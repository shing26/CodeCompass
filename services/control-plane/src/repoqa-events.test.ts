import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from './db';
import { EventBus } from './events';
import { HarnessManager } from './harness-manager';
import { createHttpApp } from './http';
import { Orchestrator } from './orchestrator';
import { RepoQARepos } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { Repos } from './repos';

interface ServerContext {
  baseUrl: string;
  db: Database.Database;
  repoqa: RepoQARepos;
  worker: RepoQAWorker;
  close(): Promise<void>;
}

async function startServer(dbPath = ':memory:'): Promise<ServerContext> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-events-'));
  const db = openDb(dbPath);
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
    db,
    repoqa,
    worker,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  };
}

async function makeConfigRepo(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'src', 'main', 'resources'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'main', 'resources', 'application.yml'),
    'spring:\n  datasource:\n    password: secret\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'main', 'resources', 'application.properties'),
    'server.port=8080\n'
  );
  await fs.writeFile(
    path.join(root, 'README.md'),
    '# Demo\nConfiguration lives in resources.\n'
  );
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
}

async function importRepo(baseUrl: string, repoPath: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/repos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ localPath: repoPath })
  });
  const body = (await response.json()) as { repo?: { id: string } };
  if (!body.repo) throw new Error('repo import failed');
  return body.repo.id;
}

describe('RepoQARepos evidence plane — persistence', () => {
  it('persists structured query.start / query.done events with timings', () => {
    const repoqa = new RepoQARepos(openDb(':memory:'));
    const startAt = '2026-08-21T10:00:00.000Z';
    const tokenAt = '2026-08-21T10:00:00.150Z';
    const doneAt = '2026-08-21T10:00:01.000Z';
    repoqa.recordEvent({
      repoId: 'repo-1',
      sessionId: 'session-9',
      eventType: 'query.start',
      intent: 'architecture',
      queryStartAt: startAt
    });
    repoqa.recordEvent({
      repoId: 'repo-1',
      sessionId: 'session-9',
      eventType: 'query.done',
      intent: 'architecture',
      queryStartAt: startAt,
      firstTokenAt: tokenAt,
      queryDoneAt: doneAt
    });

    const { events, total } = repoqa.listEvents();
    expect(total).toBe(2);
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe('query.done');
    expect(events[0].firstTokenAt).toBe(tokenAt);
    expect(events[0].queryDoneAt).toBe(doneAt);
    expect(events[0].intent).toBe('architecture');
    expect(events[0].sessionId).toBe('session-9');
    expect(events[0].anchorClicked).toBe(false);
    expect(events[1].eventType).toBe('query.start');
    expect(events[1].queryStartAt).toBe(startAt);
    expect(events[1].createdAt).toBeTruthy();
  });

  it('persists tool.miss and feedback payload columns', () => {
    const repoqa = new RepoQARepos(openDb(':memory:'));
    repoqa.recordEvent({
      repoId: 'repo-1',
      eventType: 'tool.miss',
      intent: 'call-chain',
      toolMiss: 'call-chain start symbol not found'
    });
    repoqa.recordEvent({
      repoId: 'repo-1',
      eventType: 'feedback.submitted',
      sessionId: 'session-5',
      feedback: 'very useful answer'
    });

    const toolMiss = repoqa.listEvents({ eventType: 'tool.miss' });
    expect(toolMiss.total).toBe(1);
    expect(toolMiss.events[0].toolMiss).toBe('call-chain start symbol not found');

    const feedback = repoqa.listEvents({ eventType: 'feedback.submitted' });
    expect(feedback.total).toBe(1);
    expect(feedback.events[0].feedback).toBe('very useful answer');
    expect(feedback.events[0].sessionId).toBe('session-5');
  });

  it('persists anchor.click as a boolean flag', () => {
    const repoqa = new RepoQARepos(openDb(':memory:'));
    repoqa.recordEvent({
      repoId: 'repo-1',
      eventType: 'anchor.click',
      sessionId: 'session-2',
      anchorClicked: true,
      feedback: 'src/main/java/App.java:12:handleCheckout'
    });

    const { events } = repoqa.listEvents({ eventType: 'anchor.click' });
    expect(events).toHaveLength(1);
    expect(events[0].anchorClicked).toBe(true);
    expect(events[0].feedback).toBe('src/main/java/App.java:12:handleCheckout');
  });

  it('filters by repoId, comma-separated eventType and intent', () => {
    const repoqa = new RepoQARepos(openDb(':memory:'));
    const seed = [
      { repoId: 'repo-a', eventType: 'query.start', intent: 'architecture' },
      { repoId: 'repo-a', eventType: 'query.done', intent: 'architecture' },
      { repoId: 'repo-a', eventType: 'anchor.click', intent: 'architecture' },
      { repoId: 'repo-b', eventType: 'query.start', intent: 'environment' },
      { repoId: 'repo-b', eventType: 'query.done', intent: 'environment' }
    ];
    for (const event of seed) repoqa.recordEvent(event);

    const byRepo = repoqa.listEvents({ repoId: 'repo-b' });
    expect(byRepo.total).toBe(2);
    expect(byRepo.events.every((event) => event.repoId === 'repo-b')).toBe(true);

    const byTypes = repoqa.listEvents({ eventType: 'query.start,query.done' });
    expect(byTypes.total).toBe(4);
    expect(byTypes.events.every((event) => event.eventType !== 'anchor.click')).toBe(true);

    const byIntent = repoqa.listEvents({ intent: 'environment' });
    expect(byIntent.total).toBe(2);
    expect(byIntent.events.every((event) => event.intent === 'environment')).toBe(true);

    const unknown = repoqa.listEvents({ repoId: 'repo-nope' });
    expect(unknown.total).toBe(0);
    expect(unknown.events).toHaveLength(0);
  });

  it('paginates newest-first and reports total independent of page size', () => {
    const repoqa = new RepoQARepos(openDb(':memory:'));
    const ids: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      repoqa.recordEvent({ repoId: 'repo-1', eventType: 'query.done', intent: 'architecture' });
      ids.push(repoqa.listEvents({ limit: 1 }).events[0].id);
    }
    expect(new Set(ids).size).toBe(5);

    const page1 = repoqa.listEvents({ limit: 2 });
    expect(page1.total).toBe(5);
    expect(page1.events).toHaveLength(2);
    expect(page1.events[0].id).toBeGreaterThan(page1.events[1].id);

    const page2 = repoqa.listEvents({ limit: 2, offset: 2 });
    expect(page2.total).toBe(5);
    expect(page2.events).toHaveLength(2);
    expect(page2.events[0].id).toBeLessThan(page1.events[1].id);

    const beyond = repoqa.listEvents({ limit: 2, offset: 10 });
    expect(beyond.total).toBe(5);
    expect(beyond.events).toHaveLength(0);
  });
});

