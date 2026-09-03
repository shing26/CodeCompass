import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { openDb, ensureDefaultWorkspace } from './db';
import { EventBus } from './events';
import { RepoQARepos, type Repo } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { git } from './repoqa-diff';
import {
  createMcpServer,
  resolveMcpRepo,
  MCP_TOOLS,
  runMcpServer,
  type McpDeps
} from './repoqa-mcp';
import { parseArgs, runCli } from './cli';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()!;
    await cleanup().catch(() => {});
  }
});

function registerCleanup(fn: () => Promise<void>): void {
  cleanups.push(fn);
}

async function makeSpringRepo(root: string): Promise<void> {
  const pkg = path.join(root, 'src', 'main', 'java', 'com', 'demo');
  const res = path.join(root, 'src', 'main', 'resources');
  await fs.mkdir(pkg, { recursive: true });
  await fs.mkdir(res, { recursive: true });
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
  await fs.writeFile(path.join(root, 'README.md'), '# Demo\n');
  await fs.writeFile(
    path.join(res, 'application.yml'),
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
}

/** Create a tiny base→head git repo that has an impacted API after the head commit. */
async function makePrFixtureRepo(root: string): Promise<{ base: string; head: string }> {
  const pkg = path.join(root, 'src', 'main', 'java', 'com', 'demo');
  await fs.mkdir(pkg, { recursive: true });
  await fs.writeFile(path.join(root, 'README.md'), '# PR fixture\n');
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
  await git(['init', '-q'], root);
  await git(['config', 'user.email', 'repoqa@test.local'], root);
  await git(['config', 'user.name', 'RepoQA Test'], root);
  await git(['add', '-A'], root);
  await git(['commit', '-q', '-m', 'base'], root);
  const base = (await git(['rev-parse', 'HEAD'], root)).trim();
  await fs.writeFile(
    path.join(pkg, 'OrderRepository.java'),
    'package com.demo;\n\n@Repository\npublic class OrderRepository {\n  public String findAll() {\n    return "orders-v2";\n  }\n}\n'
  );
  await git(['add', '-A'], root);
  await git(['commit', '-q', '-m', 'head'], root);
  const head = (await git(['rev-parse', 'HEAD'], root)).trim();
  return { base, head };
}

interface TestHarness {
  dir: string;
  repoqa: RepoQARepos;
  worker: RepoQAWorker;
  repo: Repo;
  deps: McpDeps;
}

/** Boot an isolated control-plane stack (no HTTP listener) and index a Spring repo. */
async function setupIndexedRepo(repoRoot?: string): Promise<TestHarness> {
  const dir = repoRoot
    ? path.dirname(repoRoot)
    : await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-mcp-'));
  const dataDir = path.join(dir, 'data');
  const repoDir = repoRoot ?? path.join(dir, 'repo');
  await fs.mkdir(dataDir, { recursive: true });
  await makeSpringRepo(repoDir);

  const db = openDb(path.join(dataDir, 'mcp-test.db'));
  ensureDefaultWorkspace(db, dataDir);
  const repoqa = new RepoQARepos(db);
  repoqa.resetInterrupted();
  const worker = new RepoQAWorker(repoqa, new EventBus());
  const result = await worker.indexRepo({ localPath: repoDir });
  if (!result.repo) throw new Error('fixture repo row lost during indexing');
  expect(result.repo.status).toBe('ready');
  expect(result.repo.fileCount).toBeGreaterThan(0);
  expect(result.repo.symbolCount).toBeGreaterThan(0);

  registerCleanup(async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, repoqa, worker, repo: result.repo, deps: { repoqa, worker, dataDir } };
}

async function startServerPair(deps: McpDeps): Promise<{
  server: ReturnType<typeof createMcpServer>;
  clientTransport: InMemoryTransport;
  serverTransport: InMemoryTransport;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(deps);
  await server.connect(serverTransport);
  return { server, clientTransport, serverTransport };
}

interface RawResponse {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

let nextRequestId = 1;

/** Send a raw JSON-RPC request over the in-memory transport and await its response. */
function rawRequest(
  transport: InMemoryTransport,
  method: string,
  params?: Record<string, unknown>
): Promise<RawResponse> {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const previous = transport.onmessage;
    transport.onmessage = (message: any, _extra) => {
      if (message && message.id === id) {
        transport.onmessage = previous;
        resolve(message as RawResponse);
      }
    };
    transport
      .send({
        jsonrpc: '2.0',
        id,
        method,
        ...(params === undefined ? {} : { params })
      } as any)
      .catch(reject);
  });
}

