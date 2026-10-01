import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { RepoQAClient, ChatCitation, ChatTurnResult, ChatPlanCard } from '../client/RepoQAClient';
import { describeError } from '../client/errorCodes';
import { PlanCardView } from './PlanCardView';

/** 改造 3：快捷交互卡片——标题 + 副标题（意图），点击直发请求。 */
const STARTER_CARDS = [
  {
    title: '全库架构透视',
    subtitle: '梳理整体分层、核心模块与技术栈分布',
    prompt: '这个仓库的整体架构和技术栈是怎样的？分层和核心模块是什么？'
  },
  {
    title: '高危大文件与孤立代码',
    subtitle: '定位 Top 极值大文件与无入度符号',
    prompt: '分析此仓是否有死代码或高风险大文件？列出最值得关注的几个。'
  },
  {
    title: '核心业务调用链路',
    subtitle: '基于当前 Routes 绘制端到端调用链',
    prompt: '梳理核心业务的全链路调用关系，画出主要请求的时序图。'
  },
  {
    title: '变更风险评估',
    subtitle: '分析特定方法或未提交修改的影响范围',
    prompt: '分析这个仓库的变更风险：哪些方法改动影响面最大？'
  }
];

interface ChatEntry {
  key: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[];
  planCards?: ChatPlanCard[];
  streaming?: boolean;
  regenerating?: boolean;
}

interface ChatSessionInfo {
  id: string;
  repoId: string;
  title: string;
  createdAt: string;
}

function splitCites(content: string): Array<{ kind: 'text' | 'cite'; value: string }> {
  const segments: Array<{ kind: 'text' | 'cite'; value: string }> = [];
  const pattern = /\[cite:\s*(\d+)\]/g;
  const matches = Array.from(content.matchAll(pattern));
  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) {
      segments.push({ kind: 'text', value: content.slice(cursor, match.index) });
    }
    segments.push({ kind: 'cite', value: match[1] });
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length || segments.length === 0) {
    segments.push({ kind: 'text', value: content.slice(cursor) });
  }
  return segments;
}

