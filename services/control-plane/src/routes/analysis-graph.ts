import express from 'express';
import { requireRepo, type HttpDeps } from './deps';
import { buildTours } from '../engine/repoqa-tours';
import { buildDashboard } from '../engine/repoqa-dashboard';
import { buildOnboardingMarkdown, onboardingExportFileName } from '../engine/repoqa-export';
import { runDomainRadar } from '../domain-radar-engine';
import { extractSubgraphContext } from '../engine/repoqa-graphrag';
import { asyncHandler } from '../http-error';
import { maskEventPayload, maskSensitiveText } from '../engine/repoqa-masking';

/**
 * V27-30 (B3 increment 2) — 图谱读侧域（symbols/reverse-deps/tours/dashboard/
 * radar/subgraph/onboarding/chunks）。自 routes/analysis.ts（原 515 行巨注册）
 * 按域物理拆分；跨域路由路径互不重叠，拆分不改变 Express 匹配语义。
 */

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

export function registerGraphRoutes(app: express.Express, deps: HttpDeps): void {
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

  // Issue 28: Graph RAG subgraph extraction. Deterministic (no LLM): resolves
  // the query through the worker, walks callers/callees over the in-memory
  // symbol graph and returns agent-ready Markdown with credential masking.
  app.get('/api/repos/:id/subgraph-context', asyncHandler(async (req, res) => {
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
  }));
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
}
