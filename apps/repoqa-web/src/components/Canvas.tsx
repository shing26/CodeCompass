import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from 'react';
import type { ChatMessage } from '../hooks/useChat';
import type { Anchor, QueryMode, Repo, RepoSymbol, TokenUsage } from '../types';
import { Markdown } from './Markdown';
import { MermaidDiagram } from './MermaidDiagram';
import { SourceTraceDrawer } from './SourceTraceDrawer';

interface CanvasProps {
  repo: Repo | null;
  messages: ChatMessage[];
  streaming: boolean;
  reconnecting: boolean;
  recovered: boolean;
  error: string | null;
  totalUsage: TokenUsage;
  onSubmit: (question: string, mode?: QueryMode) => void;
  /** Manual retry after permanent reconnect failure (ticket 07). */
  onRetry: () => void;
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
 * Main canvas: chat stream + input. SSE token events land as Markdown in the
 * assistant message; loading indicator stays until `done`. Mermaid, the Source
 * Trace drawer and the micro-win / off-ramp / break marker (ticket 06) all
 * stage-reveal in arrival order. A dropped SSE connection shows a reconnect
 * notice (ticket 07) without touching completed bubbles.
 */
export function Canvas({
  repo,
  messages,
  streaming,
  reconnecting,
  recovered,
  error,
  totalUsage,
  onSubmit,
  onRetry,
  onNavigate,
  onBackToDashboard,
  symbols = [],
  deepLinkFocus = null,
  deepLinkTraceId = null,
  focusRequest: externalFocusRequest = null
}: CanvasProps) {
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<QueryMode>('call-chain');
  const [localFocusRequest, setLocalFocusRequest] = useState<{
    symbol: string;
    requestId: number;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const latestTrace = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === 'assistant' && message.anchors?.length) return message;
    }
    return null;
  }, [messages]);

  // v0.7 (issue 12) — one-shot highlight of the trace's start node: a Top API
  // click lands here and the focused card flashes once instead of blending in.
  const focusKey = latestTrace?.anchors?.[0]
    ? `${latestTrace.id}:${latestTrace.anchors[0].file}:${latestTrace.anchors[0].line}`
    : '';
  const [focusFlash, setFocusFlash] = useState(false);
  useEffect(() => {
    if (!focusKey) return;
    setFocusFlash(true);
    const timer = window.setTimeout(() => setFocusFlash(false), 1500);
    return () => window.clearTimeout(timer);
  }, [focusKey]);

  // v0.8 — deep-link restore: when the cockpit is opened with ?focus=&traceId=,
  // flash and scroll to the matching trace card once a trace lands. traceId is
  // scene metadata surfaced in the banner (chat messages don't carry trace ids).
  const [deepLinkFlash, setDeepLinkFlash] = useState(false);
  useEffect(() => {
    if (!deepLinkFocus || !latestTrace?.anchors?.length) return;
    setDeepLinkFlash(true);
    const timer = window.setTimeout(() => setDeepLinkFlash(false), 1500);
    return () => window.clearTimeout(timer);
  }, [deepLinkFocus, latestTrace?.id, latestTrace?.anchors?.length]);

  const flowAnchors = latestTrace?.anchors ?? [];
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q || !repo || streaming) return;
    onSubmit(q, mode);
    setDraft('');
  };

  const scrollToTop = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: 0 });
    else el.scrollTop = 0;
  };

  // v0.11 (Stage 3/4) — forward an external focus request to the diagrams.
  // The requestId increments every dispatch so re-focusing the same symbol
  // still retriggers the MermaidDiagram focus effect.
  const handleFocusDiagram = useCallback((symbol: string) => {
    setLocalFocusRequest((prev) => ({ symbol, requestId: (prev?.requestId ?? 0) + 1 }));
  }, []);
  // v0.11 (Stage 3) — an external Cmd+K focus request overrides the local one.
  const effectiveFocusRequest = externalFocusRequest ?? localFocusRequest;

  // v0.11 (Stage 4) — live trace steps come from the latest assistant message
  // that carried a resolved trace (useChat already parses done.payload.trace).
  const traceSteps = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === 'assistant' && message.traceSteps && message.traceSteps.length > 0) {
        return message.traceSteps;
      }
    }
    return null;
  }, [messages]);
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
          <div ref={scrollRef} className="workbench-grid custom-scroll flex-1 overflow-y-auto p-4">
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
                flashFirst={focusFlash}
                flashSymbol={deepLinkFlash ? deepLinkFocus : undefined}
              />
            )}
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
            {messages.length === 0 && (
              <div data-testid="chat-empty" className="mx-auto mt-8 max-w-md text-center">
                <FlowSkeleton />
                <h2 className="text-base font-semibold text-ink">
                  Explore {repo.name}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  打开看板查看技术栈与核心 API，或在左侧选择 Quick Tour，也可以直接提问，例如
                  “/owners 经过了哪些类”.
                </p>
                {error && <p className="mt-2 text-xs text-danger">{error}</p>}
              </div>
            )}
            <div className="space-y-4">
              {messages.map((m) => (
               <MessageBubble
                 key={m.id}
                 message={m}
                 onNavigate={onNavigate}
                  symbols={symbols}
                 highlightNode={
                   focusFlash && latestTrace?.id === m.id
                     ? latestTrace.anchors?.[0]?.symbol
                     : undefined
                  }
                  focusRequest={effectiveFocusRequest}
                 onOffRamp={{
                    suggested: (q) => onSubmit(q),
                    continue: () => inputRef.current?.focus(),
                    top: scrollToTop
                  }}
                />
              ))}
            </div>
            {totalUsage.total > 0 && (
              <div
                data-testid="token-budget"
                className="mt-3 flex items-center gap-2 text-xs text-muted"
              >
                <div
                  role="progressbar"
                  aria-label="Token 预算"
                  aria-valuemin={0}
                  aria-valuemax={8192}
                  aria-valuenow={totalUsage.total}
                  className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-subtle"
                >
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.min(100, (totalUsage.total / 8192) * 100)}%` }}
                  />
                </div>
                <span data-testid="session-usage" className="shrink-0">
                  本次会话累计 {totalUsage.total} tokens
                </span>
              </div>
            )}
            {streaming && (
              <p data-testid="streaming-indicator" className="mt-2 text-xs text-muted">
                Streaming…
              </p>
            )}
            {streaming && reconnecting && (
              <p data-testid="reconnecting-indicator" className="mt-2 text-xs text-warning">
                连接中断，正在自动重连…
              </p>
            )}
            {recovered && !reconnecting && (
              <p data-testid="reconnect-toast" className="mt-2 text-xs text-success">
                已恢复连接
              </p>
            )}
            {!streaming && error && messages.length > 0 && (
              <div data-testid="chat-error" className="mt-2 flex items-center gap-2 text-xs text-danger">
                <span>{error}</span>
                <button
                  type="button"
                  data-testid="retry-query"
                  onClick={onRetry}
                  className="rounded border border-danger/40 bg-surface px-2 py-0.5 font-medium text-danger hover:bg-danger/10"
                >
                  重试
                </button>
              </div>
            )}
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
          <form
            onSubmit={submit}
            className="flex items-center gap-2 border-t border-line bg-surface p-3"
          >
            <div
              data-testid="chat-mode-switcher"
              className="flex shrink-0 rounded-md border border-line bg-subtle p-0.5"
            >
              <button
                type="button"
                data-testid="chat-mode-architecture"
                aria-pressed={mode === 'architecture'}
                onClick={() => setMode('architecture')}
                disabled={streaming}
                className={`h-7 rounded px-2 text-xs font-medium ${
                  mode === 'architecture'
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-muted hover:text-ink'
                }`}
              >
                架构分析
              </button>
              <button
                type="button"
                data-testid="chat-mode-call-chain"
                aria-pressed={mode === 'call-chain'}
                onClick={() => setMode('call-chain')}
                disabled={streaming}
                className={`h-7 rounded px-2 text-xs font-medium ${
                  mode === 'call-chain'
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-muted hover:text-ink'
                }`}
              >
                调用链
              </button>
            </div>
            <input
              ref={inputRef}
              data-testid="chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="例如：createOwner 的调用链？/owners 经过了哪些类？（自然语言即可）"
              disabled={streaming}
              className="h-9 flex-1 rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
            />
            <button
              type="submit"
              data-testid="chat-submit"
              disabled={streaming || !draft.trim()}
              className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              Ask
            </button>
          </form>
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

interface OffRampActions {
  /** Submit the backend-suggested follow-up question. */
  suggested: (question: string) => void;
  /** Focus the chat input so the user can keep asking. */
  continue: () => void;
  /** Scroll the message list back to the top. */
  top: () => void;
}

function MessageBubble({
  message,
  onNavigate,
  highlightNode,
  symbols,
  focusRequest,
  onOffRamp
}: {
  message: ChatMessage;
  onNavigate?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
  /** v0.7 (issue 12): symbol flashed in this message's diagram. */
  highlightNode?: string;
  /** v0.11 (Stage 2) — symbol catalog for brand-badge inference. */
  symbols?: RepoSymbol[];
  /** v0.11 (Stage 3) — external focus request for Cmd+K / trace-step centering. */
  focusRequest?: { symbol: string; requestId: number } | null;
  onOffRamp: OffRampActions;
}) {
  if (message.role === 'user') {
    return (
      <div data-testid="user-message" className="flex justify-end">
        <div className="max-w-[80%] rounded-lg bg-accent px-3 py-2 text-sm text-white">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div data-testid="assistant-message" className="flex justify-start">
      <div className="max-w-[90%] rounded-lg border border-line bg-surface px-3 py-2">
        {message.text ? (
          <Markdown text={message.text} />
        ) : (
          <span className="text-muted">…</span>
        )}
        {message.diagram && (
          <MermaidDiagram
            code={message.diagram}
            onNavigate={onNavigate}
            highlightNode={highlightNode}
            symbols={symbols}
            focusRequest={focusRequest ?? undefined}
          />
        )}
        {message.anchors && (
          <SourceTraceDrawer anchors={message.anchors} onNavigate={onNavigate} />
        )}
        {message.status === 'done' &&
          (message.provenance || message.lowConfidence || message.usage) && (
            <div
              data-testid="message-meta"
              className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[11px] text-muted"
            >
              {message.provenance && (
                <span data-testid="provenance-badge">
                  {message.provenance === 'static' ? '静态图谱' : '模型推理'}
                </span>
              )}
              {message.lowConfidence && (
                <span data-testid="low-confidence" className="text-warning">
                  低置信度
                </span>
              )}
              {message.usage && (
                <span data-testid="message-usage">本次 {message.usage.total} tokens</span>
              )}
            </div>
          )}
        {message.status === 'done' && (
          <TraceOutcome
            message={message}
            onSuggested={onOffRamp.suggested}
            onContinue={onOffRamp.continue}
            onTop={onOffRamp.top}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Ticket 06: end-of-trace presentation. A trace that hit a Static Analysis
 * Break gets an explicit red marker — never a success toast. A completed trace
 * gets a quantitative micro-win plus explicit off-ramp exits (suggested follow-up
 * / keep asking / back to top).
 */
function TraceOutcome({
  message,
  onSuggested,
  onContinue,
  onTop
}: {
  message: ChatMessage;
  onSuggested: (question: string) => void;
  onContinue: () => void;
  onTop: () => void;
}) {
  if (message.break) {
    return (
      <div
        data-testid="break-marker"
        className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs"
      >
        <span className="font-semibold text-danger">Static Analysis Break</span>
        <span className="mt-1 block text-danger">
          该 trace 未解析出完整调用链，以下为已到达的内容。
        </span>
      </div>
    );
  }

  const anchorCount = message.anchors?.length ?? 0;
  return (
    <div
      data-testid="micro-win"
      className="mt-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm"
    >
      <p data-testid="micro-win-label" className="font-medium text-success">
        {anchorCount > 0 ? `✓ 已确认 ${anchorCount} 个源码锚点` : '✓ 分析完成'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {message.suggestedAction && (
          <button
            type="button"
            data-testid="off-ramp-suggested"
            onClick={() => onSuggested(message.suggestedAction as string)}
            className="rounded-md bg-success px-2.5 py-1 text-xs font-medium text-white hover:bg-success/90"
          >
            {message.suggestedAction}
          </button>
        )}
        <button
          type="button"
          data-testid="off-ramp-continue"
          onClick={onContinue}
          className="rounded-md border border-success/40 bg-surface px-2.5 py-1 text-xs font-medium text-success hover:bg-success/10"
        >
          继续提问
        </button>
        <button
          type="button"
          data-testid="off-ramp-top"
          onClick={onTop}
          className="rounded-md border border-success/40 bg-surface px-2.5 py-1 text-xs font-medium text-success hover:bg-success/10"
        >
          回到顶部
        </button>
      </div>
    </div>
  );
}