/** chat-merge Q4: cite 角标 → Workbench 内部深链（Canvas 定位符号）。 */
function MessageBody(props: {
  content: string;
  citations?: ChatCitation[];
  onNavigate: (symbol: string) => void;
}) {
  const { content, citations, onNavigate } = props;
  const [activeCite, setActiveCite] = useState<number | null>(null);
  const segments = splitCites(content);
  const active = citations?.find((c) => c.n === activeCite);
  const markdownOf = (text: string) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      }}
    >
      {text}
    </ReactMarkdown>
  );
  // 深链目标：citation 参数里的 symbol（scan/diagnose 类工具返回都带）
  const symbolOf = (c: ChatCitation): string => {
    const args = c.args as { symbolOrMethod?: string; symbol?: string };
    return String(args.symbolOrMethod ?? args.symbol ?? '');
  };

  return (
    <div className="msg-body min-w-0 [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-subtle [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-xs [&_a]:text-accent [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-line [&_pre]:bg-code [&_pre]:p-2 [&_strong]:text-ink [&_table]:my-1 [&_table]:text-xs [&_td]:border [&_td]:border-line [&_td]:px-1.5 [&_th]:border [&_th]:border-line [&_th]:px-1.5 [&_ul]:list-disc [&_ul]:pl-5">
      {segments.map((segment, i) => (
        <Fragment key={i}>
          {segment.kind === 'text' ? (
            markdownOf(segment.value)
          ) : (
            <button
              className={`chat-cite mx-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full align-super text-micro font-semibold ${
                activeCite === Number(segment.value)
                  ? 'chat-cite-active bg-accent text-white'
                  : 'bg-accent/15 text-accent hover:bg-accent/30'
              }`}
              onClick={() => setActiveCite(activeCite === Number(segment.value) ? null : Number(segment.value))}
              title="查看来源工具调用"
            >
              {segment.value}
            </button>
          )}
        </Fragment>
      ))}
      {active && (
        <div className="chat-cite-detail mt-2 rounded-md border border-line bg-subtle px-2 py-1.5 font-mono text-xs text-muted" data-testid="chat-cite-detail">
          [{active.n}] <code>{active.tool}</code>({JSON.stringify(active.args).slice(0, 140)}) — {active.ms}ms
          {symbolOf(active) && (
            <button className="chat-cite-jump ml-2 text-accent hover:underline" onClick={() => onNavigate(symbolOf(active))}>
              在拓扑中查看 →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 模型热切换（批次 D 的 UI 面已就绪，等 llm-profiles 配第二个 profile）。
 * v1.2.x — 数据由 App 从 ChatRuntimeContext 消费后下传（单一数据源：与 TopBar
 * 全局模型胶囊共用同一份 modelInfo，任一处切换另一处即时同步）。组件保持纯
 * props 依赖，便于无 Provider 的组件级测试。
 */
function ModelSelect({
  modelInfo,
  onSwitchModel
}: {
  modelInfo: { profiles: string[]; active: string; configured: boolean } | null;
  onSwitchModel: (name: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <select
        data-testid="chat-model-select"
        className="w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent disabled:opacity-50"
        value={modelInfo?.active ?? ''}
        onChange={(e) => {
          try {
            setError(null);
            onSwitchModel(e.target.value);
          } catch (err) {
            setError(describeError(err));
          }
        }}
        disabled={!modelInfo?.profiles.length}
      >
        {(modelInfo?.profiles ?? []).map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <div className="chat-hint text-xs text-muted">{error ?? (modelInfo?.configured ? '热切换即时生效' : 'LLM 未配置')}</div>
    </>
  );
}

/**
 * v1.2 票 05（V27-15）— 超长回答折叠：长作答（流式结束后超阈值）默认只渲染
 * 前 LONG_ANSWER_CHARS 字 + 「展开全文」——~300+ DOM 节点淹没可访问性树的问题
 * （computer-use 走查 D5 实证，流式后元素 index 漂移）回到可控量级。
 * 折叠态不丢内容：展开即完整回放，内容不做任何重写；流式中不折叠（避免边流边折）。
 */
const LONG_ANSWER_CHARS = 2400;

/**
 * v1.2 收口（评审 P2）— 折叠切点安全回退：直接 slice 会切半 `[cite: N]`（渲染成
 * 字面残片）并可能在代理对中间断（UTF-16）。规则：≤limit 原样；否则回退到切点前
 * 120 字符窗口内最近的换行/空格，并丢弃尾部残缺的 `[cite:` 前缀。
 */
function foldAt(content: string, limit: number): string {
  if (content.length <= limit) return content;
  let cut = limit;
  const code = content.charCodeAt(cut);
  if (code >= 0xdc00 && code <= 0xdfff) cut -= 1;
  const windowStart = Math.max(0, cut - 120);
  const window = content.slice(windowStart, cut);
  const boundary = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '));
  if (boundary > 0) cut = windowStart + boundary;
  return `${content.slice(0, cut).replace(/\[cite:\s*\d*$/, '')}…`;
}

function AnswerBody({
  content,
  citations,
  streaming,
  onNavigate
}: {
  content: string;
  citations?: ChatCitation[];
  streaming?: boolean;
  onNavigate: (symbol: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = !streaming && content.length > LONG_ANSWER_CHARS;
  const shown = isLong && !expanded ? foldAt(content, LONG_ANSWER_CHARS) : content;
  return (
    <>
      <MessageBody content={shown} citations={citations} onNavigate={onNavigate} />
      {isLong && (
        <button
          type="button"
          data-testid="chat-expand-answer"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 self-start rounded-md border border-line bg-subtle px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </>
  );
}

export function ChatView(props: {
  client: RepoQAClient;
  repoId: string;
  repoName: string | null;
  onNavigate: (symbol: string) => void;
  onBackToWorkbench: () => void;
  onSend: (
    message: string,
    handlers: {
      onDelta: (text: string) => void;
      onRegenerate?: () => void;
      onPlan?: (cards: ChatPlanCard[]) => void;
    },
    /** 真实会话 id（chat-s*）——调用方需要它来 POST /sessions/:id/messages */
    sessionId: string
  ) => Promise<ChatTurnResult | null>;
  /** v0.26-A ticket 02 (Q3)：方案摘要卡 CTA 跳规范演进——App 组合层注入。 */
  onOpenEvolution?: () => void;
  /** v0.27-UI ticket 02 (U3)：AskDock 预填草稿——挂载时进 composer 但不自动发送。 */
  initialDraft?: string;
  onDraftConsumed?: () => void;
  /** v1.2.x：模型热切换数据（App 从 ChatRuntimeContext 消费下传——与 TopBar
   * 全局模型胶囊同源）。未传 = 无模型信息（组件级测试态）。 */
  modelInfo?: { profiles: string[]; active: string; configured: boolean } | null;
  onSwitchModel?: (name: string) => void;
  /** v1.2.x（R4-19）— 隐私确认后的草稿就绪提示。 */
  draftReady?: boolean;
  onDismissDraftReady?: () => void;
}) {
  const { client, repoId, repoName, onNavigate, onBackToWorkbench, onSend, onOpenEvolution, initialDraft, onDraftConsumed, modelInfo, onSwitchModel, draftReady, onDismissDraftReady } = props;
  const chatClient = client.chat;
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSessionInfo | null>(null);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v0.27-UI ticket 01: 375px 会话侧栏 off-canvas（模式对齐 App 全局 Sidebar 抽屉）。
  const [sideOpen, setSideOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 自适应高度挂在 input 的 effect 上（review P1-1）：命令式 style 不会被
  // React 重渲染重置，放 onChange 会让「发送清空/consent 草稿恢复/程序化
  // 赋值」三条路径留下最高 128px 的空框——effect 统一覆盖全部 value 变化。
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 128)}px`;
  }, [input]);

  // AskDock 预填（U3）：进 composer 即清 App 侧草稿，避免下次进 chat 重复注入；
  // 发送权留给用户——这里绝不自动 send()。`prev ||` 守卫（review P2-1）：
  // 用户已在打字时不被未来任何草稿入口静默覆盖。
  useEffect(() => {
    if (!initialDraft) return;
    setInput((prev) => prev || initialDraft);
    onDraftConsumed?.();
  }, [initialDraft, onDraftConsumed]);

  const refreshSessions = useCallback(() => {
    chatClient
      .listSessions()
      .then((all) => setSessions(all.filter((s) => s.repoId === repoId)))
      .catch(() => {});
  }, [chatClient, repoId]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    // jsdom has no scrollTo — guard for the component-test environment.
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
  }, [entries]);

  const openSession = useCallback(
    (session: ChatSessionInfo) => {
      setActiveSession(session);
      chatClient
        .messages(session.id)
        .then((messages) =>
          setEntries(
            messages.map((m) => {
              // citations JSON 列同时承载 planCards（CM-04 持久化）
              let citations: ChatCitation[] | undefined;
              let planCards: ChatPlanCard[] | undefined;
              if (m.citations) {
                try {
                  const parsed = JSON.parse(m.citations) as {
                    citations?: ChatCitation[];
                    planCards?: ChatPlanCard[];
                  };
                  if (Array.isArray(parsed)) citations = parsed as ChatCitation[];
                  else {
                    citations = parsed.citations;
                    planCards = parsed.planCards;
                  }
                } catch {
                  citations = undefined;
                }
              }
              return {
                key: `m-${m.id}`,
                role: m.role,
                content: m.content,
                citations,
                planCards
              };
            })
          )
        )
        .catch((e) => setError(describeError(e)));
    },
    [chatClient]
  );

  // 建会话一次；repo 切换时重置视图（会话按 repoId 过滤，历史不丢）
  useEffect(() => {
    setActiveSession(null);
    setEntries([]);
    refreshSessions();
  }, [repoId, refreshSessions]);

  const startSession = useCallback(async () => {
    setError(null);
    try {
      const session = await chatClient.createSession(repoId);
      refreshSessions();
      setActiveSession(session);
      setEntries([]);
    } catch (e) {
      setError(describeError(e));
    }
  }, [chatClient, repoId, refreshSessions]);

  const send = useCallback(
    async (raw?: string) => {
      const message = (raw ?? input).trim();
      if (!message || busy) return;
      let session = activeSession;
      try {
        if (!session) {
          session = await chatClient.createSession(repoId);
          refreshSessions();
          setActiveSession(session);
        }
        setError(null);
        setBusy(true);
        setInput('');
        const streamKey = `a-${Date.now()}`;
        setEntries((prev) => [
          ...prev,
          { key: `u-${Date.now()}`, role: 'user', content: message },
          { key: streamKey, role: 'assistant', content: '', streaming: true }
        ]);
        const done = await onSend(message, {
          onDelta: (text) =>
            setEntries((prev) => prev.map((e) => (e.key === streamKey ? { ...e, content: e.content + text } : e))),
          onRegenerate: () =>
            setEntries((prev) => prev.map((e) => (e.key === streamKey ? { ...e, content: '', regenerating: true } : e))),
          onPlan: (cards: ChatPlanCard[]) =>
            setEntries((prev) => prev.map((e) => (e.key === streamKey ? { ...e, planCards: cards } : e)))
        }, session.id);
        if (!done) {
          // consent 待确认（chatGuardSend 未执行）——撤回本地占位，恢复草稿
          setEntries((prev) => prev.filter((e) => e.key !== streamKey && e.content !== message));
          setInput(message);
          return;
        }
        // 服务端净化后的最终答案回写屏幕（QA-01）
        setEntries((prev) =>
          prev.map((e) =>
            e.key === streamKey
              ? {
                  ...e,
                  content: done.answer,
                  citations: done.citations,
                  planCards: done.planCards,
                  streaming: false,
                  regenerating: false
                }
              : e
          ),
        );
      } catch (e) {
        setError(describeError(e));
        // v1.2.x（R4-15）— 出错时撤掉零输出的流式占位：402 等「一个 token
        // 都没回来就失败」的路径下，finally 只停流态会留下一个空白
        // assistant 气泡悬浮在消息流里（Round4 实测多次出现）。
        setEntries((prev) =>
          prev
            .map((e) => ({ ...e, streaming: false, regenerating: false }))
            .filter((e) => !(e.role === 'assistant' && e.content === '' && !e.planCards?.length))
        );
      } finally {
        setEntries((prev) => prev.map((e) => ({ ...e, streaming: false, regenerating: false })));
        setBusy(false);
      }
    },
    [input, activeSession, busy, chatClient, repoId, refreshSessions, onSend]
  );

  // Issue 23 场景承接（chat-merge Q1）：排障对话由 chat 承接，composer 即入口。
  // v0.27-UI ticket 01：骨架样式补全——这些 chat-* 类名自 chat-merge 起只存在于
  // TSX、全仓 CSS 从未定义（裸 HTML 渲染的根因）。方案=Tailwind 语义 token 落地
  // （与主应用同一语言、clean/cyber 主题自动跟随），语义类名保留作测试与未来 CSS 钩子。

  return (
    <div className="chat-view flex min-h-0 flex-1 overflow-hidden" data-testid="chat-view">
      {sideOpen && (
        <div
          className="chat-side-backdrop fixed inset-0 z-30 bg-ink/30 md:hidden"
          data-testid="chat-side-backdrop"
          onClick={() => setSideOpen(false)}
        />
      )}
      <aside
        className={`chat-side fixed inset-y-0 left-0 z-40 flex w-[280px] shrink-0 flex-col gap-2 border-r border-line bg-surface p-3 transition-transform md:static md:z-auto md:translate-x-0 ${
          sideOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="chat-side-head flex items-center justify-between gap-2">
          <span className="chat-brand text-sm font-semibold text-ink" data-testid="chat-brand">架构问答</span>
          <button
            className="chat-new shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
            data-testid="chat-new-session"
            onClick={() => void startSession()}
            disabled={busy}
          >
            + 新会话
          </button>
        </div>
        <div className="chat-sessions flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" data-testid="chat-session-list">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`chat-session truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-subtle hover:text-ink ${
                activeSession?.id === s.id ? 'active bg-accent/10 text-accent' : 'text-muted'
              }`}
              onClick={() => openSession(s)}
              title={s.createdAt}
            >
              {s.title}
            </button>
          ))}
          {sessions.length === 0 && <div className="chat-hint text-xs text-muted">暂无本仓库会话</div>}
        </div>
        {/* CM-05 前置：模型配置是高级项——默认折叠，等第二 profile 配好后可展开 */}
        <details className="text-xs">
          <summary className="chat-hint cursor-pointer pb-1.5 text-muted">模型设置</summary>
          <ModelSelect modelInfo={modelInfo ?? null} onSwitchModel={onSwitchModel ?? (() => {})} />
        </details>
      </aside>

      <div className="chat-main flex min-w-0 flex-1 flex-col">
        <div className="chat-head flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="chat-side-toggle shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent md:hidden"
              data-testid="chat-side-toggle"
              onClick={() => setSideOpen((v) => !v)}
              aria-label="切换会话列表"
            >
              ☰
            </button>
            <b data-testid="chat-session-title" className="truncate text-sm text-ink">{activeSession ? activeSession.title : `新会话 · ${repoName}`}</b>
          </div>
          <button
            className="chat-back shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent"
            data-testid="chat-back"
            onClick={onBackToWorkbench}
          >
            ← 返回工作台
          </button>
        </div>
        <div
          className="chat-msgs flex min-h-0 flex-1 overflow-y-auto px-3 py-4"
          ref={listRef}
          data-testid="chat-messages"
          // v1.2 票 05（V27-15）— 消息区 aria landmark：role="log" 是追加式对话的
          // 语义容器（读屏可按「消息日志」跳转分区），aria-live="polite" 显式钉住
          // （role=log 隐含同值，显式声明让契约可断言、后续编辑不能静默丢失）；
          // aria-atomic=false = 只播报新增/变更部分，不整区重读。
          role="log"
          aria-label="对话消息"
          aria-live="polite"
          aria-atomic="false"
        >
          {/* spec 布局段：消息列与 composer/空态同一 max-w-3xl 居中语言（review P1-2） */}
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {entries.length === 0 && (
            <div className="chat-empty flex w-full flex-col gap-3 text-center text-sm text-muted">
              <div>
                直接提问即可，回答中的每个结论都来自代码事实，点上标证据角标可跳到拓扑查证。引擎只读，改动由你执行。试试：
              </div>
              <div className="grid w-full max-w-xl grid-cols-2 gap-2.5">
                {STARTER_CARDS.map((card) => (
                  <button
                    key={card.title}
                    className="flex flex-col gap-1 rounded-[10px] border border-line bg-elevated px-3.5 py-3 text-left transition-[border-color,transform] duration-150 hover:border-accent hover:-translate-y-px disabled:cursor-default disabled:opacity-50"
                    data-testid="chat-starter-card"
                    onClick={() => void send(card.prompt)}
                    disabled={busy}
                  >
                    <span className="font-semibold text-ink">{card.title}</span>
                    <span className="text-xs text-muted">{card.subtitle}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {entries.map((entry) => (
            <div
              key={entry.key}
              className={`chat-msg ${entry.role} flex max-w-[85%] flex-col rounded-lg px-3 py-2 text-sm leading-relaxed ${
                entry.role === 'assistant'
                  ? 'self-start rounded-tl-none border border-line bg-surface text-ink'
                  : 'self-end rounded-tr-none bg-accent/10 text-ink'
              }`}
            >
              {entry.role === 'assistant' ? (
                <>
                  {entry.regenerating && entry.streaming && (
                    <div className="chat-regen mb-1 rounded-md bg-warning/15 px-2 py-1 text-xs text-warning" data-testid="chat-regen-banner">
                      回答格式无效，正在重新生成…
                    </div>
                  )}
                  {entry.planCards?.length ? (
                    <PlanCardView
                      cards={entry.planCards}
                      sessionId={activeSession?.id ?? 'draft'}
                      onOpenEvolution={onOpenEvolution}
                    />
                  ) : null}
                  <AnswerBody
                    content={entry.content}
                    citations={entry.citations}
                    streaming={entry.streaming}
                    onNavigate={onNavigate}
                  />
                </>
              ) : (
                <div className="chat-user-text whitespace-pre-wrap">{entry.content}</div>
              )}
            </div>
          ))}
          </div>
        </div>
        {error && <div className="chat-error mx-3 mb-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger" data-testid="chat-error">{error}</div>}
        {/* v1.2.x（R4-19）— 隐私确认后不自动发（不误发），但显式说清「为何没
            发出」：草稿已就绪，点发送。输入变化或发送后自动退场。 */}
        {draftReady && !busy && (
          <div
            data-testid="chat-draft-ready"
            className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-md border border-accent-soft bg-accent-soft/30 px-3 py-1.5 text-xs text-accent"
          >
            <span className="min-w-0 truncate">已授权远程模型——问题已填好，点「发送」发出。</span>
            {onDismissDraftReady && (
              <button
                type="button"
                data-testid="chat-draft-ready-dismiss"
                aria-label="关闭草稿就绪提示"
                onClick={onDismissDraftReady}
                className="shrink-0 rounded px-1 text-accent hover:bg-accent/10"
              >
                ×
              </button>
            )}
          </div>
        )}
        <div className="chat-composer sticky bottom-0 border-t border-line bg-canvas/95 px-3 py-2 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
            <textarea
              data-testid="chat-question"
              ref={taRef}
              value={input}
              rows={1}
              onChange={(e) => {
                setInput(e.target.value);
                if (e.target.value) onDismissDraftReady?.();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={busy ? '思考中…' : '问点什么…（Enter 发送，Shift+Enter 换行）'}
              disabled={busy}
              className="min-h-8 max-h-32 flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-60"
            />
            <button
              className="chat-send shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              data-testid="chat-send"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
            >
              {busy ? '…' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
