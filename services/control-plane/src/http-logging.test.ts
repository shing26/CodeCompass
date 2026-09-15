import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from './db';
import { EventBus } from './events';
import { HarnessManager } from './harness-manager';
import { createHttpApp } from './http';
import { Orchestrator } from './orchestrator';
import { Repos } from './repos';
import { RepoQARepos } from './ingest/repoqa-repos';
import { RepoQAWorker } from './ingest/repoqa-worker';
import { ServerLogger } from './log-sink';

/**
 * v0.27-B R5 集成面：createHttpApp 装配后——每条 HTTP 响应落一行请求日志，
 * requestId 与 x-mhw-request-id 头一一对应；未捕获 500 的 error 行与请求行
 * 同文件同 requestId（错误事后取证的关联键，R5 review P2-7c）。
 */

function readLines(dir: string): Array<Record<string, unknown>> {
  const f = path.join(dir, 'logs');
  return fs
    .readdirSync(f)
    .filter((n) => n.endsWith('.jsonl'))
    .flatMap((n) =>
      fs
        .readFileSync(path.join(f, n), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    );
}

function buildStack(dataDir: string) {
  const log = new ServerLogger(dataDir, 'info');
  const db = openDb(':memory:');
  const repoqa = new RepoQARepos(db);
  const eventBus = new EventBus();
  const repos = new Repos(db);
  const app = createHttpApp({
    repos,
    orchestrator: new Orchestrator(repos),
    harnessManager: new HarnessManager({ repos, eventBus }),
    repoqa,
    worker: new RepoQAWorker(repoqa, eventBus),
    eventBus,
    version: 'test',
    dataDir,
    port: 0,
    exportDir: path.join(dataDir, 'exports'),
    logger: log
  });
  return { log, db, app };
}

let base = '';
let server: http.Server;
let log: ServerLogger;
let dir: string;
let db: ReturnType<typeof openDb>;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-httblog-'));
  const stack = buildStack(dir);
  log = stack.log;
  db = stack.db;
  server = http.createServer(stack.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  log.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('v0.27-B R5: request lines land in the sink', () => {
  it('200 GET: one http line with the requestId shared with the response header', async () => {
    const res = await fetch(`${base}/api/repos`);
    expect(res.status).toBe(200);
    const id = res.headers.get('x-mhw-request-id');
    expect(id).toMatch(/^req-/);
    const mine = readLines(dir).filter((l) => l.requestId === id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      level: 'info',
      scope: 'http',
      method: 'GET',
      path: '/api/repos',
      status: 200
    });
    expect(typeof mine[0].durMs).toBe('number');
  });

  it('400 malformed body is logged as a request line (not an error line)', async () => {
    const res = await fetch(`${base}/api/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops'
    });
    expect(res.status).toBe(400);
    const id = res.headers.get('x-mhw-request-id');
    const mine = readLines(dir).filter((l) => l.requestId === id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 400, level: 'info' });
  });

  it('query strings never enter the line (PII posture, R5 review P2-1)', async () => {
    const res = await fetch(`${base}/api/repos/r%201/gate-runs?limit=5&secret=hunter2`);
    expect([200, 404, 500]).toContain(res.status);
    const id = res.headers.get('x-mhw-request-id');
    const rendered = JSON.stringify(readLines(dir).filter((l) => l.requestId === id));
    expect(rendered).not.toContain('hunter2');
    expect(rendered).not.toContain('limit=5');
  });
});

describe('v0.27-B R5: unhandled 500 correlates info+error in the same sink', () => {
  it('closed-DB route → JSON 500 + info line + error line sharing one requestId', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-httblog500-'));
    const stack = buildStack(dir2);
    stack.db.close(); // 真实故障注入：SQLite 关闭 → 路由同步 throw → errorMiddleware
    const srv = http.createServer(stack.app);
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/repos/whatever/gate-runs`);
      expect(res.status).toBe(500);
      expect(await res.json()).toMatchObject({ error: 'internal server error', code: 'internal_error' });
      const id = res.headers.get('x-mhw-request-id');
      const mine = readLines(dir2).filter((l) => l.requestId === id);
      const info = mine.find((l) => l.level === 'info');
      const err = mine.find((l) => l.level === 'error');
      expect(info, 'info line with same requestId').toBeTruthy();
      expect(err, 'error line with same requestId').toBeTruthy();
      expect(err!.scope).toBe('http');
      expect(String(err!.msg)).toContain('unhandled');
    } finally {
      await new Promise<void>((resolve) => srv.close(() => resolve()));
      stack.log.close();
      fs.rmSync(dir2, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
