/**
 * v0.26-B / ADR-0017 — gate run persistence + history replay.
 *
 * Store unit suites over RepoQARepos (row + materialized routes + event
 * double-write, newest-first paging, dirty stream isolation, options snapshot,
 * deleteRepo cascade) plus HTTP integration against a real two-commit git
 * fixture: the POST verdict echo equals the stored row, the ticket-14 error
 * contract rides the bad-ref path (400 one-line + error row recorded), and
 * unknown repos hit the shared requireRepo 404 guard.
 */
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from './db';
import { EventBus } from './events';
import { HarnessManager } from './harness-manager';
import { createHttpApp } from './http';
import { Orchestrator } from './orchestrator';
import { RepoQARepos, type GateRunRow } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { Repos } from './repos';

/* ---------------- store unit suites ---------------- */

interface Harness {
  db: Database.Database;
  repoqa: RepoQARepos;
}

const harnesses: Harness[] = [];
afterAll(() => {
  for (const h of harnesses) h.db.close();
});

function freshHarness(repoId = 'gate-1'): Harness {
  const db = openDb(':memory:');
  const repoqa = new RepoQARepos(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO repos (id, name, local_path, branch, repo_commit, status, file_count, symbol_count, created_at, updated_at)
     VALUES (?, ?, 'x', 'main', ?, 'ready', 0, 0, ?, ?)`
  ).run(repoId, repoId, 'abc123', now, now);
  harnesses.push({ db, repoqa });
  return { db, repoqa };
}

function baseInput(overrides: Partial<Parameters<RepoQARepos['saveGateRun']>[0]> = {}) {
  return {
    repoId: 'gate-1',
    commit: 'abc123',
    base: 'HEAD~1',
    head: 'HEAD',
    options: { maxAffectedRoutes: 0, failOnBreak: true },
    status: 'PASS' as const,
    violationsCount: 0,
    routes: [],
    ...overrides
  };
}

describe('saveGateRun / listGateRuns (v0.26-B)', () => {
  it('writes row + materialized routes + one gate.run event in a single seam', () => {
    const h = freshHarness();
    const { runId } = h.repoqa.saveGateRun(
      baseInput({
        status: 'FAIL',
        violationsCount: 2,
        routes: [
          { route: '/api/owners', displayPath: '/api/owners', riskLevel: 'HIGH' },
          { route: '/api/owners/{id}', displayPath: '/api/owners/{id}', riskLevel: 'LOW' }
        ],
        payload: { violations: ['x'], impactedApis: [] }
      })
    );
    expect(runId).toBeTruthy();
    const { runs, total } = h.repoqa.listGateRuns('gate-1');
    expect(total).toBe(1);
    expect(runs[0].routesCount).toBe(2);
    expect(runs[0].status).toBe('FAIL');
    expect(runs[0].violationsCount).toBe(2);
    expect(runs[0].options).toEqual({ maxAffectedRoutes: 0, failOnBreak: true });
    expect(runs[0].payload).toEqual({ violations: ['x'], impactedApis: [] });
    const events = h.repoqa.listEvents({ repoId: 'gate-1', eventType: 'gate.run' });
    expect(events.total).toBe(1);
    // intent stays the enumerated dimension; refs+verdict ride feedback
    expect(events.events[0].intent).toBe('gate');
    expect(JSON.parse(events.events[0].feedback!)).toEqual({
      base: 'HEAD~1',
      head: 'HEAD',
      status: 'FAIL'
    });
  });

  it('dedupes same-key route lines and counts what actually lands (review #1)', () => {
    const h = freshHarness();
    h.repoqa.saveGateRun(
      baseInput({
        routes: [
          { route: '/api/owners#C.a', displayPath: '/api/owners', riskLevel: 'HIGH' },
          { route: '/api/owners#C.a', displayPath: '/api/owners', riskLevel: 'LOW' }
        ]
      })
    );
    const { runs } = h.repoqa.listGateRuns('gate-1');
    expect(runs[0].routesCount).toBe(1);
    const rows = h.db
      .prepare('SELECT COUNT(*) AS count FROM gate_run_routes')
      .get() as { count: number };
    expect(rows.count).toBe(1);
  });

  it('replays newest-first with paging totals and sanitizes bad paging', () => {
    const h = freshHarness();
    for (let i = 0; i < 3; i++) h.repoqa.saveGateRun(baseInput({ head: `v${i}` }));
    const page = h.repoqa.listGateRuns('gate-1', { limit: 2, offset: 0 });
    expect(page.total).toBe(3);
    expect(page.runs).toHaveLength(2);
    expect(Number(page.runs[0].id)).toBeGreaterThan(Number(page.runs[1].id));
    // newest-first ⇒ the LAST stored head comes back first
    expect(page.runs[0].head).toBe('v2');
    const garbage = h.repoqa.listGateRuns('gate-1', {
      limit: undefined,
      offset: undefined
    });
    expect(garbage.runs).toHaveLength(3);
  });

  it('keeps hash and hash+dirty as separate streams (Q12)', () => {
    const h = freshHarness();
    h.repoqa.saveGateRun(baseInput({ commit: 'abc123' }));
    h.repoqa.saveGateRun(baseInput({ commit: 'abc123+dirty' }));
    const clean = h.repoqa.listGateRuns('gate-1', { commit: 'abc123' });
    expect(clean.total).toBe(1);
    expect(clean.runs[0].commit).toBe('abc123');
    const all = h.repoqa.listGateRuns('gate-1');
    expect(all.total).toBe(2);
  });

  it('stores a failed run as a FAIL row with error/detail and no routes', () => {
    const h = freshHarness();
    h.repoqa.saveGateRun(
      baseInput({ status: 'FAIL', error: '该目录不是 git 仓库,无法做架构差异对比。', detail: 'git diff failed: fatal: ...' })
    );
    const { runs } = h.repoqa.listGateRuns('gate-1');
    expect(runs[0].error).toContain('该目录不是 git 仓库');
    expect(runs[0].detail).toContain('fatal');
    expect(runs[0].routesCount).toBe(0);
    const events = h.repoqa.listEvents({ repoId: 'gate-1', eventType: 'gate.run' });
    expect(events.events[0].failureClass).toBe('gate-exec-failure');
  });

  it('deleteRepo cascades gate runs and their route rows', () => {
    const h = freshHarness();
    h.repoqa.saveGateRun(baseInput({ routes: [{ route: '/api/owners', displayPath: null, riskLevel: null }] }));
    const { runId } = h.repoqa.saveGateRun(baseInput({ head: 'HEAD2' }));
    h.repoqa.deleteRepo('gate-1');
    expect(h.repoqa.listGateRuns('gate-1').total).toBe(0);
    const routes = h.db
      .prepare('SELECT COUNT(*) AS count FROM gate_run_routes WHERE run_id = ?')
      .get(Number(runId)) as { count: number };
    expect(routes.count).toBe(0);
  });
});

/* ---------------- HTTP integration ---------------- */

interface ServerContext {
  baseUrl: string;
  close(): Promise<void>;
}

async function startServer(): Promise<ServerContext> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-gate-'));
  const db = openDb(':memory:');
  const repos = new Repos(db);
  const repoqa = new RepoQARepos(db);
  const eventBus = new EventBus();
  const worker = new RepoQAWorker(repoqa, eventBus);
  const orchestrator = new Orchestrator(repos);
  const harnessManager = new HarnessManager({ repos, eventBus });
  const app = createHttpApp({
    repos,
    orchestrator,
    harnessManager,
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
  const address = server.address() as AddressInfo;
  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  };
}

function gitRun(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true }, (err) =>
      err ? reject(new Error(`git ${args[0]} failed: ${err.message}`)) : resolve()
    );
  });
}

/** Two-commit Spring-ish fixture: base wires list(), head adds a second route. */
async function makeTwoCommitRepo(root: string): Promise<void> {
  const pkg = path.join(root, 'src', 'main', 'java', 'com', 'demo');
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(path.join(root, 'pom.xml'), '<project/>\n');
  const controller = (extra: string) =>
    [
      'package com.demo;',
      '@RestController',
      'public class OwnerController {',
      '  private final OwnerService ownerService = new OwnerService();',
      '  @GetMapping("/api/owners")',
      '  public String list() { return ownerService.list(); }',
      extra,
      '}'
    ].join('\n');
  await fs.writeFile(path.join(pkg, 'OwnerController.java'), controller('') + '\n');
  await fs.writeFile(
    path.join(pkg, 'OwnerService.java'),
    'package com.demo;\n@Service\npublic class OwnerService {\n  public String list() { return "owners"; }\n}\n'
  );
  await gitRun(['init', '-q'], root);
  await gitRun(['add', '-A'], root);
  await gitRun(['-c', 'user.email=e2e@local', '-c', 'user.name=e2e', 'commit', '-q', '-m', 'base'], root);
  await fs.writeFile(
    path.join(pkg, 'OwnerController.java'),
    controller('  @GetMapping("/api/owners/{id}")\n  public String one() { return ownerService.list(); }') + '\n'
  );
  await gitRun(['add', '-A'], root);
  await gitRun(['-c', 'user.email=e2e@local', '-c', 'user.name=e2e', 'commit', '-q', '-m', 'head'], root);
}

async function importRepo(baseUrl: string, repoPath: string) {
  const response = await fetch(`${baseUrl}/api/repos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ localPath: repoPath })
  });
  const body = (await response.json()) as { repo?: { id: string; status: string } };
  return body.repo;
}

