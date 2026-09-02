import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Repos } from './repos';
import type { Orchestrator, TaskAction } from './orchestrator';
import type { HarnessManager } from './harness-manager';
import type { EventBus } from './events';
import type { RepoQARepos } from './repoqa-repos';
import type { RepoQAWorker } from './repoqa-worker';
import { exportWorkspace, importWorkspace } from './workspace-export';
import { maskSensitiveText, maskEventPayload } from './repoqa-masking';
import {
  cloneGitRepo,
  deriveCloneName,
  validateGitBranch,
  validateGitUrl
} from './git-importer';
import { buildTours } from './repoqa-tours';
import { buildDashboard } from './repoqa-dashboard';
import { buildOnboardingMarkdown, onboardingExportFileName } from './repoqa-export';
import { previewRepo } from './repoqa-scan';
import { llmRuntimeInfo, maskHostname } from './repoqa-llm';
import { extractSubgraphContext } from './repoqa-graphrag';
import { analyzeDiff } from './repoqa-diff';
import { runDomainRadar } from './domain-radar-engine';

export interface HttpDeps {
  repos: Repos;
  orchestrator: Orchestrator;
  harnessManager: HarnessManager;
  repoqa: RepoQARepos;
  worker: RepoQAWorker;
  eventBus: EventBus;
  version: string;
  dataDir: string;
  port: number;
  exportDir: string;
  /** Absolute path to the built SPA dist. When present (and its index.html
   * exists) the app serves it with an SPA fallback; API/WS routes keep priority. */
  staticDir?: string;
}

const ACTIONS: TaskAction[] = ['pause', 'resume', 'cancel', 'approve', 'reject'];

const RADAR_CACHE_TTL_MS = 60_000;

/**
 * v0.11 — per-(repoId, query) domain-radar cache. A simple TTL Map (no Redis):
 * the Cmd+K palette debounces keystrokes to 300ms, so repeated identical
 * queries hit this cache instead of recomputing PageRank.
 */
const radarCache = new Map<string, { data: unknown; expiresAt: number }>();

const SYMBOL_TYPE_BY_KIND: Record<string, string> = {
  class: 'CLASS',
  interface: 'INTERFACE',
  method: 'FUNCTION',
  route: 'ROUTE',
  service: 'SERVICE',
  repository: 'REPOSITORY',
  advice: 'ADVICE',
  config: 'CONFIG',
  field: 'FIELD',
  mapper: 'MAPPER',
  sql: 'SQL',
  dependency: 'DEPENDENCY'
};

function symbolTypeOf(kind: string): string {
  return SYMBOL_TYPE_BY_KIND[kind] ?? 'UNKNOWN';
}

