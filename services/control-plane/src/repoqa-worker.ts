import fs from 'node:fs/promises';
import path from 'node:path';
import type { RepoQARepos, Repo, RepoSymbol, RepoChunk } from './repoqa-repos';
import { applyModuleScopes } from './repoqa-repos';
import type { EventBus } from './events';
import type {
  RepoQaAnchor,
  RepoQaTraceHop,
  ServerEvent,
  IndexingPhase,
  DiagnoseResult
} from '../../../packages/contracts/src/index';
import {
  MAX_FILES,
  MAX_LINES,
  scanRepo,
  detectMavenModules,
  detectSuggestedSubdirs,
  mavenSourceRoots
} from './repoqa-scan';
import { adapterFor } from './repoqa-parser';
import { extractConfigSymbols, matchConfigSymbols } from './repoqa-config';
import { extractMapperSymbols } from './repoqa-mapper';
import { parseLargeFileTier3 } from './large-file';
import {
  buildCallIndex,
  CallResolver,
  resolveCallChain,
  type ReverseCaller,
  type SymbolIndex,
  applyImplicitInterfaces
} from './repoqa-callchain';
import { maskSensitiveText } from './repoqa-masking';
import { runDiagnose, frontendCallersForRoute } from './diagnose-engine';
import { runBlastRadius } from './blast-radius';
import { runDomainRadar } from './domain-radar-engine';
import { runModuleEvolution, ConventionConflictError } from './module-evolution-engine';
import {
  runConventionScan as runConventionScanEngine,
  type ConventionAnchor,
  type ConventionProfile
} from './repoqa-conventions';
import type {
  RefactorPlanResult
} from '../../../packages/contracts/src/index';
import {
  capPrompt,
  runReActAgent,
  isLlmConfigured,
  buildTokenUsage,
  estimateTokenCount,
  completeNativeChat,
  INCIDENT_MAX_AGENT_STEPS,
  INCIDENT_ZERO_HALLUCINATION_GUIDE,
  unionIncidentAnchors,
  type AgentTool,
  type ReActLLMResult,
  type LayerInstruction
} from './repoqa-llm';
import type {
  ModuleEvolutionResult,
  EvolutionIntentEcho,
  EvolutionStageId
} from '../../../packages/contracts/src/index';
import { buildTours } from './repoqa-tours';
import { classifyConfigKey, isSensitiveConfigKey } from './repoqa-dashboard';
import {
  parseStackTrace,
  resolveFramesToSymbols,
  stackTraceSummary,
  type ParsedStackFrame,
  type StackResolution
} from './repoqa-stacktrace';

/**
 * Issue 24 / ADR-0013 — a physical hop harvested from this session's
 * deterministic tool results. Layer-instruction diagrams may only render
 * edges between such hops; anything else stays out of the geometry.
 */
export interface SessionGraphEdge {
  file: string;
  method: string;
  line: number;
}

/** Session-scoped provenance for layer-instruction rendering. */
export interface DiagramSession {
  edges: SessionGraphEdge[];
  /** Tool names whose result carried `{ error }` — a failed session voids call_chain rendering. */
  failedTools: Set<string>;
}

export type IndexProgressPayload = {
  repoId: string;
  phase: 'cloning' | 'parsing' | 'ready' | 'error' | IndexingPhase;
  detail?: string;
  parsedCount?: number;
  totalFiles?: number;
  phaseLabel?: string;
  currentFile?: string;
  processedFiles?: number;
  percent?: number;
};

/**
 * v0.10 — annotate trace hops that resolve to a route symbol with the browser
 * HTTP bridge method/url. Pure and deterministic: the method comes from the
 * AST-evidence bridge resolver (`frontendCallersForRoute`), never guessed
 * (ADR-0002). Hops without a displayPath or matching bridge stay untouched.
 *
 * Key is `${filePath}:${name}` (not `symbolIdentity`, which also carries
 * lineStart) because `resolveCallChain` emits `hop.file` = `symbol.filePath`
 * and `hop.method` = `symbol.name` without lineStart. Route symbols are
 * unique enough per file+name for this two-part key to be safe.
 */
export function annotateTraceHttpMethods(
  trace: RepoQaTraceHop[],
  symbols: RepoSymbol[]
): RepoQaTraceHop[] {
  const byFileAndName = new Map<string, RepoSymbol>();
  for (const symbol of symbols) {
    if (!symbol.displayPath) continue;
    byFileAndName.set(`${symbol.filePath}:${symbol.name}`, symbol);
  }
  return trace.map((hop) => {
    if (hop.http) return hop;
    const symbol = byFileAndName.get(`${hop.file}:${hop.method}`);
    if (!symbol?.displayPath) return hop;
    const bridges = frontendCallersForRoute(symbols, symbol.displayPath);
    const bridge = bridges[0];
    if (!bridge) return hop;
    return { ...hop, http: { method: bridge.http.method, url: bridge.http.url } };
  });
}

export type StartSymbolResolution = {
  symbol: RepoSymbol;
  fallback: boolean;
  confidence: number;
};

export type FileRefreshResult = {
  repoId: string;
  file: string;
  action: 'update' | 'remove';
};

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

/**
 * Issue 18 — split an identifier into its lowercase words so natural-language
 * questions can match camelCase / snake_case / kebab-case symbol names:
 * `createOwner` → `['create', 'owner']`, `get_pet_types` → `['get', 'pet', 'types']`.
 */
export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Issue 18 — score how strongly a natural-language sentence mentions a symbol.
 * 0 = no match; higher = stronger. Exact whole-question matches score highest;
 * the phrase containing the exact symbol name, a camelCase word, a prefix and a
 * plain substring rank below in that order. This is a pure helper so the
 * deterministic static path stays fully unit-testable without LLMs.
 */
/**
 * Ticket 04 — deterministic intent parser (the zero-LLM NLU fallback).
 *
 * Chinese intents have no spaces, so prose is split at intent marker words
 * (给/加/新增/模块/…) instead of token boundaries. The keyword is the first
 * symbol-like latin identifier (OrderService), else the first CJK segment
 * (订单); every other segment becomes the extension goal. Deprecation verbs
 * route the whole intent to DEPRECATE.
 * "给订单模块加 Excel 导出" -> { EXTEND, keyword "订单", goal "Excel 导出" }.
 */
const DEPRECATE_VERBS = [
  '下线',
  '废弃',
  '退役',
  '下架',
  '移除',
  '删除',
  '清除',
  'deprecat',
  'retire',
  'remove',
  'delete'
];

const INTENT_MARKERS = [
  '给我',
  '帮我',
  '我要',
  '我想',
  '请',
  '帮忙',
  '麻烦',
  '需要',
  '计划',
  '准备',
  '一下',
  '加上',
  '加个',
  '加',
  '添加',
  '新增',
  '增加',
  '做个',
  '做',
  '实现',
  '支持',
  '扩展',
  '模块',
  '功能',
  '里',
  '中',
  '上',
  '把',
  '对',
  '在',
  '给',
  '想',
  '要',
  '的',
  '个'
];

/** Latin filler stripped word-wise (word boundaries, case-insensitive). */
const LATIN_FILLER = /\b(add|support|please|module|feature|the|and|for|to|with|of|a|an)\b/gi;

function escapeMarker(marker: string): string {
  return marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function deterministicIntentParse(question: string): EvolutionIntentEcho {
  const text = question.trim();
  const lowered = text.toLowerCase();
  const isDeprecate = DEPRECATE_VERBS.some((verb) => lowered.includes(verb));

  // 1) Strip the (first) deprecation verb, 2) cut the rest at marker words.
  let residue = text;
  for (const verb of DEPRECATE_VERBS) {
    const at = lowered.indexOf(verb);
    if (at >= 0) {
      residue = residue.slice(0, at) + residue.slice(at + verb.length);
    }
  }
  const markerPattern = new RegExp(
    `${INTENT_MARKERS.map(escapeMarker).join('|')}|[^\\u4e00-\\u9fffA-Za-z0-9_.]+|\\s+`,
    'g'
  );
  const segments = residue
    .replace(LATIN_FILLER, ' ')
    .split(markerPattern)
    .map((segment) => segment.trim())
    .filter(Boolean);

  // Keyword: symbol-like identifier > first CJK segment > longest segment.
  const symbolLike = segments.find(
    (segment) => segment.length >= 6 && /[A-Z]/.test(segment) && /[a-z]/.test(segment)
  );
  const cjk = segments.find((segment) => /[\u4e00-\u9fff]/.test(segment));
  const keyword =
    symbolLike ?? cjk ?? [...segments].sort((a, b) => b.length - a.length)[0] ?? text;
  const goal = segments
    .filter((segment) => segment !== keyword)
    .join(' ')
    .trim();
  return {
    intentType: isDeprecate ? 'DEPRECATE' : 'EXTEND',
    rawKeyword: keyword,
    ...(isDeprecate || !goal ? {} : { extensionGoal: goal }),
    alternatives: [],
    parsedBy: 'fallback'
  };
}

export function fuzzyMatchScore(question: string, symbolName: string): number {
  const q = question.toLowerCase();
  const name = symbolName.toLowerCase();
  if (!q || !name) return 0;
  if (q === name) return 100;
  if (name.length >= 3 && q.includes(name)) return 90;
  const words = q.match(/[a-z_$][\w$]*/g) ?? [];
  if (words.length === 0) return 0;
  const parts = splitIdentifier(symbolName);
  let best = 0;
  for (const word of words) {
    if (parts.includes(word)) {
      best = Math.max(best, 80);
      continue;
    }
    for (const part of parts) {
      if (word.length >= 3 && part.startsWith(word)) best = Math.max(best, 60);
      if (word.length >= 4 && word.startsWith(part)) best = Math.max(best, 50);
    }
    if (word.length >= 4 && name.includes(word)) best = Math.max(best, 40);
  }
  return best;
}

/**
 * Issue 18 — fuzzy start-symbol lookup used when exact matching fails. Scores
 * are relevance-led: the highest-scoring symbol wins, with production code and
 * method-kind used to break ties (a weak-scoring method never beats a strongly
 * matching route/service/class). Within a 10-point band a method is preferred
 * even over a slightly higher-scoring type, since call-chain traces start at
 * real methods while types normalize to an arbitrary first method.
 */
export function findFuzzyStartSymbol(
  question: string,
  symbols: RepoSymbol[],
  isTestPath: (filePath: string) => boolean
): RepoSymbol | undefined {
  const methodKinds = new Set(['method']);
  const typeKinds = new Set(['class', 'interface', 'route', 'service', 'repository']);
  const candidates: Array<{ symbol: RepoSymbol; prod: boolean }> = [];
  for (const symbol of symbols) {
    if (!methodKinds.has(symbol.kind) && !typeKinds.has(symbol.kind)) continue;
    candidates.push({ symbol, prod: !isTestPath(symbol.filePath) });
  }
  // Relevance-led ranking with a narrow method preference band: a method whose
  // score is within 10 points of a type/route symbol still wins, because
  // call-chain traces start at real methods while types normalize to an
  // arbitrary first method. Outside that band the higher score always wins
  // (a weak method never beats a strongly matching service/class).
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: fuzzyMatchScore(question, candidate.symbol.name)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      const prodDiff = (b.candidate.prod ? 1 : 0) - (a.candidate.prod ? 1 : 0);
      if (prodDiff !== 0) return prodDiff;
      const aIsMethod = methodKinds.has(a.candidate.symbol.kind);
      const bIsMethod = methodKinds.has(b.candidate.symbol.kind);
      if (aIsMethod && !bIsMethod && a.score >= b.score - 10) return -1;
      if (bIsMethod && !aIsMethod && b.score >= a.score - 10) return 1;
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return (bIsMethod ? 1 : 0) - (aIsMethod ? 1 : 0);
    });
  return ranked[0]?.candidate.symbol;
}

