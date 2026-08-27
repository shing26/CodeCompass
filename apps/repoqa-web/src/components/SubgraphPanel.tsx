import { useMemo, useState } from 'react';
import { MermaidDiagram } from './MermaidDiagram';
import type { UseSubgraphContextResult } from '../hooks/useSubgraphContext';
import { isSymbolResolutionError } from '../hooks/useSymbolResource';
import type { SubgraphContextNode, SubgraphDirection } from '../types';

type ViewFilter = 'all' | Exclude<SubgraphDirection, 'start'>;

const VIEW_OPTIONS: Array<{ value: ViewFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'caller', label: 'Caller' },
  { value: 'callee', label: 'Callee' }
];

function mermaidId(name: string): string {
  // Mermaid ids must match [A-Za-z_][\w]*; hash the name deterministically so
  // ids stay stable between renders and click bindings keep resolving.
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return `n${hash.toString(36)}`;
}

function mermaidLabel(node: SubgraphContextNode): string {
  const text = `${node.name} · d${node.distance}`.replace(/["[\]()]/g, '');
  return text;
}

/**
 * Hub-and-spoke mermaid around the start symbol: callers point in, callees
 * point out. `filter` keeps the start node always and drops the opposite
 * direction's spokes — pure view state, no backend query.
 */
export function buildSubgraphMermaid(
  nodes: SubgraphContextNode[],
  filter: ViewFilter
): string {
  const start = nodes.find((node) => node.direction === 'start');
  const startId = mermaidId(start?.name ?? 'start');
  const kept = nodes.filter(
    (node) =>
      node.direction === 'start' || filter === 'all' || node.direction === filter
  );
  const lines = ['flowchart LR'];
  for (const node of kept) {
    if (node.direction === 'start') continue;
    const id = mermaidId(node.name);
    const label = mermaidLabel(node);
    if (node.direction === 'caller') {
      lines.push(`  ${id}["${label}"] --> ${startId}["${start?.name ?? 'start'}"]`);
    } else {
      lines.push(`  ${startId}["${start?.name ?? 'start'}"] --> ${id}["${label}"]`);
    }
  }
  for (const node of kept) {
    if (node.file && typeof node.line === 'number' && node.line > 0) {
      lines.push(`  click ${mermaidId(node.name)} "code://${node.file}#${node.line}"`);
    }
  }
  return lines.join('\n');
}

/**
 * v0.6 closeout: caller/callee subgraph explorer for the focused symbol.
 * The backend already extracts a bidirectional subgraph (1-hop callers +
 * up-to-3-hop callees); this panel renders it with a client-side direction
 * filter plus legend, so users can read the two sides separately.
 */
export function SubgraphPanel({
  state,
  onOpenFile
}: {
  state: UseSubgraphContextResult;
  onOpenFile?: (file: string, line: number) => void;
}) {
  const [filter, setFilter] = useState<ViewFilter>('all');
  const mermaid = useMemo(
    () => (state.result ? buildSubgraphMermaid(state.result.nodes, filter) : null),
    [state.result, filter]
  );
  const counts = useMemo(() => {
    const nodes = state.result?.nodes ?? [];
    return {
      start: nodes.filter((node) => node.direction === 'start').length,
      caller: nodes.filter((node) => node.direction === 'caller').length,
      callee: nodes.filter((node) => node.direction === 'callee').length
    };
  }, [state.result]);

  return (
    <div
      data-testid="inspector-subgraph"
      className="border-t border-line bg-surface px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          子图透视
        </span>
        <div
          data-testid="subgraph-view-toggle"
          role="group"
          aria-label="子图方向视图"
          className="flex shrink-0 rounded-md border border-line bg-subtle p-0.5"
        >
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              data-testid={`subgraph-view-${option.value}`}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={`h-5 rounded px-1.5 text-[10px] font-medium ${
                filter === option.value
                  ? 'bg-surface text-ink shadow-sm'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[10px] text-muted">
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-ink" />
          Start {counts.start}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          Caller {counts.caller}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-callee" />
          Callee {counts.callee}
        </span>
      </div>
      {state.loading && (
        <p data-testid="subgraph-loading" className="mt-1 text-[11px] text-muted">
          构建子图…
        </p>
      )}
      {!state.loading && state.error && (
        <p data-testid="subgraph-error" className="mt-1 text-[11px] text-muted">
          {isSymbolResolutionError(state.error)
            ? '子图不可用：未定位到可解析符号。'
            : '子图暂不可用，请稍后重试。'}
        </p>
      )}
      {!state.loading && !state.error && mermaid && (
        <>
          {filter !== 'all' && counts[filter] === 0 && (
            <p data-testid="subgraph-side-empty" className="mt-1 text-[11px] text-muted">
              该方向没有静态邻接节点（start 始终保留）。
            </p>
          )}
          <MermaidDiagram code={mermaid} onNavigate={onOpenFile} />
        </>
      )}
    </div>
  );
}
