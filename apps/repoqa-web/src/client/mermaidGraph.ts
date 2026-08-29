/**
 * v0.7 — deterministic scale control for mermaid diagrams: cap the rendered
 * node count and collapse everything beyond it into a single aggregate node,
 * so a 15-caller fan-out never explodes the canvas. Pure text transform over
 * the mermaid source (no rendering), unit-testable in isolation.
 *
 * Only edges produced by our own generators are rewritten (`-->` with or
 * without `|label|`, endpoints with or without `[label]`); anything else
 * passes through untouched.
 */

const EDGE_RE =
  /^\s*([A-Za-z_]\w*)(?:\[[^\]]*\])?\s*-->(?:\|[^|]*\|)?\s*([A-Za-z_]\w*)(?:\[[^\]]*\])?/;
const CLICK_RE = /^\s*click\s+([A-Za-z_]\w*)\s+"/;

export interface MermaidGraphStats {
  totalNodes: number;
  shownNodes: number;
  hiddenNodes: number;
  collapsedEdges: number;
}

export interface TrimResult {
  code: string;
  stats: MermaidGraphStats;
  /** Labels of nodes dropped by the cap (search fallback surface). */
  hiddenLabels: string[];
}

/** v0.10 — minimal structural view of a trace hop for the semantics helper. */
export interface TraceHopView {
  symbol: string;
  status: 'BROKEN' | 'VERIFIED';
  httpMethod?: string;
  async?: boolean;
}

/** v0.10 — semantic annotation for one rendered SVG edge. */
export interface MermaidEdgeView {
  broken: boolean;
  httpMethod?: string;
  async?: boolean;
}

/**
 * v0.10 — escape a node label for safe mermaid source embedding. Mermaid
 * flowchart labels accept `#`, `()` and Unicode paths, but `[`, `]` and
 * double quotes must be neutralized so a label never terminates the node
 * declaration early (RISK-2).
 */
export function escapeMermaidLabel(label: string): string {
  return label.replace(/\[/g, '(').replace(/\]/g, ')').replace(/"/g, "'");
}

/**
 * v0.10 — derive edge semantics from an ordered trace. Edge `i` connects hop
 * `i` to hop `i+1`; its attributes come from the target hop (`i+1`), matching
 * the backend `traceToMermaid` convention. Backend traces are depth-capped
 * (4 hops), so the index mapping survives the 60-node render cap in practice.
 */
export function edgeAnnotationsForTrace(trace: TraceHopView[]): MermaidEdgeView[] {
  const edges: MermaidEdgeView[] = [];
  for (let i = 0; i < trace.length - 1; i += 1) {
    const target = trace[i + 1];
    edges.push({
      broken: target.status === 'BROKEN',
      ...(target.httpMethod ? { httpMethod: target.httpMethod } : {}),
      ...(target.async ? { async: true } : {})
    });
  }
  return edges;
}

export function trimMermaidGraph(code: string, maxNodes = 60): TrimResult {
  const lines = code.split('\n');
  const nodeOrder: string[] = [];
  const nodeSet = new Set<string>();
  const labelById = new Map<string, string>();
  const endpointsByLine = new Map<number, [string, string]>();

  lines.forEach((line, index) => {
    const edge = EDGE_RE.exec(line);
    if (!edge) return;
    const [from, to] = [edge[1], edge[2]];
    endpointsByLine.set(index, [from, to]);
    const label = /\[([^\]]*)\]/.exec(line)?.[1] ?? '';
    for (const id of [from, to]) {
      if (!nodeSet.has(id)) {
        nodeSet.add(id);
        nodeOrder.push(id);
        labelById.set(id, label.replace(/^"|"$/g, ''));
      }
    }
  });

  // Non-ASCII (or otherwise unparsed) node ids would make nodeOrder undercount
  // the real graph; never trim on an unreliable census.
  const rawEdgeCount = lines.filter((line) => line.includes('-->')).length;
  if (nodeOrder.length === 0 && rawEdgeCount > 0) {
    return {
      code,
      stats: { totalNodes: 0, shownNodes: 0, hiddenNodes: 0, collapsedEdges: 0 },
      hiddenLabels: []
    };
  }

  const totalNodes = nodeOrder.length;
  if (totalNodes <= maxNodes) {
    return {
      code,
      stats: { totalNodes, shownNodes: totalNodes, hiddenNodes: 0, collapsedEdges: 0 },
      hiddenLabels: []
    };
  }

  const kept = new Set(nodeOrder.slice(0, maxNodes));
  const hiddenNodes = totalNodes - kept.size;
  let collapsedEdges = 0;

  const out = lines.map((line, index) => {
    const endpoints = endpointsByLine.get(index);
    if (!endpoints) return line;
    const [from, to] = endpoints;
    if (kept.has(from) && kept.has(to)) return line;
    collapsedEdges += 1;
    return null;
  });

  const withClicks = out.map((line) => {
    if (line === null) return null;
    const click = CLICK_RE.exec(line);
    if (click && !kept.has(click[1])) return null;
    return line;
  });

  // Floating aggregate node: no synthetic edges, so it can never introduce a
  // mermaid syntax error regardless of the input shape.
  withClicks.push(`  ccx_aggregate["⋯ +${hiddenNodes} 已聚合"]`);

  const hiddenLabels = nodeOrder
    .slice(maxNodes)
    .map((id) => labelById.get(id) ?? id);

  return {
    hiddenLabels,
    code: withClicks.filter((line): line is string => line !== null).join('\n'),
    stats: { totalNodes, shownNodes: kept.size + 1, hiddenNodes, collapsedEdges }
  };
}
