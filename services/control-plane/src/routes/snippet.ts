import express from 'express';
import { asyncHandler } from '../http-error';
import { maskEventPayload, maskSensitiveText } from '../engine/repoqa-masking';
import { analyzeSnippet } from '../engine/repoqa-snippet';

/**
 * v1.4 票 02 — snippet graph endpoint.
 *
 * `POST /api/snippets/graph` turns one pasted TS/JS source string into a
 * deterministic call graph. No repo, no disk, no database: the analysis is a
 * pure in-memory parse + resolve, so the response is fast and side-effect free.
 * Replies carry symbol names and positions only — never the pasted source
 * itself (the caller already has it; echoing it back would turn "paste to
 * inspect" into a source-egress channel).
 */
export function registerSnippetRoutes(app: express.Express): void {
  app.post('/api/snippets/graph', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { source?: unknown; fileName?: unknown };
    const source = typeof body.source === 'string' ? body.source : '';
    const fileName =
      typeof body.fileName === 'string' && body.fileName.trim() !== ''
        ? body.fileName.trim().slice(0, 200)
        : undefined;
    if (source.trim() === '') {
      res.status(400).json({ error: 'source is required', code: 'snippet_required' });
      return;
    }
    try {
      const graph = analyzeSnippet({ source, fileName });
      // v1.4.1 评审 P2 — 与 subgraph-context 同尺：复合载荷整包过掩码
      // （节点名/文件路径/边都出库），而不是只掩 mermaid 文本。
      res.json({ graph: maskEventPayload(graph) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes('exceeds')
        ? 'snippet_too_large'
        : 'snippet_parse_failed';
      res.status(400).json({ error: maskSensitiveText(message), code });
    }
  }));
}
