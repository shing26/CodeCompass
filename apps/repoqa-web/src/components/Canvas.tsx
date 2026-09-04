import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Anchor, Repo, RepoSymbol, TraceStep } from '../types';

interface CanvasProps {
  repo: Repo | null;
  /**
   * Issue 25 / Ticket 01 — the anchors of the latest resolved trace (App
   * derives them from the chat stream; Canvas no longer renders chat bubbles).
   */
  anchors?: Anchor[] | null;
  /** Live trace steps of the latest resolved trace (App-derived). */
  traceSteps?: TraceStep[] | null;
  /** code:// deep link routing; wired to the Inspector in ticket 05. */
  onNavigate?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
  /** Issue 18: pinned "back to dashboard" entry inside the canvas. */
  onBackToDashboard?: () => void;
  /** Issue 31: symbol catalog for the workbench API/SQL impact counts. */
  symbols?: RepoSymbol[];
  /**
   * v0.8 — deep-link focus (?focus=&traceId=): flashes and scrolls to the
   * matching trace card once a trace has resolved for the linked symbol.
   */
  deepLinkFocus?: string | null;
  deepLinkTraceId?: string | null;
  /**
   * v0.11 (Stage 3) — external focus request owned by App (Cmd+K palette).
   * Canvas forwards it to the diagram layer; the trace-step strip uses its own
   * internal focus request, and external requests take precedence.
   */
  focusRequest?: { symbol: string; requestId: number } | null;
}

/**
 * Main canvas: pure topology view. The free-input chat bubble stream was
 * removed (Issue 25 / Ticket 01 — free-form questions live in the incident
 * copilot and the evolution workbench now); what stays is the focused trace
 * topology — flow cards, the trace-step strip and the offline hint — plus the
 * Mermaid diagram that renders inside the flow-card focus chain.
 */