export function createHttpApp(deps: HttpDeps): express.Express {
  const app = express();

  // CORS: the web workbench runs on a different origin/port than the API server
  // (e.g. Vite dev server on 5173, API on 43110). Browsers enforce same-origin
  // for fetch and EventSource, so the API must answer with explicit CORS
  // headers, including the SSE GET preflight (no custom headers are used, so
  // the preflight only needs the origin + method).
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  // Bug-13: malformed JSON bodies must return a JSON 400, never Express's
  // default HTML error page (which leaks the SyntaxError stack trace).
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (
        err instanceof SyntaxError &&
        (err as { type?: string }).type === 'entity.parse.failed'
      ) {
        res.status(400).json({ error: 'invalid JSON body' });
        return;
      }
      next(err);
    }
  );

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: deps.version,
      port: deps.port,
      dataDir: deps.dataDir
    });
  });

  app.get('/api/runtime', (_req, res) => {
    const runtime = llmRuntimeInfo(process.env);
    res.json({
      llm: {
        mode: runtime.mode,
        host: runtime.host ? maskHostname(runtime.host) : undefined
      }
    });
  });

  app.get('/api/tasks', (_req, res) => {
    res.json({ tasks: deps.repos.listTasks() });
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = deps.repos.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ task });
  });

  app.get('/api/tasks/:id/logs', (req, res) => {
    res.json({ logs: deps.repos.listLogs(req.params.id) });
  });

  app.post('/api/tasks', (req, res) => {
    try {
      const body = req.body as {
        type: string;
        input?: Record<string, unknown>;
        workspaceId?: string;
        requiresApproval?: boolean;
      };
      const task = deps.orchestrator.createTask({
        type: body.type as 'coding' | 'shell' | 'browser',
        input: body.input ?? {},
        workspaceId: body.workspaceId ?? 'default',
        requiresApproval: Boolean(body.requiresApproval)
      });
      res.status(201).json({ task });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post('/api/tasks/:id/actions', async (req, res) => {
    try {
      const body = req.body as { action: TaskAction; approved?: boolean };
      if (!ACTIONS.includes(body.action)) {
        res.status(400).json({ error: `Unknown action: ${String(body.action)}` });
        return;
      }
      const task = await deps.orchestrator.action(
        req.params.id,
        body.action,
        body.approved
      );
      res.json({ task });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/harnesses', (_req, res) => {
    res.json({ harnesses: deps.repos.listHarnesses() });
  });

  app.post('/api/harnesses', (req, res) => {
    try {
      const body = req.body as {
        id?: string;
        name: string;
        type: 'coding' | 'shell' | 'browser' | 'external';
        bridgeAdapter?: string;
        config?: Record<string, unknown>;
      };
      const now = new Date().toISOString();
      const harness = {
        id: body.id ?? `external-${now}`,
        name: body.name,
        type: body.type,
        mode: 'external' as const,
        status: 'disconnected' as const,
        bridgeAdapter: body.bridgeAdapter ?? 'bridge-v1',
        config: body.config ?? {}
      };
      deps.repos.upsertHarness(harness);
      res.status(201).json({ harness });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/workspaces', (_req, res) => {
    res.json({ workspaces: deps.repos.listWorkspaces() });
  });

  app.post('/api/workspaces/:id/export', (req, res) => {
    try {
      const bundleDir = exportWorkspace(deps.repos, req.params.id, deps.exportDir);
      res.json({ bundleDir });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post('/api/workspaces/import', (req, res) => {
    try {
      const bundleDir = String((req.body as { bundleDir?: unknown }).bundleDir ?? '');
      const result = importWorkspace(deps.repos, bundleDir);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/repos', (_req, res) => {
    res.json({ repos: deps.repoqa.listRepos() });
  });

  app.get('/api/repos/:id', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    res.json({ repo });
  });

  app.get('/api/repos/:id/symbols', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const kind =
      typeof req.query.kind === 'string' && req.query.kind !== ''
        ? req.query.kind
        : undefined;
    // v0.7 — serve the symbol graph (not raw DB rows) so view-time
    // annotations (moduleName/qualifiedName, implicit interfaces) reach the
    // UI and MCP consumers.
    const { symbols: graphSymbols } = deps.worker.getSymbolGraph(repo.id);
    const symbols = graphSymbols
      .filter((symbol) => !kind || symbol.kind === kind)
      .map((symbol) => ({
        ...symbol,
        symbolType: symbolTypeOf(symbol.kind)
      }));
    res.json({ symbols });
  });

  // v0.5.1 (D8): HTTP twin of MCP `codecompass_reverse_deps`.
  app.get('/api/repos/:id/reverse-deps', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const symbolName =
      typeof req.query.symbolName === 'string' ? req.query.symbolName.trim() : '';
    if (!symbolName) {
      res.status(400).json({ error: 'symbolName query parameter is required' });
      return;
    }
    try {
      res.json(deps.worker.reverseDeps(repo.id, symbolName));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  // Issue 11: AST-heuristic onboarding tours. Deterministic, no LLM involved.
  app.get('/api/repos/:id/tours', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const { symbols } = deps.worker.getSymbolGraph(repo.id);
    const tours = buildTours({ repoId: repo.id, repoName: repo.name, symbols });
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    const selected = type === '' ? tours : tours.filter((tour) => tour.id === type);
    // Round 2 (Vibe): a 0-step tour is not playable; keep the API and the UI
    // on the same data contract by filtering empty tours server-side too.
    res.json({ tours: selected.filter((tour) => tour.steps.length > 0) });
  });

  // Issue 12: zero-prompt dashboard aggregation. Config values are never
  // indexed (Issue 06), and the payload is defensively masked as well.
  app.get('/api/repos/:id/dashboard', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const { symbols } = deps.worker.getSymbolGraph(repo.id);
    const dashboard = buildDashboard({ repoId: repo.id, repoName: repo.name, symbols });
    res.json({ dashboard: maskEventPayload(dashboard) });
  });

  // v0.11 — Cmd+K symbol radar. Deterministic (no LLM): the same
  // `runDomainRadar` path the ReAct agent uses, with doc-chunk evidence and a
  // 60s per-(repoId, query) cache so the palette's 300ms-debounced keystrokes
  // do not recompute PageRank on every hit.
  app.get('/api/repos/:id/radar', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    try {
      const key = `${repo.id}\u0000${query}`;
      const now = Date.now();
      const cached = radarCache.get(key);
      if (cached && cached.expiresAt > now) {
        res.json({ radar: cached.data });
        return;
      }
      const { symbols, index } = deps.worker.getSymbolGraph(repo.id);
      const chunkHitFiles = query
        ? deps.repoqa
            .searchChunks(repo.id, query)
            .map((chunk) => chunk.filePath)
            .filter((file): file is string => Boolean(file))
        : undefined;
      const radar = runDomainRadar({
        repoId: repo.id,
        ...(query ? { query } : {}),
        symbols,
        index,
        ...(chunkHitFiles ? { chunkHitFiles } : {})
      });
      const maskedRadar = maskEventPayload(radar);
      // Prune expired entries on write so the cache stays bounded.
      for (const [k, v] of radarCache) { if (v.expiresAt <= now) radarCache.delete(k); }
      radarCache.set(key, { data: maskedRadar, expiresAt: now + RADAR_CACHE_TTL_MS });
      res.json({ radar: maskedRadar });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  // v0.6.0 — Architecture Delta: base/head 两个 git ref 的多语言路由增删、
  // 断边与风险分级。复用 `codecompass diff` 的只读 git 内核，不触碰工作区。
  app.post('/api/repos/:id/architecture-delta', async (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const body = (req.body ?? {}) as { base?: unknown; head?: unknown };
    const base = typeof body.base === 'string' ? body.base.trim() : '';
    const head = typeof body.head === 'string' ? body.head.trim() : '';
    if (!base || !head) {
      res.status(400).json({ error: 'base and head git refs are required' });
      return;
    }
    try {
      const report = await analyzeDiff({ repoPath: repo.localPath, base, head });
      res.json({ delta: report.architectureDelta ?? null });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Issue 28: Graph RAG subgraph extraction. Deterministic (no LLM): resolves
  // the query through the worker, walks callers/callees over the in-memory
  // symbol graph and returns agent-ready Markdown with credential masking.
  app.get('/api/repos/:id/subgraph-context', async (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const query =
      typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'query query parameter is required' });
      return;
    }
    let maxTokens: number | undefined;
    if (req.query.maxTokens !== undefined) {
      const raw = String(req.query.maxTokens).trim();
      if (!/^\d+$/.test(raw)) {
        res.status(400).json({ error: 'maxTokens must be a positive integer' });
        return;
      }
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100_000) {
        res.status(400).json({ error: 'maxTokens must be a positive integer (1..100000)' });
        return;
      }
      maxTokens = parsed;
    }

    try {
      const graph = deps.worker.getSymbolGraph(repo.id);
      const resolution = deps.worker.resolveStartSymbolForQuery(repo.id, query);
      if (!resolution) {
        res.status(404).json({ error: `Start symbol not found: ${query}` });
        return;
      }
      const context = await extractSubgraphContext(graph.symbols, resolution.symbol, {
        root: repo.localPath,
        index: graph.index,
        callerRoots: deps.worker.resolveExactMethodCandidates(repo.id, query),
        ...(maxTokens === undefined ? {} : { maxTokens })
      });
      res.json({ context: maskEventPayload(context) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  // Issue 14: one-click ONBOARDING.md handover export. Aggregates dashboard +
  // tours into a standard Markdown doc; config values are never indexed
  // (Issue 06), and the text is defensively masked one more time.
  app.get('/api/repos/:id/export/onboarding', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const { symbols } = deps.worker.getSymbolGraph(repo.id);
    const markdown = buildOnboardingMarkdown({
      repoId: repo.id,
      repoName: repo.name,
      symbols
    });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${onboardingExportFileName(repo.name)}"`
    );
    res.send(maskSensitiveText(markdown));
  });

  app.get('/api/repos/:id/chunks', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const query =
      typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'q query parameter is required' });
      return;
    }
    res.json({ chunks: maskEventPayload(deps.repoqa.searchChunks(repo.id, query)) });
  });

  // Issue 23 — GET stays the primary form; POST accepts the same parameters in
  // a JSON body so very long pasted stack traces never hit URL length limits.
  const handleQuery = async (req: express.Request, res: express.Response) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    // Parameters come from the query string (GET) with a JSON-body fallback
    // (POST body wins when both are present).
    const body = (req.body ?? {}) as Record<string, unknown>;
    const pickString = (key: string): string => {
      const fromBody = typeof body[key] === 'string' ? (body[key] as string) : '';
      const fromQuery = typeof req.query[key] === 'string' ? (req.query[key] as string) : '';
      return (fromBody || fromQuery).trim();
    };
    const question = pickString('question');
    if (!question) {
      res.status(400).json({ error: 'question query parameter is required' });
      return;
    }
    const modeRaw = pickString('mode');
    const mode =
      modeRaw === 'architecture' ||
      modeRaw === 'call-chain' ||
      modeRaw === 'environment' ||
      modeRaw === 'incident'
        ? (modeRaw as 'architecture' | 'call-chain' | 'environment' | 'incident')
        : undefined;
    // Issue 23 — pasted stack trace for incident mode.
    const stack = pickString('stack') || undefined;
    // Explicit trace start from the frontend (Top API click): the clicked
    // symbol's exact name + file, so findStartSymbol never resolves to a
    // same-name symbol in another file (e.g. test helpers).
    const startName = pickString('startName');
    const startFile = pickString('startFile');
    const start =
      startName && startFile ? { name: startName, file: startFile } : undefined;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.flushHeaders();
    let closed = false;
    // Issue 23: detect client disconnects on the RESPONSE stream. `req.close`
    // fires as soon as the request message is complete — always true for POST
    // once express.json() consumed the body — which would silently stop the
    // SSE stream before the first event and leave the response hanging.
    res.on('close', () => {
      closed = true;
    });

    try {
      for await (const event of deps.worker.queryRepo({
        repoId: repo.id,
        question,
        mode,
        start,
        ...(stack ? { stack } : {})
      })) {
        if (closed) return;
        // Issue 07: masking middleware — every SSE payload passes through the
        // sensitive-information filter before leaving the process.
        res.write(
          `event: ${event.type}\ndata: ${JSON.stringify(maskEventPayload(event.payload))}\n\n`
        );
      }
      res.end();
    } catch (error) {
      if (!closed) {
        const message = error instanceof Error ? error.message : String(error);
        deps.repoqa.recordEvent({
          repoId: repo.id,
          eventType: 'query.failure',
          failureClass: message
        });
        res.write(
          `event: repoqa.query.error\ndata: ${JSON.stringify({ error: message })}\n\n`
        );
        res.end();
      }
    }
  };
  app.get('/api/repos/:id/query', handleQuery);
  app.post('/api/repos/:id/query', handleQuery);

  app.post('/api/repos/:id/anchor-click', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const body = (req.body ?? {}) as {
      file?: unknown;
      line?: unknown;
      symbol?: unknown;
      sessionId?: unknown;
    };
    if (typeof body.file !== 'string' || typeof body.symbol !== 'string') {
      res.status(400).json({ error: 'file and symbol are required' });
      return;
    }
    const sessionId =
      typeof body.sessionId === 'string' ? body.sessionId : undefined;
    deps.repoqa.recordEvent({
      repoId: repo.id,
      eventType: 'anchor.click',
      sessionId,
      anchorClicked: true,
      feedback:
        typeof body.line === 'number'
          ? `${body.file}:${body.line}:${body.symbol}`
          : `${body.file}:${body.symbol}`
    });
    res.status(201).json({ ok: true });
  });

  app.post('/api/repos/:id/feedback', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const body = (req.body ?? {}) as {
      feedback?: unknown;
      sessionId?: unknown;
    };
    if (typeof body.feedback !== 'string' || body.feedback.trim() === '') {
      res.status(400).json({ error: 'feedback is required' });
      return;
    }
    deps.repoqa.recordEvent({
      repoId: repo.id,
      eventType: 'feedback.submitted',
      sessionId:
        typeof body.sessionId === 'string' ? body.sessionId : undefined,
      feedback: body.feedback
    });
    res.status(201).json({ ok: true });
  });

  // Issue 08: read-only local evidence plane accessor.
  app.get('/api/events', (req, res) => {
    const query = req.query as Record<string, unknown>;
    const asString = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
    const asNumber = (value: unknown): number | undefined => {
      if (typeof value !== 'string' || value.trim() === '') return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    };
    res.json(
      deps.repoqa.listEvents({
        repoId: asString(query.repoId),
        eventType: asString(query.eventType),
        intent: asString(query.intent),
        limit: asNumber(query.limit),
        offset: asNumber(query.offset)
      })
    );
  });

  app.post('/api/repos', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        localPath?: unknown;
        branch?: unknown;
        name?: unknown;
      };
      const localPath =
        typeof body.localPath === 'string' ? body.localPath.trim() : '';
      if (!localPath) {
        res.status(400).json({ error: 'localPath is required' });
        return;
      }
      const branch =
        typeof body.branch === 'string' && body.branch.trim() !== ''
          ? body.branch.trim()
          : undefined;
      // Bug-10: respect the user-supplied display name; empty falls back to
      // the directory basename inside the worker.
      const name =
        typeof body.name === 'string' && body.name.trim() !== ''
          ? body.name.trim()
          : undefined;
      const result = await deps.worker.indexRepo({ localPath, branch, name });
      res.status(result.created ? 201 : 200).json({ repo: result.repo });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Round 2 B4: read-only pre-import preview. The frontend calls this while
  // the user types a local path so they can see exactly what will be indexed
  // (and which ignored dirs will be skipped) before committing to an import.
  app.post('/api/repos/preview', async (req, res) => {
    try {
      const body = (req.body ?? {}) as { localPath?: unknown };
      const localPath =
        typeof body.localPath === 'string' ? body.localPath.trim() : '';
      if (!localPath) {
        res.status(400).json({ error: 'localPath is required' });
        return;
      }
      const stats = await previewRepo(localPath);
      res.json({ preview: { path: localPath, ...stats } });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Personal-use lifecycle: remove the index from the catalog. Source files
  // and local clones are intentionally left on disk — the user can re-import
  // the same path later.
  app.delete('/api/repos/:id', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    if (repo.status === 'indexing') {
      res.status(409).json({ error: 'repo is still indexing; wait for it to finish first' });
      return;
    }
    deps.worker.invalidate(repo.id);
    deps.repoqa.deleteRepo(repo.id);
    res.status(204).send();
  });

  // Personal-use lifecycle: rebuild the index from the stored local path
  // without opening the import dialog. Returns 202; the catalog poll follows
  // indexing → ready/error like a fresh import.
  app.post('/api/repos/:id/reindex', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    if (repo.status === 'indexing') {
      res.status(409).json({ error: 'repo is still indexing; wait for it to finish first' });
      return;
    }
    deps.worker.invalidate(repo.id);
    deps.repoqa.updateRepoStatus(repo.id, 'indexing');
    deps.worker
      .indexRepo({
        localPath: repo.localPath,
        branch: repo.branch,
        name: repo.name
      })
      .catch(() => {
        // indexRepo never rejects — failures are recorded on the repo row.
      });
    res.status(202).json({ repo: deps.repoqa.getRepo(repo.id)! });
  });

  // Issue 19: remote repo ingestion — validated shallow clone, then async
  // indexing. The clone runs synchronously (frontend shows a "cloning" phase);
  // the index runs fire-and-forget so the frontend can poll the repo status
  // and show a second "indexing" phase until the catalog flips to ready.
  app.post('/api/repos/clone', async (req, res) => {
    try {
      const body = (req.body ?? {}) as { url?: unknown; branch?: unknown };
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!url) {
        res.status(400).json({ error: 'url is required' });
        return;
      }
      const urlCheck = validateGitUrl(url);
      if (!urlCheck.ok) {
        res.status(400).json({ error: urlCheck.error });
        return;
      }
      let branch: string | undefined;
      try {
        branch = validateGitBranch(
          typeof body.branch === 'string' && body.branch.trim() !== ''
            ? body.branch
            : undefined
        );
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : String(error)
        });
        return;
      }
      const name = deriveCloneName(url);
      const targetDir = path.join(
        deps.dataDir,
        'clones',
        `${name}-${Date.now()}`
      );
      await cloneGitRepo({ url, branch, targetDir });

      const upsert = deps.repoqa.upsertByLocalPath({
        name,
        localPath: targetDir,
        branch,
        repoUrl: url
      });
      // The worker re-upserts (idempotent) and manages idle/indexing/ready
      // itself; marking indexing here keeps the 202 response consistent with
      // the state the catalog poll will observe.
      deps.repoqa.updateRepoStatus(upsert.repo.id, 'indexing');
      deps.worker.indexRepo({ localPath: targetDir, branch, name }).catch(() => {
        // indexRepo never rejects — failures are recorded as status='error'
        // on the repo. The catch only satisfies no-floating-promises.
      });
      res.status(202).json({ repo: deps.repoqa.getRepo(upsert.repo.id)! });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/repos/:id/file/raw', async (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    const requested = req.query.path;
    if (typeof requested !== 'string' || requested === '') {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    const root = path.resolve(repo.localPath);
    const resolved = path.resolve(root, requested);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.status(403).json({ error: 'path escapes the indexed repo' });
      return;
    }

    try {
      const realRoot = await fs.realpath(root);
      const realResolved = await fs.realpath(resolved);
      const realRelative = path.relative(realRoot, realResolved);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        res.status(403).json({ error: 'path escapes the indexed repo' });
        return;
      }
      const indexedPath = realRelative.split(path.sep).join('/');
      if (!deps.repoqa.isFileIndexed(repo.id, indexedPath)) {
        res.status(403).json({ error: 'file is not part of the indexed repo' });
        return;
      }
      const raw = await fs.readFile(realResolved, 'utf8');
      const fileName = path.basename(realResolved).toLowerCase();
      const isConfigFile =
        (fileName.startsWith('application') &&
          (/\.ya?ml$/.test(fileName) || fileName.endsWith('.properties'))) ||
        fileName === 'pom.xml';
      res.type('text/plain').send(isConfigFile ? maskSensitiveText(raw) : raw);
    } catch {
      res.status(404).json({ error: 'File not found' });
    }
  });

  // Bug-R2-05: unknown /api routes must answer JSON, never Express's default
  // HTML 404 (which also breaks JSON-only API clients).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Issue 16: single-process production hosting. Mounted after every API/WS
  // route so they keep priority; unknown non-API GETs fall back to index.html
  // for client-side routing (the SPA is state-driven, no router needed — but
  // deep links and hard refreshes still hit server routes).
  if (
    deps.staticDir &&
    existsSync(path.join(deps.staticDir, 'index.html'))
  ) {
    app.use(express.static(deps.staticDir));
    app.use((req, res, next) => {
      if (
        (req.method !== 'GET' && req.method !== 'HEAD') ||
        req.path === '/api' ||
        req.path.startsWith('/api/') ||
        req.path === '/ws'
      ) {
        next();
        return;
      }
      res.sendFile(path.join(deps.staticDir!, 'index.html'));
    });
  }

  return app;
}
