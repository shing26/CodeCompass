import express from 'express';
import { asyncHandler } from '../http-error';
import { requireRepo, type HttpDeps } from './deps';
import { maskEventPayload } from '../engine/repoqa-masking';

/**
 * V27-30 (B3 increment 2) — SSE 流域（query GET/POST + evolve POST）。
 * 自 routes/analysis.ts 按域物理拆分，逐字搬家零行为变更。
 * 卡片/事件落库语义（Issue 23/24/25）原样保留。
 */
export function registerStreamRoutes(app: express.Express, deps: HttpDeps): void {
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
  app.get('/api/repos/:id/query', asyncHandler(handleQuery));
  app.post('/api/repos/:id/query', asyncHandler(handleQuery));

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
  app.post('/api/repos/:id/evolve', asyncHandler(handleEvolve));
}
