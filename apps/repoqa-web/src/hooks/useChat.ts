import { useCallback, useEffect, useRef, useState } from 'react';
import type { Anchor, EvidenceItem, QueryMode, QueryStart, TokenUsage, TraceStep } from '../types';
import type { QueryStreamLike, RepoQAClient } from '../client/RepoQAClient';
import { parseEvidenceFromAnswer } from '../components/evidence';

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
  /** 静态图谱 vs 模型推理 provenance, from the done SSE payload. */
  provenance?: 'static' | 'llm';
  lowConfidence?: boolean;
  confidence?: number;
  /** Provider or estimated token usage for this single message. */
  usage?: TokenUsage;
  /** v0.10 — ordered trace hops from the SSE done payload (live step strip). */
  traceSteps?: TraceStep[];
  /** Issue 23 — mode this message was asked in ('incident' for the copilot). */
  mode?: QueryMode;
  /** Issue 23 — the stack trace pasted with the incident question. */
  stack?: string;
  /** Issue 23 — grounded assertions parsed from the incident answer. */
  evidence?: EvidenceItem[];
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
  /** True briefly after a reconnect recovers, so the UI can confirm it. */
  recovered: boolean;
  error: string | null;
  submit: (question: string, mode?: QueryMode, start?: QueryStart, stack?: string) => void;
  /** Issue 23 — ask the incident copilot with an optional pasted stack trace. */
  askIncident: (question: string, stack?: string) => void;
  /** Manually re-run the last question after permanent reconnect failure (07). */
  retry: () => void;
  reset: () => void;
  /** Cumulative token usage for the current repo conversation. */
  totalUsage: TokenUsage;
}

function zeroUsage(): TokenUsage {
  return { input: 0, output: 0, total: 0, source: 'estimate' };
}

function isTokenUsage(value: unknown): value is TokenUsage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TokenUsage>;
  return (
    typeof candidate.input === 'number' &&
    typeof candidate.output === 'number' &&
    typeof candidate.total === 'number' &&
    (candidate.source === 'provider' || candidate.source === 'estimate')
  );
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    total: left.total + right.total,
    source: left.source === 'provider' && right.source === 'provider' ? 'provider' : 'estimate'
  };
}

