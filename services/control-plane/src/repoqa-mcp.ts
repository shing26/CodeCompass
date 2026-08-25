import path from 'node:path';
import fs from 'node:fs/promises';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config';
import { openDb, ensureDefaultWorkspace, backupDb } from './db';
import { EventBus } from './events';
import type { Repo } from './repoqa-repos';
import { RepoQARepos, type RepoSymbol } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { CallResolver, resolveCallChain } from './repoqa-callchain';
import { buildDashboard } from './repoqa-dashboard';
import { buildTours } from './repoqa-tours';
import { matchConfigSymbols } from './repoqa-config';
import { analyzeDiff } from './repoqa-diff';

/**
 * Issue 20 — Model Context Protocol (MCP) server.
 *
 * Exposes the deterministic RepoQA analysis plane as MCP tools over stdio so
 * Agent clients (Claude, Codex, …) can query an indexed repository through the
 * standard JSON-RPC protocol:
 *
 *   codecompass_trace_call_chain(repoId, symbolOrMethod)
 *   codecompass_get_dashboard(repoId)
 *   codecompass_get_config_evidence(repoId, query?)
 *   codecompass_get_tours(repoId)
 *
 * All tools run against the same indexed SQLite evidence plane as the REST/SSE
 * workbench. Tool output keeps the Issue 06 invariant: configuration evidence
 * points to key locations (file:line) and never contains values.
 */

export const MCP_SERVER_NAME = 'codecompass';
export const MCP_SERVER_VERSION = '0.4.0';

/** Dependencies required to serve MCP tools (subset of the control-plane stack). */
export interface McpDeps {
  repoqa: RepoQARepos;
  worker: RepoQAWorker;
}

/** Handlers shared by worker + MCP tests; JSON is the wire format for tool results. */
export interface McpToolHandlerArgs {
  repoId?: unknown;
  symbolOrMethod?: unknown;
  query?: unknown;
  base?: unknown;
  head?: unknown;
  repoPath?: unknown;
}

/* ------------------------------------------------------------------ */
/* Tool metadata                                                       */
/* ------------------------------------------------------------------ */

export interface McpToolMeta {
  name: string;
  description: string;
  /** JSON Schema (rendered by the SDK from the zod shape) — used by tests. */
  inputSchema: { type: 'object'; properties: Record<string, { type: string; description?: string }>; required: string[] };
}

export const MCP_TOOLS: McpToolMeta[] = [
  {
    name: 'codecompass_list_repos',
    description:
      'List every indexed repo with its id, display name, status and file count. ' +
      'Use this first instead of guessing a repo id.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'codecompass_trace_call_chain',
    description:
      'Resolve the static call chain starting from a method/route/service/class name in an indexed repo. ' +
      'Returns ordered hops (file, method, line, lineEnd, callLine) plus break markers when static resolution stops.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name (from codecompass_catalog, GET /api/repos)' },
        symbolOrMethod: { type: 'string', description: 'Start symbol, e.g. "listOrders" or "OrdersController"' }
      },
      required: ['repoId', 'symbolOrMethod']
    }
  },
  {
    name: 'codecompass_get_dashboard',
    description:
      'Aggregate the repo cockpit: tech stack / dependency categories, config key topology (never values), ' +
      'scale counts (routes, services, methods…) and top @RestController call chains.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name' }
      },
      required: ['repoId']
    }
  },
  {
    name: 'codecompass_get_config_evidence',
    description:
      'Find configuration key evidence (YAML/properties/pom dependency keys) matching a natural-language query. ' +
      'Returns key paths with file:line locations only — values are never indexed or exposed.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name' },
        query: { type: 'string', description: 'Natural-language query, e.g. "数据库连接" or "datasource"' }
      },
      required: ['repoId']
    }
  },
  {
    name: 'codecompass_get_tours',
    description:
      'List the deterministic onboarding tours for a repo: auth-chain, main-flow and error-handling, ' +
      'each with ordered source steps and a Mermaid flowchart.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name' }
      },
      required: ['repoId']
    }
  },
  {
    name: 'codecompass_reverse_deps',
    description:
      'Find which methods call a target method/route/class (who-uses). Returns deterministic callers ' +
      'with file, method, line and call-site line, sorted by source location.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name' },
        symbolOrMethod: { type: 'string', description: 'Target symbol, e.g. "findOrders"' }
      },
      required: ['repoId', 'symbolOrMethod']
    }
  },
  {
    name: 'codecompass_get_pr_impact',
    description:
      'Analyze a base→head PR in a local git repo and return the deterministic architecture impact: ' +
      'changed Java symbols, affected @RestController APIs, config key changes, uncovered methods and Mermaid graph. ' +
      'Reads git objects only; configuration values are never included.',
    inputSchema: {
      type: 'object',
      properties: {
        repoPath: { type: 'string', description: 'Local git repository directory to analyze' },
        base: { type: 'string', description: 'Base git ref (branch, tag or commit)' },
        head: { type: 'string', description: 'Head git ref (branch, tag or commit)' }
      },
      required: ['repoPath', 'base', 'head']
    }
  }
];

