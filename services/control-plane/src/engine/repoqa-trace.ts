import type { RepoSymbol } from '../ingest/repoqa-repos';
import {
  buildCallIndex,
  buildFullCallersIndex,
  CallResolver,
  symbolIdentity,
  STATIC_ANALYSIS_BREAK_DYNAMIC,
  STATIC_ANALYSIS_BREAK_EXTERNAL,
  type SymbolIndex
} from './repoqa-callchain';

/**
 * v1.4 票 05 — `codecompass trace`: terminal call tree around one symbol.
 *
 * Walks the deterministic symbol graph in both directions (who calls me /
 * what I call) and renders it as a text tree. Same resolution rule as every
 * other engine surface (`resolveCallEdge`); unresolved edges are counted as
 * static-analysis breaks instead of being guessed, per ADR-0002.
 */

export interface TraceBreakCounts {
  external: number;
  unresolved: number;
  dynamic: number;
}

export interface TraceNode {
  name: string;
  file: string;
  line: number;
  kind: RepoSymbol['kind'];
  /** Set when the node is not expanded here: 'cycle' or 'shown-above'. */
  note?: 'cycle' | 'shown-above';
  children: TraceNode[];
}

export interface TraceWalk {
  roots: TraceNode[];
  /** Unique symbols rendered in this direction (notes included). */
  nodeCount: number;
}

export interface TraceResult {
  target: { name: string; file: string; line: number; kind: RepoSymbol['kind'] };
  depths: { up: number; down: number };
  up: TraceWalk;
  down: TraceWalk;
  breaks: TraceBreakCounts;
}

export interface TraceTargetQuery {
  /** Symbol name, or a file path fragment when `filter` is set. */
  query: string;
  /** `-f <name>`: treat `query` as a file path and pick the symbol in it. */
  filter?: string;
}

export type TraceTargetResult =
  | { ok: true; symbol: RepoSymbol }
  | { ok: false; reason: 'no-match' | 'ambiguous'; candidates: RepoSymbol[] };

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

/** Test-only path heuristic — mirrors `isTestPath` in the callchain engine. */
function looksLikeTestPath(filePath: string): boolean {
  const p = normalizePath(filePath);
  return (
    p.includes('/test/') ||
    p.includes('/tests/') ||
    p.includes('.test.') ||
    p.includes('.spec.') ||
    p.endsWith('_test.go')
  );
}

function byFileLine(a: RepoSymbol, b: RepoSymbol): number {
  return (
    a.filePath.localeCompare(b.filePath) ||
    (a.lineStart ?? 1) - (b.lineStart ?? 1) ||
    a.name.localeCompare(b.name)
  );
}

function pickTarget(candidates: RepoSymbol[]): TraceTargetResult {
  if (candidates.length === 0) return { ok: false, reason: 'no-match', candidates: [] };
  const production = candidates.filter((symbol) => !looksLikeTestPath(symbol.filePath));
  const pool = production.length > 0 ? production : candidates;
  if (pool.length === 1) return { ok: true, symbol: pool[0] };
  const sorted = [...pool].sort(byFileLine);
  // Overloads share one file+name; that is a legal single target, not ambiguity.
  const files = new Set(sorted.map((symbol) => normalizePath(symbol.filePath)));
  if (files.size === 1) return { ok: true, symbol: sorted[0] };
  return { ok: false, reason: 'ambiguous', candidates: sorted.slice(0, 12) };
}

/**
 * Resolve what the user pointed at. `-f <name>` turns the positional into a
 * file path (fragment ok) and the flag into the symbol name inside it; without
 * it the positional is a symbol name, with the worker's own resolver result as
 * the preferred answer.
 */
