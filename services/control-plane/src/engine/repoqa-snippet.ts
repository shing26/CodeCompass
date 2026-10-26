import { parseTypeScriptSource } from '../languages/TypeScriptAdapter';
import {
  buildCallIndex,
  resolveCallEdge,
  symbolIdentity,
  STATIC_ANALYSIS_BREAK_DYNAMIC,
  STATIC_ANALYSIS_BREAK_EXTERNAL,
  STATIC_ANALYSIS_BREAK_AMBIGUOUS,
  type SymbolIndex
} from './repoqa-callchain';
import type { RepoSymbol } from '../ingest/repoqa-repos';

/**
 * v1.4 票 02 — paste a TS/JS snippet, get its call graph. In-memory only:
 * nothing touches disk or the database, so the cost of looking at 20 lines of
 * code is not "index a repository".
 *
 * Resolution is the same deterministic rule as every other engine surface
 * (ADR-0002): an edge appears only when the target binds statically inside the
 * pasted source; everything else is counted as a static-analysis break — a
 * snippet calling `console.log` is not a broken snippet, it is a boundary.
 */

export const SNIPPET_MAX_SOURCE_BYTES = 100_000;
/** Nodes rendered into mermaid; the JSON payload keeps the full graph. */
export const SNIPPET_MAX_RENDER_NODES = 200;

export interface SnippetNode {
  id: string;
  name: string;
  kind: RepoSymbol['kind'];
  file: string;
  line: number;
  lineEnd: number;
  inDegree: number;
  outDegree: number;
}

export interface SnippetEdge {
  from: string;
  to: string;
  line: number;
}

export interface SnippetBreakCounts {
  external: number;
  unresolved: number;
  dynamic: number;
  /** v1.6 票 05 — 仓内目标名不唯一（ADR-0022 Phase 2）。 */
  ambiguous: number;
  total: number;
}

export interface SnippetGraph {
  nodes: SnippetNode[];
  edges: SnippetEdge[];
  breaks: SnippetBreakCounts;
  stats: {
    symbols: number;
    edges: number;
    /** True when the mermaid render dropped isolated nodes past the cap. */
    truncated: boolean;
    droppedNodes: number;
  };
  mermaid: string;
}

function classifyBreak(reason: string): 'external' | 'unresolved' | 'dynamic' | 'ambiguous' {
  if (reason.includes(STATIC_ANALYSIS_BREAK_DYNAMIC)) return 'dynamic';
  if (reason.includes(STATIC_ANALYSIS_BREAK_EXTERNAL)) return 'external';
  if (reason.includes(STATIC_ANALYSIS_BREAK_AMBIGUOUS)) return 'ambiguous';
  return 'unresolved';
}

/** Mermaid-safe id; the graph keeps positional ids (`s0`, `s1`, ...). */
function mermaidLabel(node: SnippetNode): string {
  // v1.4.1 评审 P1 纵深防御 — 标签来自调用方粘贴的源码；剥掉尖括号，配合
  // 渲染侧 strict 净化，避免任何模式回退时把标签当 HTML。
  return `${node.name} · L${node.line}`.replace(/["[\]()<>]/g, '');
}

/**
 * Build the deterministic graph for one pasted source file. Throws on empty
 * input and on oversized payloads so the route can answer 400 with a reason.
 */
export function analyzeSnippet(input: {
  source: string;
  fileName?: string;
  index?: SymbolIndex;
}): SnippetGraph {
  const source = input.source;
  if (source.trim() === '') {
    throw new Error('source is required');
  }
  if (Buffer.byteLength(source, 'utf8') > SNIPPET_MAX_SOURCE_BYTES) {
    throw new Error(`source exceeds ${SNIPPET_MAX_SOURCE_BYTES} bytes`);
  }
  const file = (input.fileName ?? 'snippet.ts').slice(0, 200);
  const symbols = parseTypeScriptSource(source, file, 'snippet-preview');
  // Callable + entry symbols make up the graph; classes/variables are context.
  const graphSymbols = symbols.filter(
    (symbol) => symbol.kind === 'method' || symbol.kind === 'route' || symbol.kind === 'module'
  );
  const index = input.index ?? buildCallIndex(symbols);
  const idBySymbol = new Map<string, string>();
  graphSymbols.forEach((symbol, position) => {
    idBySymbol.set(symbolIdentity(symbol), `s${position}`);
  });

  const edges: SnippetEdge[] = [];
  const breaks: SnippetBreakCounts = { external: 0, unresolved: 0, dynamic: 0, ambiguous: 0, total: 0 };
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const symbol of graphSymbols) {
    const from = idBySymbol.get(symbolIdentity(symbol))!;
    for (const call of symbol.calls ?? []) {
      if (call.reference) continue;
      const resolved = resolveCallEdge(index, symbol, call);
      if (!('target' in resolved)) {
        breaks[classifyBreak(resolved.reason)] += 1;
        breaks.total += 1;
        continue;
      }
      const to = idBySymbol.get(symbolIdentity(resolved.target));
      if (to === undefined) {
        // Resolved into a symbol outside the graph set (e.g. a class) — the
        // edge exists but there is no node to hang it on: count it as a break
        // rather than silently dropping it.
        breaks.unresolved += 1;
        breaks.total += 1;
        continue;
      }
      edges.push({ from, to, line: call.line ?? symbol.lineStart ?? 1 });
      outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }

  const nodes: SnippetNode[] = graphSymbols.map((symbol, position) => {
    const id = `s${position}`;
    return {
      id,
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.filePath,
      line: symbol.lineStart ?? 1,
      lineEnd: symbol.lineEnd ?? symbol.lineStart ?? 1,
      inDegree: inDegree.get(id) ?? 0,
      outDegree: outDegree.get(id) ?? 0
    };
  });

  // Render cap: connected nodes first (degree desc), isolated ones last; the
  // JSON keeps everything so the UI can list what was not drawn.
  const ranked = [...nodes].sort(
    (a, b) =>
      b.inDegree + b.outDegree - (a.inDegree + a.outDegree) ||
      a.line - b.line ||
      a.name.localeCompare(b.name)
  );
  const kept = new Set(ranked.slice(0, SNIPPET_MAX_RENDER_NODES).map((node) => node.id));
  const dropped = nodes.length - kept.size;
  const lines = ['flowchart LR'];
  for (const node of nodes) {
    if (!kept.has(node.id)) continue;
    lines.push(`  ${node.id}["${mermaidLabel(node)}"]`);
  }
  for (const edge of edges) {
    if (!kept.has(edge.from) || !kept.has(edge.to)) continue;
    lines.push(`  ${edge.from} --> ${edge.to}`);
  }
  if (dropped > 0) {
    lines.push(`  s_agg["⋯ +${dropped} 个函数未显示"]`);
  }

  return {
    nodes,
    edges,
    breaks,
    stats: {
      symbols: symbols.length,
      edges: edges.length,
      truncated: dropped > 0,
      droppedNodes: dropped
    },
    mermaid: lines.join('\n')
  };
}
