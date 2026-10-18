import { useEffect, useMemo, useRef, useState } from 'react';
import { MermaidDiagram } from './MermaidDiagram';
import type { UseSubgraphContextResult } from '../hooks/useSubgraphContext';
import type { SubgraphDepths } from '../hooks/useSubgraphContext';
import { isSymbolResolutionError } from '../hooks/useSymbolResource';
import type { SubgraphContextNode, SubgraphDirection } from '../types';

type ViewFilter = 'all' | Exclude<SubgraphDirection, 'start'>;

const VIEW_OPTIONS: Array<{ value: ViewFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'caller', label: '调用方' },
  { value: 'callee', label: '被调方' }
];

/** v1.4 票 04 — depth choices for each direction (focus mode). */
const DEPTH_OPTIONS = [1, 2, 3, 4, 5] as const;

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
 *
 * v1.4 票 04 — every click binding carries `?symbol=`: node ids are hashed
 * (`n<hash>`) while the label reads `name · dN`, and plain click re-centers the
 * subgraph on that symbol (Ctrl/⌘+click stays a pure source jump).
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
      lines.push(
        `  click ${mermaidId(node.name)} "code://${node.file}#${node.line}` +
          `?symbol=${encodeURIComponent(node.name)}"`
      );
    }
  }
  return lines.join('\n');
}

/**
 * v0.6 closeout: caller/callee subgraph explorer for the focused symbol.
 *
 * v1.4 票 04 — focus mode, matching how call-hierarchy tools read graphs:
 * centers on the selected method, defaults to one hop per direction, lets the
 * user pick depths, and lets a node click become the next center (with a
 * visible back-trail). Budget pruning from the backend is surfaced instead of
 * being invisible.
 */
export function SubgraphPanel({
  state,
  focusName,
  depths,
  onDepthsChange,
  onRecenter,
  onOpenFile
}: {
  state: UseSubgraphContextResult;
  /** Current center (the Inspector's selected symbol) for the breadcrumb. */
  focusName?: string | null;
  /** Focus-mode depths; omitted in bare component tests. */
  depths?: SubgraphDepths;
  onDepthsChange?: (depths: SubgraphDepths) => void;
  /** Plain node click: make that symbol the new center (code view follows). */
  onRecenter?: (symbol: string, file: string, line: number) => void;
  onOpenFile?: (file: string, line: number) => void;
}) {
  const [filter, setFilter] = useState<ViewFilter>('all');
  const effectiveDepths = depths ?? { up: 1, down: 1 };
  /**
   * v1.4 票 04 — walk back-trail. Clicks made here push the previous center;
   * a center change from anywhere else (sidebar, chat, palette) resets the
   * trail instead of letting it point at symbols the user never visited.
   */
  const [history, setHistory] = useState<string[]>([]);
  const panelNavRef = useRef<string | null>(null);
  useEffect(() => {
    if (panelNavRef.current !== null && panelNavRef.current === focusName) {
      panelNavRef.current = null;
      return;
    }
    setHistory([]);
  }, [focusName]);

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

  const centerName = focusName ?? state.result?.start.name ?? null;
  const canGoBack = history.length > 0;

  const handleDepths = (side: 'up' | 'down', value: number) => {
    onDepthsChange?.({ ...effectiveDepths, [side]: value });
  };
  const handleRecenter = (symbol: string, file: string, line: number) => {
    if (!centerName || symbol === centerName) return;
    setHistory((prev) => [...prev, centerName].slice(-20));
    panelNavRef.current = symbol;
    if (onRecenter) onRecenter(symbol, file, line);
    else onOpenFile?.(file, line);
  };
  const handleBack = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((prev) => prev.slice(0, -1));
    panelNavRef.current = previous;
    const node = state.result?.nodes.find((candidate) => candidate.name === previous);
    if (onRecenter) onRecenter(previous, node?.file ?? '', node?.line ?? 1);
  };

  return (
    <div
      data-testid="inspector-subgraph"
      className="border-t border-line bg-surface px-3 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-micro font-semibold uppercase tracking-wide text-muted">
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
              className={`h-5 rounded px-1.5 text-micro font-medium ${
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
      {/* v1.4 票 04 — 焦点模式：当前中心 + 深度选择 + 返回。默认 1 层上下游，
          看哪条线由用户点开，而不是一次铺开。 */}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-micro text-muted">
        {centerName && (
          <span data-testid="subgraph-center" className="truncate">
            中心：<span className="font-medium text-ink">{centerName}</span>
          </span>
        )}
        <button
          type="button"
          data-testid="subgraph-back"
          disabled={!canGoBack}
          onClick={handleBack}
          className="rounded border border-line px-1.5 py-0.5 font-medium text-ink hover:border-accent disabled:opacity-40"
        >
          返回
        </button>
        <label className="flex items-center gap-1">
          上游
          <select
            data-testid="subgraph-depth-up"
            value={effectiveDepths.up}
            onChange={(event) => handleDepths('up', Number(event.target.value))}
            className="h-5 rounded border border-line bg-surface px-0.5 text-micro text-ink"
          >
            {DEPTH_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          层
        </label>
        <label className="flex items-center gap-1">
          下游
          <select
            data-testid="subgraph-depth-down"
            value={effectiveDepths.down}
            onChange={(event) => handleDepths('down', Number(event.target.value))}
            className="h-5 rounded border border-line bg-surface px-0.5 text-micro text-ink"
          >
            {DEPTH_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          层
        </label>
      </div>
      <div className="mt-1 flex items-center gap-3 text-micro text-muted">
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-ink" />
          起点 {counts.start}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          调用方 {counts.caller}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-callee" />
          被调方 {counts.callee}
        </span>
      </div>
      {state.loading && (
        <p data-testid="subgraph-loading" className="mt-1 text-xs text-muted">
          构建子图…
        </p>
      )}
      {!state.loading && state.error && (
        <p data-testid="subgraph-error" className="mt-1 text-xs text-muted">
          {isSymbolResolutionError(state.error)
            ? '子图不可用：未定位到可解析符号。'
            : '子图暂不可用，请稍后重试。'}
        </p>
      )}
      {!state.loading && !state.error && mermaid && (
        <>
          {filter !== 'all' && counts[filter] === 0 && (
            <p data-testid="subgraph-side-empty" className="mt-1 text-xs text-muted">
              该方向没有静态邻接节点（start 始终保留）。
            </p>
          )}
          {state.result?.truncated && (
            <p data-testid="subgraph-pruned" className="mt-1 text-xs text-muted">
              另有 {state.result.prunedCount} 个节点因上下文预算未入图。
            </p>
          )}
          <MermaidDiagram
            code={mermaid}
            onNavigate={onOpenFile}
            onNodeSymbol={(file, line, symbol) => handleRecenter(symbol, file, line)}
          />
          <p className="mt-1 text-micro text-muted">
            点击节点 = 以它为中心；Ctrl/⌘+点击 = 直接打开源码。
          </p>
        </>
      )}
    </div>
  );
}
