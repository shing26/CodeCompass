import path from 'node:path';
import fs from 'node:fs/promises';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from './config';
import { openDb, ensureDefaultWorkspace, backupDb } from './db';
import { maskSensitiveText } from './repoqa-masking';
import { EventBus } from './events';
import type { Repo } from './repoqa-repos';
import { RepoQARepos, deriveLocalRepoName, type RepoSymbol } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { resolveCallChain } from './repoqa-callchain';
import { buildDashboard } from './repoqa-dashboard';
import { buildTours } from './repoqa-tours';
import { matchConfigSymbols } from './repoqa-config';
import { analyzeDiff } from './repoqa-diff';
import { extractSubgraphContext, type SubgraphContextResult } from './repoqa-graphrag';
import { runDiagnose } from './diagnose-engine';
import { runBlastRadius } from './blast-radius';
import { runDomainRadar } from './domain-radar-engine';
import { runModuleEvolution } from './module-evolution-engine';
import { runScan } from './scan-engine';
import {
  cloneGitRepo,
  deriveCloneName,
  validateGitBranch,
  validateGitUrl
} from './git-importer';

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
export const MCP_SERVER_VERSION = '0.20.0';

/* ------------------------------------------------------------------ */
/* Stdout protocol guard                                               */
/* ------------------------------------------------------------------ */

let stdioGuardInstalled = false;

/**
 * v0.8.0 — last-line stdout purity guard. The codebase's own logs already go
 * through console.error, but third-party dependencies occasionally emit
 * progress via console.log/info/warn; on the stdio transport a single such
 * line corrupts the JSON-RPC handshake. Redirect the non-protocol console
 * methods to stderr once, before any dependency is exercised. Idempotent.
 */
export function installStdioProtocolGuard(): void {
  if (stdioGuardInstalled) return;
  stdioGuardInstalled = true;
  const toStderr = (...args: unknown[]) => console.error(...args);
  console.log = toStderr;
  console.info = toStderr;
  console.warn = toStderr;
}

/** Dependencies required to serve MCP tools (subset of the control-plane stack). */
export interface McpDeps {
  repoqa: RepoQARepos;
  worker: RepoQAWorker;
  /** Data root; remote clones land under `<dataDir>/clones/`. */
  dataDir: string;
}

