import fs from 'node:fs/promises';
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
import { RepoQARepos } from './repoqa-repos';
import { RepoQAWorker, deterministicIntentParse } from './repoqa-worker';
import { Repos } from './repos';

interface ServerContext {
  baseUrl: string;
  db: Database.Database;
  close(): Promise<void>;
}

async function startServer(): Promise<ServerContext> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-evolve-'));
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
    db,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  };
}

const servers: ServerContext[] = [];
afterAll(async () => {
  for (const server of servers) await server.close();
});

async function withServer(run: (ctx: ServerContext) => Promise<void>): Promise<void> {
  const ctx = await startServer();
  servers.push(ctx);
  await run(ctx);
}

async function makeOrderRepo(root: string): Promise<void> {
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
    'package com.demo.order;\n' +
      'public class OrderRepository {\n' +
      '  public Order save(Order order) { return order; }\n' +
      '  public Order[] findAll() { return new Order[0]; }\n' +
      '}\n'
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
}

async function importReady(baseUrl: string, repoPath: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/repos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ localPath: repoPath })
  });
  const body = (await response.json()) as {
    repo?: { id: string; status: string; error?: string };
    error?: string;
  };
  expect(response.status).toBe(201);
  expect(body.repo?.status).toBe('ready');
  return body.repo!.id;
}

interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

