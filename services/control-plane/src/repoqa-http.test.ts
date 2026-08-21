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
import { maskSensitiveText } from './repoqa-masking';
import { runGoldenEval } from './repoqa-eval';
import { capPrompt, completeReAct } from './repoqa-llm';

interface ServerContext {
  baseUrl: string;
  db: Database.Database;
  eventBus: EventBus;
  worker: RepoQAWorker;
  close(): Promise<void>;
}

async function startServer(dbPath = ':memory:'): Promise<ServerContext> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-http-'));
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
    eventBus,
    worker,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  };
}

async function makeJavaRepo(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'src', 'main', 'java', 'com', 'demo'), {
    recursive: true
  });
  await fs.writeFile(path.join(root, 'pom.xml'), '<project/>\n');
  await fs.writeFile(path.join(root, 'README.md'), '# Demo\n');
  await fs.writeFile(
    path.join(root, 'src', 'main', 'java', 'com', 'demo', 'App.java'),
    'package com.demo;\npublic class App {\n  private static final String VERSION = "1";\n  public static void main(String[] args) {\n    new Controller().hello();\n  }\n}\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'main', 'java', 'com', 'demo', 'Controller.java'),
    'package com.demo;\n@RestController\npublic class Controller {\n  private final DemoService demoService = new DemoService();\n  public String hello() {\n    return demoService.greet();\n  }\n}\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'main', 'java', 'com', 'demo', 'DemoService.java'),
    'package com.demo;\n@Service\npublic class DemoService {\n  public String greet() {\n    return "hello";\n  }\n}\n'
  );
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await fs.mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true });
  await fs.writeFile(path.join(root, 'node_modules', 'dep', 'index.js'), 'ignored\n');
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
    path.join(root, 'pom.xml'),
    '<project><groupId>com.demo</groupId><artifactId>demo</artifactId></project>\n'
  );
  await fs.writeFile(
    path.join(root, 'README.md'),
    '# Demo\npassword=supersecret\nConfiguration lives in resources.\n'
  );
}