describe('GET /api/events — read-only HTTP accessor', () => {
  it('exposes events produced by the query and SSE flow', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-events-repo-'));
    try {
      await makeConfigRepo(root);
      const repoId = await importRepo(ctx.baseUrl, root);

      const query = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?mode=environment&question=${encodeURIComponent('密码')}`
      );
      expect(query.status).toBe(200);
      // Drain the SSE stream so the worker fully lands query.done on the
      // evidence plane before we read it back.
      const streamText = await query.text();
      expect(streamText).toContain('repoqa.query.done');

      const list = await fetch(`${ctx.baseUrl}/api/events`);
      const body = (await list.json()) as {
        events: Array<{ eventType: string; repoId?: string; intent?: string }>;
        total: number;
      };
      expect(body.total).toBeGreaterThanOrEqual(2);
      const types = new Set(body.events.map((event) => event.eventType));
      expect(types.has('query.start')).toBe(true);
      expect(types.has('query.done')).toBe(true);
      expect(body.events.every((event) => event.repoId === repoId)).toBe(true);

      const filtered = await fetch(
        `${ctx.baseUrl}/api/events?eventType=query.done&intent=environment`
      );
      const filteredBody = (await filtered.json()) as {
        events: Array<{ eventType: string; intent?: string }>;
        total: number;
      };
      expect(filteredBody.total).toBe(1);
      expect(filteredBody.events[0].eventType).toBe('query.done');
      expect(filteredBody.events[0].intent).toBe('environment');
    } finally {
      await ctx.close();
    }
  });

  it('records anchor.click and feedback through HTTP endpoints', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-events-repo-'));
    try {
      await makeConfigRepo(root);
      const repoId = await importRepo(ctx.baseUrl, root);

      const click = await fetch(`${ctx.baseUrl}/api/repos/${repoId}/anchor-click`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: 'src/App.java', line: 12, symbol: 'checkout' })
      });
      expect(click.status).toBe(201);

      const feedback = await fetch(`${ctx.baseUrl}/api/repos/${repoId}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback: 'clear and precise', sessionId: 'session-77' })
      });
      expect(feedback.status).toBe(201);

      const clicks = await fetch(`${ctx.baseUrl}/api/events?eventType=anchor.click`);
      const clicksBody = (await clicks.json()) as {
        events: Array<{ anchorClicked: boolean; feedback?: string }>;
        total: number;
      };
      expect(clicksBody.total).toBe(1);
      expect(clicksBody.events[0].anchorClicked).toBe(true);
      expect(clicksBody.events[0].feedback).toBe('src/App.java:12:checkout');

      const feedbacks = await fetch(`${ctx.baseUrl}/api/events?eventType=feedback.submitted`);
      const feedbacksBody = (await feedbacks.json()) as {
        events: Array<{ feedback?: string; sessionId?: string }>;
        total: number;
      };
      expect(feedbacksBody.total).toBe(1);
      expect(feedbacksBody.events[0].feedback).toBe('clear and precise');
      expect(feedbacksBody.events[0].sessionId).toBe('session-77');
    } finally {
      await ctx.close();
    }
  });

  it('is read-only and tolerates invalid paging parameters', async () => {
    const ctx = await startServer();
    try {
      ctx.repoqa.recordEvent({ repoId: 'repo-1', eventType: 'query.start', intent: 'architecture' });
      ctx.repoqa.recordEvent({ repoId: 'repo-1', eventType: 'query.done', intent: 'architecture' });

      const before = await fetch(`${ctx.baseUrl}/api/events`);
      const beforeBody = (await before.json()) as { total: number };
      expect(beforeBody.total).toBe(2);

      const invalid = await fetch(`${ctx.baseUrl}/api/events?limit=abc&offset=-5`);
      expect(invalid.status).toBe(200);
      const invalidBody = (await invalid.json()) as { total: number; events: unknown[] };
      expect(invalidBody.total).toBe(2);
      expect(invalidBody.events).toHaveLength(2);

      const zero = await fetch(`${ctx.baseUrl}/api/events?limit=0`);
      const zeroBody = (await zero.json()) as { total: number; events: unknown[] };
      expect(zeroBody.total).toBe(2);
      expect(zeroBody.events).toHaveLength(0);

      const after = await fetch(`${ctx.baseUrl}/api/events`);
      const afterBody = (await after.json()) as { total: number };
      expect(afterBody.total).toBe(2);
    } finally {
      await ctx.close();
    }
  });
});