export function Canvas({
  repo,
  anchors = null,
  traceSteps = null,
  onNavigate,
  onBackToDashboard,
  symbols = [],
  deepLinkFocus = null,
  deepLinkTraceId = null,
  focusRequest: externalFocusRequest = null
}: CanvasProps) {
  // v0.7 (issue 12) — one-shot highlight of the trace's start node: a Top API
  // click lands here and the focused card flashes once instead of blending in.
  const focusKey = anchors?.[0] ? `${anchors[0].file}:${anchors[0].line}` : '';
  const [focusFlash, setFocusFlash] = useState(false);
  useEffect(() => {
    if (!focusKey) return;
    setFocusFlash(true);
    const timer = window.setTimeout(() => setFocusFlash(false), 1500);
    return () => window.clearTimeout(timer);
  }, [focusKey]);

  // v0.8 — deep-link restore: when the cockpit is opened with ?focus=&traceId=,
  // flash and scroll to the matching trace card once a trace lands. traceId is
  // scene metadata surfaced in the banner.
  const [deepLinkFlash, setDeepLinkFlash] = useState(false);
  useEffect(() => {
    if (!deepLinkFocus || !anchors?.length) return;
    setDeepLinkFlash(true);
    const timer = window.setTimeout(() => setDeepLinkFlash(false), 1500);
    return () => window.clearTimeout(timer);
  }, [deepLinkFocus, deepLinkTraceId, anchors?.length]);

  const flowAnchors = anchors ?? [];
  const selectedNode = flowAnchors[0]?.symbol ?? repo?.name ?? '—';
  const affectedCount = flowAnchors.length;
  const apiCount = useMemo(
    () => symbols.filter((s) => s.kind === 'route' || s.displayPath).length,
    [symbols]
  );
  const sqlCount = useMemo(
    () => symbols.filter((s) => s.kind === 'sql' || s.kind === 'mapper').length,
    [symbols]
  );

  // v0.11 (Stage 3/4) — a focus request (external Cmd+K or a trace-step jump)
  // flashes the matching topology card; the requestId increments every
  // dispatch so re-focusing the same symbol still retriggers the flash.
  const [focusSymbol, setFocusSymbol] = useState<string | null>(null);
  const handleFocusDiagram = useCallback((symbol: string) => {
    setFocusSymbol(symbol);
  }, []);
  const focusRequestId = externalFocusRequest?.requestId ?? 0;
  const focusRequestSymbol = externalFocusRequest?.symbol ?? null;
  useEffect(() => {
    if (!focusRequestSymbol) return;
    setFocusSymbol(focusRequestSymbol);
  }, [focusRequestSymbol, focusRequestId]);
  // The flash is a one-shot CSS animation; drop the symbol so a later
  // dispatch of the same symbol can replay it.
  useEffect(() => {
    if (!focusSymbol) return;
    const timer = window.setTimeout(() => setFocusSymbol(null), 1500);
    return () => window.clearTimeout(timer);
  }, [focusSymbol]);

  const [traceStepIdx, setTraceStepIdx] = useState(0);
  useEffect(() => {
    if (!traceSteps || traceSteps.length === 0) {
      setTraceStepIdx(0);
      return;
    }
    setTraceStepIdx((prev) => Math.min(prev, traceSteps.length - 1));
  }, [traceSteps]);
  const visibleTraceStep = traceSteps?.[traceStepIdx] ?? null;

  const jumpToTraceStep = useCallback(
    (index: number) => {
      if (!traceSteps) return;
      const clamped = Math.max(0, Math.min(traceSteps.length - 1, index));
      setTraceStepIdx(clamped);
      const step = traceSteps[clamped];
      if (!step) return;
      handleFocusDiagram(step.symbol);
      onNavigate?.(step.file, step.line, step.lineEnd, step.symbol);
    },
    [traceSteps, handleFocusDiagram, onNavigate]
  );
  const stepPrev = useCallback(() => {
    if (!traceSteps) return;
    jumpToTraceStep(traceStepIdx - 1);
  }, [traceSteps, traceStepIdx, jumpToTraceStep]);
  const stepNext = useCallback(() => {
    if (!traceSteps) return;
    jumpToTraceStep(traceStepIdx + 1);
  }, [traceSteps, traceStepIdx, jumpToTraceStep]);

  return (
    <main data-testid="canvas" className="flex flex-1 flex-col overflow-hidden">
      {repo ? (
        <>
          <div className="workbench-grid custom-scroll flex-1 overflow-y-auto p-4">
            <div className="pointer-events-none sticky top-2 z-10 mb-3 flex items-center gap-2 rounded-md border border-line bg-surface/90 px-3 py-1.5 shadow-neon backdrop-blur">
              <span className="text-[10px] uppercase tracking-wide text-muted">焦点</span>
              <span
                data-testid="selected-node"
                className="min-w-0 flex-1 truncate font-mono text-xs text-ink"
              >
                {selectedNode}
              </span>
              <span
                data-testid="affected-count"
                className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent"
              >
                {affectedCount} 波及
              </span>
            </div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-medium text-muted">
              <span
                data-testid="api-count"
                className="rounded-full border border-line bg-surface px-2 py-0.5"
              >
                ↑ API {apiCount}
              </span>
              <span
                data-testid="sql-count"
                className="rounded-full border border-line bg-surface px-2 py-0.5"
              >
                ↓ SQL {sqlCount}
              </span>
            </div>
            {onBackToDashboard && (
              <div className="sticky top-0 z-10 -mx-4 -mt-4 border-b border-line bg-subtle px-3 py-1.5">
                <button
                  type="button"
                  data-testid="canvas-back-to-dashboard"
                  onClick={onBackToDashboard}
                  className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:border-accent/40 hover:text-accent"
                >
                  ← 返回看板
                </button>
              </div>
            )}
            {deepLinkFocus && (
              <div
                data-testid="deeplink-focus"
                className="mx-auto mb-3 flex max-w-2xl items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning"
              >
                <span aria-hidden="true">🎯</span>
                <span className="min-w-0 flex-1 truncate">
                  深度链接焦点：{deepLinkFocus}
                  {deepLinkTraceId ? ` · trace ${deepLinkTraceId}` : ''}
                </span>
              </div>
            )}
            {flowAnchors.length > 0 && (
              <FlowCards
                anchors={flowAnchors}
                onNavigate={onNavigate}
                /* An explicit external focus request wins over the trace-start
                   flash — the requested card is the one the user asked about. */
                flashFirst={focusFlash && focusSymbol === null}
                flashSymbol={deepLinkFlash ? deepLinkFocus : focusSymbol}
              />
            )}
            {flowAnchors.length === 0 && <FlowSkeleton />}
            <div
              data-testid="offline-hint"
              className="mx-auto mb-3 flex max-w-2xl items-start gap-2 rounded-md border border-line bg-subtle px-3 py-2 text-xs text-muted"
            >
              <span aria-hidden="true">🧭</span>
              <span>
                离线模式：调用链与符号索引来自 AST 确定性分析，不依赖 LLM / API Key；未配置 LLM
                时静态路径同样可用。
              </span>
            </div>
          </div>
          {traceSteps && traceSteps.length > 1 && (
            <div
              data-testid="trace-strip"
              className="border-t border-line bg-surface/95 px-3 py-1.5 backdrop-blur"
            >
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  data-testid="trace-step-prev"
                  onClick={stepPrev}
                  disabled={traceStepIdx === 0}
                  className="rounded border border-line bg-subtle px-2 py-0.5 text-muted hover:border-accent/40 disabled:opacity-30"
                >
                  ← Prev
                </button>
                <span
                  data-testid="trace-step-label"
                  className="min-w-0 flex-1 truncate font-mono"
                >
                  Step {traceStepIdx + 1}/{traceSteps.length}
                  {visibleTraceStep && (
                    <span className="ml-2 text-muted">
                      {visibleTraceStep.symbol}
                      {visibleTraceStep.status === 'BROKEN' && (
                        <span className="ml-1.5 text-danger">BROKEN</span>
                      )}
                      {visibleTraceStep.httpMethod && (
                        <span
                          className={`ml-1.5 ${
                            visibleTraceStep.httpMethod === 'POST'
                              ? 'text-success'
                              : 'text-accent'
                          }`}
                        >
                          {visibleTraceStep.httpMethod}
                        </span>
                      )}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  data-testid="trace-step-next"
                  onClick={stepNext}
                  disabled={traceStepIdx >= traceSteps.length - 1}
                  className="rounded border border-line bg-subtle px-2 py-0.5 text-muted hover:border-accent/40 disabled:opacity-30"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div data-testid="empty-state" className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-md text-center">
            <h2 className="text-lg font-semibold text-ink">Start by connecting a repo</h2>
            <p className="mt-2 text-sm text-muted">
              Import a local Java repository, wait for indexing to finish, then explore call chains
              with natural-language questions.
            </p>
            <p className="mt-1 text-xs text-muted">
              Already imported? Pick it from the selector in the top bar.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

function languageBadge(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'java':
      return 'Java';
    case 'ts':
    case 'tsx':
      return 'TS';
    case 'js':
    case 'jsx':
      return 'JS';
    case 'py':
      return 'Python';
    case 'go':
      return 'Go';
    case 'xml':
      return 'XML';
    default:
      return 'CODE';
  }
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

/** Caller -> Target -> Callee topology cards with animated dashed connectors. */
function FlowCards({
  anchors,
  onNavigate,
  flashFirst = false,
  flashSymbol
}: {
  anchors: Anchor[];
  onNavigate?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
  /** v0.7 (issue 12): one-shot highlight on the start card. */
  flashFirst?: boolean;
  /** v0.8 deep link: flash and scroll to the card matching this symbol. */
  flashSymbol?: string | null;
}) {
  const cards = anchors.slice(0, 3);
  const flashIndex = flashSymbol
    ? cards.findIndex((anchor) => anchor.symbol === flashSymbol)
    : -1;
  const flashRef = useRef<HTMLButtonElement | null>(null);
  // Deep-link restore: bring the focused card into view (jsdom-safe).
  useEffect(() => {
    const el = flashRef.current;
    if (!flashSymbol || !el) return;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [flashSymbol]);
  return (
    <div data-testid="flow-cards" className="mb-4 flex items-stretch gap-2">
      {cards.map((anchor, idx) => {
        const role = idx === 0 ? 'Caller' : idx === cards.length - 1 ? 'Callee' : 'Target';
        const flash =
          (flashFirst && idx === 0) ||
          (flashSymbol !== undefined && flashSymbol !== null && idx === flashIndex);
        return (
          <Fragment key={`${anchor.file}-${anchor.line}-${idx}`}>
            {idx > 0 && <div data-testid="flow-arrow" className="topo-line self-center" />}
            <button
              type="button"
              data-testid="flow-card"
              ref={idx === flashIndex ? flashRef : undefined}
              className={`min-w-0 flex-1 rounded-md border border-line bg-surface p-2 text-left hover:border-accent/50 ${
                flash ? 'focus-flash' : ''
              }`}
              onClick={() => onNavigate?.(anchor.file, anchor.line, undefined, anchor.symbol)}
              title={`${anchor.file}:${anchor.line}`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-[9px] font-bold uppercase ${
                    role === 'Callee' ? 'text-callee' : 'text-accent'
                  }`}
                >
                  {role}
                </span>
                <span className="rounded bg-subtle px-1 text-[9px] font-medium text-muted">
                  {languageBadge(anchor.file)}
                </span>
              </div>
              <div className="mt-1 truncate font-mono text-xs text-ink">{anchor.symbol}</div>
              <div className="mt-0.5 truncate text-[10px] text-muted">
                {basename(anchor.file)} L{anchor.line}
              </div>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Empty topology skeleton shown before the first trace resolves. */
function FlowSkeleton() {
  return (
    <div data-testid="flow-skeleton" className="mx-auto mb-4 flex max-w-md items-center gap-2">
      {[0, 1, 2].map((idx) => (
        <Fragment key={idx}>
          {idx > 0 && <div className="topo-line self-center" />}
          <div className="h-16 min-w-0 flex-1 rounded-md border border-dashed border-line bg-surface/60" />
        </Fragment>
      ))}
    </div>
  );
}