export function resolveTraceTarget(
  symbols: RepoSymbol[],
  input: TraceTargetQuery,
  fallback?: RepoSymbol
): TraceTargetResult {
  const query = input.query.trim();
  const filter = input.filter?.trim();
  if (filter) {
    const fileQuery = normalizePath(query);
    const inFile = symbols.filter(
      (symbol) => symbol.kind === 'method' && normalizePath(symbol.filePath).includes(fileQuery)
    );
    if (inFile.length === 0) return { ok: false, reason: 'no-match', candidates: [] };
    const name = filter.toLowerCase();
    const tiers = [
      inFile.filter((symbol) => symbol.name.toLowerCase() === name),
      inFile.filter((symbol) => symbol.name.toLowerCase().startsWith(name)),
      inFile.filter((symbol) => symbol.name.toLowerCase().includes(name))
    ];
    return pickTarget(tiers.find((tier) => tier.length > 0) ?? []);
  }
  if (fallback) return { ok: true, symbol: fallback };
  const name = query.toLowerCase();
  return pickTarget(
    symbols.filter((symbol) => symbol.kind === 'method' && symbol.name.toLowerCase() === name)
  );
}

function classifyBreak(reason: string): keyof TraceBreakCounts {
  if (reason.includes(STATIC_ANALYSIS_BREAK_DYNAMIC)) return 'dynamic';
  if (reason.includes(STATIC_ANALYSIS_BREAK_EXTERNAL)) return 'external';
  return 'unresolved';
}

function nodeOf(symbol: RepoSymbol, note?: TraceNode['note']): TraceNode {
  return {
    name: symbol.name,
    file: symbol.filePath,
    line: symbol.lineStart ?? 1,
    kind: symbol.kind,
    ...(note ? { note } : {}),
    children: []
  };
}

function sortNodes(nodes: TraceNode[]): void {
  nodes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name));
}

export function buildTraceResult(
  symbols: RepoSymbol[],
  target: RepoSymbol,
  index?: SymbolIndex,
  options: { up?: number; down?: number } = {}
): TraceResult {
  const up = Math.max(0, Math.min(5, options.up ?? 1));
  const down = Math.max(0, Math.min(5, options.down ?? 2));
  const resolvedIndex = index ?? buildCallIndex(symbols);
  const resolver = new CallResolver(symbols, resolvedIndex);
  const full = buildFullCallersIndex(symbols, resolvedIndex);
  const breaks: TraceBreakCounts = { external: 0, unresolved: 0, dynamic: 0 };

  const downExpanded = new Set<string>();
  const downWalk = (symbol: RepoSymbol, depth: number, path: Set<string>): TraceNode => {
    const node = nodeOf(symbol);
    const id = symbolIdentity(symbol);
    if (depth <= 0) return node;
    if (path.has(id)) return nodeOf(symbol, 'cycle');
    const nextPath = new Set(path);
    nextPath.add(id);
    const seen = new Set<string>();
    for (const call of symbol.calls ?? []) {
      // Value references are not calls (Issue 22) — a trace is a call sequence.
      if (call.reference) continue;
      const resolved = resolver.resolve(symbol, call);
      if (!('target' in resolved)) {
        breaks[classifyBreak(resolved.reason)] += 1;
        continue;
      }
      const child = resolved.target;
      const childId = symbolIdentity(child);
      if (seen.has(childId)) continue;
      seen.add(childId);
      if (nextPath.has(childId)) {
        node.children.push(nodeOf(child, 'cycle'));
        continue;
      }
      if (downExpanded.has(childId)) {
        node.children.push(nodeOf(child, 'shown-above'));
        continue;
      }
      downExpanded.add(childId);
      node.children.push(downWalk(child, depth - 1, nextPath));
    }
    sortNodes(node.children);
    return node;
  };

  const upExpanded = new Set<string>();
  const upWalk = (symbol: RepoSymbol, depth: number, path: Set<string>): TraceNode => {
    const node = nodeOf(symbol);
    const id = symbolIdentity(symbol);
    if (depth <= 0) return node;
    if (path.has(id)) return nodeOf(symbol, 'cycle');
    const nextPath = new Set(path);
    nextPath.add(id);
    const callers = full.callersOf.get(id) ?? [];
    const seen = new Set<string>();
    const sorted = [...callers].sort(byFileLine);
    for (const caller of sorted) {
      const callerId = symbolIdentity(caller);
      if (seen.has(callerId)) continue;
      seen.add(callerId);
      if (nextPath.has(callerId)) {
        node.children.push(nodeOf(caller, 'cycle'));
        continue;
      }
      if (upExpanded.has(callerId)) {
        node.children.push(nodeOf(caller, 'shown-above'));
        continue;
      }
      upExpanded.add(callerId);
      node.children.push(upWalk(caller, depth - 1, nextPath));
    }
    sortNodes(node.children);
    return node;
  };

  downExpanded.add(symbolIdentity(target));
  upExpanded.add(symbolIdentity(target));
  const upRoots = upWalk(target, up, new Set());
  const downRoots = downWalk(target, down, new Set());
  // The walk roots carry the target itself; expose children as the trees.
  const collect = (node: TraceNode): number =>
    1 + node.children.reduce((sum, child) => sum + collect(child), 0);

  return {
    target: {
      name: target.name,
      file: target.filePath,
      line: target.lineStart ?? 1,
      kind: target.kind
    },
    depths: { up, down },
    up: {
      roots: upRoots.children,
      nodeCount: upRoots.children.reduce((sum, child) => sum + collect(child), 0)
    },
    down: {
      roots: downRoots.children,
      nodeCount: downRoots.children.reduce((sum, child) => sum + collect(child), 0)
    },
    breaks
  };
}