/* ------------------------------------------------------------------ */
/* Pure tool handlers (deterministic, unit-testable)                   */
/* ------------------------------------------------------------------ */

/** Resolve a repo from an id or, as a convenience for agents, its display name. */
export function resolveMcpRepo(deps: McpDeps, repoId?: unknown): Repo {
  const raw = String(repoId ?? '').trim();
  if (!raw) throw new Error('repoId is required');
  const byId = deps.repoqa.getRepo(raw);
  if (byId) return byId;
  const byName = deps.repoqa.listRepos().find((repo) => repo.name === raw);
  if (byName) return byName;
  throw new Error(`Repo not found: ${raw}`);
}

function requireReady(repo: Repo): Repo {
  if (repo.status !== 'ready') {
    throw new Error(`Repo "${repo.name}" is not ready (status=${repo.status})`);
  }
  return repo;
}

export function mcpListRepos(deps: McpDeps): { repos: Array<{ id: string; name: string; status: Repo['status']; fileCount: number }> } {
  return {
    repos: deps.repoqa.listRepos().map((repo) => ({
      id: repo.id,
      name: repo.name,
      status: repo.status,
      fileCount: repo.fileCount
    }))
  };
}

export function mcpTraceCallChain(
  deps: McpDeps,
  args: McpToolHandlerArgs
): Array<{
  file: string;
  method: string;
  line: number | null;
  lineEnd: number | null;
  callLine: number | null;
  break: boolean;
  reason: string | null;
}> {
  const repo = requireReady(resolveMcpRepo(deps, args.repoId));
  const symbolOrMethod = String(args.symbolOrMethod ?? '').trim();
  if (!symbolOrMethod) throw new Error('symbolOrMethod is required');
  const start = deps.worker.findStartSymbolForQuery(repo.id, symbolOrMethod);
  if (!start) throw new Error(`Start symbol not found: ${symbolOrMethod}`);
  const graph = deps.worker.getSymbolGraph(repo.id);
  const trace = resolveCallChain(graph.symbols, start, 4, graph.index);
  return trace.map((hop) => ({
    file: hop.file,
    method: hop.method,
    line: hop.line ?? null,
    lineEnd: hop.lineEnd ?? null,
    callLine: hop.callLine ?? null,
    break: hop.break === true,
    reason: hop.reason ?? null
  }));
}

export function mcpGetDashboard(deps: McpDeps, args: McpToolHandlerArgs): Record<string, unknown> {
  const repo = requireReady(resolveMcpRepo(deps, args.repoId));
  const { symbols } = deps.worker.getSymbolGraph(repo.id);
  return buildDashboard({ repoId: repo.id, repoName: repo.name, symbols }) as unknown as Record<string, unknown>;
}