export class RepoQAWorker {
  private running = new Map<string, AbortController>();
  private readonly symbolCache = new Map<string, { symbols: RepoSymbol[]; index: SymbolIndex }>();
  private readonly progressEmitAt = new Map<string, number>();

  constructor(
    private repoqa: RepoQARepos,
    private eventBus: EventBus
  ) {}

  /** In-memory symbols + call index; avoids repeated SQLite scans per query. */
  getSymbolGraph(repoId: string): { symbols: RepoSymbol[]; index: SymbolIndex } {
    const cached = this.symbolCache.get(repoId);
    if (cached) return cached;
    const symbols = this.repoqa.listSymbols(repoId);
    // v0.7 — the cache-miss path must run the same backfills as
    // setSymbolGraph, or a cold process serves unannotated symbols.
    applyImplicitInterfaces(symbols);
    applyModuleScopes(symbols);
    const graph = { symbols, index: buildCallIndex(symbols) };
    this.symbolCache.set(repoId, graph);
    return graph;
  }

  invalidate(repoId: string): void {
    this.symbolCache.delete(repoId);
  }

  /**
   * Issue 24 / ADR-0014 — Pattern Ingestion: the deterministic convention
   * profile of the indexed tree (zero-LLM, replayable). Every verdict leaves
   * this method with anchors validated against the raw files; a supported
   * axis that loses all its anchors degrades to unsupported (fail closed).
   */
  async runConventionScan(input: {
    repoId: string;
    targetSymbol?: string;
    nearPackages?: string[];
  }): Promise<ConventionProfile> {
    const repo = this.repoqa.getRepo(input.repoId);
    if (!repo) throw new Error(`Repo not found: ${input.repoId}`);
    if (repo.status !== 'ready') {
      throw new Error(`Repo is not ready (${repo.status})`);
    }
    const { symbols } = this.getSymbolGraph(repo.id);
    const profile = runConventionScanEngine({
      repoId: repo.id,
      symbols,
      // ADR-0010: `unversioned` is the honest fallback when no commit is known.
      commit: repo.commit ?? 'unversioned',
      ...(input.targetSymbol ? { targetSymbol: input.targetSymbol } : {}),
      ...(input.nearPackages && input.nearPackages.length > 0
        ? { nearPackages: input.nearPackages }
        : {})
    });
    const validate = (anchors: ConventionAnchor[] | undefined): Promise<ConventionAnchor[]> =>
      this.filterConventionAnchors(repo, anchors);
    const axes: ConventionProfile['axes'] = [];
    for (const axis of profile.axes) {
      const anchors = await validate(axis.anchors);
      const dissidents = await validate(axis.dissidents);
      if (axis.supported && anchors.length === 0) {
        // Zero-Hallucination Contract: a claim without a single physical
        // anchor is not emitted.
        axes.push({ axis: axis.axis, supported: false });
        continue;
      }
      axes.push({
        ...axis,
        ...(anchors.length > 0 ? { anchors } : {}),
        ...(dissidents.length > 0 ? { dissidents } : {})
      });
    }
    return { ...profile, axes };
  }

  /** Keep only anchors whose raw file still exists (ADR-0010 discipline). */
  private async filterConventionAnchors(
    repo: Repo,
    anchors: ConventionAnchor[] | undefined
  ): Promise<ConventionAnchor[]> {
    if (!anchors || anchors.length === 0) return [];
    const valid: ConventionAnchor[] = [];
    for (const anchor of anchors) {
      if (await this.isValidAnchor(repo, { file: anchor.file, line: anchor.line, symbol: anchor.symbol })) {
        valid.push(anchor);
      }
    }
    return valid;
  }

  /**
   * v0.5.1 (D8) — shared reverse-dependency lookup used by both the REST API
   * and the MCP `codecompass_reverse_deps` tool.
   */
  reverseDeps(
    repoId: string,
    symbolOrMethod: string
  ): {
    repoId: string;
    target: { name: string; file: string; line: number };
    callers: Array<{ file: string; method: string; line: number; callLine: number | null }>;
    count: number;
    fallback: boolean;
  } {
    const repo = this.repoqa.getRepo(repoId);
    if (!repo) throw new Error(`Repo not found: ${repoId}`);
    const query = symbolOrMethod.trim();
    if (!query) throw new Error('symbolName is required');
    const resolution = this.resolveStartSymbolForQuery(repo.id, query);
    if (!resolution) throw new Error(`Start symbol not found: ${query}`);
    const graph = this.getSymbolGraph(repo.id);
    const resolver = new CallResolver(graph.symbols, graph.index);
    // v0.5.1 (D8) — "who uses likePost" spans every same-named production
    // method (controller route + service impl). Aggregating their callers keeps
    // the HTTP twin and the MCP tool useful when a query matches a service
    // method while the browser caller targets the controller route.
    const candidates = this.resolveExactMethodCandidates(repo.id, query);
    const seen = new Map<string, ReverseCaller>();
    for (const candidate of candidates) {
      for (const caller of resolver.reverseCallers(candidate)) {
        const key = `${caller.file}|${caller.method}|${caller.line}|${caller.callLine ?? ''}`;
        seen.set(key, caller);
      }
    }
    const callers = [...seen.values()].sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.method.localeCompare(b.method)
    );
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

  private setSymbolGraph(repoId: string, symbols: RepoSymbol[]): void {
    // v0.7 — Go duck typing: backfill `interfaces` from method-set matching
    // before the call index consumes them (explicit `var x I = &T{}` inference
    // already ran per-file in the adapter; this covers the cross-file case).
    applyImplicitInterfaces(symbols);
    // v0.7 — Module Scope: annotate multi-module repos at graph-build time.
    applyModuleScopes(symbols);
    this.symbolCache.set(repoId, { symbols, index: buildCallIndex(symbols) });
  }

  /**
   * Issue 30 — incremental re-parse of a single changed file. Replaces only
   * that file's symbols/chunks in SQLite, refreshes the in-memory call graph
   * and keeps the repo counters live. A missing file falls through to
   * `removeFile` so rename/delete events converge on the same code path.
   */
  async reparseFile(repoId: string, filePath: string): Promise<FileRefreshResult> {
    const repo = this.repoqa.getRepo(repoId);
    if (!repo) throw new Error(`Repo not found: ${repoId}`);
    const root = path.resolve(repo.localPath);
    const absolute = path.resolve(filePath);
    const relative = this.toRepoRelativePath(root, absolute);
    let isFile = false;
    try {
      isFile = (await fs.stat(absolute)).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) return this.removeFile(repoId, absolute);

    const symbols: RepoSymbol[] = [];
    const adapter = adapterFor(absolute);
    if (adapter) {
      try {
        symbols.push(...(await adapter.parseFile(absolute, repoId, root)));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.repoqa.recordEvent({
          repoId,
          eventType: 'repoqa.index.warning',
          feedback: JSON.stringify({
            skippedFiles: 1,
            files: [{ file: relative, error: detail }]
          })
        });
      }
    }
    const configSymbols = await extractConfigSymbols(repoId, root, [absolute]);
    const mapperSymbols = await extractMapperSymbols(repoId, root, [absolute]);
    const chunks = await this.extractChunks(repoId, root, [absolute]);
    const allSymbols = [...symbols, ...configSymbols, ...mapperSymbols];
    this.repoqa.replaceFileSymbols(repoId, relative, allSymbols);
    this.repoqa.replaceFileChunks(repoId, relative, chunks);
    this.repoqa.addRepoFile(repoId, relative);
    this.rebuildRepoCounts(repoId);
    return { repoId, file: relative, action: 'update' };
  }

  /** Issue 30 — drop one file's symbols/chunks and refresh counters/graph. */
  async removeFile(repoId: string, filePath: string): Promise<FileRefreshResult> {
    const repo = this.repoqa.getRepo(repoId);
    if (!repo) throw new Error(`Repo not found: ${repoId}`);
    const root = path.resolve(repo.localPath);
    const absolute = path.resolve(filePath);
    const relative = this.toRepoRelativePath(root, absolute);
    this.repoqa.deleteSymbolsForFile(repoId, relative);
    this.repoqa.deleteChunksForFile(repoId, relative);
    this.repoqa.removeRepoFile(repoId, relative);
    this.rebuildRepoCounts(repoId);
    return { repoId, file: relative, action: 'remove' };
  }

