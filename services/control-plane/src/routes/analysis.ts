import express from 'express';
import { requireRepo, type HttpDeps } from './deps';
import { buildTours } from '../repoqa-tours';
import { buildDashboard } from '../repoqa-dashboard';
import { buildOnboardingMarkdown, onboardingExportFileName } from '../repoqa-export';
import { runDomainRadar } from '../domain-radar-engine';
import { analyzeDiff, summarizeGitError } from '../repoqa-diff';
import { extractSubgraphContext } from '../repoqa-graphrag';
import { maskEventPayload, maskSensitiveText } from '../repoqa-masking';

/** v0.11 — per-(repoId, query) domain-radar cache. A simple TTL Map (no Redis):
 * the Cmd+K palette debounces keystrokes to 300ms, so repeated identical
 * queries hit this cache instead of recomputing PageRank. */
const RADAR_CACHE_TTL_MS = 60_000;
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

/** v0.25.0 批次 2：分析域——符号图/反向依赖/Tour/驾驶舱/radar/Delta/子图
 * RAG/ONBOARDING/chunks/query SSE/evolve SSE。自 http.ts 按域拆出，注册顺序
 * 保持原样（query 在 chunks 后、evolve 在 query 后、cards 在 evolve 后）。 */
export function registerAnalysisRoutes(app: express.Express, deps: HttpDeps): void {
  app.get('/api/repos/:id/symbols', (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
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
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
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
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
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
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
    const { symbols } = deps.worker.getSymbolGraph(repo.id);
    const dashboard = buildDashboard({ repoId: repo.id, repoName: repo.name, symbols });
    res.json({ dashboard: maskEventPayload(dashboard) });
  });

  // v0.11 — Cmd+K symbol radar. Deterministic (no LLM): the same
  // `runDomainRadar` path the ReAct agent uses, with doc-chunk evidence and a
  // 60s per-(repoId, query) cache so the palette's 300ms-debounced keystrokes
  // do not recompute PageRank on every hit.
  app.get('/api/repos/:id/radar', (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
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
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
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
      const message = error instanceof Error ? error.message : String(error);
      // R3-Bug-02 — one UI-ready sentence plus the raw git output for the
      // collapsible detail block (was: raw multi-line git stderr as-is).
      res.status(400).json({ error: summarizeGitError(message), detail: message });
    }
  });

  // Issue 28: Graph RAG subgraph extraction. Deterministic (no LLM): resolves
  // the query through the worker, walks callers/callees over the in-memory
  // symbol graph and returns agent-ready Markdown with credential masking.
  app.get('/api/repos/:id/subgraph-context', async (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
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
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
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
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
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
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
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
        // Issue 25 / Ticket 03: non-conflict failures of an incident
        // investigation persist an error card (planned conflict outcomes
        // carry their own card inside the worker and never get here).
        let errorPayload: Record<string, unknown> = { error: message };
        if (mode === 'incident') {
          const card = deps.repoqa.saveWorkbenchCard({
            repoId: repo.id,
            commit: repo.commit ?? 'unversioned',
            kind: 'incident',
            intent: question,
            ...(stack ? { echo: stack } : {}),
            status: 'error',
            error: message
          });
          errorPayload = { ...errorPayload, cardId: card.cardId, cardSeq: card.seq };
        }
        res.write(
          `event: repoqa.query.error\ndata: ${JSON.stringify(maskEventPayload(errorPayload))}\n\n`
        );
        res.end();
      }
    }
  };
  app.get('/api/repos/:id/query', handleQuery);
  app.post('/api/repos/:id/query', handleQuery);

  // Issue 24 / Ticket 04 — Evolution workbench stream. POST + JSON body (the
  // free-text intent is user prose, not a URL concern). Same SSE framing as
  // the query stream: `repoqa.evolve.stage|done|error` events, payloads pass
  // the masking middleware before leaving the process.
  const handleEvolve = async (req: express.Request, res: express.Response) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const intent =
      typeof body.intent === 'string'
        ? body.intent.trim()
        : typeof req.query.intent === 'string'
          ? req.query.intent.trim()
          : '';
    if (!intent) {
      res.status(400).json({ error: 'intent is required' });
      return;
    }
    // Correction-Pill switch: a pinned target skips the radar resolve.
    const target = typeof body.target === 'string' ? body.target.trim() : '';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.flushHeaders();
    let closed = false;
    res.on('close', () => {
      closed = true;
    });

    try {
      for await (const event of deps.worker.evolveRepo({
        repoId: repo.id,
        question: intent,
        ...(target ? { target } : {})
      })) {
        if (closed) return;
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
        // Issue 25 / Ticket 03: persist the failed delivery (planned conflict
        // outcomes carry their own card inside the worker and never get here).
        const card = deps.repoqa.saveWorkbenchCard({
          repoId: repo.id,
          commit: repo.commit ?? 'unversioned',
          kind: 'evolve',
          intent,
          ...(target ? { target } : {}),
          status: 'error',
          error: message
        });
        res.write(
          `event: repoqa.evolve.error\ndata: ${JSON.stringify(
            maskEventPayload({ error: message, cardId: card.cardId, cardSeq: card.seq })
          )}\n\n`
        );
        res.end();
      }
    }
  };
  app.post('/api/repos/:id/evolve', handleEvolve);
}