/** Handlers shared by worker + MCP tests; JSON is the wire format for tool results. */
export interface McpToolHandlerArgs {
  repoId?: unknown;
  symbolOrMethod?: unknown;
  query?: unknown;
  base?: unknown;
  head?: unknown;
  repoPath?: unknown;
  maxTokens?: unknown;
  entrySymbol?: unknown;
  symptomDescription?: unknown;
  targetSymbol?: unknown;
  changeType?: unknown;
  intentType?: unknown;
  targetSymbolOrModule?: unknown;
  extensionGoal?: unknown;
  url?: unknown;
  localPath?: unknown;
  branch?: unknown;
  name?: unknown;
  nearPackages?: unknown;
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
  },
  {
    name: 'codecompass_get_subgraph_context',
    description:
      'Extract a deterministic Graph RAG subgraph around a resolved start symbol: 1-hop callers, ' +
      '1-3 hop callees, class skeletons, token pruning and 13-pattern credential masking. ' +
      'Returns agent-ready Markdown with code:// source anchors.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name' },
        query: { type: 'string', description: 'Start symbol or natural-language phrase, e.g. "listOrders"' },
        maxTokens: { type: 'number', description: 'Optional soft output budget in estimated tokens (default 6000)' }
      },
      required: ['repoId', 'query']
    }
  },
  {
    name: 'codecompass_domain_radar',
    description:
      'Domain panorama over the symbol graph (deterministic, zero-LLM): hub nodes by degree and ' +
      'deterministic PageRank (damping 0.85, sink mass redistributed), top external APIs, the ' +
      'persistence layer, and — with a natural-language intent — the top-3 anchor symbols blended ' +
      'from identifier fuzzy matching, doc-chunk evidence and graph rank. No embeddings.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name' },
        query: { type: 'string', description: 'Optional intent phrase, e.g. "用户点赞" or "like"' }
      },
      required: ['repoId']
    }
  },
  {
    name: 'codecompass_module_evolution',
    description:
      'Module evolution planning (deterministic, zero-LLM). DEPRECATE: clusters a module, computes ' +
      'external references, cascades orphaned public code with a fixed-point scan and emits a ' +
      'teardown checklist. EXTEND: locates the attach point, surfaces declaration-level transaction ' +
      'boundaries (method/class/interface) and emits a decoupling pattern with code scaffolds. ' +
      'Patches are never produced here (ADR-0006).',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name' },
        intentType: { type: 'string', description: 'DEPRECATE | EXTEND' },
        targetSymbolOrModule: {
          type: 'string',
          description: 'Module name/directory for DEPRECATE; main-flow symbol for EXTEND'
        },
        extensionGoal: { type: 'string', description: 'Optional free-text goal for EXTEND' }
      },
      required: ['repoId', 'intentType', 'targetSymbolOrModule']
    }
  },
  {
    name: 'codecompass_diagnose',
    description:
      'Cross-stack root-cause traversal (deterministic, zero-LLM): frontend components → HTTP router → ' +
      'service → data mapper. Every hop is a statically bound graph edge; unresolvable hops are reported ' +
      'BROKEN with the deterministic reason. Entry is a method name or "METHOD /route/path". ' +
      'Returns a layer-annotated chain, a root-cause summary and a cockpit deep link.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name' },
        entrySymbol: { type: 'string', description: 'Entry symbol, e.g. "handleLike" or "POST /api/v1/posts/:id/like"' },
        symptomDescription: { type: 'string', description: 'Optional free-text symptom carried into the report' }
      },
      required: ['repoId', 'entrySymbol']
    }
  },
  {
    name: 'codecompass_refactor_plan',
    description:
      'Blast-radius refactor planning (deterministic, zero-LLM): recursively aggregates direct/indirect ' +
      'callers of a target symbol, lifts impacted API routes and bridged frontend components, scores risk ' +
      'HIGH/MEDIUM/LOW and emits migration steps plus a cockpit deep link.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name' },
        targetSymbol: { type: 'string', description: 'Target symbol, e.g. "PostService.deletePost" or "deletePost"' },
        changeType: {
          type: 'string',
          description: 'One of SIGNATURE_CHANGE | REMOVAL | LOGIC_REFACTOR'
        }
      },
      required: ['repoId', 'targetSymbol', 'changeType']
    }
  },
  {
    name: 'codecompass_index_repo',
    description:
      'Clone and index a git repository (by URL) or add a local directory, then make ' +
      'it available to all other codecompass tools. ASYNCHRONOUS (ADR-0016): returns ' +
      '{repoId, status: "indexing"} immediately once the repo row exists — the AST ' +
      'index runs in the background. Poll codecompass_list_repos until this repoId ' +
      'reports status "ready" or "error" (error carries the root-cause summary); ' +
      'then pass the repoId to the other tools. Synchronous failures (invalid URL, ' +
      'unreachable remote, missing local path) throw immediately and create no repo ' +
      'record. The clone phase (≤60s) runs before the first return.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Git repository URL (https://github.com/org/repo.git) — mutually exclusive with localPath'
        },
        localPath: {
          type: 'string',
          description: 'Local directory path — mutually exclusive with url'
        },
        branch: {
          type: 'string',
          description: 'Optional git branch or tag (default: the remote default branch)'
        },
        name: {
          type: 'string',
          description: 'Optional display name (default: derived from the URL or directory basename)'
        }
      },
      required: []
    }
  },
  {
    name: 'codecompass_remove_repo',
    description:
      'Remove a repo from the CodeCompass index: deletes its catalog row and all ' +
      'indexed data (symbols, chunks, files, events). Source files and any cloned ' +
      'directory on disk are intentionally kept — re-index the same path later with ' +
      'codecompass_index_repo. Refuses while the repo is still indexing; poll ' +
      'codecompass_list_repos until ready/error first.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name (from codecompass_list_repos)' }
      },
      required: ['repoId']
    }
  },
  {
    name: 'codecompass_scan',
    description:
      'Candidate Scan — proactive "what should I touch in this repo?" (deterministic, ' +
      'zero-LLM). Returns four buckets with file:line anchors: orphanedPublic (zero ' +
      'static callers — verify reflectively-invoked code first), hubs (highest ' +
      'PageRank, run refactor_plan before touching), oversized (methods ≥150 lines), ' +
      'deepChains (longest entry flows — run diagnose on them). Each bucket carries ' +
      'the deterministic next tool to run. Use this when you know a repo is indexed ' +
      'but do not know where to start.',
    inputSchema: {
      type: 'object',
      properties: {
        repoId: { type: 'string', description: 'Repo id or name (from codecompass_list_repos)' }
      },
      required: ['repoId']
    }
  },
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