/** Standard MCP handshake, then run `tools/list`. */
async function rawInitialize(transport: InMemoryTransport): Promise<RawResponse> {
  const init = await rawRequest(transport, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'repoqa-mcp-test', version: '0.0.1' }
  });
  expect(init.result).toBeDefined();
  expect(init.result.protocolVersion).toBeDefined();
  await transport.send({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {}
  } as any);
  return init;
}

/** tools/call against the raw client transport; resolves the parsed text result. */
async function rawCallTool(
  transport: InMemoryTransport,
  name: string,
  args: Record<string, unknown>
): Promise<{ response: RawResponse; text: string }> {
  const response = await rawRequest(transport, 'tools/call', { name, arguments: args });
  expect(response.error).toBeUndefined();
  const content = response.result.content as Array<{ type: string; text?: string }>;
  expect(content[0].type).toBe('text');
  return { response, text: content[0].text ?? '' };
}

describe('Issue 20 MCP tool metadata', () => {
  it('exposes the fourteen required tools with JSON Schema input contracts', () => {
    expect(MCP_TOOLS.map((tool) => tool.name).sort()).toEqual([
      'codecompass_diagnose',
      'codecompass_domain_radar',
      'codecompass_get_config_evidence',
      'codecompass_get_dashboard',
      'codecompass_get_pr_impact',
      'codecompass_get_subgraph_context',
      'codecompass_get_tours',
      'codecompass_index_repo',
      'codecompass_list_repos',
      'codecompass_module_evolution',
      'codecompass_refactor_plan',
      'codecompass_remove_repo',
      'codecompass_reverse_deps',
      'codecompass_trace_call_chain'
    ]);
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe('object');
      if (
        tool.name === 'codecompass_get_pr_impact' ||
        tool.name === 'codecompass_index_repo' ||
        tool.name === 'codecompass_list_repos'
      ) {
        continue;
      }
      expect(tool.inputSchema.required).toContain('repoId');
      const props = Object.keys(tool.inputSchema.properties);
      expect(props.length).toBeGreaterThan(0);
    }
    const list = MCP_TOOLS.find((tool) => tool.name === 'codecompass_list_repos')!;
    expect(list.inputSchema.required).toEqual([]);
    const reverse = MCP_TOOLS.find((tool) => tool.name === 'codecompass_reverse_deps')!;
    expect(reverse.inputSchema.required).toEqual(['repoId', 'symbolOrMethod']);
    const trace = MCP_TOOLS.find((tool) => tool.name === 'codecompass_trace_call_chain')!;
    expect(trace.inputSchema.required).toEqual(['repoId', 'symbolOrMethod']);
    const config = MCP_TOOLS.find((tool) => tool.name === 'codecompass_get_config_evidence')!;
    expect(config.inputSchema.required).toEqual(['repoId']);
    expect(config.inputSchema.properties.query).toBeDefined();
    const prImpact = MCP_TOOLS.find((tool) => tool.name === 'codecompass_get_pr_impact')!;
    expect(prImpact.inputSchema.required).toEqual(['repoPath', 'base', 'head']);
    const subgraph = MCP_TOOLS.find((tool) => tool.name === 'codecompass_get_subgraph_context')!;
    expect(subgraph.inputSchema.required).toEqual(['repoId', 'query']);
    expect(subgraph.inputSchema.properties.maxTokens).toBeDefined();
  });

  it('resolves repo ids and falls back to display names', async () => {
    const { repoqa, worker, repo, deps } = await setupIndexedRepo();
    expect(resolveMcpRepo(deps, repo.id).id).toBe(repo.id);
    expect(resolveMcpRepo(deps, repo.name).id).toBe(repo.id);
    expect(() => resolveMcpRepo(deps, 'missing-repo')).toThrow('Repo not found');
  });
});