interface GateRunResponse {
  run: GateRunRow | null;
}
interface GateListResponse {
  runs: GateRunRow[];
  total: number;
}

describe('gate run endpoints (v0.26-B)', () => {
  it('POST /gate/run persists the verdict and GET /gate-runs replays it; bad ref keeps the ticket-14 contract', async () => {
    const ctx = await startServer();
    try {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-gate-repo-'));
      await makeTwoCommitRepo(root);
      const repo = await importRepo(ctx.baseUrl, root);
      expect(repo?.status).toBe('ready');
      const repoId = repo!.id;

      // unknown repo → shared requireRepo 404 guard (ticket 09)
      const missing = await fetch(`${ctx.baseUrl}/api/repos/nope/gate-runs`);
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toEqual({ error: 'Repo not found' });

      // missing refs → 400
      const badBody = await fetch(`${ctx.baseUrl}/api/repos/${repoId}/gate/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base: 'HEAD~1' })
      });
      expect(badBody.status).toBe(400);

      // valid run
      const runRes = await fetch(`${ctx.baseUrl}/api/repos/${repoId}/gate/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base: 'HEAD~1', head: 'HEAD', maxAffectedRoutes: 0 })
      });
      expect(runRes.status).toBe(201);
      const { run } = (await runRes.json()) as GateRunResponse;
      expect(run).not.toBeNull();
      expect(run!.status).toBe('FAIL'); // head adds a route ⇒ affected > 0 > max 0
      expect(run!.violationsCount).toBeGreaterThanOrEqual(1);
      expect(run!.commit).toMatch(/^[0-9a-f]{7,40}$/i); // clean tree ⇒ plain hash
      expect(run!.source).toBe('workbench');
      const payload = run!.payload as { violations: Array<{ rule: string }>; impactedApis: unknown };
      expect(payload.violations[0].rule).toBe('max-affected-routes');

      const list = (await (
        await fetch(`${ctx.baseUrl}/api/repos/${repoId}/gate-runs`)
      ).json()) as GateListResponse;
      expect(list.total).toBe(1);
      expect(String(list.runs[0].id)).toBe(String(run!.id));

      // evidence-plane double write
      const events = (await (
        await fetch(`${ctx.baseUrl}/api/events?repoId=${repoId}&eventType=gate.run`)
      ).json()) as { total: number };
      expect(events.total).toBe(1);

      // bad ref → ticket-14 contract frozen: 400 one-line error + raw detail,
      // AND the failure lands as an error row (newest-first)
      const bad = await fetch(`${ctx.baseUrl}/api/repos/${repoId}/gate/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base: 'origin/nope', head: 'HEAD' })
      });
      expect(bad.status).toBe(400);
      const errBody = (await bad.json()) as { error: string; detail: string };
      expect(errBody.error).toBeTruthy();
      expect(errBody.error).not.toContain('\n');
      expect(errBody.detail).toContain('failed');
      const afterBad = (await (
        await fetch(`${ctx.baseUrl}/api/repos/${repoId}/gate-runs?limit=1`)
      ).json()) as GateListResponse;
      expect(afterBad.runs[0].error).toBeTruthy();
      expect(afterBad.total).toBe(2);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});