/** POST the evolve intent and collect the SSE frames until the stream ends. */
async function streamEvolve(
  baseUrl: string,
  repoId: string,
  body: Record<string, unknown>
): Promise<{ status: number; frames: SseFrame[] }> {
  const response = await fetch(`${baseUrl}/api/repos/${repoId}/evolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  const frames: SseFrame[] = [];
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
  return { status: response.status, frames };
}

describe('deterministicIntentParse (zero-LLM fallback)', () => {
  it('parses the canonical EXTEND intent into keyword + goal', () => {
    const echo = deterministicIntentParse('给订单模块加 Excel 导出');
    expect(echo.intentType).toBe('EXTEND');
    expect(echo.rawKeyword).toBe('订单');
    expect(echo.extensionGoal).toContain('Excel');
    expect(echo.parsedBy).toBe('fallback');
  });

  it('routes retirement verbs to DEPRECATE', () => {
    const echo = deterministicIntentParse('下线订单模块');
    expect(echo.intentType).toBe('DEPRECATE');
    expect(echo.rawKeyword).toBe('订单');
  });

  it('prefers latin class names when no CJK content word remains', () => {
    const echo = deterministicIntentParse('add export support to OrderService');
    expect(echo.intentType).toBe('EXTEND');
    expect(echo.rawKeyword).toBe('OrderService');
  });
});

describe('POST /api/repos/:id/evolve (Ticket 04 workbench stream)', () => {
  it('streams the five stages and the four artifact-card sections end to end', async () => {
    await withServer(async (ctx) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-evolve-repo-'));
      await makeOrderRepo(root);
      const repoId = await importReady(ctx.baseUrl, root);

      const { status, frames } = await streamEvolve(ctx.baseUrl, repoId, {
        intent: '给订单模块加 Excel 导出'
      });
      expect(status).toBe(200);

      const events = frames.map((frame) => frame.event);
      // Stage sequence: five running + five done markers in pipeline order.
      const stages = frames
        .filter((frame) => frame.event === 'repoqa.evolve.stage')
        .map((frame) => frame.data as { stage: string; status: string });
      expect(stages.map((stage) => `${stage.stage}:${stage.status}`)).toEqual([
        'intent_parse:running',
        'intent_parse:done',
        'target_resolve:running',
        'target_resolve:done',
        'convention_scan:running',
        'pipeline:running',
        'convention_scan:done',
        'pipeline:done',
        'diagram:running',
        'diagram:done'
      ]);
      expect(events).toContain('repoqa.evolve.done');

      // Intent echo: deterministic fallback parser (no LLM in tests).
      const resolveDone = frames.find(
        (frame) =>
          frame.event === 'repoqa.evolve.stage' &&
          (frame.data as { stage?: string }).stage === 'target_resolve' &&
          (frame.data as { status?: string }).status === 'done'
      );
      const echo = (resolveDone?.data as { intentEcho?: Record<string, unknown> }).intentEcho;
      expect(echo).toBeDefined();
      expect(echo?.intentType).toBe('EXTEND');
      expect(echo?.rawKeyword).toBe('订单');
      expect(echo?.parsedBy).toBe('fallback');
      // Radar anchored the keyword into the order package.
      expect(String(echo?.resolvedTarget)).toMatch(/Order/);
      expect(Array.isArray(echo?.alternatives)).toBe(true);

      // Four artifact-card sections on the done payload.
      const done = frames.find((frame) => frame.event === 'repoqa.evolve.done')!;
      const payload = done.data as {
        intentEcho: Record<string, unknown>;
        result: {
          intentType: string;
          target: string;
          conventions?: unknown;
          placement?: unknown;
          risks?: unknown;
          checklists: unknown[];
          blastRadius: { orphanedSymbols: unknown[] };
        };
        commit?: string;
      };
      expect(payload.result.intentType).toBe('EXTEND');
      expect(Array.isArray(payload.result.checklists)).toBe(true);
      expect(payload.commit).toBeTruthy();
    });
  }, 30_000);

  it('honors an explicit target from the Correction Pill (skips radar)', async () => {
    await withServer(async (ctx) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-evolve-repo-'));
      await makeOrderRepo(root);
      const repoId = await importReady(ctx.baseUrl, root);

      const { frames } = await streamEvolve(ctx.baseUrl, repoId, {
        intent: '给订单模块加 Excel 导出',
        target: 'OrderService'
      });
      const resolveDone = frames.find(
        (frame) =>
          frame.event === 'repoqa.evolve.stage' &&
          (frame.data as { stage?: string }).stage === 'target_resolve' &&
          (frame.data as { status?: string }).status === 'done'
      );
      const echo = (resolveDone?.data as { intentEcho?: { resolvedTarget?: string } }).intentEcho;
      expect(echo?.resolvedTarget).toBe('OrderService');
      const done = frames.find((frame) => frame.event === 'repoqa.evolve.done')!;
      expect((done.data as { result: { target: string } }).result.target).toBe('OrderService');
    });
  }, 30_000);

  it('answers 404 for an unknown repo and 400 without intent', async () => {
    await withServer(async (ctx) => {
      const missing = await fetch(`${ctx.baseUrl}/api/repos/nope/evolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intent: '加导出' })
      });
      expect(missing.status).toBe(404);

      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-evolve-repo-'));
      await makeOrderRepo(root);
      const repoId = await importReady(ctx.baseUrl, root);
      const noIntent = await fetch(`${ctx.baseUrl}/api/repos/${repoId}/evolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      expect(noIntent.status).toBe(400);
    });
  }, 30_000);

  it('streams a structured conventionConflict error instead of crashing', async () => {
    await withServer(async (ctx) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-evolve-repo-'));
      // Wrapped-return STRICT axis + a bare-return intent collides.
      const pkg = path.join(root, 'src', 'main', 'java', 'com', 'demo', 'order');
      await fs.mkdir(pkg, { recursive: true });
      await fs.writeFile(path.join(root, 'pom.xml'), '<project/>\n');
      const services = Array.from({ length: 4 }, (_, index) =>
        fs.writeFile(
          path.join(pkg, `FieldService${index}.java`),
          'package com.demo.order;\n' +
            'public class FieldService' + index + ' {\n' +
            '  @Autowired\n' +
            '  private OrderRepository orderRepository;\n' +
            '  public String doWork' + index + '() {\n' +
            '    return "v" + ' + index + ';\n' +
            '  }\n' +
            '}\n'
        )
      );
      await Promise.all(services);
      await fs.writeFile(
        path.join(pkg, 'OrderRepository.java'),
        'package com.demo.order;\npublic class OrderRepository {}\n'
      );
      // Wrapped-return STRICT axis: 5/5 route methods return ApiResult.
      await fs.writeFile(
        path.join(pkg, 'OrderController.java'),
        'package com.demo.order;\n' +
          '@RestController\n' +
          'public class OrderController {\n' +
          '  public ApiResult<String> list() { return ApiResult.ok(); }\n' +
          '  public ApiResult<String> get() { return ApiResult.ok(); }\n' +
          '  public ApiResult<String> create() { return ApiResult.ok(); }\n' +
          '  public ApiResult<String> update() { return ApiResult.ok(); }\n' +
          '  public ApiResult<String> delete() { return ApiResult.ok(); }\n' +
          '}\n'
      );
      const repoId = await importReady(ctx.baseUrl, root);

      const { frames } = await streamEvolve(ctx.baseUrl, repoId, {
        intent: '给 OrderController 加裸返回',
        target: 'OrderController.list'
      });
      const error = frames.find((frame) => frame.event === 'repoqa.evolve.error');
      expect(error).toBeDefined();
      const payload = error!.data as { conventionConflict?: { axis?: string } };
      expect(payload.conventionConflict).toBeDefined();
      expect(typeof payload.conventionConflict?.axis).toBe('string');
    });
  }, 30_000);
});
