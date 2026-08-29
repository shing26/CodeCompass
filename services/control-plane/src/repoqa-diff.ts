import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { RepoSymbol } from './repoqa-repos';
import { adapterFor } from './repoqa-parser';
import { CallResolver, symbolIdentity } from './repoqa-callchain';
import { scanPom, scanProperties, scanYaml, type ScannedKey } from './repoqa-config';
import { SOURCE_EXTENSIONS } from './repoqa-scan';
import type {
  ArchitectureDeltaReport,
  CallEdge,
  ExtractedSymbol
} from '../../../packages/contracts/src/index';

/**
 * Issue 22 — PR 架构影响面透视（`codecompass diff <base> <head> [repoPath]`）。
 *
 * 全链路只读：所有内容都来自 git 对象（`git diff` / `git ls-tree` / `git show`），
 * 绝不触碰工作区或 .git 元数据。
 *
 * 1. 解析 unified diff，得到每个变更文件的 hunk（新旧两侧行号）；
 * 2. 用 head 版本的符号表计算“被修改的 Java 类与方法”：
 *    - head 侧：符号行区间与变更 hunk span 相交 → 新增/修改；
 *    - base 侧：仅对 base 中存在、head 中已消失的符号（删除的方法/类）做反向分析；
 * 3. Reverse Reachability：以修改的方法为起点，沿确定性调用边（复用 Issue 05/21 的
 *    CallResolver）反向 BFS，直到命中 @RestController 路由方法；
 * 4. 组装报告：受影响 API 表格 + 反向 Mermaid 链路 + 配置变更提示（仅键名与位置，
 *    永不暴露值，延续 Issue 06 脱敏约定）。
 */

export const GIT_TIMEOUT_MS = 60_000;
const GIT_SHOW_CONCURRENCY = 8;
export const PR_IMPACT_SCHEMA_VERSION = 1 as const;
export const ARCHITECTURE_DELTA_SCHEMA_VERSION = 1 as const;

/* ------------------------------------------------------------------ */
/* Issue 29 — CI 架构门禁策略                                           */
/* ------------------------------------------------------------------ */

export type PolicyRule = 'max-affected-routes' | 'broken-chain' | 'auth-impact';
export type DiffPolicyStatus = 'PASS' | 'FAIL';

export interface DiffPolicyOptions {
  /** Fail when the number of affected API routes exceeds this limit. */
  maxAffectedRoutes?: number;
  /** Fail when modified symbols cannot be reached from any route. */
  failOnBreak?: boolean;
  /** Fail when an impacted sensitive route lacks an auth guard. */
  failOnAuthImpact?: boolean;
}

export interface PolicyViolation {
  rule: PolicyRule;
  message: string;
  /** Deterministic, human-readable evidence lines for the violation. */
  details: string[];
}

export interface DiffPolicyResult {
  status: DiffPolicyStatus;
  violations: PolicyViolation[];
}

/* ------------------------------------------------------------------ */
/* git plumbing（只读，参数数组传参，绝不拼 shell 字符串）              */
/* ------------------------------------------------------------------ */

export async function git(
  args: string[],
  repoPath: string,
  timeoutMs = GIT_TIMEOUT_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: repoPath, timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const suffix = String(stderr ?? '').trim().slice(0, 500);
        reject(new Error(`git ${args[0]} failed${suffix ? `: ${suffix}` : ''}`));
      }
    );
  });
}

export type GitStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'U';

export interface GitFileStatus {
  path: string;
  status: GitStatus;
}

/** `git diff --name-status` 列出的变更文件（含状态字母）。 */
export async function getDiffStatus(
  repoPath: string,
  base: string,
  head: string
): Promise<GitFileStatus[]> {
  const out = await git(['diff', '--name-status', '--no-renames', base, head], repoPath);
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split('\t');
      return { status: (status?.[0] ?? 'M') as GitStatus, path: rest.join('\t') };
    });
}

/** `git diff` 完整文本（--no-renames 保证行号/文件块与 name-status 对齐）。 */
export async function getDiffText(
  repoPath: string,
  base: string,
  head: string
): Promise<string> {
  return await git(['diff', '--no-renames', base, head], repoPath);
}

/** `git ls-tree -r --name-only <ref>` 列出该提交的所有文件。 */
export async function listGitFiles(repoPath: string, ref: string): Promise<string[]> {
  const out = await git(['ls-tree', '-r', '--name-only', ref], repoPath);
  return out.split(/\r?\n/).filter(Boolean);
}

/** `git show <ref>:<path>` 读取某个提交下的文件内容（读对象，不 checkout）。 */
export async function readGitFile(
  repoPath: string,
  ref: string,
  relPath: string
): Promise<string> {
  return await git(['show', `${ref}:${relPath}`], repoPath);
}

