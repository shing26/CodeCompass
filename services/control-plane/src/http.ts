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
    res.json({ symbols: deps.repoqa.listSymbols(repo.id, kind) });
  });

  // Issue 11: AST-heuristic onboarding tours. Deterministic, no LLM involved.
  app.get('/api/repos/:id/tours', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const symbols = deps.repoqa.listSymbols(repo.id);
    const tours = buildTours({ repoId: repo.id, repoName: repo.name, symbols });
    const type = typeof req.query.type === 'string' ? req.query.type.trim() : '';
    res.json({ tours: type === '' ? tours : tours.filter((tour) => tour.id === type) });
  });

  // Issue 12: zero-prompt dashboard aggregation. Config values are never
  // indexed (Issue 06), and the payload is defensively masked as well.
  app.get('/api/repos/:id/dashboard', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const symbols = deps.repoqa.listSymbols(repo.id);
    const dashboard = buildDashboard({ repoId: repo.id, repoName: repo.name, symbols });
    res.json({ dashboard: maskEventPayload(dashboard) });
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
    const symbols = deps.repoqa.listSymbols(repo.id);
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

  app.get('/api/repos/:id/query', async (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const question =
      typeof req.query.question === 'string' ? req.query.question.trim() : '';
    if (!question) {
      res.status(400).json({ error: 'question query parameter is required' });
      return;
    }
    const mode =
      req.query.mode === 'architecture' ||
      req.query.mode === 'call-chain' ||
      req.query.mode === 'environment'
        ? req.query.mode
        : undefined;
    // Explicit trace start from the frontend (Top API click): the clicked
    // symbol's exact name + file, so findStartSymbol never resolves to a
    // same-name symbol in another file (e.g. test helpers).
    const startName =
      typeof req.query.startName === 'string' ? req.query.startName.trim() : '';
    const startFile =
      typeof req.query.startFile === 'string' ? req.query.startFile.trim() : '';
    const start =
      startName && startFile ? { name: startName, file: startFile } : undefined;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.flushHeaders();
    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    try {
      for await (const event of deps.worker.queryRepo({
        repoId: repo.id,
        question,
        mode,
        start
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
  });

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
