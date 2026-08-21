import { useRef, useState, type FormEvent } from 'react';
import type { ChatMessage } from '../hooks/useChat';
import type { Repo } from '../types';
import { Markdown } from './Markdown';
import { MermaidDiagram } from './MermaidDiagram';
import { SourceTraceDrawer } from './SourceTraceDrawer';

interface CanvasProps {
  repo: Repo | null;
  messages: ChatMessage[];
  streaming: boolean;
  reconnecting: boolean;
  error: string | null;
  onSubmit: (question: string) => void;
  /** Manual retry after permanent reconnect failure (ticket 07). */
  onRetry: () => void;
  /** code:// deep link routing; wired to the Inspector in ticket 05. */
  onNavigate?: (file: string, line: number) => void;
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
  error,
  onSubmit,
  onRetry,
  onNavigate
}: CanvasProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q || !repo || streaming) return;
    onSubmit(q);
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
            {messages.length === 0 && (
              <div data-testid="chat-empty" className="mx-auto mt-8 max-w-md text-center">
                <h2 className="text-base font-semibold text-slate-900">
                  Explore {repo.name}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Click a Quick Tour on the left, or ask a question like
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
            <input
              ref={inputRef}
              data-testid="chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask anything about the repo…"
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