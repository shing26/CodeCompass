import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useChat } from '../hooks/useChat';
import { useEvolutionSession } from '../hooks/useEvolutionSession';
import type { ChatPlanCard, ChatTurnResult } from '../client/RepoQAClient';
import { useRepo } from './RepoContext';
import type { Anchor, QueryMode, RuntimeInfo, TopApiEntry, TraceStep } from '../types';

interface ConsentPending {
  question: string;
  mode?: QueryMode;
  start?: { name: string; file: string };
  stack?: string;
  chatMessage?: string;
}

interface ChatRuntimeContextValue {
  runtime: RuntimeInfo;
  totalUsage: ReturnType<typeof useChat>['totalUsage'];
  /** 最近一条 assistant 消息的锚点/调用链步骤——Canvas 与 Inspector 2-Hop 面板共用。 */
  canvasAnchors: Anchor[];
  canvasTraceSteps: TraceStep[] | null;
  evolutionSession: ReturnType<typeof useEvolutionSession>;
  consentPending: ConsentPending | null;
  setConsentPending: (v: ConsentPending | null) => void;
  confirmConsent: () => void;
  /** LLM consent 门之后的程序化提问入口（Dashboard Top API / 深链）。 */
  handleSubmit: ReturnType<typeof useChat>['submit'];
  /** chat-merge — ChatView 的发送入口，同样受 consent 门保护。 */
  chatGuardSend: (
    message: string,
    handlers: {
      onDelta: (text: string) => void;
      onRegenerate?: () => void;
      onPlan?: (cards: ChatPlanCard[]) => void;
    }
  ) => Promise<ChatTurnResult | null>;
  handleTrace: (api: TopApiEntry) => void;
}

const ChatRuntimeContext = createContext<ChatRuntimeContextValue | null>(null);

/**
 * v0.25.0 批次 3：对话运行时状态分片——LLM runtime 探测、consent 门、
 * 程序化调用链提问（useChat）、演进流（Ticket 24.5：App 持有流，切 tab 不
 * 掉线）与拓扑首屏自动 trace。只依赖 RepoContext（单向）。
 */
export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const { client, repoId, currentRepo, view, setView, dashboard, dashboardLoading } = useRepo();
  // Issue 25 / Ticket 01 — the free-input chat composer is gone; useChat now
  // feeds only the programmatic call-chain trace (Top API / crash-point) and
  // the derived canvas trace + the Inspector's token budget.
  const { messages, submit, totalUsage } = useChat(client, repoId);
  // Ticket 24.5 — the evolution artifact stream is App-owned so switching
  // workbench tabs (or closing the Inspector) never drops the stream.
  const evolutionSession = useEvolutionSession(client, currentRepo);
  const [runtime, setRuntime] = useState<RuntimeInfo>({ llm: { mode: 'none' } });
  const [llmConsented, setLlmConsented] = useState(false);
  const [consentPending, setConsentPending] = useState<ConsentPending | null>(null);

  useEffect(() => {
    client
      .getRuntime()
      .then(setRuntime)
      .catch(() => {
        // Runtime metadata is best-effort; the app still works without it.
      });
  }, [client]);

  const handleTrace = (api: TopApiEntry) => {
    setView('topo');
    // Pass the clicked entry as structured input and force the deterministic
    // call-chain mode so the trace starts from THIS exact symbol (name + file),
    // never from a same-name sibling in another file (e.g. a test helper).
    handleSubmit(`${api.name} 的完整调用链是怎样的？`, 'call-chain', {
      name: api.name,
      file: api.filePath
    });
  };

  // 改造 2 (zero-click value): 拓扑首屏自动渲染首条 Top API 的调用链——
  // 每个仓库只自动触发一次（autoTracedRepoRef 守卫）。确定性 call-chain
  // 由 worker 绕过 LLM，无需 consent 门（submit 直调而非 handleSubmit）。
  const autoTracedRepoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!repoId || view !== 'topo' || dashboardLoading || !dashboard) return;
    if (autoTracedRepoRef.current === repoId) return;
    const first = dashboard.topApis?.[0];
    if (first) {
      autoTracedRepoRef.current = repoId;
      submit(`${first.name} 的完整调用链是怎样的？`, 'call-chain', {
        name: first.name,
        file: first.filePath
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, view, dashboardLoading, dashboard]);

  const handleSubmit: typeof submit = (question, mode, start, stack) => {
    if (runtime.llm.mode === 'remote' && !llmConsented) {
      setConsentPending({ question, mode, start, stack });
      return;
    }
    submit(question, mode, start, stack);
  };

  /** chat-merge — chat send guarded by the same LLM consent gate as the
   * legacy incident composer. Returns null when consent was cancelled so the
   * ChatView can restore the draft. */
  const chatGuardSend = useCallback(
    (
      message: string,
      handlers: {
        onDelta: (text: string) => void;
        onRegenerate?: () => void;
        onPlan?: (cards: ChatPlanCard[]) => void;
      }
    ) => {
      if (runtime.llm.mode === 'remote' && !llmConsented) {
        setConsentPending({ question: message, chatMessage: message });
        return Promise.resolve(null);
      }
      if (!currentRepo) return Promise.resolve(null);
      return client.chat.chatSend(currentRepo.id, message, handlers);
    },
    [runtime.llm.mode, llmConsented, currentRepo, client]
  );

  const confirmConsent = () => {
    setLlmConsented(true);
    if (consentPending) {
      if (consentPending.chatMessage) {
        // chat 路径：输入保留在 ChatView，用户再次发送即走已授权通道
        setConsentPending(null);
        return;
      }
      submit(consentPending.question, consentPending.mode, consentPending.start, consentPending.stack);
    }
    setConsentPending(null);
  };

  // The Inspector's 2-Hop slice panel follows the latest resolved trace, and
  // Issue 25 / Ticket 01 — the topology canvas renders the same trace directly
  // (Canvas no longer owns the chat bubble stream).
  const canvasAnchors = useMemo<Anchor[]>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === 'assistant' && message.anchors?.length) {
        return message.anchors;
      }
    }
    return [];
  }, [messages]);
  const canvasTraceSteps = useMemo<TraceStep[] | null>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === 'assistant' && message.traceSteps && message.traceSteps.length > 0) {
        return message.traceSteps;
      }
    }
    return null;
  }, [messages]);

  const value: ChatRuntimeContextValue = {
    runtime,
    totalUsage,
    canvasAnchors,
    canvasTraceSteps,
    evolutionSession,
    consentPending,
    setConsentPending,
    confirmConsent,
    handleSubmit,
    chatGuardSend,
    handleTrace
  };

  return <ChatRuntimeContext.Provider value={value}>{children}</ChatRuntimeContext.Provider>;
}

export function useChatRuntime(): ChatRuntimeContextValue {
  const ctx = useContext(ChatRuntimeContext);
  if (!ctx) throw new Error('useChatRuntime must be used inside <ChatRuntimeProvider>');
  return ctx;
}
