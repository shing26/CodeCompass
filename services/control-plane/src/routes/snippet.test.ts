/**
 * v1.4 票 02 — snippet graph: engine behaviour + HTTP contract.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerSnippetRoutes } from './snippet';
import { analyzeSnippet, SNIPPET_MAX_SOURCE_BYTES } from '../engine/repoqa-snippet';

const SNIPPET = [
  'function loadUser(id: string): string {',
  "  const raw = fetchUser(id);",
  '  return normalize(raw);',
  '}',
  '',
  'function fetchUser(id: string): string {',
  '  return normalize(id);',
  '}',
  '',
  'function normalize(value: string): string {',
  '  return value.trim();',
  '}',
  ''
].join('\n');

describe('analyzeSnippet (v1.4 ticket 02)', () => {
  it('builds the call graph for a multi-function snippet', () => {
    const graph = analyzeSnippet({ source: SNIPPET });
    const names = graph.nodes.map((node) => node.name);
    expect(names).toEqual(expect.arrayContaining(['loadUser', 'fetchUser', 'normalize']));
    const idOf = (name: string): string => graph.nodes.find((node) => node.name === name)!.id;
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: idOf('loadUser'), to: idOf('fetchUser') }),
        expect.objectContaining({ from: idOf('fetchUser'), to: idOf('normalize') })
      ])
    );
    // trim() is a method on a parameter — statically unbindable inside the
    // snippet: counted as a break, never drawn as an edge.
    expect(graph.breaks.total).toBeGreaterThan(0);
    expect(graph.mermaid).toContain('flowchart LR');
    expect(graph.mermaid).toContain('loadUser · L1');
  });

  it('counts unresolvable calls by reason instead of inventing edges', () => {
    const source = [
      'function run(): void {',
      '  console.log(missingHelper());',
      '}',
      ''
    ].join('\n');
    const graph = analyzeSnippet({ source });
    expect(graph.edges).toHaveLength(0);
    expect(graph.breaks.external + graph.breaks.unresolved + graph.breaks.dynamic).toBe(
      graph.breaks.total
    );
    // The name does not exist anywhere in the snippet: EXTERNAL.
    expect(graph.breaks.external).toBeGreaterThan(0);
  });

  it('caps the rendered graph but keeps the full node list in the payload', () => {
    const lines: string[] = [];
    const total = 230;
    for (let index = 0; index < total; index += 1) {
      lines.push(`function fn${index}(): void {}`);
    }
    const graph = analyzeSnippet({ source: lines.join('\n') });
    expect(graph.nodes).toHaveLength(total);
    expect(graph.stats.truncated).toBe(true);
    expect(graph.stats.droppedNodes).toBe(total - 200);
    expect(graph.mermaid).toContain('个函数未显示');
    // Only data lines are drawn; the mermaid source must not carry 230 nodes.
    const drawn = (graph.mermaid.match(/\bs\d+\["/g) ?? []).length;
    expect(drawn).toBe(200);
  });

  it('rejects empty and oversized sources', () => {
    expect(() => analyzeSnippet({ source: '   ' })).toThrow(/source is required/);
    expect(() =>
      analyzeSnippet({ source: 'x'.repeat(SNIPPET_MAX_SOURCE_BYTES + 1) })
    ).toThrow(/exceeds/);
  });
});

describe('POST /api/snippets/graph (v1.4 ticket 02)', () => {
  let baseUrl = '';
  let server: http.Server;

  beforeAll(async () => {
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    registerSnippetRoutes(app);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (body: unknown): Promise<Response> =>
    fetch(`${baseUrl}/api/snippets/graph`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

  it('answers with the graph shape and never echoes the source back', async () => {
    const res = await post({ source: SNIPPET, fileName: 'pasted.ts' });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      graph: { nodes: Array<{ name: string }>; edges: unknown[]; breaks: { total: number }; mermaid: string };
    };
    expect(body.graph.nodes.map((node) => node.name)).toContain('loadUser');
    expect(body.graph.mermaid).toContain('flowchart LR');
    // The pasted body itself (a comment/string unique to it) must not travel back.
    expect(text).not.toContain('const raw = fetchUser(id)');
  });

  it('rejects empty and non-string sources with a code', async () => {
    const empty = await post({ source: '   ' });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { code?: string }).code).toBe('snippet_required');

    const missing = await post({});
    expect(missing.status).toBe(400);

    const badType = await post({ source: 42 });
    expect(badType.status).toBe(400);
  });

  it('rejects oversized sources with snippet_too_large', async () => {
    const res = await post({ source: 'x'.repeat(SNIPPET_MAX_SOURCE_BYTES + 10) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('snippet_too_large');
  });
});
