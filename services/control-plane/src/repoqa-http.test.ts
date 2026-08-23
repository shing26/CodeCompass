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

async function makeMultiImplRepo(root: string): Promise<void> {
  const pkg = path.join(root, 'src', 'main', 'java', 'com', 'demo');
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(path.join(root, 'pom.xml'), '<project/>\n');
  await fs.writeFile(path.join(root, 'README.md'), '# Demo\n');
  await fs.writeFile(
    path.join(pkg, 'PaymentGateway.java'),
    'package com.demo;\npublic interface PaymentGateway {\n  String pay(double amount);\n}\n'
  );
  await fs.writeFile(
    path.join(pkg, 'AlipayGateway.java'),
    'package com.demo;\npublic class AlipayGateway implements PaymentGateway {\n  public String pay(double amount) {\n    return "alipay";\n  }\n}\n'
  );
  await fs.writeFile(
    path.join(pkg, 'WechatGateway.java'),
    'package com.demo;\npublic class WechatGateway implements PaymentGateway {\n  public String pay(double amount) {\n    return "wechat";\n  }\n}\n'
  );
  await fs.writeFile(
    path.join(pkg, 'PaymentController.java'),
    'package com.demo;\n@RestController\npublic class PaymentController {\n  private final PaymentGateway gateway = new AlipayGateway();\n  public String checkout() {\n    return gateway.pay(10.0);\n  }\n}\n'
  );
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
}

async function makeDocsRepo(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'src', 'main', 'java', 'com', 'demo'), {
    recursive: true
  });
  await fs.writeFile(
    path.join(root, 'README.md'),
    '# Demo\nGradle build runs from the repository root.\n'
  );
  await fs.writeFile(path.join(root, 'pom.xml'), '<project/>\n');
  await fs.writeFile(
    path.join(root, 'src', 'main', 'java', 'com', 'demo', 'OrderService.java'),
    'package com.demo;\n\n/** Core order service: handles checkout and refunds. */\npublic class OrderService {\n  public String checkout() {\n    return "ok";\n  }\n}\n'
  );
}

async function makeDepsRepo(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'src', 'main', 'java', 'com', 'demo'), {
    recursive: true
  });
  await fs.writeFile(
    path.join(root, 'pom.xml'),
    '<project>\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.demo</groupId>\n  <artifactId>demo</artifactId>\n  <version>1.0.0</version>\n  <dependencies>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-web</artifactId>\n      <version>3.2.4</version>\n    </dependency>\n    <dependency>\n      <groupId>com.mysql</groupId>\n      <artifactId>mysql-connector-j</artifactId>\n      <version>8.3.0</version>\n      <scope>runtime</scope>\n    </dependency>\n  </dependencies>\n</project>\n'
  );
  await fs.writeFile(path.join(root, 'README.md'), '# Demo\n');
  await fs.writeFile(
    path.join(root, 'src', 'main', 'java', 'com', 'demo', 'OrderService.java'),
    'package com.demo;\n\npublic class OrderService {\n  public String checkout() {\n    return "ok";\n  }\n}\n'
  );
}