async function importRepo(baseUrl: string, repoPath: string, branch?: string) {
  const response = await fetch(`${baseUrl}/api/repos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ localPath: repoPath, ...(branch ? { branch } : {}) })
  });
  const body = (await response.json()) as {
    repo?: {
      id: string;
      localPath: string;
      status: string;
      error?: string;
      fileCount: number;
      symbolCount: number;
    };
    error?: string;
  };
  return { status: response.status, body };
}

describe('RepoPulse secret masking util', () => {
  it('masks passwords, tokens, API, AK/SK, and private keys', () => {
    const text = [
      'password=supersecret',
      'api-key=abc123',
      'token: value-123',
      'Authorization: Bearer some-token',
      'AKIA1234567890ABCDEF',
      'sk-abcdefgh1234',
      'AK=value123',
      'SK: value456',
      'access_key_id=AKID',
      'secret_access_key=SECRET',
      'client_secret=clientsecret',
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'
    ].join('\n');
    const masked = maskSensitiveText(text);
    expect(masked).toContain('password=***');
    expect(masked).toContain('api-key=***');
    expect(masked).toContain('token: ***');
    expect(masked).toContain('Bearer ***');
    expect(masked).not.toContain('supersecret');
    expect(masked).not.toContain('AKIA1234567890ABCDEF');
    expect(masked).not.toContain('sk-abcdefgh1234');
    expect(masked).toContain('AK=***');
    expect(masked).toContain('SK: ***');
    expect(masked).toContain('access_key_id=***');
    expect(masked).toContain('secret_access_key=***');
    expect(masked).toContain('client_secret=***');
    expect(masked).not.toContain('value123');
    expect(masked).not.toContain('value456');
    expect(masked).not.toContain('AKID');
    expect(masked).not.toContain('SECRET');
    expect(masked).not.toContain('clientsecret');
    expect(masked).toContain('[REDACTED PRIVATE KEY]');
  });
});

describe('RepoPulse repo import HTTP API', () => {
  it('imports a local repo and emits progress while indexing', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-java-'));
    try {
      await makeJavaRepo(root);
      const events: string[] = [];
      ctx.eventBus.on((event) => {
        if (event.type === 'repoqa.index.progress') {
          events.push(`progress:${event.payload.phase}`);
        } else if (event.type === 'repoqa.index.done') {
          events.push('done');
        }
      });

      const result = await importRepo(ctx.baseUrl, root);
      expect(result.status).toBe(201);
      expect(result.body.repo?.status).toBe('ready');
      expect(result.body.repo?.localPath).toBe(path.resolve(root));
      expect(result.body.repo?.fileCount).toBe(5);
      expect(events).toContain('progress:parsing');
      expect(events).toContain('progress:ready');
      expect(events).toContain('done');

      const listResponse = await fetch(`${ctx.baseUrl}/api/repos`);
      const list = (await listResponse.json()) as { repos: Array<{ id: string }> };
      expect(list.repos).toHaveLength(1);
      expect(list.repos[0].id).toBe(result.body.repo?.id);

      const singleResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${result.body.repo?.id}`
      );
      expect(singleResponse.status).toBe(200);
      const single = (await singleResponse.json()) as {
        repo: { status: string; fileCount: number };
      };
      expect(single.repo.status).toBe('ready');
      expect(single.repo.fileCount).toBe(5);
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('re-imports idempotently and removes stale symbols', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-java-'));
    try {
      await makeJavaRepo(root);
      const first = await importRepo(ctx.baseUrl, root);
      expect(first.status).toBe(201);
      const repoId = first.body.repo!.id;

      await ctx.db
        .prepare('INSERT INTO repo_symbols (repo_id, kind, name, file_path) VALUES (?, ?, ?, ?)')
        .run(repoId, 'class', 'StaleSymbol', 'Stale.java');
      await fs.writeFile(path.join(root, 'notes.txt'), 'extra\n');

      const second = await importRepo(ctx.baseUrl, root);
      expect(second.status).toBe(200);
      expect(second.body.repo?.id).toBe(repoId);
      expect(second.body.repo?.fileCount).toBe(6);
      const symbols = ctx.db
        .prepare('SELECT name FROM repo_symbols WHERE repo_id = ?')
        .all(repoId) as Array<{ name: string }>;
      expect(symbols.some((symbol) => symbol.name === 'StaleSymbol')).toBe(false);
      expect(symbols.length).toBeGreaterThan(0);

      const listResponse = await fetch(`${ctx.baseUrl}/api/repos`);
      const list = (await listResponse.json()) as { repos: Array<{ id: string }> };
      expect(list.repos).toHaveLength(1);
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('recovers ready repos after restart and resets interrupted indexing', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-recovery-'));
    const repoRoot = path.join(tempDir, 'repo');
    await fs.mkdir(repoRoot, { recursive: true });
    await makeJavaRepo(repoRoot);

    const dbPath = path.join(tempDir, 'control-plane.db');
    const ctx = await startServer(dbPath);
    try {
      const result = await importRepo(ctx.baseUrl, repoRoot);
      expect(result.body.repo?.status).toBe('ready');
      const repoId = result.body.repo!.id;
      const fileCount = result.body.repo!.fileCount;
      await ctx.close();

      const db = openDb(dbPath);
      const repoqa = new RepoQARepos(db);
      const recovered = repoqa.getRepo(repoId)!;
      expect(recovered.status).toBe('ready');
      expect(recovered.localPath).toBe(path.resolve(repoRoot));
      expect(recovered.fileCount).toBe(fileCount);

      db.prepare('UPDATE repos SET status = ? WHERE id = ?').run('indexing', repoId);
      repoqa.resetInterrupted();
      expect(repoqa.getRepo(repoId)!.status).toBe('idle');
      db.close();
    } finally {
      await ctx.close();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails with a clear reason when a repo exceeds the file limit', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-big-'));
    try {
      const events: string[] = [];
      ctx.eventBus.on((event) => {
        if (event.type === 'repoqa.index.error') events.push('error');
      });
      await Promise.all(
        Array.from({ length: 3001 }, (_, index) =>
          fs.writeFile(path.join(root, `file-${index}.txt`), '')
        )
      );
      const result = await importRepo(ctx.baseUrl, root);
      expect(result.status).toBe(201);
      expect(result.body.repo?.status).toBe('error');
      expect(result.body.repo?.error).toContain('3000');
      expect(events).toContain('error');
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('serves raw files inside the repo and rejects traversal', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-raw-'));
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;

      const valid = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/file/raw?path=src/main/java/com/demo/App.java`
      );
      expect(valid.status).toBe(200);
      expect(await valid.text()).toContain('package com.demo');

      const traversal = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/file/raw?path=${encodeURIComponent('../../../../secret.txt')}`
      );
      expect(traversal.status).toBe(403);

      const missingPath = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/file/raw`
      );
      expect(missingPath.status).toBe(400);

      const missingRepo = await fetch(
        `${ctx.baseUrl}/api/repos/missing-repo/file/raw?path=x`
      );
      expect(missingRepo.status).toBe(404);

      const ignoredGit = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/file/raw?path=${encodeURIComponent('.git/HEAD')}`
      );
      expect(ignoredGit.status).toBe(403);

      const ignoredDependency = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/file/raw?path=${encodeURIComponent('node_modules/dep/index.js')}`
      );
      expect(ignoredDependency.status).toBe(403);
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('RepoPulse symbol extraction HTTP API', () => {
  it('extracts route, method, and field symbols and supports kind filters', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-symbols-'));
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      expect(result.status).toBe(201);
      expect(result.body.repo?.status).toBe('ready');
      expect(result.body.repo?.symbolCount).toBeGreaterThan(0);
      const repoId = result.body.repo!.id;

      const allResponse = await fetch(`${ctx.baseUrl}/api/repos/${repoId}/symbols`);
      expect(allResponse.status).toBe(200);
      const all = (await allResponse.json()) as {
        symbols: Array<{ kind: string; name: string; filePath: string; lineStart: number }>;
      };
      expect(all.symbols.some((symbol) => symbol.kind === 'route')).toBe(true);
      expect(all.symbols.some((symbol) => symbol.kind === 'method')).toBe(true);
      expect(all.symbols.some((symbol) => symbol.kind === 'field')).toBe(true);

      const routesResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/symbols?kind=route`
      );
      const routes = (await routesResponse.json()) as {
        symbols: Array<{ kind: string }>;
      };
      expect(routes.symbols.length).toBeGreaterThan(0);
      expect(routes.symbols.every((symbol) => symbol.kind === 'route')).toBe(true);
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces Java parser failures as repo errors with detail', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-parse-error-'));
    try {
      await makeJavaRepo(root);
      await fs.writeFile(
        path.join(root, 'src', 'main', 'java', 'com', 'demo', 'Broken.java'),
        'package com.demo;\npublic class Broken { int value = ; }\n'
      );
      const result = await importRepo(ctx.baseUrl, root);
      expect(result.body.repo?.status).toBe('error');
      expect(result.body.repo?.error).toContain('failed to parse');
      expect(result.body.repo?.error).toContain('Broken.java');
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('RepoPulse SSE query skeleton', () => {
  it('streams token, mermaid, anchors, and done events in order', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-query-'));
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;

      const response = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?question=${encodeURIComponent('trace the route')}`
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const text = await response.text();
      const blocks = text.split('\n\n').filter(Boolean);
      const types = blocks.map((block) => {
        const match = block.match(/^event: (.+)$/m);
        return match?.[1] ?? '';
      });
      expect(types.length).toBeGreaterThan(0);
      expect(types[0]).toBe('repoqa.query.token');

      const anchorEventIndex = types.indexOf('repoqa.query.anchors');
      const mermaidEventIndex = types.indexOf('repoqa.query.mermaid');
      const doneEventIndex = types.indexOf('repoqa.query.done');
      expect(anchorEventIndex).toBeGreaterThan(-1);
      expect(mermaidEventIndex).toBeGreaterThan(-1);
      expect(doneEventIndex).toBeGreaterThan(-1);
      expect(mermaidEventIndex).toBeLessThan(anchorEventIndex);
      expect(anchorEventIndex).toBeLessThan(doneEventIndex);

      const anchorBlock = blocks[anchorEventIndex];
      const anchorData = JSON.parse(
        anchorBlock.slice(anchorBlock.indexOf('data: ') + 6)
      ) as { anchors: Array<{ file: string; line: number; symbol: string }> };
      expect(anchorData.anchors.length).toBeGreaterThan(0);

      const doneBlock = blocks[doneEventIndex];
      const doneData = JSON.parse(
        doneBlock.slice(doneBlock.indexOf('data: ') + 6)
      ) as { answer: string; suggestedAction?: string };
      expect(doneData.answer).toContain('trace the route');
      expect(doneData.suggestedAction).toBeTruthy();
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('omits anchors that do not pass raw file validation', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-query-invalid-'));
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;
      ctx.db
        .prepare(
          'INSERT INTO repo_symbols (repo_id, kind, name, file_path, line_start) VALUES (?, ?, ?, ?, ?)'
        )
        .run(repoId, 'route', 'GhostController', 'missing/Ghost.java', 1);

      const events = [];
      for await (const event of ctx.worker.queryRepo({
        repoId,
        question: 'trace the route'
      })) {
        events.push(event);
      }
      const anchorEvent = events.find(
        (event) => event.type === 'repoqa.query.anchors'
      );
      expect(anchorEvent).toBeDefined();
      if (anchorEvent && anchorEvent.type === 'repoqa.query.anchors') {
        expect(
          anchorEvent.payload.anchors.some(
            (anchor) => anchor.file === 'missing/Ghost.java'
          )
        ).toBe(false);
      }
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('RepoPulse deterministic call-chain query', () => {
  it('resolves a cross-layer deterministic call chain over SSE', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-chain-'));
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;

      const response = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?mode=call-chain&question=${encodeURIComponent('trace hello')}`
      );
      expect(response.status).toBe(200);
      const text = await response.text();
      const doneBlock = text
        .split('\n\n')
        .find((block) => block.startsWith('event: repoqa.query.done'));
      expect(doneBlock).toBeDefined();
      const doneData = JSON.parse(
        doneBlock!.slice(doneBlock!.indexOf('data: ') + 6)
      ) as {
        trace?: Array<{ file: string; method: string; line?: number; break?: true }>;
      };
      expect(doneData.trace?.map((hop) => hop.method)).toContain('hello');
      expect(doneData.trace?.map((hop) => hop.method)).toContain('greet');
      expect(doneData.trace?.some((hop) => hop.break)).toBe(false);
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('renders unresolved graph edges as an explicit Static Analysis Break', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-chain-break-'));
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;
      ctx.db
        .prepare(
          `INSERT INTO repo_symbols (repo_id, kind, name, file_path, line_start, calls)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          repoId,
          'method',
          'brokenFlow',
          'src/main/java/com/demo/Controller.java',
          20,
          JSON.stringify([{ file: 'src/main/java/com/demo/Controller.java', method: 'missingMethod' }])
        );

      const response = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?mode=call-chain&question=${encodeURIComponent('trace brokenFlow')}`
      );
      const text = await response.text();
      const doneBlock = text
        .split('\n\n')
        .find((block) => block.startsWith('event: repoqa.query.done'));
      const doneData = JSON.parse(
        doneBlock!.slice(doneBlock!.indexOf('data: ') + 6)
      ) as {
        trace?: Array<{ file: string; method: string; line?: number; break?: true }>;
      };
      expect(doneData.trace?.some((hop) => hop.break === true)).toBe(true);
      expect(doneData.trace?.some((hop) => hop.method === 'missingMethod')).toBe(true);
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('RepoPulse chunks and config evidence', () => {
  it('indexes config keys and chunks without leaking values', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-config-'));
    try {
      await makeConfigRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      expect(result.body.repo?.status).toBe('ready');
      const repoId = result.body.repo!.id;
      const evidenceEvents = ctx.db
        .prepare('SELECT event_type FROM repoqa_events WHERE repo_id = ?')
        .all(repoId) as Array<{ event_type: string }>;
      expect(evidenceEvents.some((event) => event.event_type === 'masking.applied')).toBe(true);

      const configResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/symbols?kind=config`
      );
      const configBody = (await configResponse.json()) as {
        symbols: Array<{ name: string; filePath: string }>;
      };
      expect(configBody.symbols.length).toBeGreaterThan(0);
      expect(configBody.symbols.some((symbol) => symbol.name === 'spring')).toBe(true);
      expect(
        configBody.symbols.some((symbol) =>
          /8080|secret|com\.demo/.test(symbol.name)
        )
      ).toBe(false);

      const chunksResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/chunks?q=password`
      );
      expect(chunksResponse.status).toBe(200);
      const chunksBody = (await chunksResponse.json()) as {
        chunks: Array<{ chunkType: string; filePath: string; content: string }>;
      };
      expect(chunksBody.chunks.length).toBeGreaterThan(0);
      expect(chunksBody.chunks[0].content).toContain('***');
      expect(chunksBody.chunks[0].content.toLowerCase()).not.toContain('supersecret');

      const queryResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?mode=environment&question=configuration`
      );
      const queryText = await queryResponse.text();
      expect(queryText).toContain('Found');
      expect(queryText.toLowerCase()).not.toContain('secret');
      expect(queryText).not.toContain('8080');

      const rawConfigResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/file/raw?path=${encodeURIComponent('src/main/resources/application.yml')}`
      );
      expect(rawConfigResponse.status).toBe(200);
      const rawConfigText = await rawConfigResponse.text();
      expect(rawConfigText).toContain('password: ***');
      expect(rawConfigText.toLowerCase()).not.toContain('secret');
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('RepoPulse local evidence plane', () => {
  it('persists query, feedback, and anchor-click events locally', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-evidence-'));
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;

      await fetch(`${ctx.baseUrl}/api/repos/${repoId}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback: 'useful', sessionId: 'local-session' })
      });
      await fetch(`${ctx.baseUrl}/api/repos/${repoId}/anchor-click`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file: 'src/main/java/com/demo/Controller.java',
          line: 4,
          symbol: 'hello',
          sessionId: 'local-session'
        })
      });
      const queryResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?question=${encodeURIComponent('architecture')}`
      );
      await queryResponse.text();

      const events = ctx.db
        .prepare('SELECT * FROM repoqa_events WHERE repo_id = ? ORDER BY id')
        .all(repoId) as any[];
      expect(events.some((event) => event.event_type === 'query.start')).toBe(true);
      expect(events.some((event) => event.event_type === 'query.done')).toBe(true);
      expect(events.some((event) => event.event_type === 'feedback.submitted')).toBe(true);
      expect(events.some((event) => event.event_type === 'anchor.click')).toBe(true);
      const feedback = events.find(
        (event) => event.event_type === 'feedback.submitted'
      );
      expect(feedback.session_id).toBe('local-session');
      expect(feedback.feedback).toBe('useful');
      const anchor = events.find((event) => event.event_type === 'anchor.click');
      expect(anchor.anchor_clicked).toBe(1);
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('records a failure class when a query is attempted against a bad repo state', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-evidence-failure-'));
    try {
      await makeJavaRepo(root);
      await fs.writeFile(
        path.join(root, 'src', 'main', 'java', 'com', 'demo', 'Broken.java'),
        'package com.demo;\npublic class Broken { int value = ; }\n'
      );
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;
      expect(result.body.repo?.status).toBe('error');

      const failureQueryResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?question=${encodeURIComponent('architecture')}`
      );
      await failureQueryResponse.text();
      const events = ctx.db
        .prepare('SELECT event_type, failure_class FROM repoqa_events WHERE repo_id = ?')
        .all(repoId) as Array<{ event_type: string; failure_class: string | null }>;
      const failure = events.find((event) => event.event_type === 'query.failure');
      expect(failure).toBeDefined();
      expect(failure?.failure_class).toContain('not ready');
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('RepoPulse golden dataset eval harness', () => {
  it('runs a repeatable per-bucket report with pass/fail thresholds', async () => {
    const report = await runGoldenEval();
    expect(report.totalQuestions).toBe(50);
    expect(report.passed).toBe(true);
    expect(report.fixtureCommits['repo-a']).toMatch(/^[0-9a-f]{40}$/i);
    expect(report.fixtureCommits['repo-b']).toMatch(/^[0-9a-f]{40}$/i);
    expect(report.fixtureCommits['repo-c']).toMatch(/^[0-9a-f]{40}$/i);
    expect(report.buckets['route-chain'].total).toBe(20);
    expect(report.buckets.config.total).toBe(15);
    expect(report.buckets.architecture.total).toBe(15);
    expect(report.failureTaxonomy.parse).toBe(0);
  });
});

describe('RepoPulse real LLM adapter', () => {
  it('reads configuration from environment and streams the full query path', async () => {
    const stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const requestBody = JSON.parse(raw);
        expect(requestBody.model).toBe('test-model');
        expect(requestBody.stream).toBe(true);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: 'LLM route hit',
                    mermaid: 'flowchart LR\n A --> B',
                    suggestedAction: 'Trace Controller'
                  })
                }
              }
            ]
          })
        );
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const address = stub.address() as AddressInfo;

    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-llm-'));
    const oldUrl = process.env.REPOQA_LLM_URL;
    const oldModel = process.env.REPOQA_LLM_MODEL;
    const oldGate = process.env.REPOQA_GATES_PASSED;
    process.env.REPOQA_LLM_URL = `http://127.0.0.1:${address.port}`;
    process.env.REPOQA_LLM_MODEL = 'test-model';
    process.env.REPOQA_GATES_PASSED = '1';
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;
      const events: Array<{ type: string; payload: any }> = [];
      for await (const event of ctx.worker.queryRepo({
        repoId,
        question: 'route overview'
      })) {
        events.push(event as { type: string; payload: any });
      }
      expect(events.some((event) => event.type === 'repoqa.query.token')).toBe(true);
      const done = events.find((event) => event.type === 'repoqa.query.done');
      expect(done?.payload.answer).toBe('LLM route hit');
      expect(done?.payload.suggestedAction).toBe('Trace Controller');
    } finally {
      if (oldUrl === undefined) delete process.env.REPOQA_LLM_URL;
      else process.env.REPOQA_LLM_URL = oldUrl;
      if (oldModel === undefined) delete process.env.REPOQA_LLM_MODEL;
      else process.env.REPOQA_LLM_MODEL = oldModel;
      if (oldGate === undefined) delete process.env.REPOQA_GATES_PASSED;
      else process.env.REPOQA_GATES_PASSED = oldGate;
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });

  it('requires env configuration and caps ReAct prompts', async () => {
    await expect(completeReAct('hello', {})).rejects.toThrow(
      'REPOQA_LLM_URL is not configured'
    );
    const capped = capPrompt('x'.repeat(40_000));
    expect(capped.length).toBeLessThan(40_000);
    expect(capped).toContain('context truncated');
  });

  it('parses streamed SSE chunks and reports first-token latency', async () => {
    const stub = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const address = stub.address() as AddressInfo;
    try {
      const result = await completeReAct('say hello', {
        REPOQA_LLM_URL: `http://127.0.0.1:${address.port}`
      });
      expect(result.answer).toBe('Hello');
      expect(result.firstTokenMs).toBeGreaterThanOrEqual(0);
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });

  it('aborts when first-token latency exceeds the 1.5s hard gate', async () => {
    const stub = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.flushHeaders();
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":"late"}}]}\n\n');
        res.end();
      }, 1600);
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const address = stub.address() as AddressInfo;

    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-llm-latency-'));
    const oldUrl = process.env.REPOQA_LLM_URL;
    const oldGate = process.env.REPOQA_GATES_PASSED;
    process.env.REPOQA_LLM_URL = `http://127.0.0.1:${address.port}`;
    process.env.REPOQA_GATES_PASSED = '1';
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;

      await expect(
        (async () => {
          for await (const _event of ctx.worker.queryRepo({
            repoId,
            question: 'route overview'
          })) {
            // Drain the generator until the gate exception surfaces.
          }
        })()
      ).rejects.toThrow('Latency gate exceeded');

      const events = ctx.db
        .prepare(
          'SELECT event_type, failure_class FROM repoqa_events WHERE repo_id = ?'
        )
        .all(repoId) as Array<{ event_type: string; failure_class: string | null }>;
      expect(
        events.some(
          (event) =>
            event.event_type === 'query.failure' &&
            event.failure_class === 'latency-gate-exceeded'
        )
      ).toBe(true);
    } finally {
      if (oldUrl === undefined) delete process.env.REPOQA_LLM_URL;
      else process.env.REPOQA_LLM_URL = oldUrl;
      if (oldGate === undefined) delete process.env.REPOQA_GATES_PASSED;
      else process.env.REPOQA_GATES_PASSED = oldGate;
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
      await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
  });

  it('keeps the real adapter disabled until the eval gate env is set', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-llm-gate-'));
    const oldUrl = process.env.REPOQA_LLM_URL;
    const oldGate = process.env.REPOQA_GATES_PASSED;
    process.env.REPOQA_LLM_URL = 'http://127.0.0.1:1';
    delete process.env.REPOQA_GATES_PASSED;
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;
      const events: Array<{ type: string; payload: any }> = [];
      for await (const event of ctx.worker.queryRepo({
        repoId,
        question: 'route overview'
      })) {
        events.push(event as { type: string; payload: any });
      }
      const done = events.find((event) => event.type === 'repoqa.query.done');
      expect(done?.payload.answer).toContain('Static mock answer');
    } finally {
      if (oldUrl === undefined) delete process.env.REPOQA_LLM_URL;
      else process.env.REPOQA_LLM_URL = oldUrl;
      if (oldGate === undefined) delete process.env.REPOQA_GATES_PASSED;
      else process.env.REPOQA_GATES_PASSED = oldGate;
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
