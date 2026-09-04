/**
 * Issue 25 / Ticket 03 — workbench_cards persistence + hydrate replay.
 *
 * Four unit suites against RepoQARepos (mixed evolve/incident order,
 * (repo_id, commit, seq) conflict-replace idempotency, deleteRepo cascade,
 * +dirty commit isolation) plus HTTP integration over the real SSE streams:
 * evolve done → GET workbench-cards replays the same card, and masking keeps
 * secret-looking content out of the persisted JSON.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type Database from 'better-sqlite3';
import { openDb } from './db';
import { EventBus } from './events';
import { HarnessManager } from './harness-manager';
import { createHttpApp } from './http';
import { Orchestrator } from './orchestrator';
import { RepoQARepos } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { Repos } from './repos';

/* ---------------- shared HTTP registry (evolve.test.ts pattern) ----------- */

interface ServerContext {
  baseUrl: string;
  db: Database.Database;
  close(): Promise<void>;
}

const openServers: ServerContext[] = [];
afterAll(async () => {
  for (const ctx of openServers) await ctx.close();
});

/* ---------------- unit suites over RepoQARepos ---------------- */

interface Harness {
  db: Database.Database;
  repoqa: RepoQARepos;
}

function makeHarness(): Harness {
  const db = openDb(':memory:');
  return { db, repoqa: new RepoQARepos(db) };
}

function seedRepo(harness: Harness, id: string, commit?: string): void {
  const now = new Date().toISOString();
  harness.db
    .prepare(
      `INSERT INTO repos (id, name, local_path, branch, repo_commit, status, file_count, symbol_count, created_at, updated_at)
       VALUES (?, ?, 'x', 'main', ?, 'ready', 0, 0, ?, ?)`
    )
    .run(id, id, commit ?? null, now, now);
}

const harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses) h.db.close();
  harnesses.length = 0;
});

function freshHarness(): Harness {
  const h = makeHarness();
  harnesses.push(h);
  return h;
}

