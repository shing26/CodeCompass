import { useCallback, useEffect, useRef, useState } from 'react';
import type { Anchor, QueryMode, QueryStart } from '../types';
import type { QueryStreamLike, RepoQAClient } from '../client/RepoQAClient';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  diagram?: string;
  anchors?: Anchor[];
  /** Suggested follow-up from the backend done payload. */
  suggestedAction?: string;
  /** 'streaming' during an in-flight SSE stream, 'done' once it finished. */
  status?: 'streaming' | 'done';
  /** True when this trace hit a Static Analysis Break (see ticket 06). */
  break?: boolean;
}

let nextId = 1;
function uid(): string {
  return `msg-${nextId++}`;
}

export interface UseChatResult {
  messages: ChatMessage[];
  streaming: boolean;
  /** True while auto-reconnect is retrying a dropped SSE connection (07). */
  reconnecting: boolean;
  error: string | null;
  submit: (question: string, mode?: QueryMode, start?: QueryStart) => void;
  /** Manually re-run the last question after permanent reconnect failure (07). */
  retry: () => void;
  reset: () => void;
}

/**
 * Owns chat state for the current repo: message list, streaming flag and the
 * active SSE stream. Switching repos cancels the in-flight stream and clears
 * messages. All stream wiring is driven through the injected QueryStreamLike
 * so tests can fake SSE without a real EventSource.
 */
export function useChat(client: RepoQAClient, repoId: string | null): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<QueryStreamLike | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const lastQuestionRef = useRef<string | null>(null);
  const lastModeRef = useRef<QueryMode | undefined>(undefined);
  const lastStartRef = useRef<QueryStart | undefined>(undefined);

  const cancel = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
  }, []);

  // Repo switch: cancel stream and reset conversation context.
  useEffect(() => {
    cancel();
    setMessages([]);
    setStreaming(false);
    setReconnecting(false);
    setError(null);
  }, [repoId, cancel]);

  // Cleanup on unmount.
  useEffect(() => () => cancel(), [cancel]);

  /** Wire one query stream onto the assistant bubble identified by assistantId. */
  const attachStream = useCallback((stream: QueryStreamLike) => {
    streamRef.current = stream;

    const withAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantIdRef.current ? fn(m) : m)));

    stream.onEvent((event) => {
      if (event.type === 'token') {
        setReconnecting(false);
        withAssistant((m) => ({ ...m, text: m.text + event.text }));
      } else if (event.type === 'mermaid') {
        withAssistant((m) => ({ ...m, diagram: event.code }));
      } else if (event.type === 'anchors') {
        withAssistant((m) => ({ ...m, anchors: event.anchors }));
      } else if (event.type === 'done') {
        const suggestedAction =
          typeof event.payload?.suggestedAction === 'string'
            ? event.payload.suggestedAction
            : undefined;
        if (suggestedAction) withAssistant((m) => ({ ...m, suggestedAction }));
      } else if (event.type === 'error') {
        setError(event.error);
        setReconnecting(false);
        setStreaming(false);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.text === '' && !last.diagram) {
            return prev.slice(0, -1);
          }
          return prev.map((m) =>
            m.id === assistantIdRef.current ? { ...m, break: true, status: 'done' } : m
          );
        });
      }
    });

    // Connection-level errors (07): the stream reopens the same URL, so any
    // already-rendered in-flight content resets and is replayed; completed
    // bubbles are never touched.
    stream.onError((err) => {
      const e = (err ?? {}) as { kind?: 'transient' | 'permanent'; attempt?: number };
      if (e.kind === 'permanent') {
        setReconnecting(false);
        setError('连接中断，自动重连失败，请手动重试。');
        setStreaming(false);
        withAssistant((m) => ({ ...m, break: true, status: 'done' }));
      } else {
        setReconnecting(true);
        withAssistant((m) => ({ ...m, text: '', diagram: undefined, anchors: [] }));
      }
    });

    stream.onDone(() => {
      setStreaming(false);
      setReconnecting(false);
      streamRef.current = null;
      withAssistant((m) => ({
        ...m,
        status: 'done',
        // Ticket 06: a query that produced neither code evidence nor a
        // diagram is presented as a break, never as a silent success.
        break: m.break === true || (!m.anchors?.length && !m.diagram)
      }));
    });

    stream.connect();
  }, []);

  const submit = useCallback(
    (question: string, mode?: QueryMode, start?: QueryStart) => {
      const q = question.trim();
      if (!q || !repoId || streaming) return;

      cancel();
      lastQuestionRef.current = q;
      lastModeRef.current = mode;
      lastStartRef.current = start;
      assistantIdRef.current = null;
      setError(null);
      setReconnecting(false);
      setStreaming(true);

      const userId = uid();
      const assistantId = uid();
      assistantIdRef.current = assistantId;
      setMessages((prev) => [
        ...prev,
        { id: userId, role: 'user', text: q },
        { id: assistantId, role: 'assistant', text: '', status: 'streaming' }
      ]);

      attachStream(client.queryRepo(repoId, q, mode, start));
    },
    [attachStream, cancel, client, repoId, streaming]
  );

  /** Ticket 07: re-run the last question in place — no duplicate user bubble. */
  const retry = useCallback(() => {
    if (!repoId || streaming) return;
    const q = lastQuestionRef.current;
    if (!q) return;

    cancel();
    const failedId = assistantIdRef.current;
    assistantIdRef.current = null;
    setError(null);
    setReconnecting(false);
    setStreaming(true);

    const assistantId = uid();
    assistantIdRef.current = assistantId;
    setMessages((prev) => {
      const kept = failedId ? prev.filter((m) => m.id !== failedId) : prev;
      return [...kept, { id: assistantId, role: 'assistant', text: '', status: 'streaming' }];
    });

    // Keep the original mode (e.g. call-chain from a Top API click) on retry.
    attachStream(client.queryRepo(repoId, q, lastModeRef.current, lastStartRef.current));
  }, [attachStream, cancel, client, repoId, streaming]);

  const reset = useCallback(() => {
    cancel();
    assistantIdRef.current = null;
    lastQuestionRef.current = null;
    lastModeRef.current = undefined;
    lastStartRef.current = undefined;
    setMessages([]);
    setError(null);
    setReconnecting(false);
    setStreaming(false);
  }, [cancel]);

  return { messages, streaming, reconnecting, error, submit, retry, reset };
}