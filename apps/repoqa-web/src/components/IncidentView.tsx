import type { ChatMessage } from '../hooks/useChat';
import type { RepoSymbol } from '../types';
import { EvidenceCard } from './EvidenceCard';
import { MermaidDiagram } from './MermaidDiagram';
import { StackTraceInput } from './StackTraceInput';

interface IncidentViewProps {
  repoName: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  reconnecting: boolean;
  recovered: boolean;
  error: string | null;
  /** v0.11 — symbol catalog for MermaidDiagram brand badges (same as Canvas). */
  symbols?: RepoSymbol[];
  onSubmit: (question: string, stack?: string) => void;
  onNavigate?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
  /** Issue 23 integration — open the diagram message inside the main workbench (Canvas). */
  onOpenInWorkbench?: () => void;
  /** Issue 23 integration — hand the crash symbol to the deterministic call-chain trace. */
  onTraceCrash?: (symbol: string, file: string) => void;
}

/**
 * Issue 23 — Architecture & Incident Copilot view. Owns the incident
 * conversation: pasted stack + symptom in, grounded evidence cards out.
 * Message flow, streaming / reconnect / error states reuse the exact
 * useChat state machine the normal chat uses; only the composer and the
 * evidence rendering are incident-specific.
 */
export function IncidentView({
  repoName,
  messages,
  streaming,
  reconnecting,
  recovered,
  error,
  symbols = [],
  onSubmit,
  onNavigate,
  onOpenInWorkbench,
  onTraceCrash
}: IncidentViewProps) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const lastAssistantId = lastAssistant?.id;
  // Issue 23 integration — crash point = first physically resolvable VERIFIED
  // assertion of the latest answer (stack frames are resolved in order, so the
  // first match is the deepest frame of the pasted trace).
  const crashTarget = (() => {
    const row = lastAssistant?.evidence?.find(
      (candidate) =>
        candidate.status === 'VERIFIED' && candidate.file.length > 0 && candidate.line > 0
    );
    return row ? { symbol: row.label, file: row.file } : null;
  })();
  const actionsEnabled = Boolean(onOpenInWorkbench || onTraceCrash);

  return (
    <section data-testid="incident-view" className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-line bg-surface px-3 py-1.5">
        <span className="text-xs font-semibold text-ink">排障副驾驶 · Architecture &amp; Incident Copilot</span>
        <span data-testid="incident-repo" className="text-[10px] text-muted">
          {repoName ?? '未连接仓库'}
        </span>
      </header>

      <div data-testid="incident-messages" className="custom-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div data-testid="incident-empty" className="mx-auto mt-8 max-w-md text-center">
            <h2 className="text-base font-semibold text-ink">把线上故障贴进来</h2>
            <p className="mt-2 text-sm text-muted">
              粘贴堆栈或描述症状，副驾驶只用本仓库索引过的物理证据（file:line + commit）定位崩溃点、
              诊断链路与影响面；无法证实的部分会明确标注 BREAK / SUSPECT。
            </p>
          </div>
        )}
        {messages.map((message) =>
          message.role === 'user' ? (
            <div key={message.id} data-testid="incident-user-message" className="mb-2 flex justify-end">
              <div className="max-w-[85%] rounded-md bg-accent/10 px-3 py-1.5 text-sm text-ink">
                <div>{message.text}</div>
                {message.stack && (
                  <pre
                    data-testid="incident-user-stack"
                    className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-line bg-surface p-1.5 font-mono text-[10px] text-muted"
                  >
                    {message.stack}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <div key={message.id} data-testid="incident-assistant-message" className="mb-3">
              <div className="rounded-md border border-line bg-surface p-2.5 text-sm text-ink">
                {message.text ? (
                  <div className="whitespace-pre-wrap">{message.text}</div>
                ) : (
                  <div className="text-xs text-muted">排查中…</div>
                )}
                {message.diagram && (
                  <MermaidDiagram
                    code={message.diagram}
                    onNavigate={onNavigate ? (file, line) => onNavigate(file, line) : undefined}
                    symbols={symbols}
                  />
                )}
                {message.evidence && message.evidence.length > 0 && (
                  <EvidenceCard evidence={message.evidence} onNavigate={onNavigate} />
                )}
                {message.status === 'done' &&
                  (message.provenance || message.usage || message.lowConfidence) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-[11px] text-muted">
                      {message.provenance && (
                        <span data-testid="incident-provenance">
                          {message.provenance === 'static' ? '静态图谱' : '模型推理'}
                        </span>
                      )}
                      {message.lowConfidence && (
                        <span className="text-warning">低置信度</span>
                      )}
                      {message.usage && (
                        <span data-testid="incident-usage">本次 {message.usage.total} tokens</span>
                      )}
                    </div>
                  )}
                {message.status === 'done' && message.id === lastAssistantId && actionsEnabled && (
                  <div
                    data-testid="incident-actions"
                    className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      接入工作台
                    </span>
                    {onTraceCrash && crashTarget && (
                      <button
                        type="button"
                        data-testid="incident-trace-crash"
                        onClick={() => onTraceCrash(crashTarget.symbol, crashTarget.file)}
                        className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:border-accent/40 hover:text-accent"
                      >
                        追踪 {crashTarget.symbol} 调用链 →
                      </button>
                    )}
                    {onOpenInWorkbench && (
                      <button
                        type="button"
                        data-testid="incident-open-workbench"
                        onClick={onOpenInWorkbench}
                        className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:border-accent/40 hover:text-accent"
                      >
                        在工作台打开对话 →
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        )}
        {streaming && (
          <div data-testid="incident-streaming" className="text-xs text-muted">
            排查中…
          </div>
        )}
        {reconnecting && (
          <div data-testid="incident-reconnecting" className="text-xs text-warning">
            连接中断，正在自动重连…
          </div>
        )}
        {recovered && (
          <div data-testid="incident-recovered" className="text-xs text-success">
            连接已恢复。
          </div>
        )}
        {error && (
          <div data-testid="incident-error" className="text-xs text-danger">
            {error}
          </div>
        )}
      </div>

      <StackTraceInput streaming={streaming} onSubmit={onSubmit} />
    </section>
  );
}