export function mcpGetConfigEvidence(
  deps: McpDeps,
  args: McpToolHandlerArgs
): {
  repoId: string;
  matchedKeys: Array<{ key: string; file: string; line: number }>;
  totalMatched: number;
  note: string;
} {
  const repo = requireReady(resolveMcpRepo(deps, args.repoId));
  const configs = deps.repoqa.listSymbols(repo.id, 'config');
  const query = String(args.query ?? '').trim();
  const matched = query ? matchConfigSymbols(query, configs) : configs;
  return {
    repoId: repo.id,
    matchedKeys: matched.slice(0, 50).map((symbol) => ({
      key: symbol.name,
      file: symbol.filePath,
      line: symbol.lineStart ?? 1
    })),
    totalMatched: matched.length,
    note: 'Values are never indexed by design; evidence points to file:line locations only.'
  };
}

export function mcpGetTours(deps: McpDeps, args: McpToolHandlerArgs): Record<string, unknown> {
  const repo = requireReady(resolveMcpRepo(deps, args.repoId));
  const { symbols } = deps.worker.getSymbolGraph(repo.id);
  return { tours: buildTours({ repoId: repo.id, repoName: repo.name, symbols }) } as unknown as Record<string, unknown>;
}

export function mcpReverseDeps(
  deps: McpDeps,
  args: McpToolHandlerArgs
): {
  repoId: string;
  target: { name: string; file: string; line: number };
  callers: Array<{ file: string; method: string; line: number; callLine: number | null }>;
  count: number;
  fallback: boolean;
} {
  const repo = requireReady(resolveMcpRepo(deps, args.repoId));
  const symbolOrMethod = String(args.symbolOrMethod ?? '').trim();
  if (!symbolOrMethod) throw new Error('symbolOrMethod is required');
  const resolution = deps.worker.resolveStartSymbolForQuery(repo.id, symbolOrMethod);
  if (!resolution) throw new Error(`Start symbol not found: ${symbolOrMethod}`);
  const graph = deps.worker.getSymbolGraph(repo.id);
  const callers = new CallResolver(graph.symbols, graph.index).reverseCallers(resolution.symbol);
  return {
    repoId: repo.id,
    target: {
      name: resolution.symbol.name,
      file: resolution.symbol.filePath,
      line: resolution.symbol.lineStart ?? 1
    },
    callers,
    count: callers.length,
    fallback: resolution.fallback
  };
}