describe('workbench_cards persistence (Issue 25 / Ticket 03)', () => {
  it('persists evolve and incident cards in mixed delivery order and replays them by seq', () => {
    const h = freshHarness();
    seedRepo(h, 'r1', 'abc1234');

    const e1 = h.repoqa.saveWorkbenchCard({
      repoId: 'r1', commit: 'abc1234', kind: 'evolve', intent: '加导出', status: 'done',
      echo: { intentType: 'EXTEND' }, result: { checklists: [] }, mermaid: 'flowchart LR\n  A --> B'
    });
    const i1 = h.repoqa.saveWorkbenchCard({
      repoId: 'r1', commit: 'abc1234', kind: 'incident', intent: 'NPE 排查', status: 'done',
      echo: 'java.lang.NullPointerException...', result: { answer: '崩溃点定位到 DemoService', anchors: [] }
    });
    const e2 = h.repoqa.saveWorkbenchCard({
      repoId: 'r1', commit: 'abc1234', kind: 'evolve', intent: '第二条推演', target: 'OrderService', status: 'error', error: 'boom'
    });

    // seq allocation is per (repo, commit) stream, monotonic across kinds.
    expect(e1.seq).toBe(1);
    expect(i1.seq).toBe(2);
    expect(e2.seq).toBe(3);
    expect(e1.cardId).not.toBe(i1.cardId);
    expect(e1.cardId).not.toBe(e2.cardId);

    const cards = h.repoqa.listWorkbenchCards('r1', 'abc1234');
    expect(cards.map((card) => card.seq)).toEqual([1, 2, 3]);
    expect(cards.map((card) => card.kind)).toEqual(['evolve', 'incident', 'evolve']);
    expect(cards[0].status).toBe('done');
    expect(cards[0].echo).toEqual({ intentType: 'EXTEND' });
    expect(cards[0].result).toEqual({ checklists: [] });
    expect(cards[0].mermaid).toBe('flowchart LR\n  A --> B');
    expect(cards[1].echo).toBe('java.lang.NullPointerException...');
    expect(cards[1].result).toEqual({ answer: '崩溃点定位到 DemoService', anchors: [] });
    expect(cards[2].status).toBe('error');
    expect(cards[2].error).toBe('boom');
    expect(cards[2].target).toBe('OrderService');
    // ids are exposed as strings (frontend adopts them as card ids).
    expect(cards.map((card) => typeof card.id)).toEqual(['string', 'string', 'string']);
  });

  it('replaces the row on an explicit (repo_id, commit, seq) conflict — write-path idempotency', () => {
    const h = freshHarness();
    seedRepo(h, 'r1', 'abc1234');

    const first = h.repoqa.saveWorkbenchCard({
      repoId: 'r1', commit: 'abc1234', kind: 'evolve', intent: 'first', status: 'done', echo: { attempt: 1 }
    });
    expect(first.seq).toBe(1);

    // Network replay of the same terminal event: same explicit seq, same key.
    const replay = h.repoqa.saveWorkbenchCard({
      repoId: 'r1', commit: 'abc1234', kind: 'evolve', intent: 'first', status: 'done', echo: { attempt: 2 }, seq: 1
    });
    expect(replay.seq).toBe(1);

    const count = (h.db.prepare('SELECT COUNT(*) AS c FROM workbench_cards').get() as { c: number }).c;
    expect(count).toBe(1);
    const cards = h.repoqa.listWorkbenchCards('r1', 'abc1234');
    expect(cards).toHaveLength(1);
    expect(cards[0].echo).toEqual({ attempt: 2 });
    expect(cards[0].id).toBe(String(replay.cardId));
  });

  it('deleteRepo cascades workbench_cards together with the repo rows', () => {
    const h = freshHarness();
    seedRepo(h, 'r1', 'abc1234');
    seedRepo(h, 'r2', 'def5678');
    h.repoqa.saveWorkbenchCard({ repoId: 'r1', commit: 'abc1234', kind: 'evolve', intent: 'a', status: 'done' });
    h.repoqa.saveWorkbenchCard({ repoId: 'r2', commit: 'def5678', kind: 'incident', intent: 'b', status: 'done' });

    h.repoqa.deleteRepo('r1');

    const left = h.repoqa.listWorkbenchCards('r2', 'def5678');
    expect(left).toHaveLength(1);
    const gone = h.db
      .prepare("SELECT COUNT(*) AS c FROM workbench_cards WHERE repo_id = 'r1'")
      .get() as { c: number };
    expect(gone.c).toBe(0);
  });

  it('isolates streams by commit including the +dirty suffix; empty commit defaults to unversioned', () => {
    const h = freshHarness();
    seedRepo(h, 'r1', 'abc1234');
    h.repoqa.saveWorkbenchCard({ repoId: 'r1', commit: 'abc1234', kind: 'evolve', intent: 'clean', status: 'done' });
    h.repoqa.saveWorkbenchCard({
      repoId: 'r1', commit: 'abc1234+dirty', kind: 'evolve', intent: 'dirty', status: 'done', result: { marker: 'dirty-only' }
    });

    const clean = h.repoqa.listWorkbenchCards('r1', 'abc1234');
    const dirty = h.repoqa.listWorkbenchCards('r1', 'abc1234+dirty');
    expect(clean.map((card) => card.intent)).toEqual(['clean']);
    expect(dirty.map((card) => card.intent)).toEqual(['dirty']);
    expect(dirty[0].result).toEqual({ marker: 'dirty-only' });

    // No commit param: the repo's physical stream (repo_commit = abc1234).
    expect(h.repoqa.listWorkbenchCards('r1').map((card) => card.intent)).toEqual(['clean']);

    // Unversioned repo: cards land in the unversioned stream.
    seedRepo(h, 'r2');
    const unv = h.repoqa.saveWorkbenchCard({ repoId: 'r2', commit: 'unversioned', kind: 'incident', intent: 'x', status: 'done' });
    expect(unv.seq).toBe(1);
    expect(h.repoqa.listWorkbenchCards('r2', 'unversioned')).toHaveLength(1);
  });
});