describe('Issue 20 MCP protocol (JSON-RPC over in-memory transport)', () => {
  it('tools/list discovered over the raw JSON-RPC handshake is spec-compliant', async () => {
    const { deps } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const list = await rawRequest(clientTransport, 'tools/list', {});
      expect(list.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
        'codecompass_diagnose',
        'codecompass_domain_radar',
        'codecompass_get_config_evidence',
        'codecompass_get_dashboard',
        'codecompass_get_pr_impact',
        'codecompass_get_subgraph_context',
        'codecompass_get_tours',
        'codecompass_index_repo',
        'codecompass_list_repos',
        'codecompass_module_evolution',
        'codecompass_refactor_plan',
        'codecompass_remove_repo',
        'codecompass_reverse_deps',
        'codecompass_trace_call_chain'
      ]);
      for (const tool of list.result.tools) {
        expect(tool.inputSchema.type).toBe('object');
        if (
          tool.name === 'codecompass_get_pr_impact' ||
          tool.name === 'codecompass_index_repo' ||
          tool.name === 'codecompass_list_repos'
        ) {
          continue;
        }
        expect(tool.inputSchema.required).toContain('repoId');
      }
    } finally {
      await server.close();
    }
  });

  it('tools/list via the SDK Client exposes the same fourteen tools', async () => {
    const { deps } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      const client = new Client({ name: 'repoqa-mcp-client', version: '0.0.1' });
      await client.connect(clientTransport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        'codecompass_diagnose',
        'codecompass_domain_radar',
        'codecompass_get_config_evidence',
        'codecompass_get_dashboard',
        'codecompass_get_pr_impact',
        'codecompass_get_subgraph_context',
        'codecompass_get_tours',
        'codecompass_index_repo',
        'codecompass_list_repos',
        'codecompass_module_evolution',
        'codecompass_refactor_plan',
        'codecompass_remove_repo',
        'codecompass_reverse_deps',
        'codecompass_trace_call_chain'
      ]);
      const trace = tools.tools.find((tool) => tool.name === 'codecompass_trace_call_chain')!;
      expect((trace.inputSchema as any).required).toEqual(['repoId', 'symbolOrMethod']);
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_list_repos lists indexed repos for agent discovery', async () => {
    const { deps, repo } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const { text } = await rawCallTool(clientTransport, 'codecompass_list_repos', {});
      const body = JSON.parse(text) as {
        repos: Array<{
          id: string;
          name: string;
          status: string;
          fileCount: number;
          symbolCount: number;
          localPath: string;
        }>;
      };
      expect(body.repos).toContainEqual({
        id: repo.id,
        name: repo.name,
        status: 'ready',
        fileCount: repo.fileCount,
        symbolCount: repo.symbolCount,
        localPath: repo.localPath
      });
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_index_repo returns indexing immediately, then polls to ready', async () => {
    const { deps } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const newRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'index-repo-'));
      registerCleanup(async () => fs.rm(newRepoDir, { recursive: true, force: true }));
      await makeSpringRepo(newRepoDir);

      // ADR-0016: the call returns {status: 'indexing'} right away — no 30s
      // synchronous wait, no file/symbol counts yet.
      const { text } = await rawCallTool(clientTransport, 'codecompass_index_repo', {
        localPath: newRepoDir
      });
      const body = JSON.parse(text) as {
        repoId: string;
        name: string;
        status: string;
        localPath: string;
        pollHint?: string;
      };
      expect(body.repoId).toBeTruthy();
      expect(body.status).toBe('indexing');
      expect(body.localPath).toBe(newRepoDir);
      expect(body.pollHint).toContain('codecompass_list_repos');

      // Poll list_repos until the background index flips to ready.
      const listed = await rawCallTool(clientTransport, 'codecompass_list_repos', {});
      const listBody = JSON.parse(listed.text) as {
        repos: Array<{ id: string; status: string; localPath: string; error?: string }>;
      };
      const row = listBody.repos.find((entry) => entry.id === body.repoId);
      expect(row).toBeDefined();
      expect(['indexing', 'ready']).toContain(row!.status);
      expect(row!.localPath).toBe(newRepoDir);

      // Eventually-ready: poll up to ~20s, then the repoId is fully usable.
      let ready = false;
      for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const poll = await rawCallTool(clientTransport, 'codecompass_list_repos', {});
        const pollBody = JSON.parse(poll.text) as {
          repos: Array<{ id: string; status: string; error?: string; symbolCount?: number }>;
        };
        const polled = pollBody.repos.find((entry) => entry.id === body.repoId);
        if (polled?.status === 'ready') {
          ready = true;
          expect(polled.symbolCount).toBeGreaterThan(0);
        } else if (polled?.status === 'error') {
          throw new Error(`index failed: ${polled.error ?? 'unknown'}`);
        }
      }
      expect(ready).toBe(true);

      // The newly indexed repo is usable by other tools.
      const dash = await rawCallTool(clientTransport, 'codecompass_get_dashboard', {
        repoId: body.repoId
      });
      expect(JSON.parse(dash.text).repoId).toBe(body.repoId);
    } finally {
      await server.close();
    }
  }, 30_000);

  it('tools/call codecompass_index_repo rejects a non-existent local path without leaving a record', async () => {
    const { deps } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const response = await rawRequest(clientTransport, 'tools/call', {
        name: 'codecompass_index_repo',
        arguments: { localPath: '/nonexistent/path/xyz' }
      });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain('not a directory');
      // Pre-check gate: the failure happens before any DB row, so no zombie
      // indexing record may linger in list_repos.
      const listed = await rawCallTool(clientTransport, 'codecompass_list_repos', {});
      const listBody = JSON.parse(listed.text) as {
        repos: Array<{ localPath: string }>;
      };
      expect(listBody.repos.some((entry) => entry.localPath === '/nonexistent/path/xyz')).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_index_repo rejects when both url and localPath are provided', async () => {
    const { deps } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const response = await rawRequest(clientTransport, 'tools/call', {
        name: 'codecompass_index_repo',
        arguments: { url: 'https://github.com/org/repo.git', localPath: '/some/path' }
      });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain('not both');
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_index_repo rejects when neither url nor localPath is provided', async () => {
    const { deps } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const response = await rawRequest(clientTransport, 'tools/call', {
        name: 'codecompass_index_repo',
        arguments: {}
      });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain('Either url');
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_remove_repo deletes a ready repo and cascades its index data', async () => {
    const { deps, repo } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);

      // Symbols/chunks exist for the repo before removal.
      expect(deps.repoqa.listSymbols(repo.id).length).toBeGreaterThan(0);

      const { text } = await rawCallTool(clientTransport, 'codecompass_remove_repo', {
        repoId: repo.id
      });
      const body = JSON.parse(text) as { removed: boolean; repoId: string };
      expect(body.removed).toBe(true);
      expect(body.repoId).toBe(repo.id);

      // Catalog row gone, index data cascade-deleted.
      expect(deps.repoqa.getRepo(repo.id)).toBeUndefined();
      expect(deps.repoqa.listSymbols(repo.id)).toHaveLength(0);

      const listed = await rawCallTool(clientTransport, 'codecompass_list_repos', {});
      const listBody = JSON.parse(listed.text) as { repos: Array<{ id: string }> };
      expect(listBody.repos.some((entry) => entry.id === repo.id)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_remove_repo refuses while the repo is indexing', async () => {
    const { deps } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const newRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remove-repo-'));
      registerCleanup(async () => fs.rm(newRepoDir, { recursive: true, force: true }));
      await makeSpringRepo(newRepoDir);

      const { text } = await rawCallTool(clientTransport, 'codecompass_index_repo', {
        localPath: newRepoDir
      });
      const body = JSON.parse(text) as { repoId: string; status: string };
      expect(body.status).toBe('indexing');

      // Force the row to stay indexing regardless of how fast the background
      // index finishes, so the refusal path is deterministic.
      deps.repoqa.updateRepoStatus(body.repoId, 'indexing');
      const response = await rawRequest(clientTransport, 'tools/call', {
        name: 'codecompass_remove_repo',
        arguments: { repoId: body.repoId }
      });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain('still indexing');

      // The row survives the refused removal.
      expect(deps.repoqa.getRepo(body.repoId)).toBeDefined();
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_remove_repo rejects an unknown repoId', async () => {
    const { deps } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const response = await rawRequest(clientTransport, 'tools/call', {
        name: 'codecompass_remove_repo',
        arguments: { repoId: 'repo-does-not-exist' }
      });
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain('Repo not found');
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_reverse_deps returns deterministic who-uses callers', async () => {
    const { deps, repo } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const { text } = await rawCallTool(clientTransport, 'codecompass_reverse_deps', {
        repoId: repo.id,
        symbolOrMethod: 'findAll'
      });
      const body = JSON.parse(text) as {
        target: { name: string };
        callers: Array<{ method: string }>;
        count: number;
      };
      expect(body.target.name).toBe('findAll');
      expect(body.count).toBeGreaterThan(0);
      expect(body.callers.map((caller) => caller.method)).toContain('findOrders');
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_trace_call_chain returns ordered hops with source locations', async () => {
    const { deps, repo } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const { response, text } = await rawCallTool(clientTransport, 'codecompass_trace_call_chain', {
        repoId: repo.id,
        symbolOrMethod: 'listOrders'
      });
      expect(response.result.isError).toBeUndefined();
      const hops = JSON.parse(text);
      expect(hops.map((hop: { method: string }) => hop.method)).toEqual([
        'listOrders',
        'findOrders',
        'findAll'
      ]);
      expect(hops[0]).toMatchObject({
        file: 'src/main/java/com/demo/OrdersController.java',
        line: expect.any(Number),
        break: false,
        reason: null
      });
      expect(hops.every((hop: { file: string }) => hop.file.startsWith('src/main/java/'))).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_get_dashboard aggregates the cockpit', async () => {
    const { deps, repo } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const { text } = await rawCallTool(clientTransport, 'codecompass_get_dashboard', {
        repoId: repo.id
      });
      const dash = JSON.parse(text);
      expect(dash.repoId).toBe(repo.id);
      expect(dash.scale).toMatchObject({ routes: 1, services: 1, repositories: 1 });
      expect(dash.scale.methods).toBeGreaterThanOrEqual(3);
      expect(dash.config.maskedValues).toBe(true);
      expect(dash.topApis[0].hops).toEqual(['listOrders', 'findOrders', 'findAll']);
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_get_config_evidence never leaks values and matches queries', async () => {
    const { deps, repo } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const { text } = await rawCallTool(clientTransport, 'codecompass_get_config_evidence', {
        repoId: repo.id,
        query: 'datasource'
      });
      const body = JSON.parse(text);
      expect(body.note).toContain('never indexed');
      const keys = body.matchedKeys.map((entry: { key: string }) => entry.key);
      expect(keys).toContain('spring.datasource.password');
      // evidence is location-only: file + line, never the secret value
      expect(body.matchedKeys.every(
        (entry: { file: string; line: number }) => typeof entry.file === 'string' && typeof entry.line === 'number'
      )).toBe(true);
      expect(text).not.toContain('supersecret');
      expect(text).not.toContain('8080');
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_get_config_evidence without a query returns all config keys', async () => {
    const { deps, repo } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const { text } = await rawCallTool(clientTransport, 'codecompass_get_config_evidence', {
        repoId: repo.id
      });
      const body = JSON.parse(text);
      expect(body.totalMatched).toBeGreaterThanOrEqual(5);
      expect(body.matchedKeys.map((entry: { key: string }) => entry.key)).toContain('server.port');
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_get_tours returns the deterministic onboarding tours', async () => {
    const { deps, repo } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const { text } = await rawCallTool(clientTransport, 'codecompass_get_tours', {
        repoId: repo.id
      });
      const body = JSON.parse(text);
      expect(body.tours.map((tour: { id: string }) => tour.id)).toEqual([
        'auth-chain',
        'main-flow',
        'error-handling'
      ]);
      const main = body.tours.find((tour: { id: string }) => tour.id === 'main-flow');
      expect(main.steps.length).toBeGreaterThan(0);
      expect(main.steps[0]).toMatchObject({
        filePath: expect.any(String),
        lineNumber: expect.any(Number),
        symbol: expect.any(String)
      });
      expect(main.mermaid).toContain('flowchart');
    } finally {
      await server.close();
    }
  });

  it('tools/call codecompass_get_subgraph_context extracts masked Graph RAG context', async () => {
    const { deps, repo } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const { text } = await rawCallTool(
        clientTransport,
        'codecompass_get_subgraph_context',
        {
          repoId: repo.id,
          query: 'listOrders',
          maxTokens: 2000
        }
      );
      const body = JSON.parse(text) as {
        context: {
          start: { name: string };
          nodes: Array<{ name: string; direction: string }>;
          tokenCount: number;
          truncated: boolean;
          text: string;
        };
      };
      expect(body.context.start.name).toBe('listOrders');
      expect(body.context.nodes.length).toBeGreaterThan(1);
      expect(body.context.nodes.map((node) => node.name)).toEqual(
        expect.arrayContaining(['findOrders', 'findAll'])
      );
      expect(body.context.text).toContain('findAll');
      expect(body.context.tokenCount).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it('tools/call returns structured isError results for unknown repos and bad args', async () => {
    const { deps, repo } = await setupIndexedRepo();
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);

      const missing = await rawRequest(clientTransport, 'tools/call', {
        name: 'codecompass_trace_call_chain',
        arguments: { repoId: 'repo-missing', symbolOrMethod: 'listOrders' }
      });
      expect(missing.result.isError).toBe(true);
      expect(missing.result.content[0].text).toContain('Repo not found');

      const notReady = await rawRequest(clientTransport, 'tools/call', {
        name: 'codecompass_get_dashboard',
        arguments: { repoId: repo.id }
      });
      expect(notReady.result.isError).toBeUndefined();

      const badArgs = await rawRequest(clientTransport, 'tools/call', {
        name: 'codecompass_trace_call_chain',
        arguments: { repoId: repo.id }
      });
      expect(badArgs.result.isError).toBe(true);
      expect(badArgs.result.content[0].text.toLowerCase()).toContain('validation');
    } finally {
      await server.close();
    }
  });
});