  private toRepoRelativePath(root: string, absolute: string): string {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`File outside repo root: ${absolute}`);
    }
    return relative;
  }

  private rebuildRepoCounts(repoId: string): void {
    const fileCount = this.repoqa.countFiles(repoId);
    const symbolCount = this.repoqa.countSymbols(repoId);
    this.repoqa.updateRepoCounts(repoId, fileCount, symbolCount);
    this.setSymbolGraph(repoId, this.repoqa.listSymbols(repoId));
  }

  async indexRepo(input: {
    localPath: string;
    branch?: string;
    /** Bug-10: user-supplied display name; empty falls back to the basename. */
    name?: string;
  }): Promise<{ repo: Repo; created: boolean }> {
    const localPath = path.resolve(input.localPath);
    const rootStat = await fs.stat(localPath).catch(() => null);
    if (!rootStat?.isDirectory()) {
      throw new Error(`local path is not a directory: ${input.localPath}`);
    }

    const name =
      input.name?.trim() || (localPath.split(/[\\/]/).filter(Boolean).pop() ?? 'local');
    const upsert = this.repoqa.upsertByLocalPath({
      name,
      localPath,
      branch: input.branch
    });
    const repoId = upsert.repo.id;
    this.invalidate(repoId);
    const taskId = `index-${repoId}`;
    const controller = new AbortController();
    this.running.set(taskId, controller);

    try {
      if (!controller.signal.aborted) {
        this.repoqa.updateRepoStatus(repoId, 'idle', 0, 0);
        this.repoqa.clearRepoData(repoId);
      }

      this.broadcast(taskId, {
        type: 'repoqa.index.progress',
        payload: {
          repoId,
          phase: 'DISCOVERY',
          phaseLabel: '发现文件',
          detail: 'Resolving local repo...',
          processedFiles: 0,
          totalFiles: 0,
          percent: 0
        }
      } as any);
      this.repoqa.updateRepoStatus(repoId, 'indexing', undefined, undefined, undefined, {
        parsed: 0,
        total: 0
      });
      // Issue 23 / ADR-0010: re-pin the physical commit at index time so
      // anchors minted later carry the state the index actually saw.
      this.repoqa.refreshRepoCommit(repoId);
      this.broadcast(taskId, {
        type: 'repoqa.index.progress',
        payload: {
          repoId,
          phase: 'DISCOVERY',
          phaseLabel: '发现文件',
          detail: 'Scanning files and counting lines...',
          processedFiles: 0,
          totalFiles: 0,
          percent: 0
        }
      } as any);

      const stats = await scanRepo(localPath);
      if (stats.fileCount > MAX_FILES) {
        throw new Error(
          `repo exceeds ${MAX_FILES} files (found ${stats.fileCount}); import a submodule or repo root instead`
        );
      }
      if (stats.lineCount > MAX_LINES) {
        throw new Error(
          `repo exceeds ${MAX_LINES} lines (found ${stats.lineCount}); import a submodule or repo root instead`
        );
      }

      // Issue 15: multi-module Maven detection (parent pom `<modules>`); the
      // recursive scan below already covers every module's sources with
      // repo-root-relative paths, this just lifts the module layout out of the
      // repo so it is visible on the evidence plane.
      const modules = await detectMavenModules(localPath);
      const moduleSummary =
        modules.length > 0
          ? `, ${modules.length} Maven module${modules.length === 1 ? '' : 's'} (${modules.map((m) => m.name).join(', ')})`
          : '';

      this.broadcast(taskId, {
        type: 'repoqa.index.progress',
        payload: {
          repoId,
          phase: 'DISCOVERY',
          phaseLabel: '发现文件',
          detail: `Found ${stats.fileCount} files${
            stats.skippedBinary > 0 ? `, ${stats.skippedBinary} binary skipped` : ''
          }`,
          processedFiles: stats.fileCount,
          totalFiles: stats.fileCount,
          percent: 5
        }
      } as any);

      this.repoqa.saveFiles(repoId, localPath, stats.files);
      const largeFiles = new Set(stats.largeFiles);
      const { symbols, skipped } = await this.parseRepo(
        repoId,
        localPath,
        stats.files,
        largeFiles,
        (parsed, total, currentFile) => {
          // Bug-R2-04: surface a live AST parsing count so large imports never
          // look stuck on the scan phase. fileCount is transient here and is
          // overwritten with the real total when the repo flips to ready.
          // v0.6.0: 100ms time throttle; the final tick always emits.
          const now = Date.now();
          const lastEmit = this.progressEmitAt.get(taskId) ?? 0;
          if (parsed < total && now - lastEmit < 100) return;
          this.progressEmitAt.set(taskId, now);
          this.repoqa.updateRepoStatus(repoId, 'indexing', parsed, undefined, undefined, {
            parsed,
            total
          });
          this.broadcast(taskId, {
            type: 'repoqa.index.progress',
            payload: {
              repoId,
              phase: 'AST_EXTRACTION',
              phaseLabel: 'AST 提取',
              detail: `Parsing AST... ${parsed} files`,
              parsedCount: parsed,
              totalFiles: total,
              processedFiles: parsed,
              percent: Math.min(80, Math.round(10 + 70 * (parsed / Math.max(total, 1)))),
              currentFile
            }
          } as any);
        }
      );
      if (skipped.length > 0) {
        this.repoqa.recordEvent({
          repoId,
          eventType: 'repoqa.index.warning',
          feedback: JSON.stringify({
            skippedFiles: skipped.length,
            files: skipped.map((entry) => ({ file: entry.file, error: entry.error }))
          })
        });
      }
      this.broadcast(taskId, {
        type: 'repoqa.index.progress',
        payload: {
          repoId,
          phase: 'CROSS_LANG_BRIDGE',
          phaseLabel: '跨语言桥接',
          detail: 'Building cross-language call edges...',
          processedFiles: stats.fileCount,
          totalFiles: stats.fileCount,
          percent: 85
        }
      } as any);
      const configSymbols = await extractConfigSymbols(repoId, localPath, stats.files);
      const mapperSymbols = await extractMapperSymbols(
        repoId,
        localPath,
        stats.files
      );
      this.broadcast(taskId, {
        type: 'repoqa.index.progress',
        payload: {
          repoId,
          phase: 'FINALIZING',
          phaseLabel: '拓扑收敛',
          detail: 'Finalizing chunks and symbol graph...',
          processedFiles: stats.fileCount,
          totalFiles: stats.fileCount,
          percent: 95
        }
      } as any);
      const chunks = await this.extractChunks(repoId, localPath, stats.files);
      const allSymbols = [...symbols, ...configSymbols, ...mapperSymbols];
      this.repoqa.upsertSymbols(allSymbols);
      this.repoqa.upsertChunks(chunks);
      this.repoqa.updateRepoStatus(repoId, 'ready', stats.fileCount, allSymbols.length);
      this.setSymbolGraph(repoId, allSymbols);
      if (modules.length > 0) {
        const sourceRoots = await mavenSourceRoots(localPath, modules);
        this.repoqa.recordEvent({
          repoId,
          eventType: 'repoqa.modules.detected',
          feedback: JSON.stringify({
            moduleCount: modules.length,
            modules: modules.map((module) => ({ name: module.name, pomPath: module.pomPath })),
            sourceRoots
          })
        });
      }
      this.broadcast(taskId, {
        type: 'repoqa.index.progress',
        payload: {
          repoId,
          phase: 'FINALIZING',
          phaseLabel: '拓扑收敛',
          detail: `Indexed ${stats.fileCount} files, ${stats.lineCount} lines${moduleSummary}`,
          processedFiles: stats.fileCount,
          totalFiles: stats.fileCount,
          percent: 100
        }
      } as any);
      this.broadcast(taskId, {
        type: 'repoqa.index.done',
        payload: {
          repoId,
          status: 'ready',
          fileCount: stats.fileCount,
          symbolCount: allSymbols.length
        }
      } as any);

      return { repo: this.repoqa.getRepo(repoId)!, created: upsert.created };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.repoqa.updateRepoStatus(repoId, 'error', undefined, undefined, message);
      this.broadcast(taskId, {
        type: 'repoqa.index.error',
        payload: { error: message }
      } as any);
      const baseRepo = this.repoqa.getRepo(repoId)!;
      const suggestedSubdirs =
        /exceeds \d+ (files|lines)/.test(message)
          ? await detectSuggestedSubdirs(localPath)
          : [];
      const repo =
        suggestedSubdirs.length > 0
          ? { ...baseRepo, suggestedSubdirs }
          : baseRepo;
      return { repo, created: upsert.created };
    } finally {
      this.running.delete(taskId);
    }
  }

  /**
   * Issue 24 / Ticket 04 — Evolution workbench stream (POST /api/repos/:id/evolve).
   *
   * Free-text intent in, four artifact-card sections out, in one pass:
   *   intent_parse    — ONE NLU call (LLM) or the deterministic parser fallback
   *                     -> { intentType, rawKeyword, extensionGoal }
   *   target_resolve  — domain_radar anchors the keyword deterministically
   *                     (resolved target + alternatives for the Correction Pill)
   *   convention_scan — declared for the progress UI; the EXTEND engine runs it
   *                     internally (ADR-0014, zero LLM)
   *   pipeline        — runModuleEvolution (EXTEND / DEPRECATE)
   *   diagram         — engine-rendered call_chain over the resolved target
   *                     (ADR-0013: physical edges only, code:// deep links)
   *
   * LLM budget: intent parsing once; no narration call (ADR-0012 composite
   * entry). An explicit `target` (Correction Pill switch) bypasses the radar.
   * A STRICT-axis or bean-cycle conflict streams as `repoqa.evolve.error` with
   * the structured ConventionConflictDetail — a planned outcome, not a crash.
   */
  async *evolveRepo(input: {
    repoId: string;
    question: string;
    /** Explicit target from a Correction-Pill switch — skips the radar. */
    target?: string;
  }): AsyncGenerator<ServerEvent> {
    const repo = this.repoqa.getRepo(input.repoId);
    if (!repo) throw new Error('Repo not found');
    if (repo.status !== 'ready') {
      throw new Error(`Repo is not ready (${repo.status})`);
    }
    const { symbols, index } = this.getSymbolGraph(repo.id);
    const commit = repo.commit ?? 'unversioned';

    // ---- Stage 1: intent parse (one NLU call, deterministic fallback) ----
    yield {
      type: 'repoqa.evolve.stage',
      payload: { stage: 'intent_parse', label: '意图解析', status: 'running' }
    };
    const echo = await this.parseEvolutionIntent(input.question);
    yield {
      type: 'repoqa.evolve.stage',
      payload: { stage: 'intent_parse', label: '意图解析', status: 'done', intentEcho: echo }
    };

    // ---- Stage 2: target resolve (domain radar, deterministic) ----
    yield {
      type: 'repoqa.evolve.stage',
      payload: { stage: 'target_resolve', label: '目标锚定', status: 'running' }
    };
    let resolvedTarget = input.target?.trim() || '';
    let alternatives: Array<{ symbol: string; score: number }> = [];
    if (resolvedTarget) {
      // Correction-Pill switch: the user pinned the target, skip the radar.
      echo.resolvedTarget = resolvedTarget;
      echo.alternatives = [{ symbol: resolvedTarget, score: 100 }];
    } else {
      const radar = runDomainRadar({
        repoId: repo.id,
        query: echo.rawKeyword,
        symbols,
        index,
        chunkHitFiles: this.repoqa
          .searchChunks(repo.id, echo.rawKeyword)
          .map((chunk) => chunk.filePath)
          .filter((file): file is string => Boolean(file))
      });
      alternatives = radar.matchedAnchors.map((anchor) => ({
        symbol: anchor.symbol,
        score: anchor.relevanceScore
      }));
      resolvedTarget = alternatives[0]?.symbol ?? echo.rawKeyword;
      echo.resolvedTarget = resolvedTarget;
      echo.alternatives = alternatives;
    }
    yield {
      type: 'repoqa.evolve.stage',
      payload: { stage: 'target_resolve', label: '目标锚定', status: 'done', intentEcho: echo }
    };

    // ---- Stage 3+4: convention scan (inside the EXTEND engine) + pipeline ----
    yield {
      type: 'repoqa.evolve.stage',
      payload: { stage: 'convention_scan', label: '惯例嗅探', status: 'running' }
    };
    yield {
      type: 'repoqa.evolve.stage',
      payload: { stage: 'pipeline', label: '演进推演', status: 'running' }
    };
    let result: ModuleEvolutionResult;
    try {
      result = runModuleEvolution({
        repoId: repo.id,
        intentType: echo.intentType,
        targetSymbolOrModule: resolvedTarget,
        ...(echo.extensionGoal ? { extensionGoal: echo.extensionGoal } : {}),
        symbols,
        index,
        // ADR-0010: `unversioned` is the honest fallback when no commit is known.
        commit
      });
    } catch (error) {
      if (error instanceof ConventionConflictError) {
        yield {
          type: 'repoqa.evolve.error',
          payload: { error: error.message, conventionConflict: error.conflict }
        };
        return;
      }
      throw error;
    }
    yield {
      type: 'repoqa.evolve.stage',
      payload: { stage: 'convention_scan', label: '惯例嗅探', status: 'done' }
    };
    yield {
      type: 'repoqa.evolve.stage',
      payload: { stage: 'pipeline', label: '演进推演', status: 'done' }
    };

    // ---- Stage 5: engine-rendered diagram over the resolved target ----
    yield {
      type: 'repoqa.evolve.stage',
      payload: { stage: 'diagram', label: '图谱投射', status: 'running' }
    };
    let mermaid: string | undefined;
    try {
      const start = this.pickEvolveStart(symbols, resolvedTarget);
      if (start) {
        const trace = resolveCallChain(symbols, start, 4, index);
        if (trace.length >= 2) mermaid = this.traceToMermaid(trace, start.name);
      }
    } catch {
      // Diagram is additive: the artifact cards stand without it.
      mermaid = undefined;
    }
    yield {
      type: 'repoqa.evolve.stage',
      payload: { stage: 'diagram', label: '图谱投射', status: 'done' }
    };

    this.repoqa.recordEvent({
      repoId: repo.id,
      eventType: 'query.done',
      intent: 'evolve',
      queryStartAt: new Date().toISOString(),
      feedback: JSON.stringify({ intent: echo.intentType, target: resolvedTarget })
    });
    yield {
      type: 'repoqa.evolve.done',
      payload: { intentEcho: echo, result, ...(mermaid ? { mermaid } : {}), commit }
    };
  }

  /** EXTEND attaches onto methods/classes: pick the pipeline attach symbol. */
  private pickEvolveStart(symbols: RepoSymbol[], resolvedTarget: string): RepoSymbol | undefined {
    const exact = symbols.find(
      (symbol) =>
        (symbol.kind === 'method' || symbol.kind === 'route') &&
        (symbol.parentType ? `${symbol.parentType}.${symbol.name}` : symbol.name) === resolvedTarget
    );
    if (exact) return exact;
    const typeMatch = symbols.find(
      (symbol) =>
        (symbol.kind === 'class' || symbol.kind === 'service') && symbol.name === resolvedTarget
    );
    if (typeMatch) return typeMatch;
    // Type targets normalize to their first method, mirroring call-chain starts.
    const prefix = `${resolvedTarget}.`;
    return symbols.find(
      (symbol) => symbol.kind === 'method' && (symbol.parentType ?? '').startsWith(prefix)
    );
  }

  /**
   * ONE NLU call for the free-text intent (Issue 24 budget: LLM = 1). Returns
   * { intentType, rawKeyword, extensionGoal }. With no LLM configured — or on
   * any parse/transport failure — the deterministic keyword parser answers
   * instead (parsedBy: 'fallback'); the pipeline never blocks on the model.
   */
  private async parseEvolutionIntent(question: string): Promise<EvolutionIntentEcho> {
    const fallback = deterministicIntentParse(question);
    if (!isLlmConfigured(process.env)) return fallback;
    try {
      const turn = await completeNativeChat([
        {
          role: 'system',
          content:
            'You parse a software-evolution request into JSON. Respond with ONLY a JSON object: ' +
            '{"intentType":"EXTEND"|"DEPRECATE","rawKeyword":"<module or class the intent targets, e.g. 订单/OrderService>","extensionGoal":"<what to add, empty for DEPRECATE>"}. ' +
            'DEPRECATE means retiring/deleting a module; everything else is EXTEND.'
        },
        { role: 'user', content: question }
      ]);
      const content = turn.content ?? '';
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return fallback;
      const parsed = JSON.parse(match[0]) as {
        intentType?: string;
        rawKeyword?: string;
        extensionGoal?: string;
      };
      const intentType = String(parsed.intentType ?? '').toUpperCase();
      const rawKeyword = String(parsed.rawKeyword ?? '').trim();
      if (intentType !== 'EXTEND' && intentType !== 'DEPRECATE') return fallback;
      return {
        intentType,
        rawKeyword: rawKeyword || fallback.rawKeyword,
        ...(parsed.extensionGoal ? { extensionGoal: String(parsed.extensionGoal).trim() } : {}),
        alternatives: [],
        parsedBy: 'llm'
      };
    } catch {
      return fallback;
    }
  }

  async *queryRepo(input: {
    repoId: string;
    question: string;
    mode?: 'architecture' | 'call-chain' | 'environment' | 'incident';
    /** Explicit trace start supplied by the frontend (Top API click): the
     * exact (name, file) of the clicked symbol. Prevents same-name ambiguity —
     * e.g. a production method and a test helper with an identical name. */
    start?: { name: string; file: string };
    /** Issue 23 — pasted stack trace / log excerpt for incident mode. */
    stack?: string;
  }): AsyncGenerator<ServerEvent> {
    const repo = this.repoqa.getRepo(input.repoId);
    if (!repo) throw new Error('Repo not found');
    if (repo.status !== 'ready') {
      throw new Error(`Repo is not ready (${repo.status})`);
    }
    const queryStartAt = new Date().toISOString();
    this.repoqa.recordEvent({
      repoId: repo.id,
      eventType: 'query.start',
      intent: input.mode ?? 'architecture',
      queryStartAt
    });

    const { symbols } = this.getSymbolGraph(repo.id);
    // Issue 23 — incident mode routes through its own copilot path, which
    // decides between the LLM ReAct agent (LLM + gates) and the fully
    // deterministic fallback (no LLM / gates not passed).
    if (input.mode === 'incident') {
      yield* this.runIncidentQuery(input, repo, symbols, queryStartAt);
      return;
    }
    // Issue 10: configuration can come from process.env or a local `.env`
    // (REPOQA_LLM_BASE / REPOQA_LLM_URL / REPOQA_LLM_API_KEY / REPOQA_LLM_MODEL).
    const llmConfigured = isLlmConfigured(process.env);
    const gatesPassed =
      process.env.REPOQA_GATES_PASSED === '1' ||
      process.env.REPOQA_EVAL_PASSED === '1';
    if (
      llmConfigured &&
      gatesPassed &&
      input.mode !== 'call-chain' &&
      input.mode !== 'environment'
    ) {
      const startedAt = Date.now();
      let firstTokenMs: number | undefined;
      // Issue 24 / ADR-0013: harvest the session's deterministic tool results
      // so a layer instruction can only ever render edges the tools returned.
      const diagramSession: DiagramSession = { edges: [], failedTools: new Set() };
      const real = await this.runReActLoop(
        repo.id,
        input.question,
        symbols,
        (ms) => {
          if (firstTokenMs === undefined) firstTokenMs = ms;
        },
        (toolName, result) => this.harvestDiagramSession(diagramSession, toolName, result)
      );
      const latency = firstTokenMs ?? Date.now() - startedAt;
      if (latency > 1500) {
        this.repoqa.recordEvent({
          repoId: repo.id,
          eventType: 'query.failure',
          failureClass: 'latency-gate-exceeded'
        });
        throw new Error('Latency gate exceeded (1.5s)');
      }
      const anchors: RepoQaAnchor[] = [];
      for (const anchor of real.anchors ?? []) {
        // ADR-0010: validated anchors are minted with the repo's physical commit.
        if (await this.isValidAnchor(repo, anchor)) {
          anchors.push({ ...anchor, commit: repo.commit });
        }
      }
      const answer = maskSensitiveText(real.answer ?? 'No answer from LLM.');
      const usage =
        real.usage ??
        buildTokenUsage(estimateTokenCount(input.question), estimateTokenCount(answer), 'estimate');
      const routeForAction =
        symbols.find((symbol) => symbol.kind === 'route') ??
        symbols.find((symbol) => symbol.kind === 'method') ??
        symbols[0];
      const suggestedAction = routeForAction ? `Trace ${routeForAction.name}` : undefined;
      const tokens = answer.match(/\S+(?:\s+)?/g) ?? [answer];
      for (const token of tokens) {
        yield { type: 'repoqa.query.token', payload: { token } };
      }
      // Issue 24 / ADR-0013: the model's layer instruction is rendered by the
      // engine dispatcher only — model-painted mermaid was stripped at finalize.
      const engineMermaid = real.diagram
        ? this.renderLayerInstruction(real.diagram, repo, symbols, diagramSession)
        : undefined;
      if (engineMermaid) {
        yield { type: 'repoqa.query.mermaid', payload: { mermaid: engineMermaid } };
      }
      if (anchors.length > 0) {
        yield { type: 'repoqa.query.anchors', payload: { anchors } };
      }
      this.repoqa.recordEvent({
        repoId: repo.id,
        eventType: 'query.done',
        intent: input.mode ?? 'architecture',
        queryStartAt,
        // Issue 08: persist first-token latency on the evidence plane.
        firstTokenAt:
          firstTokenMs !== undefined
            ? new Date(startedAt + firstTokenMs).toISOString()
            : undefined,
        queryDoneAt: new Date().toISOString()
      });
      yield {
        type: 'repoqa.query.done',
        payload: {
          answer,
          mermaid: engineMermaid,
          anchors,
          suggestedAction,
          confidence: undefined,
          lowConfidence: false,
          provenance: 'llm',
          usage,
          commit: repo.commit
        }
      };
      return;
    }

    const usesSymbolResolution =
      input.mode === 'call-chain' ||
      input.mode === 'architecture' ||
      input.mode === undefined;
    let trace: RepoQaTraceHop[] | undefined = [];
    let candidateAnchors: RepoQaAnchor[] = [];
    let mermaid: string | undefined;
    let route: RepoSymbol | undefined;
    let startFallback = false;
    let startConfidence: number | undefined;
    let environmentKeyCount = 0;
    let environmentChunkCount = 0;
    let environmentEvidence: string[] = [];

    if (usesSymbolResolution) {
      const resolution = this.resolveStartSymbol(input.question, symbols, input.start);
      const start = resolution?.symbol;
      startFallback = resolution?.fallback ?? false;
      startConfidence = resolution?.confidence;
      if (start) {
        route = start;
        trace = resolveCallChain(symbols, start, 4, this.getSymbolGraph(repo.id).index);
        // v0.10 — surface browser HTTP bridge methods on route hops so the
        // frontend can render GET/POST capsules from deterministic evidence.
        trace = annotateTraceHttpMethods(trace, symbols);
        candidateAnchors = trace
          .filter((hop) => !hop.break && hop.line)
          .map((hop) => ({
            file: hop.file,
            line: hop.line!,
            symbol: hop.method,
            ...(hop.lineEnd ? { lineEnd: hop.lineEnd } : {})
          }));
        mermaid = this.traceToMermaid(trace, start.name);
        if (startFallback) {
          this.repoqa.recordEvent({
            repoId: repo.id,
            eventType: 'tool.miss',
            intent: input.mode ?? 'architecture',
            toolMiss: `${input.mode ?? 'architecture'} start symbol not found`
          });
        }
      } else {
        this.repoqa.recordEvent({
          repoId: repo.id,
          eventType: 'tool.miss',
          intent: input.mode ?? 'architecture',
          toolMiss: `${input.mode ?? 'architecture'} start symbol not found`
        });
      }
    } else if (input.mode === 'environment') {
      const configs = matchConfigSymbols(
        input.question,
        symbols.filter(
          (symbol) => symbol.kind === 'config' || symbol.kind === 'dependency'
        )
      );
      const chunks = this.repoqa.searchChunks(repo.id, input.question);
      environmentKeyCount = configs.length;
      environmentChunkCount = chunks.length;
      // Issue 06: precise file + line + key evidence, values never included.
      environmentEvidence = configs.slice(0, 12).map(
        (symbol) => `- ${symbol.name} @ ${symbol.filePath}:${symbol.lineStart ?? 1}`
      );
      candidateAnchors = configs.map((symbol) => ({
        file: symbol.filePath,
        line: symbol.lineStart ?? 1,
        symbol: symbol.name
      }));
      route = configs[0];
      trace = undefined;
      mermaid = undefined;
    }

    const anchors: RepoQaAnchor[] = [];
    for (const anchor of candidateAnchors) {
      // ADR-0010: validated anchors are minted with the repo's physical commit.
      if (await this.isValidAnchor(repo, anchor)) {
        anchors.push({ ...anchor, commit: repo.commit });
      }
    }

    const rawAnswer =
      input.mode === 'environment'
        ? (() => {
            const base = `Found ${environmentKeyCount} config keys and ${environmentChunkCount} matching chunks.`;
            return environmentEvidence.length > 0
              ? `${base}\n\nMatched key evidence:\n${environmentEvidence.join('\n')}`
              : base;
          })()
        : (() => {
            // Issue 05: surface the break marker textually so deterministic
            // call-chain queries never look like silent success.
            const breakHop = trace?.find((hop) => hop.break);
            const fallbackPrefix = startFallback
              ? '未在工程中定位到精确对应符号，以下基于默认入口推导供参考。\n\n'
              : '';
            const chainLines =
              trace && trace.length > 0
                ? trace
                    .map(
                      (hop, index) =>
                        `${index + 1}. ${hop.method} @ ${hop.file}:${hop.line ?? '?'}`
                    )
                    .join('\n')
                : undefined;
            const breakNote = breakHop?.reason ? `\n\n${breakHop.reason}` : '';
            if (input.mode === 'call-chain' && chainLines) {
              return `${fallbackPrefix}调用链分析（问题「${input.question}」）：\n${chainLines}${breakNote}`;
            }
            if (chainLines) {
              return `${fallbackPrefix}静态分析（问题「${input.question}」）：识别到入口 ${trace![0].method} 与下游调用：\n${chainLines}${breakNote}`;
            }
            return `${fallbackPrefix}静态分析（问题「${input.question}」）：未解析到可追踪的调用链。`;
          })();
    const answer = maskSensitiveText(rawAnswer);
    const usage = buildTokenUsage(estimateTokenCount(input.question), estimateTokenCount(answer), 'estimate');
    const tokens = answer.match(/\S+(?:\s+)?/g) ?? [answer];

    for (const token of tokens) {
      yield { type: 'repoqa.query.token', payload: { token } };
    }
    if (mermaid) yield { type: 'repoqa.query.mermaid', payload: { mermaid } };
    if (anchors.length > 0) {
      yield { type: 'repoqa.query.anchors', payload: { anchors } };
    }
    const suggestedAction =
      route ? `Trace ${route.name}` :
      anchors.length > 0 ? `Inspect ${anchors[0].symbol}` : undefined;
    this.repoqa.recordEvent({
      repoId: repo.id,
      eventType: 'query.done',
      intent: input.mode ?? 'architecture',
      queryStartAt,
      queryDoneAt: new Date().toISOString()
    });
    yield {
      type: 'repoqa.query.done',
      payload: {
        answer,
        mermaid,
        anchors,
        trace,
        suggestedAction,
        confidence: startConfidence,
        lowConfidence: startFallback || (startConfidence !== undefined && startConfidence < 0.6),
        provenance: 'static',
        usage,
        commit: repo.commit
      }
    };
  }

  /**
   * Issue 23 — incident copilot (Architecture & Incident Copilot).
   *
   * LLM path: stack frames are parsed deterministically up front and the
   * resolution summary is injected into the context; the agent runs the
   * whitelisted incident tools with a 6-step budget under the
   * Zero-Hallucination Contract. Anchors still pass `isValidAnchor` before
   * they are minted with the repo's physical commit (ADR-0010).
   *
   * Fallback path (no LLM / gates): fully deterministic — diagnose the crash
   * symbol, aggregate the blast radius, collect config evidence and compose a
   * three-part answer; every unmatched stack frame is reported as BREAK.
   */
  private async *runIncidentQuery(
    input: {
      repoId: string;
      question: string;
      stack?: string;
    },
    repo: Repo,
    symbols: RepoSymbol[],
    queryStartAt: string
  ): AsyncGenerator<ServerEvent> {
    const stackText = input.stack?.trim() ?? '';
    const frames = stackText ? parseStackTrace(stackText) : [];
    const resolution = resolveFramesToSymbols(frames, symbols, {
      name: (symbol) => symbol.name,
      parentType: (symbol) => symbol.parentType,
      filePath: (symbol) => symbol.filePath
    });
    const summary = stackText
      ? stackTraceSummary(resolution)
      : 'No stack trace supplied — symptom description only.';

    if (isLlmConfigured(process.env)) {
      const incidentTools = this.buildIncidentTools(repo.id, symbols);
      const startedAt = Date.now();
      // Issue 24 / ADR-0013: same session-edge harvest as the architecture path.
      const diagramSession: DiagramSession = { edges: [], failedTools: new Set() };
      const real = await runReActAgent({
        question: input.question,
        context: this.buildIncidentContext(repo.id, input.question, symbols, resolution, summary),
        tools: incidentTools,
        env: process.env,
        maxSteps: INCIDENT_MAX_AGENT_STEPS,
        nativeTools: true,
        guideExtra: INCIDENT_ZERO_HALLUCINATION_GUIDE,
        onToolResult: (toolName, result) =>
          this.harvestDiagramSession(diagramSession, toolName, result)
      });
      const latencyMs = Date.now() - startedAt;
      // Issue 23: the 6-step incident budget is intentionally exempt from the
      // 1.5s interactive latency gate (ADR-0011 static boundary, deeper tool
      // traversal) — the gate still applies to architecture queries.

      const anchors: RepoQaAnchor[] = [];
      // Issue 23 integration — the evidence chain must not depend on the
      // model's prose style: deterministic stack-frame matches always lead
      // the anchor list; model anchors only add extra locations.
      const stackAnchors = resolution.matches.map(({ frame, symbol }) => ({
        file: symbol.filePath,
        line: symbol.lineStart ?? 1,
        symbol: `${frame.className ? `${frame.className}.` : ''}${frame.method}`
      }));
      for (const anchor of unionIncidentAnchors(stackAnchors, real.anchors)) {
        if (await this.isValidAnchor(repo, anchor)) {
          anchors.push({ ...anchor, commit: repo.commit });
        }
      }
      const answer = maskSensitiveText(real.answer ?? 'No answer from LLM.');
      const usage =
        real.usage ??
        buildTokenUsage(estimateTokenCount(input.question + summary), estimateTokenCount(answer), 'estimate');
      const tokens = answer.match(/\S+(?:\s+)?/g) ?? [answer];
      for (const token of tokens) {
        yield { type: 'repoqa.query.token', payload: { token } };
      }
      // Issue 24 / ADR-0013: engine-rendered diagram only (model mermaid stripped).
      const engineMermaid = real.diagram
        ? this.renderLayerInstruction(real.diagram, repo, symbols, diagramSession)
        : undefined;
      if (engineMermaid) {
        yield { type: 'repoqa.query.mermaid', payload: { mermaid: engineMermaid } };
      }
      if (anchors.length > 0) {
        yield { type: 'repoqa.query.anchors', payload: { anchors } };
      }
      this.repoqa.recordEvent({
        repoId: repo.id,
        eventType: 'query.done',
        intent: 'incident',
        queryStartAt,
        firstTokenAt:
          real.firstTokenMs !== undefined
            ? new Date(startedAt + real.firstTokenMs).toISOString()
            : undefined,
        queryDoneAt: new Date().toISOString(),
        feedback: JSON.stringify({ incident: summary })
      });
      yield {
        type: 'repoqa.query.done',
        payload: {
          answer,
          mermaid: engineMermaid,
          anchors,
          suggestedAction: undefined,
          confidence: undefined,
          lowConfidence: false,
          provenance: 'llm',
          usage,
          commit: repo.commit
        }
      };
      return;
    }

    // ---- Deterministic fallback path (ADR-0011: static boundary) ----
    const crashSymbol = this.pickCrashSymbol(resolution, symbols);
    const staticAnswer = this.buildIncidentStaticAnswer(
      repo.id,
      input.question,
      symbols,
      resolution,
      summary,
      crashSymbol
    );
    const answer = maskSensitiveText(staticAnswer.answer);
    const usage = buildTokenUsage(estimateTokenCount(input.question + summary), estimateTokenCount(answer), 'estimate');
    const tokens = answer.match(/\S+(?:\s+)?/g) ?? [answer];
    for (const token of tokens) {
      yield { type: 'repoqa.query.token', payload: { token } };
    }
    if (staticAnswer.mermaid) {
      yield { type: 'repoqa.query.mermaid', payload: { mermaid: staticAnswer.mermaid } };
    }
    const anchors: RepoQaAnchor[] = [];
    for (const anchor of staticAnswer.anchors) {
      if (await this.isValidAnchor(repo, anchor)) {
        anchors.push({ ...anchor, commit: repo.commit });
      }
    }
    if (anchors.length > 0) {
      yield { type: 'repoqa.query.anchors', payload: { anchors } };
    }
    if (resolution.unmatched.length > 0) {
      this.repoqa.recordEvent({
        repoId: repo.id,
        eventType: 'tool.miss',
        intent: 'incident',
        toolMiss: `incident stack frames unmatched: ${resolution.unmatched
          .map((frame) => `${frame.className ? `${frame.className}.` : ''}${frame.method}`)
          .slice(0, 5)
          .join(', ')}`
      });
    }
    this.repoqa.recordEvent({
      repoId: repo.id,
      eventType: 'query.done',
      intent: 'incident',
      queryStartAt,
      queryDoneAt: new Date().toISOString(),
      feedback: JSON.stringify({ incident: summary })
    });
    yield {
      type: 'repoqa.query.done',
      payload: {
        answer,
        mermaid: staticAnswer.mermaid,
        anchors,
        suggestedAction: crashSymbol ? `Trace ${crashSymbol.name}` : undefined,
        confidence: crashSymbol ? 1 : undefined,
        lowConfidence: !crashSymbol,
        provenance: 'static',
        usage,
        commit: repo.commit
      }
    };
  }

  /**
   * Issue 23 — crash-site symbol for the incident fallback: the first resolved
   * frame (deepest = crash point), else the first method in the index only as
   * an explicitly-labelled last resort.
   */
  private pickCrashSymbol(
    resolution: StackResolution<RepoSymbol>,
    symbols: RepoSymbol[]
  ): RepoSymbol | undefined {
    const matched = resolution.matches[0]?.symbol;
    if (matched) return matched;
    // No frame matched the index: fall back to a route/method entry so the
    // diagnose traversal still starts from something physically real.
    return (
      symbols.find((symbol) => symbol.kind === 'route') ??
      symbols.find((symbol) => symbol.kind === 'method')
    );
  }

  /** Issue 23 — incident context: parsed stack summary + index excerpt. */
  private buildIncidentContext(
    repoId: string,
    question: string,
    symbols: RepoSymbol[],
    resolution: StackResolution<RepoSymbol>,
    summary: string
  ): string {
    const symbolLines = symbols.slice(0, 200).map(
      (symbol) => `${symbol.name} (${symbol.kind} @ ${symbol.filePath}:${symbol.lineStart ?? 1})`
    );
    const frameLines = [...resolution.matches, ...resolution.unmatched.map((frame) => ({ frame, symbol: undefined }))].map(
      ({ frame, symbol }) =>
        `- ${frame.raw}${symbol ? ` -> ${symbol.name} @ ${symbol.filePath}:${symbol.lineStart ?? 1}` : ' -> UNRESOLVED (BREAK)'}`
    );
    const chunkLines = this.repoqa
      .searchChunks(repoId, question)
      .slice(0, 20)
      .map((chunk) => `${chunk.filePath ?? '?'}: ${chunk.content.slice(0, 200)}`);
    return capPrompt(
      [
        `Stack trace analysis: ${summary}`,
        frameLines.length > 0 ? `Parsed frames:\n${frameLines.join('\n')}` : undefined,
        `Indexed symbols (excerpt):\n${symbolLines.join('\n')}`,
        chunkLines.length > 0 ? `Evidence chunks:\n${chunkLines.join('\n')}` : undefined
      ]
        .filter(Boolean)
        .join('\n\n')
    );
  }

  /**
   * Issue 23 — incident tool whitelist: diagnose chain, blast radius, call
   * chain, config evidence plus the deterministic `parse_stack_trace` tool.
   * Everything returns physical evidence only (ADR-0011).
   */
  private buildIncidentTools(repoId: string, symbols: RepoSymbol[]): AgentTool[] {
    const base = this.buildAgentTools(repoId, symbols);
    const whitelist = [
      'diagnose_chain',
      'blast_radius',
      'trace_call_chain',
      'get_config_evidence'
    ];
    const tools = base.filter((tool) => whitelist.includes(tool.name));
    tools.push({
      name: 'parse_stack_trace',
      description:
        'Deterministically parse a pasted Java/TS stack trace and resolve its frames against the indexed ' +
        'symbol table. Returns matched frames (with physical file:line) and UNRESOLVED frames (report them as BREAK).',
      parameters: 'stack: string',
      parameterSchema: {
        type: 'object',
        properties: {
          stack: { type: 'string', description: 'Raw pasted stack trace / log excerpt' }
        },
        required: ['stack'],
        additionalProperties: false
      },
      execute: (args) => {
        const stack = String(args.stack ?? '');
        if (!stack.trim()) return { error: 'stack is required' };
        const frames = parseStackTrace(stack);
        const resolved = resolveFramesToSymbols(frames, symbols, {
          name: (symbol) => symbol.name,
          parentType: (symbol) => symbol.parentType,
          filePath: (symbol) => symbol.filePath
        });
        return {
          summary: stackTraceSummary(resolved),
          matched: resolved.matches.map(({ frame, symbol }) => ({
            frame: frame.raw,
            symbol: symbol.name,
            file: symbol.filePath,
            line: symbol.lineStart ?? 1
          })),
          unmatched: resolved.unmatched.map((frame) => ({
            frame: frame.raw,
            status: 'BREAK'
          }))
        };
      }
    });
    return tools;
  }

  /**
   * Issue 23 — deterministic incident answer (no LLM): stack resolution,
   * diagnose traversal from the crash symbol, blast radius and config keys,
   * composed into the three-part layout. Every file:line comes from the
   * symbol table; unmatched frames are printed verbatim as BREAK.
   */
  private buildIncidentStaticAnswer(
    repoId: string,
    question: string,
    symbols: RepoSymbol[],
    resolution: StackResolution<RepoSymbol>,
    summary: string,
    crashSymbol: RepoSymbol | undefined
  ): { answer: string; mermaid?: string; anchors: RepoQaAnchor[] } {
    const anchors: RepoQaAnchor[] = [];
    const matchedLines = resolution.matches.map(
      ({ frame, symbol }) =>
        `- ${frame.className ? `${frame.className}.` : ''}${frame.method} -> ${symbol.name} @ ${symbol.filePath}:${symbol.lineStart ?? 1} [VERIFIED]`
    );
    const breakLines = resolution.unmatched.map(
      (frame) => `- ${frame.raw} -> BREAK (no physical counterpart in the index)`
    );

    // Diagnose traversal from the crash symbol (deterministic engine).
    let diagnose: DiagnoseResult | undefined;
    if (crashSymbol) {
      try {
        diagnose = runDiagnose({
          repoId,
          entrySymbol: crashSymbol.name,
          symbols,
          index: this.getSymbolGraph(repoId).index
        });
      } catch {
        diagnose = undefined;
      }
    }
    const chainLines =
      diagnose?.verifiedChain.map(
        (step) => `- [${step.status}] ${step.layer} ${step.symbol} @ ${step.filePath}:${step.line}`
      ) ?? [];
    for (const step of diagnose?.verifiedChain ?? []) {
      anchors.push({ file: step.filePath, line: step.line, symbol: step.symbol });
    }

    // Blast radius for the crash symbol (deterministic engine).
    let blast: RefactorPlanResult | undefined;
    if (crashSymbol) {
      try {
        blast = runBlastRadius({
          repoId,
          targetSymbol: crashSymbol.name,
          changeType: 'LOGIC_REFACTOR',
          symbols,
          index: this.getSymbolGraph(repoId).index
        });
      } catch {
        blast = undefined;
      }
    }
    const blastLines: string[] = [];
    if (blast) {
      blastLines.push(
        `- direct callers: ${blast.directCallersCount}, indirect: ${blast.indirectCallersCount}, risk: ${blast.riskLevel}`
      );
      if (blast.impactedRoutes.length > 0) {
        blastLines.push(`- impacted routes: ${blast.impactedRoutes.slice(0, 6).join(', ')}`);
      }
    }

    // Config evidence for keys mentioned in the question/stack.
    const configMatches = matchConfigSymbols(
      `${question}\n${resolution.matches.map(({ frame }) => frame.raw).join('\n')}`,
      symbols.filter((symbol) => symbol.kind === 'config')
    ).slice(0, 6);
    const configLines = configMatches.map(
      (symbol) => `- ${symbol.name} @ ${symbol.filePath}:${symbol.lineStart ?? 1}`
    );
    for (const symbol of configMatches) {
      anchors.push({ file: symbol.filePath, line: symbol.lineStart ?? 1, symbol: symbol.name });
    }

    const overview = crashSymbol
      ? `崩溃点定位到 ${crashSymbol.parentType ? `${crashSymbol.parentType}.` : ''}${crashSymbol.name}（${crashSymbol.filePath}:${crashSymbol.lineStart ?? 1}），以下链路均来自本次会话的确定性工具返回。`
      : '堆栈中的帧未能在索引中定位到物理符号，无法给出可证实的调用链。';

    const evidence: string[] = [`堆栈解析: ${summary}`];
    if (matchedLines.length > 0) evidence.push(`已解析帧（VERIFIED）:\n${matchedLines.join('\n')}`);
    if (breakLines.length > 0) evidence.push(`未解析帧（BREAK，不猜测）:\n${breakLines.join('\n')}`);
    if (chainLines.length > 0) evidence.push(`诊断链路（静态穿透）:\n${chainLines.join('\n')}`);
    if (diagnose) evidence.push(`链路边界说明: ${diagnose.rootCauseSummary}`);
    if (blastLines.length > 0) evidence.push(`影响面（Blast Radius）:\n${blastLines.join('\n')}`);
    if (configLines.length > 0) evidence.push(`相关配置键:\n${configLines.join('\n')}`);

    const nextStep = crashSymbol
      ? blast && blast.migrationSteps.length > 0
        ? `建议下一步: ${blast.migrationSteps[0]}`
        : `建议下一步: 从 ${crashSymbol.name} 开始核对 ${crashSymbol.filePath}:${crashSymbol.lineStart ?? 1} 的最近改动。`
      : '建议下一步: 补充堆栈上下文或确认该代码是否在当前仓库索引范围内。';

    const mermaid =
      diagnose && diagnose.verifiedChain.length > 1
        ? this.traceToMermaid(
            diagnose.verifiedChain.map((step) => ({
              file: step.filePath,
              method: step.symbol,
              line: step.line,
              ...(step.status === 'BROKEN' ? { break: true as const, reason: step.diagnosticNotes } : {})
            })),
            diagnose.verifiedChain[0].symbol
          )
        : undefined;

    return { answer: `${overview}\n\n${evidence.join('\n\n')}\n\n${nextStep}`, mermaid, anchors };
  }

  /**
   * Issue 20 — public deterministic start-symbol lookup for the MCP tools and
   * other non-HTTP consumers: resolves a method/route/service/class name (or a
   * natural-language phrase) to the symbol a call-chain trace should start from.
   */
  resolveStartSymbolForQuery(
    repoId: string,
    query: string,
    explicitStart?: { name: string; file: string }
  ): StartSymbolResolution | undefined {
    const { symbols } = this.getSymbolGraph(repoId);
    return this.resolveStartSymbol(query, symbols, explicitStart);
  }

  findStartSymbolForQuery(repoId: string, query: string): RepoSymbol | undefined {
    return this.resolveStartSymbolForQuery(repoId, query)?.symbol;
  }

  /**
   * v0.5.1 (D8) — every production method matching the query name. Reverse
   * lookups ("who uses likePost") and subgraph context treat these as caller
   * roots so a browser caller targeting the controller route is not hidden by
   * the same-named service method.
   */
  resolveExactMethodCandidates(repoId: string, query: string): RepoSymbol[] {
    const { symbols } = this.getSymbolGraph(repoId);
    const name = query.trim().toLowerCase();
    const prod = symbols.filter(
      (symbol) =>
        symbol.kind === 'method' &&
        symbol.name.toLowerCase() === name &&
        !this.isTestPath(symbol.filePath)
    );
    if (prod.length > 0) return prod;
    return symbols.filter(
      (symbol) => symbol.kind === 'method' && symbol.name.toLowerCase() === name
    );
  }

  /** Test paths (src/test, test/java) rarely carry the chain the user asked
   * about — a production method wins over a same-named test helper. */
  private isTestPath(filePath: string): boolean {
    const p = filePath.replace(/\\/g, '/').toLowerCase();
    return p.includes('/test/') || p.includes('/src/test') || p.includes('test/java');
  }

  private resolveStartSymbol(
    question: string,
    symbols: RepoSymbol[],
    explicitStart?: { name: string; file: string }
  ): StartSymbolResolution | undefined {
    // Explicit start (Top API click) wins: exact file+name first, then a
    // production-code name match, so the trace never starts from a sibling
    // symbol in a test class.
    if (explicitStart?.name && explicitStart.file) {
      const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
      const exact = symbols.find(
        (symbol) =>
          symbol.name.toLowerCase() === explicitStart.name.toLowerCase() &&
          norm(symbol.filePath) === norm(explicitStart.file)
      );
      if (exact) return { symbol: exact, fallback: false, confidence: 1 };
      const byName = symbols.find(
        (symbol) =>
          symbol.name.toLowerCase() === explicitStart.name.toLowerCase() &&
          !this.isTestPath(symbol.filePath)
      );
      if (byName) return { symbol: byName, fallback: false, confidence: 1 };
    }
    const words = question.toLowerCase().match(/[a-z_$][\w$]*/g) ?? [];
    const prodSymbols = symbols.filter((symbol) => !this.isTestPath(symbol.filePath));
    // Issue 05: allow tracing from a route/service/repository/class symbol too;
    // resolveCallChain normalizes the type into its first method.
    const typeKinds = new Set(['class', 'interface', 'route', 'service', 'repository']);
    const find = (list: RepoSymbol[], kinds: Set<string>, word: string) =>
      list.find((symbol) => kinds.has(symbol.kind) && symbol.name.toLowerCase() === word);
    for (const word of words) {
      const match = find(prodSymbols, new Set(['method']), word);
      if (match) return { symbol: match, fallback: false, confidence: 1 };
    }
    for (const word of words) {
      const match = find(symbols, new Set(['method']), word);
      if (match) return { symbol: match, fallback: false, confidence: 1 };
    }
    // Issue 18: fuzzy extraction runs before the exact type/route lookups so
    // natural-language phrasing like "创建 owner 的方法" starts from a real
    // method (createOwner) instead of the type whose name is a word in the
    // question (class Owner normalizes to an arbitrary first method).
    const fuzzy = findFuzzyStartSymbol(question, symbols, (filePath) => this.isTestPath(filePath));
    if (fuzzy) {
      const score = fuzzyMatchScore(question, fuzzy.name);
      const confidence = Number((0.6 + (score / 100) * 0.39).toFixed(2));
      return { symbol: fuzzy, fallback: false, confidence };
    }
    for (const word of words) {
      const match = find(prodSymbols, typeKinds, word);
      if (match) return { symbol: match, fallback: false, confidence: 1 };
    }
    for (const word of words) {
      const match = find(symbols, typeKinds, word);
      if (match) return { symbol: match, fallback: false, confidence: 1 };
    }
    const fallback =
      prodSymbols.find((symbol) => symbol.kind === 'method') ??
      symbols.find((symbol) => symbol.kind === 'method');
    return fallback ? { symbol: fallback, fallback: true, confidence: 0.2 } : undefined;
  }

  private findStartSymbol(
    question: string,
    symbols: RepoSymbol[],
    explicitStart?: { name: string; file: string }
  ): RepoSymbol | undefined {
    return this.resolveStartSymbol(question, symbols, explicitStart)?.symbol;
  }

  private traceToMermaid(
    trace: RepoQaTraceHop[],
    startName: string,
    annotations?: Record<string, string>
  ): string {
    const lines = ['flowchart LR'];
    const names = [startName, ...trace.slice(1).map((hop) => hop.method)];
    for (let index = 0; index < names.length - 1; index += 1) {
      const hop = trace[index + 1];
      // v0.7 — break markers take precedence; async hops get an [async] edge
      // label so Goroutine dispatch stays visible in the deterministic chain.
      const label = hop?.break
        ? (hop.reason ?? 'break').replace(/[\[\]]/g, '')
        : hop?.async
          ? 'async'
          : undefined;
      const edge = label ? `-->|${label}|` : '-->';
      lines.push(`  ${names[index]}[${names[index]}] ${edge} ${names[index + 1]}[${names[index + 1]}]`);
    }
    // Issue 10: code:// deep-link every node to its source location so the
    // frontend can jump from the diagram to the Inspector.
    const nodes = [
      { name: startName, hop: trace[0] },
      ...trace.slice(1).map((hop, index) => ({ name: names[index + 1], hop }))
    ];
    for (const { name, hop } of nodes) {
      if (hop?.file && typeof hop.line === 'number') {
        lines.push(`  click ${name} "code://${hop.file}#${hop.line}"`);
      }
    }
    // Issue 24 / ADR-0013: model annotations ride along as mermaid comments —
    // they never touch geometry, edges or click bindings. Keys that do not
    // name a node of this diagram are dropped (existence enforced here).
    if (annotations) {
      for (const { name } of nodes) {
        const note = annotations[name];
        if (note) lines.push(`  %% note ${name}: ${note}`);
      }
    }
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Issue 24 / ADR-0013 — layer-instruction rendering.
   *
   * The model may only request diagrams via a structured instruction; every
   * edge below is harvested from this session's deterministic tool results
   * (trace_call_chain / diagnose_chain rows) or rendered by a fixed engine
   * renderer (config topology, onboarding tours). Model-painted mermaid is
   * stripped in finalizeAgentResult and never reaches a payload.
   * ------------------------------------------------------------------ */

  /** Physical hop harvested from one session tool result row. */
  collectSessionEdges(result: unknown, edges: SessionGraphEdge[]): number {
    let added = 0;
    if (Array.isArray(result)) {
      for (const item of result) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const row = item as Record<string, unknown>;
        const file =
          typeof row.file === 'string'
            ? row.file
            : typeof row.filePath === 'string'
              ? row.filePath
              : undefined;
        const method =
          typeof row.method === 'string'
            ? row.method
            : typeof row.symbol === 'string'
              ? row.symbol
              : undefined;
        const line = Number(row.line);
        if (!file || !method || !Number.isFinite(line) || line <= 0) continue;
        edges.push({ file, method, line: Math.trunc(line) });
        added += 1;
      }
      return added;
    }
    if (result && typeof result === 'object') {
      // diagnose_chain returns { verifiedChain: [...] } — same row shape.
      const chain = (result as Record<string, unknown>).verifiedChain;
      if (Array.isArray(chain)) added += this.collectSessionEdges(chain, edges);
    }
    return added;
  }

  /** Sink wired into the ReAct loop: harvest edges, mark failed tools. */
  private harvestDiagramSession(
    session: DiagramSession,
    toolName: string,
    result: unknown
  ): void {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const error = (result as Record<string, unknown>).error;
      if (typeof error === 'string' && error) session.failedTools.add(toolName);
    }
    this.collectSessionEdges(result, session.edges);
  }

  /**
   * ADR-0013: the ONLY path from a layer instruction to a payload diagram.
   * call_chain requires provable session edges (and a clean session — any
   * failed tool call voids the chain); config_topo / tour are fixed engine
   * renderers over the symbol table. Returns undefined when nothing can be
   * proven — the engine never invents geometry to satisfy an instruction.
   */
  renderLayerInstruction(
    instruction: LayerInstruction,
    repo: { id: string; name: string },
    symbols: RepoSymbol[],
    session: DiagramSession
  ): string | undefined {
    if (instruction.kind === 'call_chain') {
      if (session.failedTools.size > 0) return undefined;
      return this.renderCallChainDiagram(instruction, repo.id, symbols, session.edges);
    }
    if (instruction.kind === 'config_topo') {
      return this.renderConfigTopoDiagram(instruction, symbols);
    }
    return this.renderTourDiagram(instruction, repo, symbols);
  }

  private renderCallChainDiagram(
    instruction: LayerInstruction,
    repoId: string,
    symbols: RepoSymbol[],
    edges: SessionGraphEdge[]
  ): string | undefined {
    let start: RepoSymbol | undefined;
    for (const name of instruction.focus ?? []) {
      start = this.findStartSymbol(name, symbols);
      if (start) break;
    }
    if (!start) {
      // No resolvable focus: fall back to the first session edge that pins a
      // symbol in the index — still engine-derived, never model-drawn.
      for (const edge of edges) {
        start =
          symbols.find((symbol) => symbol.name === edge.method) ??
          symbols.find(
            (symbol) =>
              `${symbol.parentType ? `${symbol.parentType}.` : ''}${symbol.name}` === edge.method
          );
        if (start) break;
      }
    }
    if (!start) return undefined;
    const trace = resolveCallChain(symbols, start, 4, this.getSymbolGraph(repoId).index);
    if (trace.length < 2) return undefined;
    const collapse = instruction.collapse ?? trace.length;
    const capped = trace.slice(0, Math.max(2, Math.min(collapse, trace.length)));
    return this.traceToMermaid(capped, start.name, instruction.annotations);
  }

  private renderConfigTopoDiagram(
    instruction: LayerInstruction,
    symbols: RepoSymbol[]
  ): string | undefined {
    const configs = symbols.filter(
      (symbol) => symbol.kind === 'config' && !symbol.name.includes(':')
    );
    const focus = instruction.focus ?? [];
    // ADR-0013: focus that matches nothing renders nothing — never the full
    // topology as a consolation prize, never invented keys.
    const selected = (
      focus.length > 0 ? configs.filter((symbol) => focus.includes(symbol.name)) : configs
    ).slice(0, Math.max(1, Math.min(instruction.collapse ?? 12, 30)));
    if (selected.length === 0) return undefined;
    const lines = ['flowchart LR'];
    const usedIds = new Set<string>();
    const nodeIdOf = (raw: string): string => {
      let id = raw.replace(/[^A-Za-z0-9_]/g, '_');
      while (usedIds.has(id)) id = `${id}_x`;
      usedIds.add(id);
      return id;
    };
    const groupIds = new Map<string, string>();
    for (const symbol of selected) {
      const id = nodeIdOf(symbol.name);
      const sensitive = isSensitiveConfigKey(symbol.name);
      lines.push(`  ${id}["${sensitive ? `${symbol.name} (sensitive)` : symbol.name}"]`);
      lines.push(`  click ${id} "code://${symbol.filePath}#${symbol.lineStart ?? 1}"`);
      const group = classifyConfigKey(symbol.name);
      if (!groupIds.has(group)) {
        const gid = nodeIdOf(`group_${group}`);
        groupIds.set(group, gid);
        lines.push(`  ${gid}["${group}"]`);
      }
      lines.push(`  ${id} --> ${groupIds.get(group)}`);
    }
    const mermaid = lines.join('\n');
    const annotations = instruction.annotations;
    if (!annotations || Object.keys(annotations).length === 0) return mermaid;
    const nodeIds = this.mermaidNodeIds(mermaid);
    const notes = Object.entries(annotations).filter(([key]) => nodeIds.has(key));
    return notes.length === 0
      ? mermaid
      : `${mermaid}\n${notes.map(([key, text]) => `  %% note ${key}: ${text}`).join('\n')}`;
  }

  private renderTourDiagram(
    instruction: LayerInstruction,
    repo: { id: string; name: string },
    symbols: RepoSymbol[]
  ): string | undefined {
    const tours = buildTours({ repoId: repo.id, repoName: repo.name, symbols });
    if (tours.length === 0) return undefined;
    const focusId = instruction.focus?.[0];
    // ADR-0013: an unknown tour id renders nothing; no focus → main-flow.
    const matched = focusId ? tours.find((tour) => tour.id === focusId) : undefined;
    if (focusId && !matched) return undefined;
    const picked = matched ?? tours.find((tour) => tour.id === 'main-flow') ?? tours[0];
    const annotations = instruction.annotations;
    if (!annotations || Object.keys(annotations).length === 0) return picked.mermaid;
    const nodeIds = this.mermaidNodeIds(picked.mermaid);
    const notes = Object.entries(annotations).filter(([key]) => nodeIds.has(key));
    return notes.length === 0
      ? picked.mermaid
      : `${picked.mermaid}\n${notes.map(([key, text]) => `  %% note ${key}: ${text}`).join('\n')}`;
  }

  /** Identifier tokens of a diagram body (clicks / quoted strings / comments excluded). */
  private mermaidNodeIds(code: string): Set<string> {
    const withoutStrings = code.replace(/"([^"]*)"/g, '');
    const body = withoutStrings
      .split('\n')
      .filter((line) => !/^\s*%%/.test(line) && !/^\s*click\s/i.test(line))
      .join('\n');
    const ids = new Set<string>();
    for (const match of body.matchAll(/[A-Za-z_][\w]*/g)) ids.add(match[0]);
    return ids;
  }

  private async runReActLoop(
    repoId: string,
    question: string,
    symbols: RepoSymbol[],
    onFirstToken?: (latencyMs: number) => void,
    onToolResult?: (toolName: string, result: unknown) => void
  ): Promise<ReActLLMResult> {
    // Issue 10: the ReAct loop now lives in the adapter (repoqa-llm.ts).
    // Tools expose deterministic repo intelligence; masking happens both on the
    // outgoing prompt and inside the repoqa-masking tool.
    return runReActAgent({
      question,
      context: this.buildReActContext(repoId, question, symbols),
      tools: this.buildAgentTools(repoId, symbols),
      env: process.env,
      onFirstToken,
      onToolResult
    });
  }

  /** Prebuilt deterministic context: indexed symbols + evidence chunks. */
  private buildReActContext(
    repoId: string,
    question: string,
    symbols: RepoSymbol[]
  ): string {
    const symbolLines = symbols
      .slice(0, 200)
      .map(
        (symbol) =>
          `${symbol.name} (${symbol.kind} @ ${symbol.filePath}:${symbol.lineStart ?? 1})`
      )
      .join('\n');
    const chunkLines = this.repoqa
      .searchChunks(repoId, question)
      .slice(0, 30)
      .map((chunk) => `${chunk.filePath ?? '?'}: ${chunk.content.slice(0, 200)}`)
      .join('\n');
    return capPrompt(`Indexed symbols:\n${symbolLines}\nEvidence chunks:\n${chunkLines}`);
  }

  /** Issue 10: Agent Tools wired into the ReAct loop. */
  private buildAgentTools(repoId: string, symbols: RepoSymbol[]): AgentTool[] {
    const compositeTools: AgentTool[] = [
      {
        name: 'domain_radar',
        description:
          'v0.9 composite panorama tool: hub nodes (degree + deterministic PageRank), top external ' +
          'APIs, persistence layer and — with an intent query — top-3 anchor symbols. Zero embeddings.',
        parameters: 'query?: string',
        execute: (args) => {
          const query = args.query === undefined ? undefined : String(args.query ?? '').trim();
          try {
            const chunkHitFiles = query
              ? this.repoqa
                  .searchChunks(repoId, query)
                  .map((chunk) => chunk.filePath)
                  .filter((file): file is string => Boolean(file))
              : undefined;
            return runDomainRadar({
              repoId,
              ...(query ? { query } : {}),
              symbols,
              index: this.getSymbolGraph(repoId).index,
              ...(chunkHitFiles ? { chunkHitFiles } : {})
            });
          } catch (error) {
            return { error: (error as Error).message };
          }
        }
      },
      {
        name: 'module_evolution',
        description:
          'v0.9 composite evolution tool: DEPRECATE emits orphaned public code (fixed-point cascade) ' +
          'and a teardown checklist; EXTEND emits the attach point, transaction boundaries and a ' +
          'convention-driven placement (ADR-0014) with code scaffolds. Patches are never produced ' +
          'here (ADR-0006). A STRICT-convention conflict fails closed with a conventionConflict detail.',
        parameters:
          'intentType: "DEPRECATE" | "EXTEND", targetSymbolOrModule: string, extensionGoal?: string, nearPackages?: string[]',
        execute: (args) => {
          const intentType = String(args.intentType ?? 'DEPRECATE') as 'DEPRECATE' | 'EXTEND';
          const targetSymbolOrModule = String(args.targetSymbolOrModule ?? args.target ?? '');
          if (!targetSymbolOrModule) return { error: 'targetSymbolOrModule is required' };
          const nearPackages = Array.isArray(args.nearPackages)
            ? args.nearPackages.map((entry) => String(entry)).filter(Boolean)
            : undefined;
          try {
            return runModuleEvolution({
              repoId,
              intentType,
              targetSymbolOrModule,
              ...(args.extensionGoal === undefined
                ? {}
                : { extensionGoal: String(args.extensionGoal) }),
              ...(nearPackages && nearPackages.length > 0 ? { nearPackages } : {}),
              symbols,
              index: this.getSymbolGraph(repoId).index,
              // ADR-0010: `unversioned` is the honest fallback when no commit is known.
              commit: this.repoqa.getRepo(repoId)?.commit ?? 'unversioned'
            });
          } catch (error) {
            // Issue 24.3: a STRICT conflict (or injection cycle) is a planned
            // outcome, not a tool crash — surface the structured detail so the
            // agent can rewrite the intent instead of retrying blind.
            if (error instanceof ConventionConflictError) {
              return { error: error.message, conventionConflict: error.conflict };
            }
            return { error: (error as Error).message };
          }
        }
      },
      {
        name: 'diagnose_chain',
        description:
          'v0.8 composite root-cause tool: deterministic frontend→router→service→data-mapper traversal ' +
          'for an entry symbol or "METHOD /route/path". Returns layer-annotated steps with VERIFIED/BROKEN status.',
        parameters: 'entrySymbol: string',
        execute: (args) => {
          const entrySymbol = String(args.entrySymbol ?? args.query ?? '');
          if (!entrySymbol) return { error: 'entrySymbol is required' };
          try {
            return runDiagnose({
              repoId,
              entrySymbol,
              ...(args.symptom !== undefined ? { symptomDescription: String(args.symptom) } : {}),
              symbols,
              index: this.getSymbolGraph(repoId).index
            });
          } catch (error) {
            return { error: (error as Error).message };
          }
        }
      },
      {
        name: 'blast_radius',
        description:
          'v0.8 composite refactor tool: deterministic direct/indirect caller aggregation, impacted routes, ' +
          'bridged frontend components, risk score and migration steps for a target symbol.',
        parameters: 'targetSymbol: string, changeType: "SIGNATURE_CHANGE" | "REMOVAL" | "LOGIC_REFACTOR"',
        execute: (args) => {
          const targetSymbol = String(args.targetSymbol ?? args.query ?? '');
          if (!targetSymbol) return { error: 'targetSymbol is required' };
          const changeType = String(args.changeType ?? 'SIGNATURE_CHANGE') as
            | 'SIGNATURE_CHANGE'
            | 'REMOVAL'
            | 'LOGIC_REFACTOR';
          try {
            return runBlastRadius({ repoId, targetSymbol, changeType, symbols, index: this.getSymbolGraph(repoId).index });
          } catch (error) {
            return { error: (error as Error).message };
          }
        }
      },
      {
        name: 'convention_scan',
        description:
          'ADR-0014 deterministic convention profile (zero-LLM): return wrapping, interface/impl split, ' +
          'base classes, DI style and package layout. Every verdict carries physical anchors with ' +
          'coverage; dissidents are disclosed, and a targetSymbol arbitrates neighborhood-first.',
        parameters: 'targetSymbol?: string',
        execute: async (args) => {
          const targetSymbol = args.targetSymbol === undefined ? undefined : String(args.targetSymbol ?? '').trim();
          try {
            return await this.runConventionScan({
              repoId,
              ...(targetSymbol ? { targetSymbol } : {})
            });
          } catch (error) {
            return { error: (error as Error).message };
          }
        }
      }
    ];
    return [
      {
        name: 'trace_call_chain',
        description:
          'Resolve the call chain starting from a method/route/class name (e.g. "hello"). Returns ordered hops with file, method, line and break markers.',
        parameters: 'query: string',
        execute: (args) => {
          const query = String(args.query ?? args.symbol ?? '');
          if (!query) return { error: 'query is required' };
          const start = this.findStartSymbol(query, symbols);
          if (!start) return { error: `start symbol not found for "${query}"` };
          const trace = resolveCallChain(symbols, start);
          return trace.map((hop) => ({
            file: hop.file,
            method: hop.method,
            line: hop.line ?? null,
            break: hop.break === true,
            reason: hop.reason ?? null
          }));
        }
      },
      {
        name: 'get_config_evidence',
        description:
          'Find configuration keys (YAML/properties/pom). Returns key paths with file:line locations, NEVER the secret values.',
        parameters: 'key: string',
        execute: (args) => {
          const key = String(args.key ?? args.query ?? '');
          const configs = symbols.filter((symbol) => symbol.kind === 'config');
          const matched = key ? matchConfigSymbols(key, configs) : configs;
          return matched.slice(0, 30).map((symbol) => ({
            key: symbol.name,
            file: symbol.filePath,
            line: symbol.lineStart ?? 1
          }));
        }
      },
      {
        name: 'repoqa-masking',
        description:
          'Mask sensitive content (passwords, tokens, API keys, private keys) in arbitrary text before it is shown to users.',
        parameters: 'text: string',
        execute: (args) => maskSensitiveText(String(args.text ?? ''))
      },
      ...compositeTools
    ];
  }

  cancel(taskId: string) {
    this.running.get(taskId)?.abort();
    this.running.delete(taskId);
  }

  private broadcast(taskId: string, event: ServerEvent) {
    this.eventBus.emit({ ...event, taskId } as any);
  }

  private async parseRepo(
    repoId: string,
    root: string,
    files: string[],
    largeFiles: Set<string>,
    onProgress?: (parsed: number, total: number, currentFile?: string) => void
  ): Promise<{ symbols: RepoSymbol[]; skipped: Array<{ file: string; error: string }> }> {
    const symbols: RepoSymbol[] = [];
    const skipped: Array<{ file: string; error: string }> = [];
    const total = files.length;
    let parsed = 0;
    for (const filePath of files) {
      const adapter = adapterFor(filePath);
      if (adapter) {
        try {
          if (largeFiles.has(filePath)) {
            const source = await fs.readFile(filePath, 'utf8');
            const relative = path.relative(root, filePath).split(path.sep).join('/');
            symbols.push(...parseLargeFileTier3(source, relative, repoId));
            this.repoqa.recordEvent({
              repoId,
              eventType: 'repoqa.index.warning',
              feedback: JSON.stringify({
                tier: 'LARGE_GENERATED_FILE',
                file: relative
              })
            });
          } else {
            symbols.push(...(await adapter.parseFile(filePath, repoId, root)));
          }
        } catch (error) {
          // Dogfooding (Issue 17): real-world repos routinely contain edge
          // syntax a parser cannot cover (e.g. class literals inside annotation
          // arguments). A single unparseable file must not abort the whole
          // import — skip it, surface a warning event, and keep the rest.
          const relative = path.relative(root, filePath).split(path.sep).join('/');
          const detail = error instanceof Error ? error.message : String(error);
          skipped.push({ file: relative, error: detail });
        }
      }
      parsed += 1;
      const currentFile = path.relative(root, filePath).split(path.sep).join('/');
      if (parsed % 50 === 0) onProgress?.(parsed, total, currentFile);
    }
    if (total > 0) onProgress?.(total, total);
    return { symbols, skipped };
  }

  private async isValidAnchor(
    repo: Repo,
    anchor: RepoQaAnchor
  ): Promise<boolean> {
    // Issue 23 hotfix: model-supplied anchors are untrusted — a missing `file`
    // must fail validation, not crash path.resolve below.
    if (!anchor || typeof anchor.file !== 'string' || !anchor.file.trim()) return false;
    const root = path.resolve(repo.localPath);
    const resolved = path.resolve(root, anchor.file);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
    try {
      const realRoot = await fs.realpath(root);
      const realResolved = await fs.realpath(resolved);
      const realRelative = path.relative(realRoot, realResolved);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return false;
      const stat = await fs.stat(realResolved);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private async extractChunks(
    repoId: string,
    root: string,
    files: string[]
  ): Promise<RepoChunk[]> {
    const chunks: RepoChunk[] = [];
    let masked = false;
    for (const filePath of files) {
      const fileName = path.basename(filePath).toLowerCase();
      const relativePath = path.relative(root, filePath).split(path.sep).join('/');
      if (fileName.startsWith('readme') || fileName.endsWith('.md')) {
        const content = await fs.readFile(filePath, 'utf8').catch(() => '');
        const maskedContent = maskSensitiveText(content);
        if (maskedContent !== content) masked = true;
        if (maskedContent.trim()) {
          chunks.push({
            repoId,
            chunkType: 'readme',
            content: maskedContent.slice(0, 4000),
            filePath: relativePath,
            lineStart: 1
          });
        }
        continue;
      }

      if (filePath.endsWith('.java')) {
        const content = await fs.readFile(filePath, 'utf8').catch(() => '');
        const javadoc = content.match(/\/\*\*[\s\S]*?\*\//g) ?? [];
        for (const block of javadoc) {
          const maskedBlock = maskSensitiveText(block);
          if (maskedBlock !== block) masked = true;
          chunks.push({
            repoId,
            chunkType: 'docstring',
            content: maskedBlock.slice(0, 4000),
            filePath: relativePath,
            lineStart: lineNumberAt(content, content.indexOf(block))
          });
        }
      }
    }
    if (masked) {
      this.repoqa.recordEvent({ repoId, eventType: 'masking.applied' });
    }
    return chunks;
  }

}