/* ---------------- HTTP integration: SSE → persist → GET replay ------------- */

async function importReady(baseUrl: string, repoPath: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/repos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ localPath: repoPath })
  });
  const body = (await response.json()) as { repo?: { id: string; status: string }; error?: string };
  expect(response.status).toBe(201);
  expect(body.repo?.status).toBe('ready');
  return body.repo!.id;
}

async function makeOrderRepo(root: string, extraConfig = false): Promise<void> {
  const pkg = path.join(root, 'src', 'main', 'java', 'com', 'demo', 'order');
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(path.join(root, 'pom.xml'), '<project/>\n');
  await fs.writeFile(
    path.join(pkg, 'OrderService.java'),
    'package com.demo.order;\n' +
      '/** 订单服务:订单创建、查询与导出。 */\n' +
      'public class OrderService {\n' +
      '  private final OrderRepository orderRepository = new OrderRepository();\n' +
      '  public Order create(Order order) {\n' +
      '    return orderRepository.save(order);\n' +
      '  }\n' +
      '  public void exportExcel() {\n' +
      '    orderRepository.findAll();\n' +
      '  }\n' +
      '}\n'
  );
  await fs.writeFile(
    path.join(pkg, 'OrderRepository.java'),
    'package com.demo.order;\npublic class OrderRepository {\n  public Order save(Order order) { return order; }\n  public Order[] findAll() { return new Order[0]; }\n}\n'
  );
  await fs.writeFile(
    path.join(pkg, 'Order.java'),
    'package com.demo.order;\npublic class Order { public long id; }\n'
  );
  await fs.writeFile(
    path.join(pkg, 'ExportService.java'),
    'package com.demo.order;\npublic class ExportService {\n  public void export() {}\n}\n'
  );
  await fs.writeFile(
    path.join(pkg, 'ReportHandler.java'),
    'package com.demo.order;\npublic class ReportHandler {\n  public void handle() {}\n}\n'
  );
  if (extraConfig) {
    // Sensitive-looking config value: nothing from the config scan may leak
    // into the persisted card JSON (Issue 07 masker + hydrate middleware).
    const res = path.join(root, 'src', 'main', 'resources');
    await fs.mkdir(res, { recursive: true });
    await fs.writeFile(path.join(res, 'application.yml'), 'spring:\n  datasource:\n    password: supersecret\n');
  }
}

