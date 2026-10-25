import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { Anchor, Repo, RepoDashboard, TopApiEntry, TraceStep } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';
import { Badge } from './ui/Badge';
import { CountPill } from './ui/CountPill';
import { statusLabel } from '../client/statusLabel';
import { RepoOverview } from './RepoOverview';

/**
 * v1.2 票 08（R4-7）— 链路来源标注。文案是本轮唯一新增的用户可见判断句：
 * 只陈述「这次链路是谁发起的」这一确定性事实，不替用户解释该不该看。
 */
const TRACE_ORIGIN_COPY: Record<string, string> = {
  chat: '来自架构问答',
  'dashboard-entry': '来自架构仪表盘的入口',
  'overview-hub': '来自这里的枢纽符号',
  'auto-topapi': '自动示例：首条 Top API'
};

interface CanvasProps {
  repo: Repo | null;
  /**
   * Issue 25 / Ticket 01 — the anchors of the latest resolved trace (App
   * derives them from the chat stream; Canvas no longer renders chat bubbles).
   */
  anchors?: Anchor[] | null;
  /** Live trace steps of the latest resolved trace (App-derived). */
  traceSteps?: TraceStep[] | null;
  /** v1.5 票 04（R5-13）— 最近一次链路解析完成但零锚点：骨架屏换确定性兜底文案。 */
  traceEmpty?: boolean;
  /** code:// deep link routing; wired to the Inspector in ticket 05. */
  onNavigate?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
  /** Issue 18: pinned "back to dashboard" entry inside the canvas. */
  onBackToDashboard?: () => void;
  /**
   * v1.2.x（Round5 R5-11）— 移除：原 `↑API / ↓SQL` 两个焦点计数由它算出，而那两个
   * 数字是**整仓常量**、与焦点无关（详见组件内注释）。保留一个无人消费的 prop 只是
   * 换一种形式留死代码，故一并移除。
   */
  symbols?: never;
  /**
   * v0.8 — deep-link focus (?focus=&traceId=): flashes and scrolls to the
   * matching trace card once a trace has resolved for the linked symbol.
   */
  deepLinkFocus?: string | null;
  deepLinkTraceId?: string | null;
  /**
   * v0.11 (Stage 3) — external focus request owned by App (Cmd+K palette).
   * Canvas forwards it to the diagram layer; the trace-step strip uses its own
   * internal focus request, and external requests take precedence.
   */
  focusRequest?: { symbol: string; requestId: number } | null;
  /* v1.2 票 08（R4-7）— 概览层数据面：dashboard 由 App 的 useDashboard 全局
     加载，本组件只透传（不重复请求）；radar 由 RepoOverview 自取。三件套
     （client + 两个下钻回调）缺一即不渲染概览层——纯组件测试与无库态不受影响。 */
  client?: RepoQAClient;
  dashboard?: RepoDashboard | null;
  dashboardLoading?: boolean;
  dashboardError?: string | null;
  onRetryDashboard?: () => void;
  /** 概览层「Top API 入口」点击 → 与仪表盘同一条确定性 call-chain。 */
  onTraceApi?: (api: TopApiEntry) => void;
  /** 概览层「枢纽符号」点击 → 同一 call-chain，只给名字。 */
  onTraceSymbol?: (symbol: string) => void;
  /** 当前展示链路的发起方，用于给下半部分加来源标注（R4-7「来历不明」）。 */
  traceOrigin?: string | null;
  /**
   * v1.4 票 01 — 一键载入内置示例项目（免找本机路径）。只出现在无库空态；
   * 载入后走既有导入流程（202 + 索引进度条 + 自动示例链路）。
   */
  onLoadSample?: (() => void | Promise<unknown>) | undefined;
  /** v1.4 票 02 — 无库空态直达片段分析（粘贴代码即看图）。 */
  onTrySnippet?: (() => void) | undefined;
}

/**
 * Main canvas: pure topology view. The free-input chat bubble stream was
 * removed (Issue 25 / Ticket 01 — free-form questions live in the chat workbench
 * and the evolution workbench now); what stays is the focused trace topology —
 * flow cards, the trace-step strip and the offline hint. No Mermaid renders
 * here (the diagram lives in the delta/evolution views) — see ticket 01 review.
 */
