import { useState, type FormEvent, type KeyboardEvent } from 'react';

interface StackTraceInputProps {
  streaming: boolean;
  /** Issue 23 — submit the incident question + pasted stack to the copilot. */
  onSubmit: (question: string, stack?: string) => void;
}

/**
 * Issue 23 — incident copilot composer: paste the stack trace / log excerpt,
 * describe the symptom, Enter (or the button) dispatches mode='incident'.
 *
 * Enter submits only when it is a real commit key: `isComposing` guards the
 * IME composition window (Chinese/Japanese input) and `keyCode === 229`
 * covers browsers that report composition keys through the legacy code —
 * without the guard, confirming a candidate with Enter would send the draft.
 */
export function StackTraceInput({ streaming, onSubmit }: StackTraceInputProps) {
  const [question, setQuestion] = useState('');
  const [stack, setStack] = useState('');
  const [showStack, setShowStack] = useState(false);

  const canSubmit = !streaming && question.trim().length > 0;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    onSubmit(question.trim(), stack.trim() || undefined);
    setQuestion('');
    setStack('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    // IME safety: both guards must pass before Enter commits the draft.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  };

  return (
    <form
      data-testid="incident-input"
      onSubmit={(e) => submit(e)}
      className="flex flex-col gap-2 border-t border-line bg-surface p-3"
    >
      <div className="flex items-center gap-2">
        <input
          data-testid="incident-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="描述线上症状，例如：下单接口 500，疑似 NPE"
          disabled={streaming}
          className="h-9 flex-1 rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent disabled:opacity-50"
        />
        <button
          type="button"
          data-testid="incident-toggle-stack"
          aria-pressed={showStack}
          onClick={() => setShowStack((v) => !v)}
          className="h-9 shrink-0 rounded-md border border-line px-2 text-xs font-medium text-muted hover:border-accent hover:text-accent"
        >
          {showStack ? '收起堆栈' : '粘贴堆栈'}
        </button>
        <button
          type="submit"
          data-testid="incident-submit"
          disabled={!canSubmit}
          className="h-9 shrink-0 rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          排查
        </button>
      </div>
      {showStack && (
        <textarea
          data-testid="incident-stack"
          value={stack}
          onChange={(e) => setStack(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="粘贴完整堆栈或日志片段（Java / TS 均可），例如：&#10;java.lang.NullPointerException&#10;  at com.demo.OrderService.create(OrderService.java:42)"
          rows={6}
          disabled={streaming}
          className="w-full resize-y rounded-md border border-line bg-surface p-2 font-mono text-xs text-ink outline-none focus:border-accent disabled:opacity-50"
        />
      )}
      <p className="text-[10px] text-muted">
        排查结论仅基于本仓库索引的物理锚点（file:line + commit）；堆栈中无法定位的帧会明确标注 BREAK，不作猜测。
      </p>
    </form>
  );
}