describe('Phase 5 MCP PR impact', () => {
  it('tools/call codecompass_get_pr_impact only runs inside an indexed repo', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-mcp-pr-'));
    const repoDir = path.join(dir, 'repo');
    const { base, head } = await makePrFixtureRepo(repoDir);

    const { deps, repo } = await setupIndexedRepo(repoDir);
    const { server, clientTransport } = await startServerPair(deps);
    try {
      await rawInitialize(clientTransport);
      const { text } = await rawCallTool(clientTransport, 'codecompass_get_pr_impact', {
        repoPath: repo.localPath,
        base,
        head
      });
      const parsed = JSON.parse(text) as { schemaVersion: number; repoName: string; affectedApis: unknown[] };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.repoName).toBe('repo');
      expect(parsed.affectedApis.length).toBeGreaterThan(0);

      const outside = await rawRequest(clientTransport, 'tools/call', {
        name: 'codecompass_get_pr_impact',
        arguments: {
          repoPath: path.join(dir, 'outside'),
          base,
          head
        }
      });
      expect(outside.result.isError).toBe(true);
      expect(outside.result.content[0].text).toContain('outside the indexed repos');
    } finally {
      await server.close();
    }
  }, 30_000);
});

describe('Issue 20 MCP CLI wiring', () => {
  it('parses `codecompass mcp <path>` as the mcp subcommand', () => {
    expect(parseArgs(['mcp', 'C:/repos/demo'])).toEqual({
      ok: true,
      args: {
        command: 'mcp',
        targetPath: 'C:/repos/demo',
        noBrowser: false,
        noWatch: false,
        doctorJson: false,
        dryRun: false,
        failOnBreak: false,
        failOnAuthImpact: false,
        help: false,
        version: false,
        failOnImpact: false
      }
    });
    expect(parseArgs(['mcp', '--data-dir', 'D:/data', 'C:/repos/demo'])).toMatchObject({
      ok: true,
      args: { command: 'mcp', dataDir: 'D:/data', targetPath: 'C:/repos/demo' }
    });
    expect(parseArgs(['mcp'])).toMatchObject({ ok: true, args: { command: 'mcp' } });
  });

  it('`codecompass mcp <path>` auto-indexes and serves tools until the client disconnects', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-mcp-cli-'));
    const repoDir = path.join(dir, 'repo');
    const dataDir = path.join(dir, 'data');
    await makeSpringRepo(repoDir);
    await fs.mkdir(dataDir, { recursive: true });
    registerCleanup(async () => fs.rm(dir, { recursive: true, force: true }));

    const logs: string[] = [];
    let remote: InMemoryTransport | undefined;

    const run = runCli(['mcp', '--data-dir', dataDir, repoDir], {
      log: (line) => logs.push(line),
      mcpTransport: () => {
        const pair = InMemoryTransport.createLinkedPair();
        remote = pair[0];
        return pair[1];
      }
    });

    try {
      // runMcpServer indexes the target repo before serving — wait for the log.
      await waitFor(() => logs.some((line) => line.includes('indexed')), 20_000);
      expect(logs.some((line) => line.includes('indexed') && line.includes('status=ready'))).toBe(true);

      const repoName = path.basename(repoDir);
      // The running CLI answers real JSON-RPC tools/call over the linked transport.
      await rawInitialize(remote!);
      const { response, text } = await rawCallTool(remote!, 'codecompass_trace_call_chain', {
        repoId: repoName,
        symbolOrMethod: 'listOrders'
      });
      expect(response.result.isError).toBeUndefined();
      const hops = JSON.parse(text);
      expect(hops.map((hop: { method: string }) => hop.method)).toEqual([
        'listOrders',
        'findOrders',
        'findAll'
      ]);
      expect(logs.some((line) => line.includes('server ready on stdio'))).toBe(true);

      // Disconnect the client: runCli resolves with no HTTP server started.
      await remote!.close();
      const result = await run;
      expect(result.server).toBeNull();
      expect(result.cockpitUrl).toBeNull();
      expect(logs.some((line) => line.includes(`indexed "${repoName}"`))).toBe(true);
    } finally {
      await remote?.close().catch(() => {});
    }
  }, 30_000);
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