async function makeDashboardRepo(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'src', 'main', 'java', 'com', 'demo'), {
    recursive: true
  });
  await fs.mkdir(path.join(root, 'src', 'main', 'resources'), { recursive: true });
  const pkg = path.join(root, 'src', 'main', 'java', 'com', 'demo');
  await fs.writeFile(
    path.join(root, 'pom.xml'),
    `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.demo</groupId>
  <artifactId>demo</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.2.4</version>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-security</artifactId>
      <version>3.2.4</version>
    </dependency>
    <dependency>
      <groupId>com.mysql</groupId>
      <artifactId>mysql-connector-j</artifactId>
      <version>8.3.0</version>
    </dependency>
  </dependencies>
</project>
`
  );
  await fs.writeFile(
    path.join(root, 'src', 'main', 'resources', 'application.yml'),
    'spring:\n  datasource:\n    password: supersecret\nserver:\n  port: 8080\n'
  );
  await fs.writeFile(
    path.join(pkg, 'OrdersController.java'),
    'package com.demo;\n\n@RestController\npublic class OrdersController {\n  private final OrderService orderService = new OrderService();\n\n  public String listOrders() {\n    return orderService.findOrders();\n  }\n}\n'
  );
  await fs.writeFile(
    path.join(pkg, 'OrderService.java'),
    'package com.demo;\n\n@Service\npublic class OrderService {\n  private final OrderRepository orderRepository = new OrderRepository();\n\n  public String findOrders() {\n    return orderRepository.findAll();\n  }\n}\n'
  );
  await fs.writeFile(
    path.join(pkg, 'OrderRepository.java'),
    'package com.demo;\n\n@Repository\npublic class OrderRepository {\n  public String findAll() {\n    return "orders";\n  }\n}\n'
  );
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
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
  }, 15_000);

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

  it('skips unparseable Java files with a warning event instead of failing the repo', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-parse-error-'));
    try {
      await makeJavaRepo(root);
      await fs.writeFile(
        path.join(root, 'src', 'main', 'java', 'com', 'demo', 'Broken.java'),
        'package com.demo;\npublic class Broken { int value = ; }\n'
      );
      const result = await importRepo(ctx.baseUrl, root);
      // Dogfooding (Issue 17): a single unparseable file must not abort the
      // whole import — the repo becomes ready and the skip is visible as an event.
      expect(result.body.repo?.status).toBe('ready');
      const repoId = result.body.repo!.id;
      const eventsResponse = await fetch(
        `${ctx.baseUrl}/api/events?repoId=${encodeURIComponent(repoId)}&eventType=repoqa.index.warning`
      );
      const eventsBody = (await eventsResponse.json()) as {
        events: Array<{ eventType: string; feedback: string }>;
      };
      const warning = eventsBody.events.find((event) => event.eventType === 'repoqa.index.warning');
      expect(warning).toBeTruthy();
      const feedback = JSON.parse(warning!.feedback) as { skippedFiles: number; files: Array<{ file: string; error: string }> };
      expect(feedback.skippedFiles).toBe(1);
      expect(feedback.files[0].file).toContain('Broken.java');
      expect(feedback.files[0].error).toContain('failed to parse');
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('RepoPulse onboarding tours HTTP API', () => {
  it('returns three deterministic onboarding tours from the symbol table', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-tours-http-'));
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      expect(result.body.repo?.status).toBe('ready');
      const repoId = result.body.repo!.id;

      const response = await fetch(`${ctx.baseUrl}/api/repos/${repoId}/tours`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        tours: Array<{
          id: string;
          title: string;
          description: string;
          steps: Array<{
            step: string;
            filePath: string;
            lineNumber: number;
            symbol: string;
            kind: string;
          }>;
          mermaid: string;
        }>;
      };
      expect(body.tours.map((tour) => tour.id)).toEqual([
        'auth-chain',
        'main-flow',
        'error-handling'
      ]);
      for (const tour of body.tours) {
        expect(tour.title).toBeTruthy();
        expect(tour.description).toBeTruthy();
        expect(tour.mermaid).toContain('flowchart LR');
      }

      // Controller.hello → DemoService.greet is the only route chain, so it
      // wins main-flow; auth-chain/error-handling have no security/advice
      // classes in this fixture.
      const mainFlow = body.tours.find((tour) => tour.id === 'main-flow')!;
      expect(mainFlow.steps.map((step) => step.step)).toEqual([
        '1. Controller.hello（入口接口）',
        '2. greet'
      ]);
      expect(mainFlow.steps.map((step) => step.lineNumber)).toEqual([5, 4]);
      expect(mainFlow.mermaid).toContain('hello --> greet');
      expect(mainFlow.mermaid).toContain(
        'click greet "code://src/main/java/com/demo/DemoService.java#4"'
      );

      const authChain = body.tours.find((tour) => tour.id === 'auth-chain')!;
      expect(authChain.steps.map((step) => step.step)).toEqual([
        '1. Controller.hello（受保护端点）'
      ]);
      const errorHandling = body.tours.find((tour) => tour.id === 'error-handling')!;
      expect(errorHandling.steps).toEqual([]);
      expect(errorHandling.mermaid).toContain('暂无匹配代码');
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('filters tours by ?type= and 404s for unknown repos', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-tours-filter-'));
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;

      const filtered = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/tours?type=auth-chain`
      );
      expect(filtered.status).toBe(200);
      const filteredBody = (await filtered.json()) as { tours: Array<{ id: string }> };
      expect(filteredBody.tours).toHaveLength(1);
      expect(filteredBody.tours[0].id).toBe('auth-chain');

      const missing = await fetch(`${ctx.baseUrl}/api/repos/missing-repo/tours`);
      expect(missing.status).toBe(404);
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('RepoPulse dashboard HTTP API', () => {
  it('aggregates tech stack, config topology, scale, and top APIs over the wire', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-dashboard-http-'));
    try {
      await makeDashboardRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      expect(result.body.repo?.status).toBe('ready');
      const repoId = result.body.repo!.id;

      const response = await fetch(`${ctx.baseUrl}/api/repos/${repoId}/dashboard`);
      expect(response.status).toBe(200);
      const text = await response.text();
      // Values are never indexed (Issue 06) — the payload must be value-free.
      expect(text).not.toContain('supersecret');
      expect(text).not.toContain('8080');
      expect(text).not.toContain('jdbc:mysql');

      const body = JSON.parse(text) as {
        dashboard: {
          repoId: string;
          repoName?: string;
          techStack: {
            summary: Array<{ category: string; label: string; count: number }>;
            highlights: string[];
          };
          config: {
            topology: Array<{
              key: string;
              filePath: string;
              lineStart?: number;
              group: string;
              sensitive: boolean;
            }>;
            maskedValues: boolean;
          };
          scale: Record<string, number>;
          topApis: Array<{
            name: string;
            controller: string;
            filePath: string;
            lineStart: number;
            depth: number;
            hops: string[];
          }>;
        };
      };
      const dashboard = body.dashboard;
      expect(dashboard.repoId).toBe(repoId);
      expect(dashboard.techStack.summary.length).toBe(3);
      expect(
        dashboard.techStack.summary.map((entry) => entry.category).sort()
      ).toEqual(['database', 'framework', 'security']);
      expect(dashboard.techStack.highlights[0]).toBe('Spring Boot');

      expect(dashboard.scale).toMatchObject({
        routes: 1,
        services: 1,
        repositories: 1,
        advices: 0,
        configKeys: 11
      });

      expect(dashboard.config.maskedValues).toBe(true);
      const serverPort = dashboard.config.topology.find(
        (item) => item.key === 'server.port'
      );
      expect(serverPort).toMatchObject({ group: 'server', sensitive: false });
      const dbPassword = dashboard.config.topology.find(
        (item) => item.key === 'spring.datasource.password'
      );
      expect(dbPassword).toMatchObject({ group: 'datasource', sensitive: true });

      expect(dashboard.topApis).toHaveLength(1);
      expect(dashboard.topApis[0]).toMatchObject({
        name: 'listOrders',
        controller: 'OrdersController',
        depth: 3,
        hops: ['listOrders', 'findOrders', 'findAll']
      });
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('404s for unknown repos', async () => {
    const ctx = await startServer();
    try {
      const missing = await fetch(`${ctx.baseUrl}/api/repos/missing-repo/dashboard`);
      expect(missing.status).toBe(404);
    } finally {
      await ctx.close();
    }
  });
});

describe('RepoPulse onboarding export HTTP API', () => {
  it('serves a value-free ONBOARDING.md with dashboard + tours sections', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-export-http-'));
    try {
      await makeDashboardRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      expect(result.body.repo?.status).toBe('ready');
      const repoId = result.body.repo!.id;

      const response = await fetch(`${ctx.baseUrl}/api/repos/${repoId}/export/onboarding`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/markdown');
      const disposition = response.headers.get('content-disposition') ?? '';
      expect(disposition).toMatch(/filename="[^"]+-ONBOARDING\.md"/);

      const markdown = await response.text();
      // Standard handover scaffolding.
      for (const section of [
        'ONBOARDING 架构交接手册',
        '## 技术栈（Tech Stack）',
        '## 架构指标（Architecture Scale）',
        '## 脱敏配置（Config Topology）',
        '## Top 核心 API（时序图）',
        '## Onboarding 路线（3 条）'
      ]) {
        expect(markdown).toContain(section);
      }
      // Dashboard content.
      expect(markdown).toContain('listOrders');
      expect(markdown).toContain('sequenceDiagram');
      expect(markdown).toContain('spring.datasource.password');
      expect(markdown).toContain('sensitive');
      // Tours content — all three routes present.
      expect(markdown).toContain('`auth-chain`');
      expect(markdown).toContain('`main-flow`');
      expect(markdown).toContain('`error-handling`');
      // Issue 06: values never leave the process.
      expect(markdown).not.toContain('supersecret');
      expect(markdown).not.toContain('8080');
      expect(markdown).not.toContain('jdbc:mysql');
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('404s for unknown repos', async () => {
    const ctx = await startServer();
    try {
      const missing = await fetch(`${ctx.baseUrl}/api/repos/missing-repo/export/onboarding`);
      expect(missing.status).toBe(404);
    } finally {
      await ctx.close();
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

      // Issue 10: deterministic architecture diagrams carry code:// click
      // bindings whose node IDs equal the rendered labels, so the frontend
      // can jump from a clicked node to the Inspector.
      const mermaidBlock = blocks[mermaidEventIndex];
      const mermaidData = JSON.parse(
        mermaidBlock.slice(mermaidBlock.indexOf('data: ') + 6)
      ) as { mermaid: string };
      expect(mermaidData.mermaid).toContain('Controller[Controller]');
      expect(mermaidData.mermaid).toContain(
        'click Controller "code://src/main/java/com/demo/Controller.java#3"'
      );
      expect(mermaidData.mermaid).toContain(
        'click greet "code://src/main/java/com/demo/DemoService.java#4"'
      );

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

  it('returns exact start/end/call line numbers for a Controller → Service chain', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-chain-lines-'));
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
        trace?: Array<{
          file: string;
          method: string;
          line?: number;
          lineEnd?: number;
          callLine?: number;
          break?: true;
          reason?: string;
        }>;
      };
      // Controller.java: hello() spans 5-7 and calls demoService.greet() on line 6;
      // DemoService.java: greet() spans 4-6.
      expect(doneData.trace).toEqual([
        {
          file: 'src/main/java/com/demo/Controller.java',
          method: 'hello',
          line: 5,
          lineEnd: 7,
          callLine: 5
        },
        {
          file: 'src/main/java/com/demo/DemoService.java',
          method: 'greet',
          line: 4,
          lineEnd: 6,
          callLine: 6
        }
      ]);
      expect(doneData.trace?.some((hop) => hop.break)).toBe(false);
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('flags interface multi-implementation dispatch as a Static Analysis Break in trace, mermaid, and answer', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-chain-dispatch-'));
    try {
      await makeMultiImplRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;

      const response = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?mode=call-chain&question=${encodeURIComponent('checkout')}`
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
        answer: string;
        mermaid?: string;
        trace?: Array<{
          file: string;
          method: string;
          line?: number;
          lineEnd?: number;
          callLine?: number;
          break?: true;
          reason?: string;
        }>;
      };
      const payHop = doneData.trace?.find((hop) => hop.method === 'pay');
      expect(payHop?.break).toBe(true);
      expect(payHop?.reason).toContain('Static Analysis Break: Dynamic/RPC Dispatch');
      expect(doneData.trace?.[0]).toEqual(
        expect.objectContaining({ method: 'checkout', line: 5, lineEnd: 7, callLine: 5 })
      );
      expect(doneData.mermaid).toContain('Dynamic/RPC Dispatch');
      expect(doneData.answer).toContain('Static Analysis Break: Dynamic/RPC Dispatch');
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('pins the trace start to the exact file via startName/startFile, never a same-name test sibling', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-chain-start-'));
    try {
      // Production Controller.hello() plus a SAME-named method in a test
      // class — reproduces the "Top API click jumped into OwnerControllerTests"
      // defect: the heuristic start once resolved to whatever symbol the
      // parser indexed first.
      await makeJavaRepo(root);
      await fs.mkdir(path.join(root, 'src', 'test', 'java', 'com', 'demo'), {
        recursive: true
      });
      await fs.writeFile(
        path.join(root, 'src', 'test', 'java', 'com', 'demo', 'ControllerTests.java'),
        'package com.demo;\npublic class ControllerTests {\n  public String hello() {\n    return "test";\n  }\n}\n'
      );
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;

      // Without an explicit start the heuristic must already prefer the
      // production method over the test sibling (findStartSymbol now filters
      // src/test paths first).
      const plainResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?mode=call-chain&question=${encodeURIComponent('trace hello')}`
      );
      const plainText = await plainResponse.text();
      const plainDone = plainText
        .split('\n\n')
        .find((block) => block.startsWith('event: repoqa.query.done'));
      const plainData = JSON.parse(
        plainDone!.slice(plainDone!.indexOf('data: ') + 6)
      ) as { trace?: Array<{ file: string; method: string }> };
      expect(plainData.trace?.[0]?.file).toBe('src/main/java/com/demo/Controller.java');

      // Explicit start pointing at the production file resolves to it exactly.
      const prodResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?mode=call-chain&question=${encodeURIComponent('trace hello')}&startName=hello&startFile=${encodeURIComponent('src/main/java/com/demo/Controller.java')}`
      );
      const prodText = await prodResponse.text();
      const prodDone = prodText
        .split('\n\n')
        .find((block) => block.startsWith('event: repoqa.query.done'));
      const prodData = JSON.parse(
        prodDone!.slice(prodDone!.indexOf('data: ') + 6)
      ) as {
        trace?: Array<{ file: string; method: string; line?: number; break?: true }>;
      };
      expect(prodData.trace?.[0]?.file).toBe('src/main/java/com/demo/Controller.java');
      expect(prodData.trace?.[0]?.method).toBe('hello');
      expect(prodData.trace?.map((hop) => hop.method)).toContain('greet');
      expect(prodData.trace?.some((hop) => hop.break)).toBe(false);

      // Explicit start pointing at the test file starts there — the pinned
      // symbol wins over any production-code preference.
      const testResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?mode=call-chain&question=${encodeURIComponent('trace hello')}&startName=hello&startFile=${encodeURIComponent('src/test/java/com/demo/ControllerTests.java')}`
      );
      const testText = await testResponse.text();
      const testDone = testText
        .split('\n\n')
        .find((block) => block.startsWith('event: repoqa.query.done'));
      const testData = JSON.parse(
        testDone!.slice(testDone!.indexOf('data: ') + 6)
      ) as { trace?: Array<{ file: string; method: string }> };
      expect(testData.trace?.[0]?.file).toBe('src/test/java/com/demo/ControllerTests.java');
      expect(testData.trace?.[0]?.method).toBe('hello');
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

  it('returns precise config key evidence with file+line for environment queries', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-config-evidence-'));
    try {
      await makeConfigRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;

      const configResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/symbols?kind=config`
      );
      const configBody = (await configResponse.json()) as {
        symbols: Array<{ name: string; filePath: string; lineStart?: number }>;
      };
      const serverPort = configBody.symbols.find(
        (symbol) => symbol.name === 'server.port'
      );
      expect(serverPort).toMatchObject({
        filePath: 'src/main/resources/application.properties',
        lineStart: 1
      });
      const dbPassword = configBody.symbols.find(
        (symbol) => symbol.name === 'spring.datasource.password'
      );
      expect(dbPassword).toMatchObject({
        filePath: 'src/main/resources/application.yml',
        lineStart: 3
      });

      const response = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?mode=environment&question=${encodeURIComponent('port')}`
      );
      const text = await response.text();
      expect(text).toContain('Found');
      expect(text).toContain('server.port');
      expect(text).toContain('src/main/resources/application.properties:1');
      expect(text).not.toContain('8080');
      expect(text.toLowerCase()).not.toContain('secret');

      const doneBlock = text
        .split('\n\n')
        .find((block) => block.startsWith('event: repoqa.query.done'));
      const doneData = JSON.parse(
        doneBlock!.slice(doneBlock!.indexOf('data: ') + 6)
      ) as {
        anchors?: Array<{ file: string; line: number; symbol: string }>;
      };
      expect(doneData.anchors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: 'src/main/resources/application.properties',
            line: 1,
            symbol: 'server.port'
          })
        ])
      );
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('indexes README and class-level doc comments as locatable chunks', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-docs-'));
    try {
      await makeDocsRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;

      const readmeResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/chunks?q=${encodeURIComponent('Gradle')}`
      );
      const readmeBody = (await readmeResponse.json()) as {
        chunks: Array<{
          chunkType: string;
          filePath: string;
          lineStart?: number;
          content: string;
        }>;
      };
      const readmeChunk = readmeBody.chunks.find(
        (chunk) => chunk.chunkType === 'readme'
      );
      expect(readmeChunk).toMatchObject({ filePath: 'README.md', lineStart: 1 });
      expect(readmeChunk!.content).toContain('Gradle');

      const docResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/chunks?q=${encodeURIComponent('checkout')}`
      );
      const docBody = (await docResponse.json()) as {
        chunks: Array<{
          chunkType: string;
          filePath: string;
          lineStart?: number;
          content: string;
        }>;
      };
      const docChunk = docBody.chunks.find(
        (chunk) => chunk.chunkType === 'docstring'
      );
      expect(docChunk).toMatchObject({
        filePath: 'src/main/java/com/demo/OrderService.java',
        lineStart: 3
      });
      expect(docChunk!.content).toContain('Core order service');
    } finally {
      await ctx.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('scans pom dependencies as component keys and answers dependency queries', async () => {
    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-deps-'));
    try {
      await makeDepsRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;

      const configResponse = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/symbols?kind=config`
      );
      const configBody = (await configResponse.json()) as {
        symbols: Array<{ name: string; filePath: string; lineStart?: number }>;
      };
      const starter = configBody.symbols.find(
        (symbol) => symbol.name === 'org.springframework.boot:spring-boot-starter-web'
      );
      expect(starter).toMatchObject({ filePath: 'pom.xml', lineStart: 9 });
      const mysql = configBody.symbols.find(
        (symbol) => symbol.name === 'com.mysql:mysql-connector-j (runtime)'
      );
      expect(mysql).toMatchObject({ filePath: 'pom.xml', lineStart: 14 });

      const response = await fetch(
        `${ctx.baseUrl}/api/repos/${repoId}/query?mode=environment&question=${encodeURIComponent('依赖组件')}`
      );
      const text = await response.text();
      expect(text).toContain('Found');
      expect(text).toContain('org.springframework.boot:spring-boot-starter-web');
      expect(text).toContain('com.mysql:mysql-connector-j (runtime)');
      expect(text).toContain('pom.xml:9');
      expect(text).toContain('pom.xml:14');
      expect(text.toLowerCase()).not.toContain('secret');
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
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;
      expect(result.body.repo?.status).toBe('ready');
      // Force a bad repo state directly so the query path records a failure class.
      ctx.db.prepare(`UPDATE repos SET status = 'error' WHERE id = ?`).run(repoId);

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
      // Issue 10: the adapter finalizes every answer into the three-section
      // layout (业务概述 / 证据与拆解 / 结论与下一步).
      expect(done?.payload.answer).toContain('LLM route hit');
      expect(done?.payload.answer).toContain('业务概述');
      expect(done?.payload.answer).toContain('结论与下一步');
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

  it('runs the ReAct tool loop end-to-end and masks secrets in every prompt', async () => {
    const bodies: string[] = [];
    let call = 0;
    const stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        bodies.push(raw);
        call += 1;
        let content: string;
        if (call === 1) {
          content = JSON.stringify({
            tool: { name: 'trace_call_chain', args: { query: 'hello' } }
          });
        } else if (call === 2) {
          content = JSON.stringify({
            tool: { name: 'repoqa-masking', args: { text: 'password=supersecret' } }
          });
        } else {
          content = JSON.stringify({
            answer: 'Route Controller.hello calls DemoService.greet',
            mermaid:
              'flowchart LR\n  Controller[Controller]\n  Service[Service]\n  Controller --> Service',
            anchors: [
              { file: 'src/main/java/com/demo/Controller.java', line: 7, symbol: 'Controller' },
              { file: 'src/main/java/com/demo/DemoService.java', line: 4, symbol: 'Service' }
            ],
            suggestedAction: 'Trace greet'
          });
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const address = stub.address() as AddressInfo;

    const ctx = await startServer();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-llm-react-'));
    const oldUrl = process.env.REPOQA_LLM_URL;
    const oldGate = process.env.REPOQA_GATES_PASSED;
    process.env.REPOQA_LLM_URL = `http://127.0.0.1:${address.port}`;
    process.env.REPOQA_GATES_PASSED = '1';
    try {
      await makeJavaRepo(root);
      const result = await importRepo(ctx.baseUrl, root);
      const repoId = result.body.repo!.id;
      const events: Array<{ type: string; payload: any }> = [];
      for await (const event of ctx.worker.queryRepo({
        repoId,
        question: 'trace hello'
      })) {
        events.push(event as { type: string; payload: any });
      }
      // Tool loop: trace_call_chain -> repoqa-masking -> final answer.
      expect(bodies.length).toBe(3);
      // The masking tool result is fed back, and the secret never reaches the
      // model raw: every prompt leaving the adapter is masked.
      expect(bodies[1]).toContain('[tool result 1]');
      expect(bodies[1]).toContain('Tool trace_call_chain');
      expect(bodies[2]).toContain('password=***');
      expect(bodies[2]).not.toContain('supersecret');
      const done = events.find((event) => event.type === 'repoqa.query.done');
      expect(done?.payload.answer).toContain('业务概述');
      expect(done?.payload.answer).toContain('结论与下一步');
      expect(done?.payload.answer).toContain('Controller.hello');
      // code:// anchors are bound into the diagram and validated against the repo.
      expect(done?.payload.mermaid).toContain(
        'code://src/main/java/com/demo/Controller.java#7'
      );
      expect(done?.payload.mermaid).toContain(
        'code://src/main/java/com/demo/DemoService.java#4'
      );
      expect(done?.payload.mermaid).not.toContain('http');
      expect(done?.payload.anchors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: 'src/main/java/com/demo/Controller.java',
            line: 7,
            symbol: 'Controller'
          }),
          expect.objectContaining({
            file: 'src/main/java/com/demo/DemoService.java',
            line: 4,
            symbol: 'Service'
          })
        ])
      );
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
      // Deterministic fallback answers describe the static analysis result
      // instead of a generic mock placeholder.
      expect(done?.payload.answer).toContain('静态分析');
      expect(done?.payload.answer).toContain('route overview');
      expect(done?.payload.answer).not.toContain('Static mock answer');
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