async function streamEvolve(
  baseUrl: string,
  repoId: string,
  body: Record<string, unknown>
): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const response = await fetch(`${baseUrl}/api/repos/${repoId}/evolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  return parseSse(text);
}

function parseSse(text: string): Array<{ event: string; data: Record<string, unknown> }> {
  const frames: Array<{ event: string; data: Record<string, unknown> }> = [];
  let event = '';
  for (const line of text.split('\n')) {
    const raw = line.replace(/\r$/, '');
    if (raw.startsWith('event:')) {
      event = raw.slice(6).trim();
    } else if (raw.startsWith('data:') && event) {
      try {
        frames.push({ event, data: JSON.parse(raw.slice(5).trim()) as Record<string, unknown> });
      } catch {
        frames.push({ event, data: {} });
      }
      event = '';
    }
  }
  return frames;
}

describe('GET /api/repos/:id/workbench-cards (hydrate replay)', () => {
  it('replays the evolve done card after the SSE stream ends (same order, same content)', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cards-'));
    const db = openDb(':memory:');
    const repos = new Repos(db);
    const repoqa = new RepoQARepos(db);
    const eventBus = new EventBus();
    const worker = new RepoQAWorker(repoqa, eventBus);
    const app = createHttpApp({
      repos,
      orchestrator: new Orchestrator(repos),
      harnessManager: new HarnessManager({ repos, eventBus }),
      repoqa,
      worker,
      eventBus,
      version: 'test',
      dataDir: tempDir,
      port: 0,
      exportDir: path.join(tempDir, 'exports')
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    openServers.push({ baseUrl, db, close: () => new Promise<void>((resolve) => server.close(() => resolve())) });

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cards-repo-'));
    await makeOrderRepo(root);
    const repoId = await importReady(baseUrl, root);

    const frames = await streamEvolve(baseUrl, repoId, { intent: '给订单模块加 Excel 导出' });
    const doneFrame = frames.find((frame) => frame.event === 'repoqa.evolve.done');
    expect(doneFrame).toBeDefined();
    const done = doneFrame!.data as unknown as {
      intentEcho: unknown; result: unknown; mermaid?: string; commit: string; cardId: string; cardSeq: number;
    };
    // Terminal payload discloses the server card id/seq.
    expect(typeof done.cardId).toBe('string');
    expect(done.cardSeq).toBe(1);

    const response = await fetch(`${baseUrl}/api/repos/${repoId}/workbench-cards`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      repoId: string;
      commit: string;
      cards: Array<{
        id: string; seq: number; kind: string; status: string;
        intent: string; echo?: unknown; result?: unknown; mermaid: string | null;
      }>;
    };
    expect(body.repoId).toBe(repoId);
    expect(typeof body.commit).toBe('string');
    expect(body.commit.length).toBeGreaterThan(0);
    expect(body.cards).toHaveLength(1);
    const card = body.cards[0];
    expect(card.id).toBe(done.cardId);
    expect(card.seq).toBe(1);
    expect(card.kind).toBe('evolve');
    expect(card.status).toBe('done');
    expect(card.intent).toBe('给订单模块加 Excel 导出');
    expect(card.echo).toEqual(done.intentEcho);
    expect(card.result).toEqual(done.result);
    expect(card.mermaid ?? null).toBe(done.mermaid ?? null);

    // An explicit unknown commit replays an empty stream.
    const empty = await fetch(`${baseUrl}/api/repos/${repoId}/workbench-cards?commit=deadbeef`);
    const emptyBody = (await empty.json()) as { cards: unknown[] };
    expect(emptyBody.cards).toEqual([]);

    // Unknown repo → 404.
    const missing = await fetch(`${baseUrl}/api/repos/nope/workbench-cards`);
    expect(missing.status).toBe(404);
  }, 30_000);

  it('keeps secret-looking values out of the persisted card JSON (masking)', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-cards-mask-'));
    const db = openDb(':memory:');
    const repos = new Repos(db);
    const repoqa = new RepoQARepos(db);
    const eventBus = new EventBus();
    const worker = new RepoQAWorker(repoqa, eventBus);
    const app = createHttpApp({
      repos,
      orchestrator: new Orchestrator(repos),
      harnessManager: new HarnessManager({ repos, eventBus }),
      repoqa,
      worker,
      eventBus,
      version: 'test',
      dataDir: tempDir,
      port: 0,
      exportDir: path.join(tempDir, 'exports')
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    openServers.push({ baseUrl, db, close: () => new Promise<void>((resolve) => server.close(() => resolve())) });

    // A repo whose config file carries a password — the scan-backed artifacts
    // must not leak it into the persisted card.
    const root = path.join(tempDir, 'secret-repo');
    await makeOrderRepo(root, true);
    const repoId = await importReady(baseUrl, root);

    const frames = await streamEvolve(baseUrl, repoId, { intent: '给订单模块加 Excel 导出' });
    expect(frames.some((frame) => frame.event === 'repoqa.evolve.done')).toBe(true);

    // Raw persisted JSON never carries the secret.
    const rows = db
      .prepare("SELECT echo_json, result_json, mermaid FROM workbench_cards WHERE repo_id = ?")
      .all(repoId) as Array<{ echo_json: string | null; result_json: string | null; mermaid: string | null }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.echo_json ?? '').not.toContain('supersecret');
      expect(row.result_json ?? '').not.toContain('supersecret');
      expect(row.mermaid ?? '').not.toContain('supersecret');
    }

    // The hydrate endpoint (masking middleware) is likewise clean.
    const response = await fetch(`${baseUrl}/api/repos/${repoId}/workbench-cards`);
    expect((await response.text())).not.toContain('supersecret');
  }, 30_000);
});