/** v0.10 — normalize the SSE done.payload.trace into TraceStep[] (defensive). */
function parseTraceSteps(payload: Record<string, unknown> | undefined): TraceStep[] | undefined {
  const raw = payload?.trace;
  if (!Array.isArray(raw)) return undefined;
  const steps: TraceStep[] = [];
  for (const hop of raw) {
    if (!hop || typeof hop !== 'object') continue;
    const h = hop as {
      file?: unknown;
      method?: unknown;
      line?: unknown;
      lineEnd?: unknown;
      break?: unknown;
      async?: unknown;
      http?: { method?: unknown };
    };
    if (typeof h.file !== 'string' || typeof h.method !== 'string') continue;
    steps.push({
      file: h.file,
      line: typeof h.line === 'number' ? h.line : 1,
      ...(typeof h.lineEnd === 'number' ? { lineEnd: h.lineEnd } : {}),
      symbol: h.method,
      status: h.break === true ? 'BROKEN' : 'VERIFIED',
      ...(h.async === true ? { async: true } : {}),
      ...(typeof h.http?.method === 'string' ? { httpMethod: h.http.method } : {})
    });
  }
  return steps.length > 0 ? steps : undefined;
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
  const [recovered, setRecovered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalUsage, setTotalUsage] = useState<TokenUsage>(zeroUsage());
  const streamRef = useRef<QueryStreamLike | null>(null);
  const assistantIdRef = useRef<string | null>(null);
  const lastQuestionRef = useRef<string | null>(null);
  const lastModeRef = useRef<QueryMode | undefined>(undefined);
  const lastStartRef = useRef<QueryStart | undefined>(undefined);
  const lastStackRef = useRef<string | undefined>(undefined);
  const historyByRepo = useRef(new Map<string, ChatMessage[]>());
  const usageByRepo = useRef(new Map<string, TokenUsage>());
  const lastRepoRef = useRef<string | null>(null);
  const repoIdRef = useRef<string | null>(repoId);
  const messagesRef = useRef<ChatMessage[]>([]);
  const reconnectingRef = useRef(false);
  const recoveredTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    repoIdRef.current = repoId;
  }, [repoId]);

  useEffect(() => {
    reconnectingRef.current = reconnecting;
  }, [reconnecting]);

  const cancel = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
  }, []);

  // Repo switch: cancel stream and reset conversation context.
  useEffect(() => {
    const previousRepo = lastRepoRef.current;
    if (previousRepo && previousRepo !== repoId) {
      historyByRepo.current.set(
        previousRepo,
        messagesRef.current.filter((message) => message.status !== 'streaming')
      );
    }
    lastRepoRef.current = repoId;
    cancel();
    setMessages(repoId ? (historyByRepo.current.get(repoId) ?? []) : []);
    setTotalUsage(repoId ? (usageByRepo.current.get(repoId) ?? zeroUsage()) : zeroUsage());
    setStreaming(false);
    setReconnecting(false);
    setRecovered(false);
    if (recoveredTimer.current) clearTimeout(recoveredTimer.current);
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
        if (reconnectingRef.current) {
          setReconnecting(false);
          setRecovered(true);
          if (recoveredTimer.current) clearTimeout(recoveredTimer.current);
          recoveredTimer.current = setTimeout(() => setRecovered(false), 2000);
        }
        withAssistant((m) => ({ ...m, text: m.text + event.text }));
      } else if (event.type === 'mermaid') {
        if (reconnectingRef.current) {
          setReconnecting(false);
          setRecovered(true);
          if (recoveredTimer.current) clearTimeout(recoveredTimer.current);
          recoveredTimer.current = setTimeout(() => setRecovered(false), 2000);
        }
        withAssistant((m) => ({ ...m, diagram: event.code }));
      } else if (event.type === 'anchors') {
        withAssistant((m) => ({ ...m, anchors: event.anchors }));
      } else if (event.type === 'done') {
        if (reconnectingRef.current) {
          setReconnecting(false);
          setRecovered(true);
          if (recoveredTimer.current) clearTimeout(recoveredTimer.current);
          recoveredTimer.current = setTimeout(() => setRecovered(false), 2000);
        }
        const suggestedAction =
          typeof event.payload?.suggestedAction === 'string'
            ? event.payload.suggestedAction
            : undefined;
        const usage = isTokenUsage(event.payload?.usage) ? event.payload.usage : undefined;
        const provenance =
          event.payload?.provenance === 'llm' || event.payload?.provenance === 'static'
            ? event.payload.provenance
            : undefined;
        const lowConfidence = event.payload?.lowConfidence === true;
        const confidence =
          typeof event.payload?.confidence === 'number' ? event.payload.confidence : undefined;
        const traceSteps = parseTraceSteps(event.payload);
        if (
          suggestedAction ||
          usage ||
          provenance !== undefined ||
          lowConfidence ||
          confidence !== undefined ||
          traceSteps !== undefined
        ) {
          withAssistant((m) => ({
            ...m,
            suggestedAction,
            usage,
            provenance,
            lowConfidence,
            confidence,
            traceSteps
          }));
        }
        // Issue 23 — incident messages ground their assertions into evidence
        // cards (VERIFIED/BREAK/SUSPECT) parsed from the answer text plus the
        // validated anchors. Narrative text without assertions stays unparsed.
        if (lastModeRef.current === 'incident') {
          withAssistant((m) => ({
            ...m,
            evidence: parseEvidenceFromAnswer(m.text, m.anchors ?? [])
          }));
        }
        if (usage) {
          setTotalUsage((prev) => {
            const next = addUsage(prev, usage);
            const key = repoIdRef.current ?? '';
            usageByRepo.current.set(key, next);
            return next;
          });
        }
      } else if (event.type === 'error') {
        setError(event.error);
        setReconnecting(false);
        setRecovered(false);
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
        setRecovered(false);
        setError('连接中断，自动重连失败，请手动重试。');
        setStreaming(false);
        withAssistant((m) => ({ ...m, break: true, status: 'done' }));
      } else {
        setReconnecting(true);
        setRecovered(false);
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
    (question: string, mode?: QueryMode, start?: QueryStart, stack?: string) => {
      const q = question.trim();
      if (!q || !repoId || streaming) return;

      cancel();
      lastQuestionRef.current = q;
      lastModeRef.current = mode;
      lastStartRef.current = start;
      lastStackRef.current = stack;
      assistantIdRef.current = null;
      setError(null);
      setReconnecting(false);
      setRecovered(false);
      setStreaming(true);

      const userId = uid();
      const assistantId = uid();
      assistantIdRef.current = assistantId;
      setMessages((prev) => [
        ...prev,
        {
          id: userId,
          role: 'user',
          text: q,
          ...(mode === 'incident' ? { mode, stack } : {})
        },
        { id: assistantId, role: 'assistant', text: '', status: 'streaming' }
      ]);

      attachStream(
        client.queryRepo(repoId, q, mode, start, mode === 'incident' ? stack : undefined)
      );
    },
    [attachStream, cancel, client, repoId, streaming]
  );

  /** Issue 23 — incident copilot entry: mode='incident' + pasted stack. */
  const askIncident = useCallback(
    (question: string, stack?: string) => {
      submit(question, 'incident', undefined, stack);
    },
    [submit]
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
    setRecovered(false);
    setStreaming(true);

    const assistantId = uid();
    assistantIdRef.current = assistantId;
    setMessages((prev) => {
      const kept = failedId ? prev.filter((m) => m.id !== failedId) : prev;
      return [...kept, { id: assistantId, role: 'assistant', text: '', status: 'streaming' }];
    });

    // Keep the original mode (e.g. call-chain from a Top API click) on retry.
    attachStream(
      client.queryRepo(
        repoId,
        q,
        lastModeRef.current,
        lastStartRef.current,
        lastModeRef.current === 'incident' ? lastStackRef.current : undefined
      )
    );
  }, [attachStream, cancel, client, repoId, streaming]);

  const reset = useCallback(() => {
    cancel();
    assistantIdRef.current = null;
    lastQuestionRef.current = null;
    lastModeRef.current = undefined;
    lastStartRef.current = undefined;
    lastStackRef.current = undefined;
    setMessages([]);
    usageByRepo.current.delete(repoIdRef.current ?? '');
    setTotalUsage(zeroUsage());
    setError(null);
    setReconnecting(false);
    setRecovered(false);
    if (recoveredTimer.current) clearTimeout(recoveredTimer.current);
    setStreaming(false);
  }, [cancel]);

  return {
    messages,
    streaming,
    reconnecting,
    recovered,
    error,
    submit,
    askIncident,
    retry,
    reset,
    totalUsage
  };
}
