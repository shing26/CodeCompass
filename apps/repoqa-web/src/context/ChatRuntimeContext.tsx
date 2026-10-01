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
  /** 最近一条 assistant 消息的锚点/调用链步骤——Canvas 与 Inspector 上下游切片面板共用。 */
  canvasAnchors: Anchor[];
  canvasTraceSteps: TraceStep[] | null;
  evolutionSession: ReturnType<typeof useEvolutionSession>;
  consentPending: ConsentPending | null;
  setConsentPending: (v: ConsentPending | null) => void;
  confirmConsent: () => void;
  /** v1.2.x（R4-19）— 隐私确认后 composer 草稿就绪提示（确认≠自动发送）。 */
  draftReady: boolean;
  clearDraftReady: () => void;
  /** LLM consent 门之后的程序化提问入口（Dashboard Top API / 深链）。 */
  handleSubmit: ReturnType<typeof useChat>['submit'];
  /** chat-merge — ChatView 的发送入口，同样受 consent 门保护。
   * sessionId 由 ChatView 传入（真实 chat-s*；v0.25 批3 误用 repoId 的回归锁）。 */
  chatGuardSend: (
    message: string,
    handlers: {
      onDelta: (text: string) => void;
      onRegenerate?: () => void;
      onPlan?: (cards: ChatPlanCard[]) => void;
    },
    sessionId: string
  ) => Promise<ChatTurnResult | null>;
  handleTrace: (api: TopApiEntry) => void;
  /** v1.2 票 08（R4-7）— 只给符号名的同一 call-chain 入口（概览层枢纽 /
   * ChatView 证据角标共用，避免同一段提交逻辑在两处各写一遍）。 */
  traceSymbol: (symbol: string) => void;
  /** 当前画布链路由谁发起——画布据此标注来源，消除「来历不明」。 */
  traceOrigin: string;
  /** v1.2.x — 全局模型热切换（自 ChatView.ModelSelect 提升为共享状态）：
   * TopBar 与 ChatView 消费同一份 modelInfo，切档即全站生效。 */
  modelInfo: { profiles: string[]; active: string; configured: boolean } | null;
  refreshModelInfo: () => void;
  switchModel: (name: string) => Promise<void>;
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
  // v1.2 票 08（R4-7）— 画布链路来源。默认 'chat'：用户自己发的问是唯一无歧义的
  // 起点；自动示例链路与概览/仪表盘入口会覆盖它。
  const [traceOrigin, setTraceOrigin] = useState('chat');
  // v1.2.x（R4-19）
  const [draftReady, setDraftReady] = useState(false);
  const clearDraftReady = useCallback(() => setDraftReady(false), []);
  const [consentPending, setConsentPending] = useState<ConsentPending | null>(null);
  // v1.2.x — 全局模型热切换状态（单一数据源：TopBar 与 ChatView 共用）。
  const [modelInfo, setModelInfo] = useState<{
    profiles: string[];
    active: string;
    configured: boolean;
  } | null>(null);

  const refreshModelInfo = useCallback(() => {
    client.chat
      .modelInfo()
      .then(setModelInfo)
      .catch(() => {
        // best-effort：模型信息拉不到时控件显示未配置态
      });
  }, [client]);

  useEffect(refreshModelInfo, [refreshModelInfo]);

  const switchModel = useCallback(
    async (name: string) => {
      await client.chat.switchModel(name);
      refreshModelInfo();
    },
    [client, refreshModelInfo]
  );

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
    setTraceOrigin('dashboard-entry');
    // Pass the clicked entry as structured input and force the deterministic
    // call-chain mode so the trace starts from THIS exact symbol (name + file),
    // never from a same-name sibling in another file (e.g. a test helper).
    handleSubmit(`${api.name} 的完整调用链是怎样的？`, 'call-chain', {
      name: api.name,
      file: api.filePath
    });
  };

  // v1.2 票 08（R4-7）— 枢纽符号只有名字（radar 的 hubNodes 不带 filePath），
  // 走同一条确定性 call-chain；发起方记为 'overview-hub'，画布照实标注。
  const traceSymbol = (symbol: string) => {
    setView('topo');
    setTraceOrigin('overview-hub');
    handleSubmit(`${symbol} 的完整调用链是怎样的？`, 'call-chain', {
      name: symbol,
      file: ''
    });
  };

  // 改造 2 (zero-click value): 拓扑首屏自动渲染首条 Top API 的调用链——
  // 每个仓库只自动触发一次（autoTracedRepoRef 守卫）。确定性 call-chain
  // 由 worker 绕过 LLM，无需 consent 门（submit 直调而非 handleSubmit）。
  // v1.2 票 08（R4-7）：这条链路是**用户没要求的**样本，此前独占首屏且无任何
  // 来源标注（走查记为「来历不明」）。保留零点击价值，但把发起方记为
  // 'auto-topapi'，画布在链路区上方照实标出「自动示例」。
  const autoTracedRepoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!repoId || view !== 'topo' || dashboardLoading || !dashboard) return;
    if (autoTracedRepoRef.current === repoId) return;
    const first = dashboard.topApis?.[0];
    if (first) {
      autoTracedRepoRef.current = repoId;
      setTraceOrigin('auto-topapi');
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
   * ChatView can restore the draft. sessionId 由 ChatView 传入（真实 chat-s*
   * 行）——v0.25 批3 分片时误把 currentRepo.id 当 sessionId，真实前端全部
   * 404 unknown session（computer-use 走查抓到，登记 v027-ui 票 03）。 */
  const chatGuardSend = useCallback(
    (
      message: string,
      handlers: {
        onDelta: (text: string) => void;
        onRegenerate?: () => void;
        onPlan?: (cards: ChatPlanCard[]) => void;
      },
      sessionId: string
    ) => {
      if (runtime.llm.mode === 'remote' && !llmConsented) {
        setConsentPending({ question: message, chatMessage: message });
        return Promise.resolve(null);
      }
      if (!currentRepo) return Promise.resolve(null);
      return client.chat.chatSend(sessionId, message, handlers);
    },
    [runtime.llm.mode, llmConsented, currentRepo, client]
  );

  const confirmConsent = () => {
    setLlmConsented(true);
    if (consentPending) {
      if (consentPending.chatMessage) {
        // chat 路径：输入保留在 ChatView，用户再次发送即走已授权通道。
        // v1.2.x（R4-19）— 置 draftReady 让 ChatView 显式提示「草稿已就绪，
        // 点发送」：确认后不自动发（不误发），但要让用户知道为何没发出去。
        setConsentPending(null);
        setDraftReady(true);
        return;
      }
      submit(consentPending.question, consentPending.mode, consentPending.start, consentPending.stack);
    }
    setConsentPending(null);
  };

  // The Inspector's 上下游切片 slice panel follows the latest resolved trace, and
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
    draftReady,
    clearDraftReady,
    handleSubmit,
    chatGuardSend,
    handleTrace,
    traceSymbol,
    traceOrigin,
    modelInfo,
    refreshModelInfo,
    switchModel
  };

  return <ChatRuntimeContext.Provider value={value}>{children}</ChatRuntimeContext.Provider>;
}

export function useChatRuntime(): ChatRuntimeContextValue {
  const ctx = useContext(ChatRuntimeContext);
  if (!ctx) throw new Error('useChatRuntime must be used inside <ChatRuntimeProvider>');
  return ctx;
}
