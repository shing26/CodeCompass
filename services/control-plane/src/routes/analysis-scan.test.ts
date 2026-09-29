/**
 * v1.2 票 02 — 体检面数据通道（`GET /api/repos/:id/scan`）：
 * ① HTTP twin 与 MCP 面同引擎同输入（deep-equal runScan 直调）；
 * ② (repoId, commit) 缓存语义——命中只算一次（getSymbolGraph 调用计数为观测点），
 *    commit 变化走新键重新计算；
 * ③ 精度摘要端点逐字段直读 ratchet-baseline.json（仓库内运行时）。
 * 桩 HttpDeps：路由只取 repoqa.getRepo 与 worker.getSymbolGraph 两处。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerGraphRoutes } from './analysis-graph';
import type { HttpDeps } from './deps';
import { runScan } from '../scan-engine';
import { buildCallIndex } from '../engine/repoqa-callchain';
import { cockpitBaseUrl } from '../config';
import type { RepoSymbol } from '../ingest/repoqa-repos';

const symbols = [
  {
    id: 's1',
    repoId: 'r1',
    kind: 'method',
    name: 'lonelyHelper',
    filePath: 'src/a.ts',
    lineStart: 3,
    signature: 'lonelyHelper()'
  },
  {
    id: 's2',
    repoId: 'r1',
    kind: 'method',
    name: 'hubEntry',
    filePath: 'src/b.ts',
    lineStart: 7,
    signature: 'hubEntry()',
    calls: [{ target: 'lonelyHelper', line: 8 }]
  }
] as unknown as RepoSymbol[];
const index = buildCallIndex(symbols);

describe('GET /api/repos/:id/scan (v1.2 票 02)', () => {
  let baseUrl = '';
  let server: http.Server;
  const repo = {
    id: 'r1',
    name: 'scan-fixture',
    commit: 'abc123',
    status: 'ready',
    localPath: 'D:/x',
    branch: 'main',
    fileCount: 0,
    symbolCount: 0,
    createdAt: '',
    updatedAt: ''
  };
  const getSymbolGraph = vi.fn(() => ({ symbols, index }));

  beforeAll(async () => {
    const deps = {
      repoqa: { getRepo: (id: string) => (id === repo.id ? repo : undefined) },
      worker: { getSymbolGraph }
    } as unknown as HttpDeps;
    const app = express();
    app.use(express.json());
    registerGraphRoutes(app, deps);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns the runScan output verbatim (HTTP twin of the MCP tool)', async () => {
    const expected = runScan({
      repoId: repo.id,
      repoName: repo.name,
      symbols,
      index,
      baseUrl: cockpitBaseUrl()
    });
    const res = await fetch(`${baseUrl}/api/repos/r1/scan`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scan: typeof expected };
    expect(body.scan.buckets.map((b) => b.id)).toEqual([
      'orphanedPublic',
      'hubs',
      'oversized',
      'deepChains',
      'oversizedFiles'
    ]);
    expect(body.scan).toEqual(expected);
  });

  it('serves repeated requests for the same (repoId, commit) from cache', async () => {
    const before = getSymbolGraph.mock.calls.length;
    const first = await (await fetch(`${baseUrl}/api/repos/r1/scan`)).json();
    const second = await (await fetch(`${baseUrl}/api/repos/r1/scan`)).json();
    expect(second).toEqual(first);
    // 两次请求引擎调用数零增长——同键全部命中 TTL 缓存（test 1 已填充）。
    expect(getSymbolGraph.mock.calls.length).toBe(before);
  });

  it('recomputes when the commit advances (new cache key)', async () => {
    const before = getSymbolGraph.mock.calls.length;
    repo.commit = 'def456';
    const res = await fetch(`${baseUrl}/api/repos/r1/scan`);
    expect(res.status).toBe(200);
    expect(getSymbolGraph.mock.calls.length).toBe(before + 1);
  });

  it('precision summary reads ratchet-baseline.json field-for-field', async () => {
    const res = await fetch(`${baseUrl}/api/precision/summary`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { available: boolean; baseline: unknown };
    // 测试 cwd = services/control-plane → 路径解析向上两级命中仓库根。
    const file = path.resolve(process.cwd(), '..', '..', 'scripts', 'precision', 'ratchet-baseline.json');
    expect(body.available).toBe(true);
    expect(body.baseline).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')));
  });
});
