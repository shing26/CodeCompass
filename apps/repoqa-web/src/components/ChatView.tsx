import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { RepoQAClient, ChatCitation, ChatTurnResult, ChatPlanCard } from '../client/RepoQAClient';
import { PlanCardView } from './PlanCardView';

/** 改造 3：快捷交互卡片——标题 + 副标题（意图），点击直发请求。 */
const STARTER_CARDS = [
  {
    title: '全库架构透视',
    subtitle: '梳理整体分层、核心模块与技术栈分布',
    prompt: '这个仓库的整体架构和技术栈是怎样的？分层和核心模块是什么？'
  },
  {
    title: '高危大文件与孤岛',
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
    subtitle: '分析特定方法或未提交修改的受波及面',
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
    <div className="msg-body">
      {segments.map((segment, i) => (
        <Fragment key={i}>
          {segment.kind === 'text' ? (
            markdownOf(segment.value)
          ) : (
            <button
              className={`chat-cite${activeCite === Number(segment.value) ? ' chat-cite-active' : ''}`}
              onClick={() => setActiveCite(activeCite === Number(segment.value) ? null : Number(segment.value))}
              title="查看来源工具调用"
            >
              {segment.value}
            </button>
          )}
        </Fragment>
      ))}
      {active && (
        <div className="chat-cite-detail" data-testid="chat-cite-detail">
          [{active.n}] <code>{active.tool}</code>({JSON.stringify(active.args).slice(0, 140)}) — {active.ms}ms
          {symbolOf(active) && (
            <button className="chat-cite-jump" onClick={() => onNavigate(symbolOf(active))}>
              在拓扑中查看 →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 模型热切换（批次 D 的 UI 面已就绪，等 llm-profiles 配第二个 profile）。 */
function ModelSelect(props: { chatClient: RepoQAClient['chat'] }) {
  const { chatClient } = props;
  const [model, setModel] = useState<{ profiles: string[]; active: string; configured: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    chatClient.modelInfo().then(setModel).catch(() => {});
  }, [chatClient]);
  useEffect(refresh, [refresh]);
  return (
    <>
      <select
        data-testid="chat-model-select"
        value={model?.active ?? ''}
        onChange={(e) =>
          void chatClient
            .switchModel(e.target.value)
            .then(refresh)
            .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        }
        disabled={!model?.profiles.length}
      >
        {(model?.profiles ?? []).map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <div className="chat-hint">{error ?? (model?.configured ? '热切换即时生效' : 'LLM 未配置')}</div>
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
    }
  ) => Promise<ChatTurnResult | null>;
}) {
  const { client, repoId, repoName, onNavigate, onBackToWorkbench, onSend } = props;
  const chatClient = client.chat;
  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSessionInfo | null>(null);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
        .catch((e) => setError(String(e)));
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
      setError(e instanceof Error ? e.message : String(e));
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
        });
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
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setEntries((prev) => prev.map((e) => ({ ...e, streaming: false, regenerating: false })));
        setBusy(false);
      }
    },
    [input, activeSession, busy, chatClient, repoId, refreshSessions, onSend]
  );

  // Issue 23 场景承接（chat-merge Q1）：排障对话由 chat 承接，composer 即入口。

  return (
    <div className="chat-view" data-testid="chat-view">
      <aside className="chat-side">
        <div className="chat-side-head">
          <span className="chat-brand" data-testid="chat-brand">架构问答</span>
          <button
            className="chat-new"
            data-testid="chat-new-session"
            onClick={() => void startSession()}
            disabled={busy}
          >
            + 新会话
          </button>
        </div>
        <div className="chat-sessions" data-testid="chat-session-list">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`chat-session${activeSession?.id === s.id ? ' active' : ''}`}
              onClick={() => openSession(s)}
              title={s.createdAt}
            >
              {s.title}
            </button>
          ))}
          {sessions.length === 0 && <div className="chat-hint">暂无本仓库会话</div>}
        </div>
        {/* CM-05 前置：模型配置是高级项——默认折叠，等第二 profile 配好后可展开 */}
        <details className="chat-model">
          <summary className="chat-hint">模型设置</summary>
          <ModelSelect chatClient={chatClient} />
        </details>
      </aside>

      <div className="chat-main">
        <div className="chat-head">
          <b data-testid="chat-session-title">{activeSession ? activeSession.title : `新会话 · ${repoName}`}</b>
          <button className="chat-back" onClick={onBackToWorkbench}>
            ← 返回工作台
          </button>
        </div>
        <div className="chat-msgs" ref={listRef} data-testid="chat-messages">
          {entries.length === 0 && (
            <div className="chat-empty">
              <div>
                直接提问即可，回答中的每个结论都来自代码事实，可点 [cite: N] 查证。引擎只读，改动由你执行。试试：
              </div>
              <div className="chat-starters">
                {STARTER_CARDS.map((card) => (
                  <button
                    key={card.title}
                    className="chat-starter-card"
                    data-testid="chat-starter-card"
                    onClick={() => void send(card.prompt)}
                    disabled={busy}
                  >
                    <span className="chat-starter-title">{card.title}</span>
                    <span className="chat-starter-sub">{card.subtitle}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {entries.map((entry) => (
            <div key={entry.key} className={`chat-msg ${entry.role}`}>
              {entry.role === 'assistant' ? (
                <>
                  {entry.regenerating && entry.streaming && (
                    <div className="chat-regen" data-testid="chat-regen-banner">
                      回答格式无效，正在重新生成…
                    </div>
                  )}
                  {entry.planCards?.length ? (
                    <PlanCardView cards={entry.planCards} sessionId={activeSession?.id ?? 'draft'} />
                  ) : null}
                  <MessageBody content={entry.content} citations={entry.citations} onNavigate={onNavigate} />
                </>
              ) : (
                <div className="chat-user-text">{entry.content}</div>
              )}
            </div>
          ))}
        </div>
        {error && <div className="chat-error" data-testid="chat-error">{error}</div>}
        <div className="chat-composer">
          <textarea
            data-testid="chat-question"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={busy ? '思考中…' : '问点什么…（Enter 发送，Shift+Enter 换行）'}
            disabled={busy}
          />
          <button className="chat-send" data-testid="chat-send" onClick={() => void send()} disabled={busy || !input.trim()}>
            {busy ? '…' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