export interface RenderTraceOptions {
  /** Pure-ASCII box art (`--ascii`) instead of box-drawing characters. */
  ascii?: boolean;
}

const GLYPHS = {
  unicode: { branch: '├─ ', last: '└─ ', cont: '│  ', blank: '   ', note: (note: string) => ` (${note})` },
  ascii: { branch: '|-- ', last: '`-- ', cont: '|   ', blank: '    ', note: (note: string) => ` (${note})` }
} as const;

function renderWalk(walk: TraceWalk, depth: number, options: RenderTraceOptions): string[] {
  const glyphs = options.ascii ? GLYPHS.ascii : GLYPHS.unicode;
  const lines: string[] = [];
  const render = (nodes: TraceNode[], prefix: string): void => {
    nodes.forEach((node, index) => {
      const isLast = index === nodes.length - 1;
      const connector = isLast ? glyphs.last : glyphs.branch;
      const note = node.note ? glyphs.note(node.note) : '';
      lines.push(`${prefix}${connector}${node.name} — ${node.file}:${node.line}${note}`);
      render(node.children, `${prefix}${isLast ? glyphs.blank : glyphs.cont}`);
    });
  };
  render(walk.roots, '');
  if (lines.length === 0) lines.push('(none)');
  return lines;
}

export function renderTraceTree(result: TraceResult, options: RenderTraceOptions = {}): string {
  const lines: string[] = [];
  lines.push(
    `${result.target.name} — ${result.target.file}:${result.target.line} (${result.target.kind})`
  );
  lines.push('');
  lines.push(`Upstream (callers, depth ${result.depths.up}): ${result.up.nodeCount} node(s)`);
  lines.push(...renderWalk(result.up, result.depths.up, options));
  lines.push('');
  lines.push(`Downstream (callees, depth ${result.depths.down}): ${result.down.nodeCount} node(s)`);
  lines.push(...renderWalk(result.down, result.depths.down, options));
  const breakParts: string[] = [];
  if (result.breaks.external > 0) breakParts.push(`EXTERNAL x${result.breaks.external}`);
  if (result.breaks.dynamic > 0) breakParts.push(`DYNAMIC x${result.breaks.dynamic}`);
  if (result.breaks.unresolved > 0) breakParts.push(`UNRESOLVED x${result.breaks.unresolved}`);
  lines.push('');
  lines.push(
    breakParts.length > 0
      ? `Static analysis breaks: ${breakParts.join(', ')}`
      : 'Static analysis breaks: none'
  );
  return lines.join('\n');
}