/** `git rev-parse --short <ref>`；失败返回 undefined（非 commit 引用等）。 */
export async function shortSha(repoPath: string, ref: string): Promise<string | undefined> {
  try {
    return (await git(['rev-parse', '--short', ref], repoPath)).trim() || undefined;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* unified diff 解析                                                    */
/* ------------------------------------------------------------------ */

export interface DiffHunkLine {
  kind: 'add' | 'del' | 'ctx';
  text: string;
}

export interface DiffHunk {
  /** 1-based old-side start line. */
  oldStart: number;
  oldCount: number;
  /** 1-based new-side start line. */
  newStart: number;
  newCount: number;
  lines: DiffHunkLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'A' | 'M' | 'D';
  hunks: DiffHunk[];
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parse `git diff` unified output into per-file hunks. Tracks each hunk line's
 * side (add/del/ctx) so callers can compute exact touched lines on both the
 * old and the new side.
 */
export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let hunk: DiffHunk | null = null;

  for (const rawLine of diffText.split(/\r?\n/)) {
    if (rawLine.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(rawLine);
      current = {
        path: match?.[2] ?? rawLine.slice('diff --git '.length),
        status: 'M',
        hunks: []
      };
      files.push(current);
      hunk = null;
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith('new file mode')) {
      current.status = 'A';
      continue;
    }
    if (rawLine.startsWith('deleted file mode')) {
      current.status = 'D';
      continue;
    }
    if (rawLine.startsWith('--- ')) {
      const match = /^--- (?:a\/)?(.*)$/.exec(rawLine);
      if (match && match[1] !== '/dev/null') current.oldPath = match[1];
      continue;
    }
    if (rawLine.startsWith('+++ ')) continue;

    const hunkMatch = HUNK_HEADER_RE.exec(rawLine);
    if (hunkMatch) {
      hunk = {
        oldStart: Number(hunkMatch[1]),
        oldCount: hunkMatch[2] ? Number(hunkMatch[2]) : 1,
        newStart: Number(hunkMatch[3]),
        newCount: hunkMatch[4] ? Number(hunkMatch[4]) : 1,
        lines: []
      };
      current.hunks.push(hunk);
      continue;
    }

    if (hunk) {
      const ch = rawLine[0] ?? '';
      if (ch === '+') hunk.lines.push({ kind: 'add', text: rawLine.slice(1) });
      else if (ch === '-') hunk.lines.push({ kind: 'del', text: rawLine.slice(1) });
      else if (ch === ' ' || rawLine === '') hunk.lines.push({ kind: 'ctx', text: rawLine.slice(1) });
      // `\ No newline at end of file` and binary noise are ignored.
    }
  }
  return files;
}

/* ------------------------------------------------------------------ */
/* 变更行 / hunk span 计算                                              */
/* ------------------------------------------------------------------ */

export interface FileChangedLines {
  /** 1-based new-side lines inside hunks that actually change code. */
  newLines: number[];
  /** 1-based old-side lines inside hunks that actually change code. */
  oldLines: number[];
  /** Inclusive [start, end] hunk spans in new-side coordinates. */
  newSpans: Array<[number, number]>;
  /** Inclusive [start, end] hunk spans in old-side coordinates. */
  oldSpans: Array<[number, number]>;
  /** 精确的新侧新增行（' +' 行），配置键检测用它避免上下文行误报。 */
  newAddLines: number[];
  /** 精确的旧侧删除行（' -' 行）。 */
  oldDelLines: number[];
}

/**
 * Touched lines per side. A hunk that contains only context (no +/- lines) is
 * not a change and is skipped; otherwise the whole hunk span counts as touched
 * so a pure deletion inside a method still marks the method on the head side.
 * Exact add/delete line numbers are tracked separately for config keys, where
 * context lines must never count as a change.
 */
export function changedLinesFor(fileDiff: FileDiff): FileChangedLines {
  const newLines: number[] = [];
  const oldLines: number[] = [];
  const newSpans: Array<[number, number]> = [];
  const oldSpans: Array<[number, number]> = [];
  const newAddLines: number[] = [];
  const oldDelLines: number[] = [];
  for (const hunk of fileDiff.hunks) {
    const hasChange = hunk.lines.some((line) => line.kind === 'add' || line.kind === 'del');
    if (!hasChange) continue;
    const newEnd = hunk.newStart + hunk.newCount - 1;
    const oldEnd = hunk.oldStart + hunk.oldCount - 1;
    newSpans.push([hunk.newStart, newEnd]);
    oldSpans.push([hunk.oldStart, oldEnd]);
    for (let line = hunk.newStart; line <= newEnd; line += 1) newLines.push(line);
    for (let line = hunk.oldStart; line <= oldEnd; line += 1) oldLines.push(line);
    let newCursor = hunk.newStart;
    let oldCursor = hunk.oldStart;
    for (const line of hunk.lines) {
      if (line.kind === 'add') {
        newAddLines.push(newCursor);
        newCursor += 1;
      } else if (line.kind === 'del') {
        oldDelLines.push(oldCursor);
        oldCursor += 1;
      } else {
        newCursor += 1;
        oldCursor += 1;
      }
    }
  }
  return {
    newLines: [...new Set(newLines)].sort((a, b) => a - b),
    oldLines: [...new Set(oldLines)].sort((a, b) => a - b),
    newSpans,
    oldSpans,
    newAddLines: [...new Set(newAddLines)].sort((a, b) => a - b),
    oldDelLines: [...new Set(oldDelLines)].sort((a, b) => a - b)
  };
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let line = start; line <= end; line += 1) out.push(line);
  return out;
}

/* ------------------------------------------------------------------ */
/* 被修改的符号（类与方法）                                             */
/* ------------------------------------------------------------------ */

export interface ModifiedSymbol {
  symbol: RepoSymbol;
  /** head = 存在于目标提交（新增/修改）；base = 仅存在于基线（删除）。 */
  side: 'head' | 'base';
  /** 符号行区间内被变更触及的行号。 */
  changedLines: number[];
}

/** 仅跟踪类型/方法符号；字段与 config 由各自环节单独处理。 */
const SYMBOL_KINDS = new Set<RepoSymbol['kind']>([
  'class',
  'interface',
  'method',
  'route',
  'service',
  'repository',
  'advice'
]);

/**
 * Pick symbols whose [lineStart, lineEnd] intersects any touched hunk span on
 * the given side. `side='head'` matches added/modified code, `side='base'`
 * matches removed code (deleted methods/classes).
 */
export function pickModifiedSymbols(
  symbols: RepoSymbol[],
  changedByFile: Map<string, FileChangedLines>,
  side: 'head' | 'base'
): ModifiedSymbol[] {
  const out: ModifiedSymbol[] = [];
  for (const symbol of symbols) {
    if (!SYMBOL_KINDS.has(symbol.kind)) continue;
    const changed = changedByFile.get(symbol.filePath);
    if (!changed) continue;
    const spans = side === 'head' ? changed.newSpans : changed.oldSpans;
    const start = symbol.lineStart ?? 0;
    const end = symbol.lineEnd ?? start;
    const hit = spans.filter(([spanStart, spanEnd]) => start <= spanEnd && end >= spanStart);
    if (hit.length > 0) {
      out.push({
        symbol,
        side,
        changedLines: hit.flatMap(([spanStart, spanEnd]) => range(spanStart, spanEnd))
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reverse Reachability                                                */
/* ------------------------------------------------------------------ */

export interface ReachabilityImpact {
  /** 触发本影响的被修改方法。 */
  modified: ModifiedSymbol;
  /** 从路由方法到被修改方法的调用链（caller → callee，含两端）。 */
  chain: RepoSymbol[];
}

export interface ReachabilityHit {
  /** 受影响的路由方法（@RestController 内的方法）。 */
  routeMethod: RepoSymbol;
  /** 路由类符号（kind='route'）。 */
  routeClass: RepoSymbol;
  impacts: ReachabilityImpact[];
}

/**
 * Reverse Reachability：对每个被修改的方法符号，沿确定性调用边反向 BFS，
 * 找到所有能到达它的 @RestController 路由方法，并记录 route → … → modified
 * 的最短路径（BFS 前驱链）。
 *
 * `symbols` 是用于解析调用边的符号全集（head 或 base 版本）。未被任何路由
 * 方法到达的修改会放进 `uncovered`（可能是静态边界之外的调用方）。
 */
export function reverseReachability(
  symbols: RepoSymbol[],
  modified: ModifiedSymbol[]
): { hits: ReachabilityHit[]; uncovered: ModifiedSymbol[] } {
  const resolver = new CallResolver(symbols);
  const byId = new Map<string, RepoSymbol>();
  for (const symbol of symbols) {
    byId.set(symbolIdentity(symbol), symbol);
  }

  // calleeId → callerIds（确定性解析每条调用边）。
  const reverse = new Map<string, Set<string>>();
  for (const caller of symbols) {
    if (caller.kind !== 'method' && caller.kind !== 'route') continue;
    for (const call of caller.calls ?? []) {
      const resolved = resolver.resolve(caller, call);
      if (!('target' in resolved) || !resolved.target) continue;
      const calleeId = symbolIdentity(resolved.target);
      let callers = reverse.get(calleeId);
      if (!callers) {
        callers = new Set();
        reverse.set(calleeId, callers);
      }
      callers.add(symbolIdentity(caller));
    }
  }

  const routeClassByName = new Map(
    symbols.filter((symbol) => symbol.kind === 'route').map((symbol) => [symbol.name, symbol])
  );
  const routeMethodById = new Map<string, RepoSymbol>();
  for (const symbol of symbols) {
    if (
      symbol.kind === 'route' ||
      (symbol.kind === 'method' &&
        symbol.parentType &&
        routeClassByName.has(symbol.parentType))
    ) {
      routeMethodById.set(symbolIdentity(symbol), symbol);
    }
  }

  const hits: ReachabilityHit[] = [];
  const uncovered: ModifiedSymbol[] = [];
  const hitByRoute = new Map<string, ReachabilityHit>();

  for (const entry of modified) {
    const startId = symbolIdentity(entry.symbol);
    if (!byId.has(startId)) {
      // 该版本符号表中不存在此方法（例如 base 侧的类级修改）→ 无法做方法级反向。
      uncovered.push(entry);
      continue;
    }
    // BFS：从被修改方法向上，直到命中路由方法。
    const seen = new Set<string>([startId]);
    const queue: string[] = [startId];
    const parent = new Map<string, string | null>([[startId, null]]);
    let found: string | null = null;
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (routeMethodById.has(currentId)) {
        found = currentId;
        break;
      }
      for (const callerId of reverse.get(currentId) ?? []) {
        if (seen.has(callerId)) continue;
        seen.add(callerId);
        parent.set(callerId, currentId);
        queue.push(callerId);
      }
    }

    if (!found) {
      uncovered.push(entry);
      continue;
    }
    const pathIds: string[] = [];
    let cursor: string | null = found;
    while (cursor) {
      pathIds.push(cursor);
      cursor = parent.get(cursor)!;
    }
    const routeMethod = routeMethodById.get(found)!;
    const chain = pathIds
      .map((id) => byId.get(id))
      .filter((symbol): symbol is RepoSymbol => Boolean(symbol));
    let hit = hitByRoute.get(found);
    if (!hit) {
      const routeClass = routeMethod.parentType
        ? routeClassByName.get(routeMethod.parentType)
        : undefined;
      hit = {
        routeMethod,
        routeClass: routeClass ?? routeMethod,
        impacts: []
      };
      hitByRoute.set(found, hit);
      hits.push(hit);
    }
    hit.impacts.push({ modified: entry, chain });
  }

  return { hits, uncovered };
}

/* ------------------------------------------------------------------ */
/* 配置变更检测（仅键名与位置，永不输出值）                             */
/* ------------------------------------------------------------------ */

export interface ConfigChange {
  file: string;
  key: string;
  line: number;
  status: 'added' | 'modified' | 'removed';
}

export interface DiffImpactSummary {
  changedFiles: number;
  modifiedSymbols: number;
  affectedApis: number;
  configChanges: number;
  uncovered: number;
}

function isConfigFile(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  return (
    (name.startsWith('application') && (/\.ya?ml$/.test(name) || name.endsWith('.properties'))) ||
    name === 'pom.xml'
  );
}

function scanKeysFor(file: string, source: string): ScannedKey[] {
  const name = path.basename(file).toLowerCase();
  if (name === 'pom.xml') return scanPom(source);
  if (/\.ya?ml$/.test(name)) return scanYaml(source);
  return scanProperties(source);
}

function keysTouched(keys: ScannedKey[], touched: Set<number>): Array<{ key: string; line: number }> {
  return keys
    .filter((key) => {
      const start = key.lineStart;
      const end = key.lineEnd ?? start;
      for (let line = start; line <= end; line += 1) {
        if (touched.has(line)) return true;
      }
      return false;
    })
    .map((key) => ({ key: key.name, line: key.lineStart }));
}

/**
 * 找出变更配置文件里被改动的配置键。head 侧新增/修改的键、base 侧被删除的
 * 键都列入；同名键同时出现在两侧时标记为 modified。只使用精确的新增/删除
 * 行（不含 hunk 上下文行），避免把相邻未变键误报为变更。
 */
export async function detectConfigChanges(
  repoPath: string,
  base: string,
  head: string,
  changedByFile: Map<string, FileChangedLines>
): Promise<ConfigChange[]> {
  const changes: ConfigChange[] = [];
  for (const [file, changed] of changedByFile) {
    if (!isConfigFile(file)) continue;
    const touchedNew = new Set(changed.newAddLines);
    const touchedOld = new Set(changed.oldDelLines);

    const headKeys: Array<{ key: string; line: number }> = [];
    if (touchedNew.size > 0) {
      try {
        const headSource = await readGitFile(repoPath, head, file);
        headKeys.push(...keysTouched(scanKeysFor(file, headSource), touchedNew));
      } catch {
        // 文件在 head 不存在（被删除）→ 无新增键。
      }
    }

    const oldKeys: Array<{ key: string; line: number }> = [];
    if (touchedOld.size > 0) {
      try {
        const baseSource = await readGitFile(repoPath, base, file);
        oldKeys.push(...keysTouched(scanKeysFor(file, baseSource), touchedOld));
      } catch {
        // 文件在 base 不存在（新增）→ 无删除键。
      }
    }

    const headByName = new Map(headKeys.map((entry) => [entry.key, entry]));
    const oldByName = new Map(oldKeys.map((entry) => [entry.key, entry]));
    const allNames = [...new Set([...headByName.keys(), ...oldByName.keys()])].sort();
    for (const name of allNames) {
      const headEntry = headByName.get(name);
      const oldEntry = oldByName.get(name);
      if (headEntry && oldEntry) {
        changes.push({ file, key: name, line: headEntry.line, status: 'modified' });
      } else if (headEntry) {
        changes.push({ file, key: name, line: headEntry.line, status: 'added' });
      } else if (oldEntry) {
        changes.push({ file, key: name, line: oldEntry.line, status: 'removed' });
      }
    }
  }
  return changes.sort((a, b) =>
    a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.line - b.line
  );
}

/* ------------------------------------------------------------------ */
/* 分析编排                                                            */
/* ------------------------------------------------------------------ */

export interface ChangedFileEntry {
  path: string;
  status: GitStatus;
  java: boolean;
  /** v0.6.0 — any supported source file (Java/TS/Python/Go). */
  source: boolean;
  config: boolean;
}

export interface ModifiedSymbolEntry {
  kind: string;
  name: string;
  parentType?: string;
  file: string;
  line: number;
  side: 'head' | 'base';
  changedLines: number[];
}

export interface AffectedApiEntry {
  controller: string;
  routeMethod: string;
  httpPath?: string;
  file: string;
  line: number;
  /** Issue 29: route method annotations (e.g. `@PreAuthorize`) for auth policy. */
  annotations?: string[];
  /** Issue 29: controller class annotations for auth policy. */
  controllerAnnotations?: string[];
  /** 每个被修改方法一条影响。 */
  impacts: Array<{
    modifiedMethod: string;
    modifiedFile: string;
    modifiedLine: number;
    side: 'head' | 'base';
    /** route → … → modified 的方法名链。 */
    chain: string[];
  }>;
}

export interface DiffReport {
  schemaVersion: typeof PR_IMPACT_SCHEMA_VERSION;
  summary: DiffImpactSummary;
  repoPath: string;
  repoName: string;
  base: string;
  head: string;
  baseSha?: string;
  headSha?: string;
  changedFiles: ChangedFileEntry[];
  modifiedSymbols: ModifiedSymbolEntry[];
  affectedApis: AffectedApiEntry[];
  /** 被修改但未定位到上游 API 的方法（静态边界之外）。 */
  uncovered: Array<{ name: string; parentType?: string; file: string; line: number; side: 'head' | 'base' }>;
  configChanges: ConfigChange[];
  mermaid: string;
  /** Issue 29: pr-summary 门禁判定；`diff` 命令不附加。 */
  policy?: DiffPolicyResult;
  /** v0.6.0 — 路由增删 / 断边 / 风险分级 delta，供 Web 架构差异工作台消费。 */
  architectureDelta?: ArchitectureDeltaReport;
}

export interface AnalyzeDiffOptions {
  repoPath: string;
  base: string;
  head: string;
}

async function parseRefSymbols(
  repoPath: string,
  ref: string,
  files: string[]
): Promise<RepoSymbol[]> {
  const symbols: RepoSymbol[] = [];
  let index = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const file = files[index++];
      if (file === undefined) return;
      try {
        const source = await readGitFile(repoPath, ref, file);
        const adapter = adapterFor(file);
        if (adapter) {
          symbols.push(...adapter.parseSource(source, file, `diff-${ref}`));
        }
      } catch {
        // 单文件解析失败不阻断整体分析（与 indexRepo 的容错一致）。
      }
    }
  };
  const workers = Array.from(
    { length: Math.min(GIT_SHOW_CONCURRENCY, Math.max(files.length, 1)) },
    () => worker()
  );
  await Promise.all(workers);
  return symbols;
}

function toExtractedSymbol(symbol: RepoSymbol): ExtractedSymbol {
  return {
    name: symbol.name,
    file: symbol.filePath,
    lineStart: symbol.lineStart ?? 1,
    lineEnd: symbol.lineEnd ?? symbol.lineStart ?? 1,
    kind: symbol.kind,
    parentType: symbol.parentType,
    displayPath: symbol.displayPath
  };
}

function deltaRouteKey(symbol: RepoSymbol): string {
  return `${symbol.filePath}:${symbol.parentType ?? ''}:${symbol.name}:${symbol.displayPath ?? ''}`;
}

function riskLevelFor(affectedBySymbols: string[], maxChainLength: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (affectedBySymbols.length >= 3 || maxChainLength >= 3) return 'HIGH';
  if (affectedBySymbols.length === 2) return 'MEDIUM';
  return 'LOW';
}

function buildDeltaMermaid(delta: {
  addedRoutes: ExtractedSymbol[];
  removedRoutes: ExtractedSymbol[];
  brokenEdges: CallEdge[];
}): string {
  const nodeLines: string[] = [];
  const edgeLines: string[] = [];
  const nodeIds = new Map<string, string>();
  let counter = 0;
  const idFor = (key: string, label: string): string => {
    let id = nodeIds.get(key);
    if (!id) {
      counter += 1;
      id = `n${counter}`;
      nodeIds.set(key, id);
      nodeLines.push(`    ${id}["${escapeHtml(label)}"]`);
    }
    return id;
  };

  for (const route of delta.addedRoutes) {
    const label = `🟢 ${route.parentType ? `${route.parentType}.` : ''}${route.name}${route.displayPath ? ` ${route.displayPath}` : ''} @ ${route.file}:${route.lineStart}`;
    idFor(`added:${route.file}:${route.lineStart}:${route.name}`, label);
  }
  for (const route of delta.removedRoutes) {
    const label = `🔴 ${route.parentType ? `${route.parentType}.` : ''}${route.name}${route.displayPath ? ` ${route.displayPath}` : ''} @ ${route.file}:${route.lineStart}`;
    idFor(`removed:${route.file}:${route.lineStart}:${route.name}`, label);
  }
  for (const edge of delta.brokenEdges) {
    const fromKey = `from:${edge.from.file}:${edge.from.line}:${edge.from.method}`;
    const toKey = `to:${edge.to.file}:${edge.to.line}:${edge.to.method}`;
    const fromId = idFor(fromKey, `${edge.from.method} @ ${edge.from.file}:${edge.from.line}`);
    const toId = idFor(toKey, `${edge.to.method} @ ${edge.to.file}:${edge.to.line}`);
    edgeLines.push(`    ${fromId} -. 断链 .-> ${toId}`);
  }

  if (nodeLines.length === 0 && edgeLines.length === 0) {
    return '```mermaid\ngraph TD\n    empty["无架构差异"]\n```';
  }
  // v0.8: every edge in the delta graph is a broken edge — paint them red.
  const styleLines = edgeLines.map((_, i) => `    linkStyle ${i} stroke:#f7768e,stroke-width:2px,color:#f7768e;`);
  return ['```mermaid', 'graph TD', ...nodeLines, ...edgeLines, ...styleLines, '```'].join('\n');
}

/**
 * v0.6.0 — Architecture Delta：以 base/head 两个完整符号表对比路由增删，
 * 收集 head 中无法静态解析的调用断边，并按波及符号数 / 链路长度给受影响
 * API 分级。全部来自 git 对象，只读。
 */
export function buildArchitectureDelta(
  report: Pick<
    DiffReport,
    'base' | 'head' | 'baseSha' | 'headSha' | 'affectedApis'
  >,
  baseSymbols: RepoSymbol[],
  headSymbols: RepoSymbol[]
): ArchitectureDeltaReport {
  const baseRoutes = new Map<string, RepoSymbol>();
  const headRoutes = new Map<string, RepoSymbol>();
  for (const symbol of baseSymbols) {
    if (symbol.kind === 'route') baseRoutes.set(deltaRouteKey(symbol), symbol);
  }
  for (const symbol of headSymbols) {
    if (symbol.kind === 'route') headRoutes.set(deltaRouteKey(symbol), symbol);
  }

  const addedRoutes: ExtractedSymbol[] = [];
  for (const [key, symbol] of headRoutes) {
    if (!baseRoutes.has(key)) addedRoutes.push(toExtractedSymbol(symbol));
  }
  const removedRoutes: ExtractedSymbol[] = [];
  for (const [key, symbol] of baseRoutes) {
    if (!headRoutes.has(key)) removedRoutes.push(toExtractedSymbol(symbol));
  }

  const resolver = new CallResolver(headSymbols);
  const brokenEdges: CallEdge[] = [];
  for (const caller of headSymbols) {
    if (caller.kind !== 'method' && caller.kind !== 'route') continue;
    for (const call of caller.calls ?? []) {
      const result = resolver.resolve(caller, call);
      if ('reason' in result) {
        brokenEdges.push({
          from: {
            file: caller.filePath,
            method: caller.name,
            line: call.line ?? caller.lineStart ?? 1
          },
          to: {
            file: call.file,
            method: call.method,
            line: call.line ?? caller.lineStart ?? 1
          }
        });
      }
    }
  }

  const impactedApis = report.affectedApis.map((api) => {
    const affectedBySymbols = [
      ...new Set(api.impacts.map((impact) => impact.modifiedMethod))
    ].sort((a, b) => a.localeCompare(b));
    const maxChainLength = api.impacts.reduce(
      (max, impact) => Math.max(max, impact.chain.length),
      0
    );
    return {
      routeSymbol: {
        name: api.routeMethod,
        file: api.file,
        lineStart: api.line,
        lineEnd: api.line,
        kind: 'route',
        parentType: api.controller,
        displayPath: api.httpPath
      } satisfies ExtractedSymbol,
      affectedBySymbols,
      riskLevel: riskLevelFor(affectedBySymbols, maxChainLength)
    };
  });

  const delta: ArchitectureDeltaReport = {
    schemaVersion: ARCHITECTURE_DELTA_SCHEMA_VERSION,
    base: report.base,
    head: report.head,
    baseSha: report.baseSha,
    headSha: report.headSha,
    addedRoutes: addedRoutes.sort((a, b) => a.file.localeCompare(b.file) || a.lineStart - b.lineStart),
    removedRoutes: removedRoutes.sort((a, b) => a.file.localeCompare(b.file) || a.lineStart - b.lineStart),
    brokenEdges,
    impactedApis,
    mermaid: buildDeltaMermaid({ addedRoutes, removedRoutes, brokenEdges })
  };
  return delta;
}

/**
 * 主入口：读取 base→head 的 diff，计算修改符号与受影响 API，组装报告。
 */
export async function analyzeDiff(options: AnalyzeDiffOptions): Promise<DiffReport> {
  const repoPath = path.resolve(options.repoPath);
  const rootStat = await fs.stat(repoPath).catch(() => null);
  if (!rootStat?.isDirectory()) {
    throw new Error(`repo path is not a directory: ${options.repoPath}`);
  }

  const [statuses, diffText, baseSha, headSha] = await Promise.all([
    getDiffStatus(repoPath, options.base, options.head),
    getDiffText(repoPath, options.base, options.head),
    shortSha(repoPath, options.base),
    shortSha(repoPath, options.head)
  ]);

  const fileDiffs = parseUnifiedDiff(diffText);
  const changedByFile = new Map<string, FileChangedLines>();
  for (const fileDiff of fileDiffs) {
    changedByFile.set(fileDiff.path, changedLinesFor(fileDiff));
  }

  const sourceChanged = statuses.filter((status) =>
    SOURCE_EXTENSIONS.has(path.extname(status.path).toLowerCase())
  );
  const changedSourcePaths = new Set(sourceChanged.map((status) => status.path));

  // head 符号全集（反向可达性需要全量调用边）。
  const headSourceFiles = (await listGitFiles(repoPath, options.head)).filter((file) =>
    SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())
  );
  const headSymbols = await parseRefSymbols(repoPath, options.head, headSourceFiles);

  const headModified = pickModifiedSymbols(headSymbols, changedByFile, 'head').filter((entry) =>
    changedSourcePaths.has(entry.symbol.filePath)
  );

  // base 符号全集：v0.6.0 还需要全量路由表做 Architecture Delta 的路由增删
  // 对比，同时支持删除符号的反向分析。
  const baseSourceFiles = (await listGitFiles(repoPath, options.base)).filter((file) =>
    SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())
  );
  const baseSymbols = await parseRefSymbols(repoPath, options.base, baseSourceFiles);
  const baseSymbolsOfChanged = baseSymbols.filter((symbol) =>
    changedSourcePaths.has(symbol.filePath)
  );
  // 以 (file, kind, parentType, name) 判定“head 中仍存在”——行号位移不算删除，
  // 只有真正消失的符号才需要 base 图做反向分析。
  const presenceKey = (symbol: RepoSymbol): string =>
    `${symbol.filePath}:${symbol.kind}:${symbol.parentType ?? ''}:${symbol.name}`;
  const headPresence = new Set(headSymbols.map(presenceKey));
  const baseModified = pickModifiedSymbols(baseSymbolsOfChanged, changedByFile, 'base')
    .filter((entry) => !headPresence.has(presenceKey(entry.symbol)))
    .filter((entry) => changedSourcePaths.has(entry.symbol.filePath));

  // 反向可达性：head 侧用 head 图；base 侧（删除）用 base 图。
  const reachableModified = headModified.filter((entry) => entry.symbol.kind === 'method');
  const headReach = reverseReachability(headSymbols, reachableModified);

  let baseReach: { hits: ReachabilityHit[]; uncovered: ModifiedSymbol[] } = {
    hits: [],
    uncovered: []
  };
  const baseModifiedMethods = baseModified.filter((entry) => entry.symbol.kind === 'method');
  if (baseModifiedMethods.length > 0) {
    baseReach = reverseReachability(baseSymbols, baseModifiedMethods);
  }

  // 合并 hits → 受影响的 API 表。
  const affectedApis: AffectedApiEntry[] = [];
  const mergeHits = (hits: ReachabilityHit[]) => {
    for (const hit of hits) {
      const existing = affectedApis.find(
        (entry) =>
          entry.controller === hit.routeClass.name &&
          entry.routeMethod === hit.routeMethod.name &&
          entry.file === hit.routeMethod.filePath
      );
      const impacts = hit.impacts.map((impact) => ({
        modifiedMethod: impact.modified.symbol.name,
        modifiedFile: impact.modified.symbol.filePath,
        modifiedLine: impact.modified.symbol.lineStart ?? 1,
        side: impact.modified.side,
        chain: impact.chain.map((symbol) => symbol.name)
      }));
      if (existing) {
        existing.impacts.push(...impacts);
      } else {
        affectedApis.push({
          controller: hit.routeClass.name,
          routeMethod: hit.routeMethod.name,
          httpPath: hit.routeMethod.displayPath,
          file: hit.routeMethod.filePath,
          line: hit.routeMethod.lineStart ?? 1,
          annotations: hit.routeMethod.annotations,
          controllerAnnotations: hit.routeClass.annotations,
          impacts
        });
      }
    }
  };
  mergeHits(headReach.hits);
  mergeHits(baseReach.hits);
  affectedApis.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.routeMethod.localeCompare(b.routeMethod)
  );

  const uncovered = [...headReach.uncovered, ...baseReach.uncovered].map((entry) => ({
    name: entry.symbol.name,
    parentType: entry.symbol.parentType,
    file: entry.symbol.filePath,
    line: entry.symbol.lineStart ?? 1,
    side: entry.side
  }));

  const configChanges = await detectConfigChanges(
    repoPath,
    options.base,
    options.head,
    changedByFile
  );

  const modifiedSymbols: ModifiedSymbolEntry[] = [
    ...headModified.map((entry) => ({
      kind: entry.symbol.kind,
      name: entry.symbol.name,
      parentType: entry.symbol.parentType,
      file: entry.symbol.filePath,
      line: entry.symbol.lineStart ?? 1,
      side: entry.side as 'head' | 'base',
      changedLines: entry.changedLines
    })),
    ...baseModified.map((entry) => ({
      kind: entry.symbol.kind,
      name: entry.symbol.name,
      parentType: entry.symbol.parentType,
      file: entry.symbol.filePath,
      line: entry.symbol.lineStart ?? 1,
      side: entry.side as 'head' | 'base',
      changedLines: entry.changedLines
    }))
  ].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const architectureDelta = buildArchitectureDelta(
    {
      base: options.base,
      head: options.head,
      baseSha,
      headSha,
      affectedApis
    },
    baseSymbols,
    headSymbols
  );

  return {
    schemaVersion: PR_IMPACT_SCHEMA_VERSION,
    summary: {
      changedFiles: statuses.length,
      modifiedSymbols: modifiedSymbols.length,
      affectedApis: affectedApis.length,
      configChanges: configChanges.length,
      uncovered: uncovered.length
    },
    repoPath,
    repoName: path.basename(repoPath),
    base: options.base,
    head: options.head,
    baseSha,
    headSha,
    changedFiles: statuses
      .map((status) => ({
        path: status.path,
        status: status.status,
        java: status.path.endsWith('.java'),
        source: SOURCE_EXTENSIONS.has(path.extname(status.path).toLowerCase()),
        config: isConfigFile(status.path)
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    modifiedSymbols,
    affectedApis,
    uncovered,
    configChanges,
    mermaid: buildMermaid({ affectedApis }),
    architectureDelta
  };
}

/* ------------------------------------------------------------------ */
/* 反向 Mermaid 链路                                                    */
/* ------------------------------------------------------------------ */

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface MermaidNode {
  /** 路由入口：Controller.method + HTTP 路径。 */
  routeLabel?: string;
  /** 普通方法：ClassName.method。 */
  methodLabel?: string;
  file: string;
  line: number;
  modified?: boolean;
  deleted?: boolean;
}

function mermaidNodeText(node: MermaidNode): string {
  const parts: string[] = [];
  if (node.routeLabel) {
    parts.push(node.routeLabel);
  } else if (node.methodLabel) {
    parts.push(node.methodLabel);
  }
  parts.push(`${node.file}:${node.line}`);
  if (node.modified) parts.push('🔴 修改');
  if (node.deleted) parts.push('🗑 删除');
  return parts
    .filter(Boolean)
    .map((part) => escapeHtml(String(part)))
    .join('<br/>')
    .replace(/"/g, '&quot;');
}

export function buildMermaid(input: { affectedApis: AffectedApiEntry[] }): string {
  const nodeLines: string[] = [];
  const edgeLines: string[] = [];
  const classed = new Set<string>();
  const deleted = new Set<string>();
  const nodeIds = new Map<string, string>();
  let nodeCounter = 0;

  const nodeIdFor = (key: string, node: MermaidNode): string => {
    let id = nodeIds.get(key);
    if (!id) {
      nodeCounter += 1;
      id = `n${nodeCounter}`;
      nodeIds.set(key, id);
      nodeLines.push(`    ${id}["${mermaidNodeText(node)}"]`);
    }
    return id;
  };

  for (const api of input.affectedApis) {
    for (const impact of api.impacts) {
      const chain = impact.chain;
      if (chain.length === 0) continue;
      const ids: string[] = [];
      for (let index = 0; index < chain.length; index += 1) {
        const methodName = chain[index];
        const isRoute = index === 0;
        const isModified = index === chain.length - 1;
        const file = isRoute ? api.file : isModified ? impact.modifiedFile : '';
        const line = isRoute ? api.line : isModified ? impact.modifiedLine : 1;
        // 中间节点 key 加入链内位置：同名方法（如 findById）在不同层级/链中
        // 应各自成节点，避免共 key 合并产生 n5 --> n5 自环。
        const key = `${file}:${line}:${methodName}:${isRoute ? 'route' : isModified ? 'mod' : `mid-${index}`}`;
        const node: MermaidNode = { file, line };
        if (isRoute) {
          node.routeLabel = `${api.controller}.${methodName}${api.httpPath ? ` ${api.httpPath}` : ''}`;
        } else {
          node.methodLabel = methodName;
          if (isModified) {
            node.modified = impact.side === 'head';
            node.deleted = impact.side === 'base';
          }
        }
        const id = nodeIdFor(key, node);
        if (node.modified) classed.add(id);
        if (node.deleted) deleted.add(id);
        ids.push(id);
      }
      for (let index = 0; index + 1 < ids.length; index += 1) {
        edgeLines.push(`    ${ids[index]} --> ${ids[index + 1]}`);
      }
    }
  }

  const lines = [
    '```mermaid',
    'graph TD',
    '    classDef mod fill:#fde2e2,stroke:#c0392b,color:#111;',
    '    classDef del fill:#e8e8e8,stroke:#7f8c8d,stroke-dasharray:4 2,color:#555;',
    ...nodeLines,
    ...edgeLines,
    ...[...classed].map((id) => `    class ${id} mod`),
    ...[...deleted].map((id) => `    class ${id} del`),
    '```'
  ];
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Markdown 报告渲染                                                    */
/* ------------------------------------------------------------------ */

const AUTH_ANNOTATION_RE =
  /@(?:PreAuthorize|Secured|RolesAllowed|Authenticated|Login|RequiresPermissions|RequiresAuthentication|RequiresUser|CheckPermission|SaCheckLogin|SaCheckPermission)\b/i;

const SENSITIVE_ROUTE_RE =
  /(admin|user|account|payment|billing|token|secret|credential|password|config|auth|login|permission)/i;

function hasAuthAnnotation(annotations: string[] | undefined): boolean {
  return (annotations ?? []).some((text) => AUTH_ANNOTATION_RE.test(text));
}

function isAuthProtected(api: AffectedApiEntry): boolean {
  return hasAuthAnnotation(api.annotations) || hasAuthAnnotation(api.controllerAnnotations);
}

function isSensitiveRoute(api: AffectedApiEntry): boolean {
  const haystack = [api.httpPath ?? '', api.routeMethod, api.controller].join(' ');
  return SENSITIVE_ROUTE_RE.test(haystack);
}

function routeLabel(api: AffectedApiEntry): string {
  return `${api.controller}.${api.routeMethod}${api.httpPath ? ` ${api.httpPath}` : ''} @ ${api.file}:${api.line}`;
}

/**
 * Issue 29 — deterministic gate evaluation for `pr-summary`. Every enabled
 * rule either contributes concrete violations or stays silent, so CI gets a
 * stable PASS/FAIL verdict with Markdown-ready diagnostics.
 */
export function evaluateDiffPolicy(
  report: DiffReport,
  options: DiffPolicyOptions
): DiffPolicyResult {
  const violations: PolicyViolation[] = [];

  if (
    options.maxAffectedRoutes !== undefined &&
    options.maxAffectedRoutes >= 0 &&
    report.affectedApis.length > options.maxAffectedRoutes
  ) {
    violations.push({
      rule: 'max-affected-routes',
      message: `受影响路由数 ${report.affectedApis.length} 超过上限 ${options.maxAffectedRoutes}`,
      details: report.affectedApis.map(routeLabel)
    });
  }

  if (options.failOnBreak && report.uncovered.length > 0) {
    violations.push({
      rule: 'broken-chain',
      message: `${report.uncovered.length} 个被修改符号无法经静态调用边到达任何路由`,
      details: report.uncovered.map(
        (entry) =>
          `${entry.parentType ? `${entry.parentType}.` : ''}${entry.name} @ ${entry.file}:${entry.line} (${entry.side === 'head' ? '新增/修改' : '删除'})`
      )
    });
  }

  if (options.failOnAuthImpact) {
    const unprotected = report.affectedApis.filter(
      (api) => isSensitiveRoute(api) && !isAuthProtected(api)
    );
    if (unprotected.length > 0) {
      violations.push({
        rule: 'auth-impact',
        message: `${unprotected.length} 个受影响的敏感路由缺少鉴权注解`,
        details: unprotected.map(routeLabel)
      });
    }
  }

  return {
    status: violations.length > 0 ? 'FAIL' : 'PASS',
    violations
  };
}

/** Issue 29: standalone Markdown verdict block for a gate result. */
export function renderPolicyMarkdown(result: DiffPolicyResult): string {
  const lines = ['## 门禁判定', ''];
  if (result.status === 'PASS') {
    lines.push('**PASS** — 未触发任何策略违规。');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(`**FAIL** — ${result.violations.length} 项策略违规：`);
  lines.push('');
  for (const violation of result.violations) {
    lines.push(`### ${violation.rule}`);
    lines.push('');
    lines.push(`- ${violation.message}`);
    for (const detail of violation.details) {
      lines.push(`  - \`${detail}\``);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function refLabel(report: DiffReport): string {
  const fmt = (ref: string, sha?: string) => (sha ? `${ref} (${sha})` : ref);
  return `${fmt(report.base, report.baseSha)} → ${fmt(report.head, report.headSha)}`;
}

export function renderMarkdown(report: DiffReport): string {
  const changed = report.changedFiles;
  const counts = { A: 0, M: 0, D: 0, R: 0, C: 0, U: 0 } as Record<string, number>;
  for (const file of changed) counts[file.status] = (counts[file.status] ?? 0) + 1;
  const javaCount = changed.filter((file) => file.java).length;
  const configCount = changed.filter((file) => file.config).length;

  const lines: string[] = [];
  lines.push('# PR 架构影响面分析');
  lines.push('');
  lines.push(`- 仓库：\`${report.repoName}\`（\`${report.repoPath}\`）`);
  lines.push(`- 变更范围：${refLabel(report)}`);
  lines.push(
    `- 变更文件：${changed.length}（新增 ${counts.A} / 修改 ${counts.M} / 删除 ${counts.D}；Java ${javaCount}，配置 ${configCount}）`
  );
  lines.push('');

  // 1. 修改符号
  lines.push('## 1. 修改的 Java 符号');
  lines.push('');
  if (report.modifiedSymbols.length === 0) {
    lines.push('_未检测到 Java 类/方法级修改。_');
    lines.push('');
  } else {
    lines.push('| 类型 | 符号 | 位置 | 变更行 | 状态 |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const entry of report.modifiedSymbols) {
      const symbolName = entry.parentType ? `${entry.parentType}.${entry.name}` : entry.name;
      const changedLines =
        entry.changedLines.length <= 6
          ? entry.changedLines.join(', ')
          : `${entry.changedLines[0]}–${entry.changedLines[entry.changedLines.length - 1]} (${entry.changedLines.length} 行)`;
      lines.push(
        `| ${entry.kind} | \`${symbolName}\` | \`${entry.file}:${entry.line}\` | ${changedLines} | ${entry.side === 'head' ? '新增/修改' : '删除'} |`
      );
    }
    lines.push('');
  }

  // 2. 受影响 API
  lines.push('## 2. 受影响 API（Reverse Reachability）');
  lines.push('');
  if (report.affectedApis.length === 0) {
    lines.push('_未发现受波及的 @RestController 路由入口。_');
    lines.push('');
  } else {
    lines.push('| 路由入口 | HTTP 路径 | Controller | 位置 | 波及链路 |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const api of report.affectedApis) {
      const paths = api.httpPath ? `\`${api.httpPath}\`` : '—';
      const chains = api.impacts
        .map((impact) => `\`${impact.chain.join(' → ')}\``)
        .join('<br/>');
      lines.push(
        `| \`${api.routeMethod}\` | ${paths} | \`${api.controller}\` | \`${api.file}:${api.line}\` | ${chains} |`
      );
    }
    lines.push('');
  }

  if (report.uncovered.length > 0) {
    lines.push('### 未定位到上游 API 的修改');
    lines.push('');
    lines.push(
      `以下修改无法经静态调用边到达任何 @RestController（调用方在静态边界之外，或为新增未接线的代码）：`
    );
    lines.push('');
    for (const entry of report.uncovered) {
      const name = entry.parentType ? `${entry.parentType}.${entry.name}` : entry.name;
      lines.push(`- \`${name}\` — \`${entry.file}:${entry.line}\`（${entry.side === 'head' ? '新增/修改' : '删除'}）`);
    }
    lines.push('');
  }

  // 3. 反向调用链
  lines.push('## 3. 反向调用链');
  lines.push('');
  if (report.affectedApis.length === 0) {
    lines.push('_无可渲染的调用链。_');
    lines.push('');
  } else {
    lines.push(report.mermaid);
    lines.push('');
  }

  // 4. 配置变更
  lines.push('## 4. 配置变更提示');
  lines.push('');
  if (report.configChanges.length === 0) {
    lines.push('_本次变更未触及配置文件（application*.yml/.properties/pom.xml）。_');
    lines.push('');
  } else {
    lines.push('| 文件 | 配置键 | 位置 | 状态 |');
    lines.push('| --- | --- | --- | --- |');
    for (const change of report.configChanges) {
      const statusText =
        change.status === 'added' ? '新增' : change.status === 'removed' ? '删除' : '修改';
      lines.push(`| \`${change.file}\` | \`${change.key}\` | ${change.line} | ${statusText} |`);
    }
    lines.push('');
  }

  if (report.policy) {
    lines.push(renderPolicyMarkdown(report.policy));
  }

  lines.push('---');
  lines.push('> 由 CodeCompass `codecompass diff` 生成 · 配置仅报告键名与位置，值永不输出。');
  lines.push('');
  return lines.join('\n');
}
