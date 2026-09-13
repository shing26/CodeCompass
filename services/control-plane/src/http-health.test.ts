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
import { RepoQARepos } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';

/**
 * v0.27-B R6 — /health 深检（依赖探针，不再口头 ok）与 /api/runtime 进程指标。
 */

let base = '';
let server: http.Server;
let dir: string;
let db: ReturnType<typeof openDb>;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-health-'));
  db = openDb(':memory:');
  const repoqa = new RepoQARepos(db);
  const eventBus = new EventBus();
  const repos = new Repos(db);
  const worker = new RepoQAWorker(repoqa, eventBus);
  const app = createHttpApp({
    repos,
    orchestrator: new Orchestrator(repos),
    harnessManager: new HarnessManager({ repos, eventBus }),
    repoqa,
    worker,
    eventBus,
    version: 'test',
    dataDir: dir,
    port: 0,
    exportDir: path.join(dir, 'exports'),
    db
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('R6 /health deep check', () => {
  it('healthy deps → 200 with checks map, legacy fields intact', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 'ok', version: 'test' });
    expect(body.checks).toEqual({ db: 'ok', dataDir: 'ok' });
    expect(body).toHaveProperty('checks');
  });

  it('no probe-file residue after health (write+delete discipline)', async () => {
    await fetch(`${base}/health`);
    const probes = fs.readdirSync(dir).filter((f) => f.startsWith('.health-probe'));
    expect(probes).toEqual([]);
  });
});

describe('R6 /api/runtime process metrics', () => {
  it('carries uptimeSec/rssKb/indexingJobs numbers (loopback peer, additive)', async () => {
    const body = (await (await fetch(`${base}/api/runtime`)).json()) as {
      llm?: unknown;
      process?: Record<string, unknown>;
    };
    expect(body.llm).toBeDefined(); // 既有面不动
    expect(typeof body.process?.uptimeSec).toBe('number');
    expect(typeof body.process?.rssKb).toBe('number');
    // P1-3：running map 只登记索引任务——字段实名 indexingJobs，不冒充全任务集。
    expect(typeof body.process?.indexingJobs).toBe('number');
    expect((body.process!.uptimeSec as number) >= 0).toBe(true);
  });
});

describe('R6 degraded path', () => {
  it('closed DB → 503 degraded with checks.db=down (never a verbal ok)', async () => {
    // 第二实例：关库制造真实依赖故障
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-health503-'));
    const db2 = openDb(':memory:');
    const repoqa2 = new RepoQARepos(db2);
    const bus2 = new EventBus();
    const repos2 = new Repos(db2);
    const app2 = createHttpApp({
      repos: repos2,
      orchestrator: new Orchestrator(repos2),
      harnessManager: new HarnessManager({ repos: repos2, eventBus: bus2 }),
      repoqa: repoqa2,
      worker: new RepoQAWorker(repoqa2, bus2),
      eventBus: bus2,
      version: 'test',
      dataDir: dir2,
      port: 0,
      exportDir: dir2,
      db: db2
    });
    db2.close();
    const srv2 = http.createServer(app2);
    await new Promise<void>((resolve) => srv2.listen(0, '127.0.0.1', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(srv2.address() as AddressInfo).port}/health`);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { status: string; checks: { db: string; dataDir: string } };
      expect(body.status).toBe('degraded');
      expect(body.checks).toEqual({ db: 'down', dataDir: 'ok' });
    } finally {
      await new Promise<void>((resolve) => srv2.close(() => resolve()));
      fs.rmSync(dir2, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('unwritable dataDir → 503 with checks.dataDir=down (R6 review P2-7)', async () => {
    const ghost = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-healthwd-')), 'no-such-dir');
    const repoqa3 = new RepoQARepos(db);
    const bus3 = new EventBus();
    const app3 = createHttpApp({
      repos: new Repos(db),
      orchestrator: new Orchestrator(new Repos(db)),
      harnessManager: new HarnessManager({ repos: new Repos(db), eventBus: bus3 }),
      repoqa: repoqa3,
      worker: new RepoQAWorker(repoqa3, bus3),
      eventBus: bus3,
      version: 'test',
      dataDir: ghost, // 不存在的目录：探针 writeFileSync 必 ENOENT
      port: 0,
      exportDir: ghost,
      db
    });
    const srv3 = http.createServer(app3);
    await new Promise<void>((resolve) => srv3.listen(0, '127.0.0.1', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(srv3.address() as AddressInfo).port}/health`);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { status: string; checks: { db: string; dataDir: string } };
      expect(body.checks).toEqual({ db: 'ok', dataDir: 'down' });
    } finally {
      await new Promise<void>((resolve) => srv3.close(() => resolve()));
      fs.rmSync(path.dirname(ghost), { recursive: true, force: true });
    }
  });

  it('no db handle → checks.db=skipped, never a verbal ok (R6 review P1-2)', async () => {
    const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-healthskip-'));
    const repoqa4 = new RepoQARepos(db);
    const bus4 = new EventBus();
    const repos4 = new Repos(db);
    const app4 = createHttpApp({
      repos: repos4,
      orchestrator: new Orchestrator(repos4),
      harnessManager: new HarnessManager({ repos: repos4, eventBus: bus4 }),
      repoqa: repoqa4,
      worker: new RepoQAWorker(repoqa4, bus4),
      eventBus: bus4,
      version: 'test',
      dataDir: dir4,
      port: 0,
      exportDir: dir4
      // db 故意不传
    });
    const srv4 = http.createServer(app4);
    await new Promise<void>((resolve) => srv4.listen(0, '127.0.0.1', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(srv4.address() as AddressInfo).port}/health`);
      expect(res.status).toBe(200); // skip 不判死
      const body = (await res.json()) as { checks: { db: string; dataDir: string } };
      expect(body.checks).toEqual({ db: 'skipped', dataDir: 'ok' });
    } finally {
      await new Promise<void>((resolve) => srv4.close(() => resolve()));
      fs.rmSync(dir4, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