async function realpathOrResolve(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

/** PR impact only runs against local paths already owned by an indexed repo. */
export async function isTrustedRepoPath(deps: McpDeps, repoPath: string): Promise<boolean> {
  const target = await realpathOrResolve(repoPath);
  const roots = await Promise.all(
    deps.repoqa.listRepos().map((repo) => realpathOrResolve(repo.localPath))
  );
  return roots.some((root) => {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

export async function mcpGetPrImpact(deps: McpDeps, args: McpToolHandlerArgs): Promise<Record<string, unknown>> {
  const repoPath = String(args.repoPath ?? '').trim();
  const base = String(args.base ?? '').trim();
  const head = String(args.head ?? '').trim();
  if (!repoPath || !base || !head) {
    throw new Error('repoPath, base and head are required');
  }
  if (!(await isTrustedRepoPath(deps, repoPath))) {
    throw new Error('repoPath is outside the indexed repos; import the repository first');
  }
  return (await analyzeDiff({ repoPath, base, head })) as unknown as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* MCP server (SDK)                                                    */
/* ------------------------------------------------------------------ */

function zodShapeFor(meta: McpToolMeta): Record<string, z.ZodType> {
  const required = new Set(meta.inputSchema.required);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, spec] of Object.entries(meta.inputSchema.properties)) {
    const base = spec.type === 'string' ? z.string() : z.unknown();
    shape[key] = required.has(key) ? base : (base as z.ZodString).optional();
  }
  return shape;
}

function textResult(value: unknown) {
  const text =
    typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text' as const, text }] };
}

/** Build the stdio MCP server with the four CodeCompass tools registered. */
export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  const handlers: Record<string, (args: McpToolHandlerArgs) => unknown | Promise<unknown>> = {
    codecompass_list_repos: () => mcpListRepos(deps),
    codecompass_trace_call_chain: (args) => mcpTraceCallChain(deps, args),
    codecompass_get_dashboard: (args) => mcpGetDashboard(deps, args),
    codecompass_get_config_evidence: (args) => mcpGetConfigEvidence(deps, args),
    codecompass_get_tours: (args) => mcpGetTours(deps, args),
    codecompass_reverse_deps: (args) => mcpReverseDeps(deps, args),
    codecompass_get_pr_impact: (args) => mcpGetPrImpact(deps, args)
  };

  // The SDK's registerTool generics infer very deep schemas; register through a
  // thin helper that treats the zod shape as opaque so typecheck stays shallow.
  const registerPlain = (
    meta: McpToolMeta,
    handler: (args: McpToolHandlerArgs) => unknown | Promise<unknown>
  ) => {
    (server.registerTool as any)(
      meta.name,
      { description: meta.description, inputSchema: zodShapeFor(meta) },
      async (args: McpToolHandlerArgs) => textResult(await handler(args))
    );
  };

  for (const meta of MCP_TOOLS) {
    registerPlain(meta, handlers[meta.name]);
  }

  return server;
}

/* ------------------------------------------------------------------ */
/* CLI bootstrap: codecompass mcp <path>                               */
/* ------------------------------------------------------------------ */

export type McpTransportFactory = () => (Transport | Promise<Transport>);

export interface RunMcpServerOptions {
  /** Local repo directory to index before serving (auto-import). */
  targetPath?: string;
  /** Data directory override (MHW_DATA_DIR). */
  dataDir?: string;
  /** Environment passed to loadConfig; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Log output; defaults to console.error (stdio must stay protocol-only). */
  log?: (line: string) => void;
  /** Injectable transport for tests; defaults to StdioServerTransport. */
  transportFactory?: McpTransportFactory;
}

/**
 * Boot the database-backed analysis stack (no HTTP listener), optionally index
 * the target repo, then serve the MCP protocol on stdio until the client
 * disconnects (stdin EOF) or the transport closes.
 */
export async function runMcpServer(options: RunMcpServerOptions = {}): Promise<void> {
  // Stdout is the MCP message channel (newline-delimited JSON); human-readable
  // progress must go to stderr so it can never corrupt the protocol stream.
  const log = options.log ?? ((line: string) => console.error(line));
  const env = { ...(options.env ?? process.env) };
  if (options.dataDir) env.MHW_DATA_DIR = options.dataDir;
  const config = loadConfig(env);

  await backupDb(config.dbPath);
  const db = openDb(config.dbPath);
  ensureDefaultWorkspace(db, config.dataDir);
  const repoqa = new RepoQARepos(db);
  repoqa.resetInterrupted();
  const worker = new RepoQAWorker(repoqa, new EventBus());

  try {
    if (options.targetPath) {
      const target = path.resolve(options.targetPath);
      log(`CodeCompass MCP: indexing ${target}`);
      const result = await worker.indexRepo({ localPath: target });
      const repo = result.repo;
      log(
        `CodeCompass MCP: indexed "${repo.name}" (${repo.id}) status=${repo.status} files=${repo.fileCount} symbols=${repo.symbolCount}`
      );
    }

    const server = createMcpServer({ repoqa, worker });
    const done = new Promise<void>((resolve) => {
      server.server.onclose = () => resolve();
      server.server.onerror = () => resolve();
    });

    const transport = options.transportFactory
      ? await options.transportFactory()
      : new StdioServerTransport();
    if (!options.transportFactory) {
      // Exit cleanly when the MCP client disconnects (stdin EOF).
      const onEof = () => {
        server.close().catch(() => {});
      };
      process.stdin.once('end', onEof);
      process.stdin.once('close', onEof);
    }

    await server.connect(transport);
    log('CodeCompass MCP: server ready on stdio (tools/list, tools/call)');
    await done;
    await server.close().catch(() => {});
  } finally {
    db.close();
  }
}