export function Canvas({
  repo,
  anchors = null,
  traceSteps = null,
  traceEmpty = false,
  onNavigate,
  onBackToDashboard,
  deepLinkFocus = null,
  deepLinkTraceId = null,
  focusRequest: externalFocusRequest = null,
  client,
  dashboard = null,
  dashboardLoading = false,
  dashboardError = null,
  onRetryDashboard,
  onTraceApi,
  onTraceSymbol,
  traceOrigin = null,
  onLoadSample,
  onTrySnippet
}: CanvasProps) {
  // v0.7 (issue 12) — one-shot highlight of the trace's start node: a Top API
  // click lands here and the focused card flashes once instead of blending in.
  const focusKey = anchors?.[0] ? `${anchors[0].file}:${anchors[0].line}` : '';
  const [focusFlash, setFocusFlash] = useState(false);
  useEffect(() => {
    if (!focusKey) return;
    setFocusFlash(true);
    const timer = window.setTimeout(() => setFocusFlash(false), 1500);
    return () => window.clearTimeout(timer);
  }, [focusKey]);

  // v0.8 — deep-link restore: when the cockpit is opened with ?focus=&traceId=,
  // flash and scroll to the matching trace card once a trace lands. traceId is
  // scene metadata surfaced in the banner.
  const [deepLinkFlash, setDeepLinkFlash] = useState(false);
  useEffect(() => {
    if (!deepLinkFocus || !anchors?.length) return;
    setDeepLinkFlash(true);
    const timer = window.setTimeout(() => setDeepLinkFlash(false), 1500);
    return () => window.clearTimeout(timer);
  }, [deepLinkFocus, deepLinkTraceId, anchors?.length]);

  const flowAnchors = anchors ?? [];
  const selectedNode = flowAnchors[0]?.symbol ?? repo?.name ?? '—';
  const affectedCount = flowAnchors.length;
  /* v1.2.x（Round5 R5-11）— 删掉「↑ API / ↓ SQL」两个计数。
   *
   * 它们由**整仓 symbols** 算出（`symbols.filter(...)`），与焦点无关——点不同符号、
   * 换不同枢纽，数字恒定不变。放在「焦点」条里会被读成「当前焦点影响多少接口」，
   * 而它其实是「这个仓一共有多少接口」。而且概览层的「结构规模」已经用正确的标签
   * 展示了同一组数字（接口 64 / 仓储 12…），两处并存纯属冗余。
   *
   * 若日后要真正做「焦点影响面」，那是 blast-radius 的活（blast_radius 图），不是
   * 两个常量计数器该冒充的。 */

  // v0.11 (Stage 3/4) — a focus request (external Cmd+K or a trace-step jump)
  // flashes the matching topology card; the requestId increments every
  // dispatch so re-focusing the same symbol still retriggers the flash.
  const [focusSymbol, setFocusSymbol] = useState<string | null>(null);
  const handleFocusDiagram = useCallback((symbol: string) => {
    setFocusSymbol(symbol);
  }, []);
  const focusRequestId = externalFocusRequest?.requestId ?? 0;
  const focusRequestSymbol = externalFocusRequest?.symbol ?? null;
  useEffect(() => {
    if (!focusRequestSymbol) return;
    setFocusSymbol(focusRequestSymbol);
  }, [focusRequestSymbol, focusRequestId]);
  // The flash is a one-shot CSS animation; drop the symbol so a later
  // dispatch of the same symbol can replay it.
  useEffect(() => {
    if (!focusSymbol) return;
    const timer = window.setTimeout(() => setFocusSymbol(null), 1500);
    return () => window.clearTimeout(timer);
  }, [focusSymbol]);

  const [traceStepIdx, setTraceStepIdx] = useState(0);
  useEffect(() => {
    if (!traceSteps || traceSteps.length === 0) {
      setTraceStepIdx(0);
      return;
    }
    setTraceStepIdx((prev) => Math.min(prev, traceSteps.length - 1));
  }, [traceSteps]);
  const visibleTraceStep = traceSteps?.[traceStepIdx] ?? null;

  const jumpToTraceStep = useCallback(
    (index: number) => {
      if (!traceSteps) return;
      const clamped = Math.max(0, Math.min(traceSteps.length - 1, index));
      setTraceStepIdx(clamped);
      const step = traceSteps[clamped];
      if (!step) return;
      handleFocusDiagram(step.symbol);
      onNavigate?.(step.file, step.line, step.lineEnd, step.symbol);
    },
    [traceSteps, handleFocusDiagram, onNavigate]
  );
  const stepPrev = useCallback(() => {
    if (!traceSteps) return;
    jumpToTraceStep(traceStepIdx - 1);
  }, [traceSteps, traceStepIdx, jumpToTraceStep]);
  const stepNext = useCallback(() => {
    if (!traceSteps) return;
    jumpToTraceStep(traceStepIdx + 1);
  }, [traceSteps, traceStepIdx, jumpToTraceStep]);

  return (
    <main data-testid="canvas" className="flex flex-1 flex-col overflow-hidden">
      {repo ? (
        <>
          <div className="workbench-grid custom-scroll flex-1 overflow-y-auto p-4">
            <div className="pointer-events-none sticky top-2 z-10 mb-3 flex items-center gap-2 rounded-md border border-line bg-surface/90 px-3 py-1.5 shadow-neon backdrop-blur">
              <span className="text-micro uppercase tracking-wide text-muted">焦点</span>
              <span
                data-testid="selected-node"
                className="min-w-0 flex-1 truncate font-mono text-xs text-ink"
              >
                {selectedNode}
              </span>
              <CountPill data-testid="affected-count">
                {affectedCount} 受影响
              </CountPill>
            </div>
            {onBackToDashboard && (
              <div className="sticky top-0 z-10 -mx-4 -mt-4 border-b border-line bg-subtle px-3 py-1.5">
                <button
                  type="button"
                  data-testid="canvas-back-to-dashboard"
                  onClick={onBackToDashboard}
                  className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:border-accent/40 hover:text-accent"
                >
                  ← 返回看板
                </button>
              </div>
            )}
            {deepLinkFocus && (
              <div
                data-testid="deeplink-focus"
                className="mx-auto mb-3 flex max-w-2xl items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning"
              >
                <span aria-hidden="true">🎯</span>
                <span className="min-w-0 flex-1 truncate">
                  深度链接焦点：{deepLinkFocus}
                  {deepLinkTraceId ? ` · trace ${deepLinkTraceId}` : ''}
                </span>
              </div>
            )}
            {client && onTraceApi && onTraceSymbol && (
              <RepoOverview
                repo={repo}
                client={client}
                dashboard={dashboard}
                dashboardLoading={dashboardLoading}
                dashboardError={dashboardError}
                onRetryDashboard={onRetryDashboard ?? (() => undefined)}
                onTraceApi={onTraceApi}
                onTraceSymbol={onTraceSymbol}
              />
            )}
            {flowAnchors.length > 0 && traceOrigin && (
              <div
                data-testid="trace-origin"
                className="mx-auto mb-2 flex max-w-4xl items-center gap-2 text-micro text-muted"
              >
                <span className="font-medium text-ink">当前链路</span>
                <span>{TRACE_ORIGIN_COPY[traceOrigin] ?? traceOrigin}</span>
              </div>
            )}
            {flowAnchors.length > 0 && (
              <FlowCards
                anchors={flowAnchors}
                onNavigate={onNavigate}
                /* An explicit external focus request wins over the trace-start
                   flash — the requested card is the one the user asked about. */
                flashFirst={focusFlash && focusSymbol === null}
                flashSymbol={deepLinkFlash ? deepLinkFocus : focusSymbol}
              />
            )}
            {flowAnchors.length === 0 && traceEmpty && (
              // v1.5 票 04（R5-13 剩余半）— 链路解析完成但零锚点：不再渲染
              // 骨架屏（看起来像永远在加载、「当前链路」整段消失），改说确定性
              // 事实。口径与 TopApiBlock 空榜文案一致：陈述引擎能识别什么、
              // 空结果可能意味着什么，不猜具体原因。
              <div
                data-testid="flow-empty"
                className="mx-auto mb-4 flex max-w-2xl items-start gap-2 rounded-md border border-line bg-subtle px-3 py-2 text-xs text-muted"
              >
                <span aria-hidden="true">🔎</span>
                <span>
                  这条链路没有解析到任何静态调用边——引擎只解析静态可判定的显式调用。
                  起点符号可能是静态图谱里的叶子（没有静态调用出边）、入口注册形态
                  不在识别范围内、或调用经由运行时机制发生。这是分析边界，不是错误；
                  可在左侧符号树选择其他符号重新发起追踪。
                </span>
              </div>
            )}
            {flowAnchors.length === 0 && !traceEmpty && <FlowSkeleton />}
            <div
              data-testid="offline-hint"
              className="mx-auto mb-3 flex max-w-2xl items-start gap-2 rounded-md border border-line bg-subtle px-3 py-2 text-xs text-muted"
            >
              <span aria-hidden="true">🧭</span>
              <span>
                离线模式：调用链与符号索引由确定性代码分析生成，不依赖 LLM / API Key；未配置 LLM
                时静态路径同样可用。
              </span>
            </div>
          </div>
          {traceSteps && traceSteps.length > 1 && (
            <div
              data-testid="trace-strip"
              className="border-t border-line bg-surface/95 px-3 py-1.5 backdrop-blur"
            >
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  data-testid="trace-step-prev"
                  onClick={stepPrev}
                  disabled={traceStepIdx === 0}
                  className="rounded border border-line bg-subtle px-2 py-0.5 text-muted hover:border-accent/40 disabled:opacity-30"
                >
                  ← 上一跳
                </button>
                <span
                  data-testid="trace-step-label"
                  className="min-w-0 flex-1 truncate font-mono"
                >
                  步骤 {traceStepIdx + 1}/{traceSteps.length}
                  {visibleTraceStep && (
                    <span className="ml-2 text-muted">
                      {visibleTraceStep.symbol}
                      {visibleTraceStep.status === 'BROKEN' && (
                        <span className="ml-1.5 text-danger">{statusLabel('BROKEN')}</span>
                      )}
                      {/* v1.2.x（Round5）— 止于仓库外用中性色，不用危险色：它是
                          分析边界而非缺陷，红字会让正常代码看起来像坏了。 */}
                      {visibleTraceStep.status === 'EXTERNAL' && (
                        <span className="ml-1.5 text-muted" title="链路止于仓库外的调用（父类方法 / 运行时 / 框架入口）——分析边界，不是缺陷">
                          {statusLabel('EXTERNAL')}
                        </span>
                      )}
                      {visibleTraceStep.httpMethod && (
                        <span
                          className={`ml-1.5 ${
                            visibleTraceStep.httpMethod === 'POST'
                              ? 'text-success'
                              : 'text-accent'
                          }`}
                        >
                          {visibleTraceStep.httpMethod}
                        </span>
                      )}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  data-testid="trace-step-next"
                  onClick={stepNext}
                  disabled={traceStepIdx >= traceSteps.length - 1}
                  className="rounded border border-line bg-subtle px-2 py-0.5 text-muted hover:border-accent/40 disabled:opacity-30"
                >
                  下一跳 →
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div data-testid="empty-state" className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-lg text-center">
            <h2 className="text-lg font-semibold text-ink">先用 30 秒看看它能干什么</h2>
            {/* v1.4 票 01 — 零门槛入口：不填路径、不准备仓库，服务端把内置
                示例小仓落到数据目录后走正常导入流程。 */}
            {onLoadSample && (
              <div className="mt-4">
                <button
                  type="button"
                  data-testid="empty-load-sample"
                  onClick={() => void onLoadSample()}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-canvas hover:opacity-90"
                >
                  载入示例项目（一键）
                </button>
                <p className="mt-2 text-xs text-muted">
                  内置一个小型任务看板 API 源码，索引完自动弹出首条调用链，不用准备本机路径。
                </p>
              </div>
            )}
            {onTrySnippet && (
              <div className="mt-3">
                <button
                  type="button"
                  data-testid="empty-try-snippet"
                  onClick={onTrySnippet}
                  className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:border-accent"
                >
                  粘贴一段代码看看
                </button>
                <p className="mt-2 text-xs text-muted">
                  手边只有一段代码？直接粘贴，立刻看到它内部的调用关系，连仓库都不用导入。
                </p>
              </div>
            )}
            <h3 className="mt-6 text-sm font-semibold text-ink">或者，导入你自己的仓库</h3>
            <div className="mt-3 space-y-3 text-left text-sm text-muted">
              <p>
                <strong className="text-ink">① 导入仓库</strong> —
                顶部「导入仓库」按钮，填本机仓库的完整路径
                （如 C:\projects\petclinic），支持 Java / TS / Python / Go，索引完成后自动就绪。
              </p>
              <p>
                <strong className="text-ink">② 选一个视图</strong> —
                <strong className="text-ink">要方案 →</strong>「规范演进」给改动意图，产出落地建议与风险清单（引擎只读）；
                <strong className="text-ink">问现状 →</strong>「架构问答」自然语言提问，结论可逐条查证（推荐新手从这里开始）。
                其余：「代码拓扑」先看结构规模与枢纽符号、再点进去看调用链、「变更审计」对接 CI 门禁、「Diff 影响面」看架构差异；全仓配置拓扑在右上「⋯ 更多操作 → 架构仪表盘」（v1.2.x R4-13：入口已移出一级导航）。
              </p>
              <p>
                <strong className="text-ink">③ 提问或探索</strong> — 在「架构问答」输入如
                <em>「这个仓库哪里最值得改？」</em>，回答附带证据角标，点角标可跳到拓扑定位。
              </p>
            </div>
            <p className="mt-4 text-xs text-muted">
              已导入过？直接在顶部下拉选择仓库即可。
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

function languageBadge(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'java':
      return 'Java';
    case 'ts':
    case 'tsx':
      return 'TS';
    case 'js':
    case 'jsx':
      return 'JS';
    case 'py':
      return 'Python';
    case 'go':
      return 'Go';
    case 'xml':
      return 'XML';
    default:
      return 'CODE';
  }
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

/** Caller -> Target -> Callee topology cards with animated dashed connectors. */
// 内部 role 值驱动配色逻辑不动（D4），展示层出中文（v0.30 表 A）。
const ROLE_COPY: Record<string, string> = { Caller: '调用方', Callee: '被调方', Target: '目标' };
function FlowCards({
  anchors,
  onNavigate,
  flashFirst = false,
  flashSymbol
}: {
  anchors: Anchor[];
  onNavigate?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
  /** v0.7 (issue 12): one-shot highlight on the start card. */
  flashFirst?: boolean;
  /** v0.8 deep link: flash and scroll to the card matching this symbol. */
  flashSymbol?: string | null;
}) {
  const cards = anchors.slice(0, 3);
  const flashIndex = flashSymbol
    ? cards.findIndex((anchor) => anchor.symbol === flashSymbol)
    : -1;
  const flashRef = useRef<HTMLButtonElement | null>(null);
  // Deep-link restore: bring the focused card into view (jsdom-safe).
  useEffect(() => {
    const el = flashRef.current;
    if (!flashSymbol || !el) return;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [flashSymbol]);
  return (
    <div data-testid="flow-cards" className="mb-4 flex items-stretch gap-2">
      {cards.map((anchor, idx) => {
        const role = idx === 0 ? 'Caller' : idx === cards.length - 1 ? 'Callee' : 'Target';
        const flash =
          (flashFirst && idx === 0) ||
          (flashSymbol !== undefined && flashSymbol !== null && idx === flashIndex);
        return (
          <Fragment key={`${anchor.file}-${anchor.line}-${idx}`}>
            {idx > 0 && <div data-testid="flow-arrow" className="topo-line self-center" />}
            <button
              type="button"
              data-testid="flow-card"
              ref={idx === flashIndex ? flashRef : undefined}
              className={`min-w-0 flex-1 rounded-md border border-line bg-surface p-2 text-left hover:border-accent/50 ${
                flash ? 'focus-flash' : ''
              }`}
              onClick={() => onNavigate?.(anchor.file, anchor.line, undefined, anchor.symbol)}
              title={`${anchor.file}:${anchor.line}`}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-micro font-bold uppercase ${
                    role === 'Callee' ? 'text-callee' : 'text-accent'
                  }`}
                >
                  {ROLE_COPY[role] ?? role}
                </span>
                <Badge>{languageBadge(anchor.file)}</Badge>
              </div>
              <div className="mt-1 truncate font-mono text-xs text-ink">{anchor.symbol}</div>
              <div className="mt-0.5 truncate text-micro text-muted">
                {basename(anchor.file)} L{anchor.line}
              </div>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Empty topology skeleton shown before the first trace resolves. */
function FlowSkeleton() {
  return (
    <div data-testid="flow-skeleton" className="mx-auto mb-4 flex max-w-md items-center gap-2">
      {[0, 1, 2].map((idx) => (
        <Fragment key={idx}>
          {idx > 0 && <div className="topo-line self-center" />}
          <div className="h-16 min-w-0 flex-1 rounded-md border border-dashed border-line bg-surface/60" />
        </Fragment>
      ))}
    </div>
  );
}