export function mcpListRepos(deps: McpDeps): {
  repos: Array<{
    id: string;
    name: string;
    status: Repo['status'];
    fileCount: number;
    symbolCount: number;
    localPath: string;
    /** Root-cause summary when status === 'error' (v0.18 observability). */
    error?: string;
  }>;
} {
  return {
    repos: deps.repoqa.listRepos().map((repo) => ({
      id: repo.id,
      name: repo.name,
      status: repo.status,
      fileCount: repo.fileCount,
      symbolCount: repo.symbolCount,
      localPath: repo.localPath,
      // ADR-0003: error summaries carry raw exception text (git stderr, paths);
      // they pass the sensitive-info filter before leaving the process.
      ...(repo.error ? { error: maskSensitiveText(repo.error) } : {})
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
  const configs = deps.repoqa
    .listSymbols(repo.id)
    .filter((symbol) => symbol.kind === 'config' || symbol.kind === 'dependency');
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
  // Honest degradation (v0.18): tours are Java/Spring-shaped; empty-step shells
  // on non-Java repos would mislead agents. Mirror the HTTP layer's filtering
  // (http.ts GET /tours) and explain the boundary when nothing survives.
  const tours = buildTours({ repoId: repo.id, repoName: repo.name, symbols }).filter(
    (tour) => tour.steps.length > 0
  );
  const note =
    tours.length === 0
      ? 'No routes detected in this repo — tours currently cover Java/Spring REST projects (auth-chain / main-flow / error-handling).'
      : undefined;
  return { tours, ...(note ? { note } : {}) } as unknown as Record<string, unknown>;
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
  return deps.worker.reverseDeps(repo.id, String(args.symbolOrMethod ?? ''));
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

export async function mcpGetSubgraphContext(
  deps: McpDeps,
  args: McpToolHandlerArgs
): Promise<{ context: SubgraphContextResult }> {
  const repo = requireReady(resolveMcpRepo(deps, args.repoId));
  const query = String(args.query ?? '').trim();
  if (!query) throw new Error('query is required');

  let maxTokens: number | undefined;
  if (args.maxTokens !== undefined) {
    const parsed = Number(args.maxTokens);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100_000) {
      throw new Error('maxTokens must be a positive integer (1..100000)');
    }
    maxTokens = parsed;
  }

  const graph = deps.worker.getSymbolGraph(repo.id);
  const resolution = deps.worker.resolveStartSymbolForQuery(repo.id, query);
  if (!resolution) throw new Error(`Start symbol not found: ${query}`);
  const context = await extractSubgraphContext(graph.symbols, resolution.symbol, {
    root: repo.localPath,
    index: graph.index,
    ...(maxTokens === undefined ? {} : { maxTokens })
  });
  return { context };
}

/** v0.9.0 — deterministic domain panorama (hubs, top APIs, intent anchors). */
export function mcpDomainRadar(deps: McpDeps, args: McpToolHandlerArgs): Record<string, unknown> {
  const repo = requireReady(resolveMcpRepo(deps, args.repoId));
  const graph = deps.worker.getSymbolGraph(repo.id);
  const query = args.query === undefined ? undefined : String(args.query ?? '').trim();
  // Chunk LIKE hits bridge Chinese/colloquial intents to symbol-bearing files.
  const chunkHitFiles = query
    ? deps.repoqa
        .searchChunks(repo.id, query)
        .map((chunk) => chunk.filePath)
        .filter((file): file is string => Boolean(file))
    : undefined;
  return runDomainRadar({
    repoId: repo.id,
    ...(query ? { query } : {}),
    symbols: graph.symbols,
    index: graph.index,
    ...(chunkHitFiles ? { chunkHitFiles } : {})
  }) as unknown as Record<string, unknown>;
}

/** v0.9.0 — deterministic module evolution planning (deprecate / extend). */
export function mcpModuleEvolution(deps: McpDeps, args: McpToolHandlerArgs): Record<string, unknown> {
  const repo = requireReady(resolveMcpRepo(deps, args.repoId));
  const graph = deps.worker.getSymbolGraph(repo.id);
  const intentType = String(args.intentType ?? 'DEPRECATE') as 'DEPRECATE' | 'EXTEND';
  const baseUrl = `http://localhost:${loadConfig(process.env).port}`;
  return runModuleEvolution({
    repoId: repo.id,
    intentType,
    targetSymbolOrModule: String(args.targetSymbolOrModule ?? ''),
    ...(args.extensionGoal === undefined ? {} : { extensionGoal: String(args.extensionGoal) }),
    ...(Array.isArray(args.nearPackages)
      ? { nearPackages: args.nearPackages.map((entry) => String(entry)).filter(Boolean) }
      : {}),
    symbols: graph.symbols,
    index: graph.index,
    baseUrl,
    // ADR-0010: `unversioned` is the honest fallback when no commit is known.
    commit: repo.commit ?? 'unversioned'
  }) as unknown as Record<string, unknown>;
}

/** v0.8.0 — deterministic cross-stack root-cause traversal. */
export function mcpDiagnose(deps: McpDeps, args: McpToolHandlerArgs): Record<string, unknown> {
  const repo = requireReady(resolveMcpRepo(deps, args.repoId));
  const graph = deps.worker.getSymbolGraph(repo.id);
  // Deep links must honor the actually-bound control-plane port, not a guess.
  const baseUrl = `http://localhost:${loadConfig(process.env).port}`;
  return runDiagnose({
    repoId: repo.id,
    entrySymbol: String(args.entrySymbol ?? ''),
    ...(args.symptomDescription === undefined
      ? {}
      : { symptomDescription: String(args.symptomDescription) }),
    symbols: graph.symbols,
    index: graph.index,
    baseUrl,
    snippetRoot: repo.localPath
  }) as unknown as Record<string, unknown>;
}

/** v0.8.0 — deterministic blast-radius refactor planning. */
export function mcpRefactorPlan(deps: McpDeps, args: McpToolHandlerArgs): Record<string, unknown> {
  const repo = requireReady(resolveMcpRepo(deps, args.repoId));
  const graph = deps.worker.getSymbolGraph(repo.id);
  const baseUrl = `http://localhost:${loadConfig(process.env).port}`;
  return runBlastRadius({
    repoId: repo.id,
    targetSymbol: String(args.targetSymbol ?? ''),
    changeType: String(args.changeType ?? 'SIGNATURE_CHANGE') as
      | 'SIGNATURE_CHANGE'
      | 'REMOVAL'
      | 'LOGIC_REFACTOR',
    symbols: graph.symbols,
    index: graph.index,
    baseUrl
  }) as unknown as Record<string, unknown>;
}

/**
 * v0.18.0 — index a new repo from a local path or git URL, asynchronously.
 *
 * ADR-0016: MCP long operations return immediately. The synchronous portion of
 * this handler is bounded and fail-fast: URL/branch validation, the (≤60s)
 * shallow clone, and — for localPath — an existence/readability pre-check.
 * Any failure there throws before a repo row is ever created, so a failed
 * start never leaves zombie records. Once the row exists it is marked
 * `indexing` and the AST index itself runs fire-and-forget; agents observe
 * progress via `codecompass_list_repos` (status: indexing → ready | error,
 * with the error summary on the row).
 */
export async function mcpIndexRepo(
  deps: McpDeps,
  args: McpToolHandlerArgs
): Promise<Record<string, unknown>> {
  const url = typeof args.url === 'string' ? args.url.trim() : '';
  const localPath = typeof args.localPath === 'string' ? args.localPath.trim() : '';
  const branch = typeof args.branch === 'string' ? args.branch.trim() : undefined;
  const name = typeof args.name === 'string' ? args.name.trim() : undefined;

  if (url && localPath) {
    throw new Error('Provide either url or localPath, not both');
  }
  if (!url && !localPath) {
    throw new Error('Either url (git repository URL) or localPath (local directory) is required');
  }

  // Fast-fail URL/branch validation before any clone side effect, matching the
  // http.ts entry-point convention (cloneGitRepo re-validates as a guard).
  if (url) {
    const urlCheck = validateGitUrl(url);
    if (!urlCheck.ok) throw new Error(urlCheck.error);
  }
  const validatedBranch = validateGitBranch(branch);

  let targetPath: string;
  let effectiveName: string | undefined = name;

  if (url) {
    const baseName = deriveCloneName(url);
    effectiveName = name ?? baseName;
    targetPath = path.join(deps.dataDir, 'clones', `${baseName}-${Date.now()}`);
    await cloneGitRepo({ url, branch: validatedBranch, targetDir: targetPath });
  } else {
    // Pre-check gate (v0.18, mirrors clone-failure semantics): an invalid or
    // unreadable localPath must fail synchronously WITHOUT creating a repo
    // row — otherwise a zombie `indexing` record would linger in list_repos
    // with the real error only visible to the background task.
    const stat = await fs.stat(localPath).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new Error(`local path is not a directory: ${localPath}`);
    }
    await fs.access(localPath, fs.constants.R_OK).catch(() => {
      throw new Error(`local path is not readable: ${localPath}`);
    });
    targetPath = localPath;
  }
  // upsertByLocalPath binds name directly into a NOT NULL column; mirror the
  // worker's basename fallback here.
  if (!effectiveName) {
    effectiveName = deriveLocalRepoName(targetPath);
  }

  // COALESCE keeps repo_url across the worker's own re-upsert inside indexRepo.
  const upsert = deps.repoqa.upsertByLocalPath({
    name: effectiveName,
    localPath: targetPath,
    branch: validatedBranch,
    ...(url ? { repoUrl: url } : {})
  });
  const repoId = upsert.repo.id;
  deps.repoqa.updateRepoStatus(repoId, 'indexing');

  // Fire-and-forget (ADR-0016). indexRepo records failures as status='error'
  // on the repo row itself, but its pre-try prologue (fs.stat, upsert) can
  // still reject — swallowing that would leave the row stuck in `indexing`
  // forever (the zombie ADR-0016 §3 forbids). So the catch flips the row to
  // error with the root cause for list_repos polling.
  void deps.worker
    .indexRepo({ localPath: targetPath, branch: validatedBranch, name: effectiveName })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      deps.repoqa.updateRepoStatus(repoId, 'error', undefined, undefined, message);
    });

  return {
    repoId,
    name: upsert.repo.name,
    status: 'indexing',
    localPath: targetPath,
    pollHint: 'Poll codecompass_list_repos until this repoId reports status ready or error'
  };
}

/**
 * v0.18.0 — remove a repo from the index. Mirrors the DELETE /api/repos/:id
 * semantics: refuses while indexing (the worker would otherwise resurrect a
 * ghost index when it finishes), then invalidates the symbol cache and
 * cascade-deletes the row plus its symbols/chunks/files/events. Disk contents
 * (source trees and clones) are intentionally untouched (ADR-0001).
 */
export function mcpRemoveRepo(deps: McpDeps, args: McpToolHandlerArgs): Record<string, unknown> {
  const repo = resolveMcpRepo(deps, args.repoId);
  if (repo.status === 'indexing') {
    throw new Error(
      `Repo "${repo.name}" is still indexing; poll codecompass_list_repos until ready or error first`
    );
  }
  deps.worker.invalidate(repo.id);
  deps.repoqa.deleteRepo(repo.id);
  return { removed: true, repoId: repo.id, name: repo.name };
}

/** v0.19.0 — Candidate Scan: proactive "where should I start" buckets. */
export function mcpScan(deps: McpDeps, args: McpToolHandlerArgs): Record<string, unknown> {
  const repo = requireReady(resolveMcpRepo(deps, args.repoId));
  const graph = deps.worker.getSymbolGraph(repo.id);
  const baseUrl = `http://localhost:${loadConfig(process.env).port}`;
  return runScan({
    repoId: repo.id,
    repoName: repo.name,
    symbols: graph.symbols,
    index: graph.index,
    baseUrl
  }) as unknown as Record<string, unknown>;
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

/** Build the stdio MCP server with all CodeCompass tools registered. */
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
    codecompass_get_pr_impact: (args) => mcpGetPrImpact(deps, args),
    codecompass_get_subgraph_context: (args) => mcpGetSubgraphContext(deps, args),
    codecompass_domain_radar: (args) => mcpDomainRadar(deps, args),
    codecompass_module_evolution: (args) => mcpModuleEvolution(deps, args),
    codecompass_diagnose: (args) => mcpDiagnose(deps, args),
    codecompass_refactor_plan: (args) => mcpRefactorPlan(deps, args),
    codecompass_index_repo: (args) => mcpIndexRepo(deps, args),
    codecompass_remove_repo: (args) => mcpRemoveRepo(deps, args),
    codecompass_scan: (args) => mcpScan(deps, args)
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
  // The guard also traps stray console.log/info/warn from third-party deps.
  installStdioProtocolGuard();
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
      // Synchronous one-shot path: the ghost guard cannot trip here, but the
      // type is Repo | null since v0.18 — fail loudly instead of crashing.
      if (!result.repo) throw new Error(`indexing produced no repo row: ${target}`);
      const repo = result.repo;
      log(
        `CodeCompass MCP: indexed "${repo.name}" (${repo.id}) status=${repo.status} files=${repo.fileCount} symbols=${repo.symbolCount}`
      );
    }

    const server = createMcpServer({ repoqa, worker, dataDir: config.dataDir });
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
