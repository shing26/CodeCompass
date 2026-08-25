import { useRef, useState, type FormEvent } from 'react';
import type { ChatMessage } from '../hooks/useChat';
import type { QueryMode, Repo, TokenUsage } from '../types';
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
  onNavigate?: (file: string, line: number) => void;
  /** Issue 18: pinned "back to dashboard" entry inside the canvas. */
  onBackToDashboard?: () => void;
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
  onBackToDashboard
}: CanvasProps) {
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<QueryMode>('call-chain');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  return (
    <main data-testid="canvas" className="flex flex-1 flex-col overflow-hidden">
      {repo ? (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
            {onBackToDashboard && (
              <div className="sticky top-0 z-10 -mx-4 -mt-4 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                <button
                  type="button"
                  data-testid="canvas-back-to-dashboard"
                  onClick={onBackToDashboard}
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-accent/40 hover:text-accent"
                >
                  ← 返回看板
                </button>
              </div>
            )}
            <div
              data-testid="offline-hint"
              className="mx-auto mb-3 flex max-w-2xl items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500"
            >
              <span aria-hidden="true">🧭</span>
              <span>
                离线模式：调用链与符号索引来自 AST 确定性分析，不依赖 LLM / API Key；未配置 LLM
                时静态路径同样可用。
              </span>
            </div>
            {messages.length === 0 && (
              <div data-testid="chat-empty" className="mx-auto mt-8 max-w-md text-center">
                <h2 className="text-base font-semibold text-slate-900">
                  Explore {repo.name}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  打开看板查看技术栈与核心 API，或在左侧选择 Quick Tour，也可以直接提问，例如
                  “/owners 经过了哪些类”.
                </p>
                {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
              </div>
            )}
            <div className="space-y-4">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onNavigate={onNavigate}
                  onOffRamp={{
                    suggested: (q) => onSubmit(q),
                    continue: () => inputRef.current?.focus(),
                    top: scrollToTop
                  }}
                />
              ))}
            </div>
            {totalUsage.total > 0 && (
              <p data-testid="session-usage" className="mt-3 text-right text-xs text-slate-400">
                本次会话累计 {totalUsage.total} tokens
              </p>
            )}
            {streaming && (
              <p data-testid="streaming-indicator" className="mt-2 text-xs text-slate-400">
                Streaming…
              </p>
            )}
            {streaming && reconnecting && (
              <p data-testid="reconnecting-indicator" className="mt-2 text-xs text-amber-600">
                连接中断，正在自动重连…
              </p>
            )}
            {recovered && !reconnecting && (
              <p data-testid="reconnect-toast" className="mt-2 text-xs text-emerald-600">
                已恢复连接
              </p>
            )}
            {!streaming && error && messages.length > 0 && (
              <div data-testid="chat-error" className="mt-2 flex items-center gap-2 text-xs text-red-600">
                <span>{error}</span>
                <button
                  type="button"
                  data-testid="retry-query"
                  onClick={onRetry}
                  className="rounded border border-red-300 bg-white px-2 py-0.5 font-medium text-red-700 hover:bg-red-50"
                >
                  重试
                </button>
              </div>
            )}
          </div>
          <form
            onSubmit={submit}
            className="flex items-center gap-2 border-t border-slate-200 bg-white p-3"
          >
            <div
              data-testid="chat-mode-switcher"
              className="flex shrink-0 rounded-md border border-slate-200 bg-slate-50 p-0.5"
            >
              <button
                type="button"
                data-testid="chat-mode-architecture"
                aria-pressed={mode === 'architecture'}
                onClick={() => setMode('architecture')}
                disabled={streaming}
                className={`h-7 rounded px-2 text-xs font-medium ${
                  mode === 'architecture'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
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
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
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
              className="h-9 flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-accent disabled:opacity-50"
            />
            <button
              type="submit"
              data-testid="chat-submit"
              disabled={streaming || !draft.trim()}
              className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Ask
            </button>
          </form>
        </>
      ) : (
        <div data-testid="empty-state" className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-md text-center">
            <h2 className="text-lg font-semibold text-slate-900">Start by connecting a repo</h2>
            <p className="mt-2 text-sm text-slate-500">
              Import a local Java repository, wait for indexing to finish, then explore call chains
              with natural-language questions.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Already imported? Pick it from the selector in the top bar.
            </p>
          </div>
        </div>
      )}
    </main>
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
  onOffRamp
}: {
  message: ChatMessage;
  onNavigate?: (file: string, line: number) => void;
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
      <div className="max-w-[90%] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        {message.text ? (
          <Markdown text={message.text} />
        ) : (
          <span className="text-slate-400">…</span>
        )}
        {message.diagram && <MermaidDiagram code={message.diagram} onNavigate={onNavigate} />}
        {message.anchors && (
          <SourceTraceDrawer anchors={message.anchors} onNavigate={onNavigate} />
        )}
        {message.status === 'done' &&
          (message.provenance || message.lowConfidence || message.usage) && (
            <div
              data-testid="message-meta"
              className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-500"
            >
              {message.provenance && (
                <span data-testid="provenance-badge">
                  {message.provenance === 'static' ? '静态图谱' : '模型推理'}
                </span>
              )}
              {message.lowConfidence && (
                <span data-testid="low-confidence" className="text-amber-600">
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
        className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs"
      >
        <span className="font-semibold text-red-700">Static Analysis Break</span>
        <span className="mt-1 block text-red-600">
          该 trace 未解析出完整调用链，以下为已到达的内容。
        </span>
      </div>
    );
  }

  const anchorCount = message.anchors?.length ?? 0;
  return (
    <div
      data-testid="micro-win"
      className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm"
    >
      <p data-testid="micro-win-label" className="font-medium text-emerald-800">
        {anchorCount > 0 ? `✓ 已确认 ${anchorCount} 个源码锚点` : '✓ 分析完成'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {message.suggestedAction && (
          <button
            type="button"
            data-testid="off-ramp-suggested"
            onClick={() => onSuggested(message.suggestedAction as string)}
            className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
          >
            {message.suggestedAction}
          </button>
        )}
        <button
          type="button"
          data-testid="off-ramp-continue"
          onClick={onContinue}
          className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
        >
          继续提问
        </button>
        <button
          type="button"
          data-testid="off-ramp-top"
          onClick={onTop}
          className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
        >
          回到顶部
        </button>
      </div>
    </div>
  );
}
