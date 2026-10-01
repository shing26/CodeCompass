import { useEffect, useRef, useState } from 'react';
import type {
  StepperProgress,
  LlmRuntimeMode,
  Repo,
  RepoPreview,
  WorkbenchTab
} from '../types';
import { ImportRepoModal } from './ImportRepoModal';
import { PrivacyPill } from './PrivacyPill';
import { StatusStepper } from './StatusStepper';
import { useTheme } from '../hooks/useTheme';

interface TopBarProps {
  repos: Repo[];
  currentRepo: Repo | null;
  loading: boolean;
  error: string | null;
  /** v1.2.x（R4-4）— 错误条可消（× 钮 + 8s 自动消退）。 */
  onDismissError?: () => void;
  onSelectRepo: (id: string) => void;
  /** Issue 19: local ingestion — name + local path (double-tab import dialog). */
  onImportLocal: (name: string, localPath: string) => Promise<Repo | void>;
  /** Round 2 B4: read-only pre-import preview for the local-path tab. */
  onPreviewLocal: (localPath: string) => Promise<RepoPreview>;
  /** Issue 19: remote ingestion — clone URL + optional branch. */
  onCloneRemote: (url: string, branch?: string) => Promise<Repo>;
  /** Issue 14: fetch the ONBOARDING.md handover doc and trigger the download. */
  onExport: () => Promise<void>;
  /** Personal-use lifecycle: rebuild the selected repo's index. */
  onReindex: (repo: Repo) => void;
  /** Personal-use lifecycle: remove the selected repo's index (source kept). */
  onDelete: (repo: Repo) => void;
  /** Bug-04: hamburger toggle for the mobile sidebar drawer. */
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  /** Bug-12: repo currently being indexed (from catalog polling) — lets the
   * import dialog show live phase feedback while POST /api/repos is pending. */
  importingRepo?: Repo | null;
  /** v1.2.x — 全局模型热切换：胶囊显示当前 profile，点开下拉即切（chat/evolve 即时生效）。 */
  modelInfo?: { profiles: string[]; active: string; configured: boolean } | null;
  onSwitchModel?: (name: string) => void;
  /** v1.2.x — 克隆瞬断重试（WS），透传给导入弹窗的克隆阶段提示。 */
  cloneRetry?: { attempt: number; backoffMs: number } | null;
  /** v0.25.0 批次 1：原生目录选择器（可选，未传时按钮隐藏）。 */
  onPickFolder?: () => Promise<{ supported: boolean; canceled?: boolean; path?: string }>;
  llmMode: LlmRuntimeMode;
  llmHost?: string;
  /** Issue 31: active workbench tab. */
  activeView: WorkbenchTab;
  onSelectView: (tab: WorkbenchTab) => void;
  /** Issue 28: copy the Graph RAG agent context from the TopBar. */
  onCopyAgentContext: () => void | Promise<void>;
  canCopyAgentContext: boolean;
  /** v0.6.0 — live staged indexing progress from the WebSocket stream. */
  indexingProgress?: StepperProgress | null;
}

// 票 05（Web 收敛 6→3）：一级导航只留问现状（chat）/ 变更审计（gate）/ Diff 影响面
// （delta）三条。v1.2 票 01（产品化 IA 还原）：topo 回归一级（日常排查高频），
// 新增体检（scan 骨架，数据面随票 02）——一级共 5 项；metrics 并入 more 菜单
// （一跳可达），evolve 留深链。视图与深链契约零改动（viewFromMode 纯增量）。
const TABS: Array<{ id: WorkbenchTab; label: string; title: string }> = [
  { id: 'chat', label: '架构问答', title: '问现状：架构、链路、风险都基于代码事实，结论可逐条按证据查证' },
  { id: 'topo', label: '代码拓扑', title: '点击左侧路由或类，逐步走查确定性调用链路（Caller→Target→Callee）' },
  { id: 'gate', label: '变更审计', title: '运行并记录门禁、回看本机门禁运行史，也可复制预置命令到 CI/CD 流水线' },
  { id: 'delta', label: 'Diff 影响面', title: '对比两个 Git Commit，精确定位受影响的接口与反向调用方' },
  { id: 'scan', label: '体检', title: '代码体检：扫描候选与精度态势——引擎只报确定性事实，语义判断交给对话' }
];

function watcherState(status: Repo['status'] | undefined) {
  switch (status) {
    case 'ready':
      return { label: '就绪', dotClass: 'bg-success' };
    case 'indexing':
    case 'cloning':
    case 'parsing':
      return { label: '索引中', dotClass: 'bg-warning animate-pulse' };
    case 'error':
      return { label: '离线', dotClass: 'bg-danger' };
    default:
      return { label: '待机', dotClass: 'bg-muted' };
  }
}

/**
 * TopBar: 48px workbench header with repo/watcher state on the left, the
 * topo/metrics/gate segmented tabs in the middle and privacy/theme/agent
 * actions on the right. Repo lifecycle actions live in the overflow menu.
 *
 * Round 3 Bug-03 — below 1280px the header wraps: the tab strip moves to a
 * second header row (order-3, full width) instead of being overlapped by the
 * right cluster; status capsules collapse to dots and the copy button to a
 * short label. At ≥1280px the original single-row layout is byte-identical.
 */
export function TopBar({
  repos,
  currentRepo,
  loading,
  error,
  onDismissError,
  onSelectRepo,
  onImportLocal,
  onPreviewLocal,
  onCloneRemote,
  onExport,
  onReindex,
  onDelete,
  onToggleSidebar,
  sidebarOpen,
  importingRepo,
  modelInfo,
  onSwitchModel,
  cloneRetry,
  onPickFolder,
  llmMode,
  llmHost,
  activeView,
  onSelectView,
  onCopyAgentContext,
  canCopyAgentContext,
  indexingProgress
}: TopBarProps) {
  const [showImport, setShowImport] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [maskHelpOpen, setMaskHelpOpen] = useState(false); // v1.2.x R4-18 脱敏说明面板
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const watcher = watcherState(currentRepo?.status);
  const moreActionsRef = useRef<HTMLButtonElement | null>(null);

  // Round 3 Bug-04 — Esc closes the overflow menu and returns focus to the
  // ⋯ trigger. Scoped to the open state so other Escape handlers (import
  // dialog) are unaffected; stopPropagation keeps them from double-firing
  // if both happen to be open.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setMenuOpen(false);
      moreActionsRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  // v1.2.x — 模型下拉与 more-menu 同款 Esc 语义。
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setModelMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modelMenuOpen]);

  // v1.2.x（R4-4）— 错误条 8s 自动消退：修前它永久钉在页头（Esc 关弹窗后、
  // 切主题都在，无关闭钮）；手动 × 与自动消退并存。
  useEffect(() => {
    if (!error || !onDismissError) return;
    const timer = window.setTimeout(onDismissError, 8000);
    return () => window.clearTimeout(timer);
  }, [error, onDismissError]);

  const handleExport = async () => {
    if (!currentRepo || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await onExport();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const handleCopyAgentContext = async () => {
    if (!canCopyAgentContext || copying) return;
    setCopying(true);
    try {
      await onCopyAgentContext();
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } finally {
      setCopying(false);
    }
  };

  return (
    <>
    <header className="flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 border-b border-subtle bg-surface px-2 py-1 sm:gap-x-3 sm:px-3">
      <div className="order-1 flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
        <button
          type="button"
          data-testid="sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? '收起侧栏' : '展开侧栏'}
          aria-expanded={sidebarOpen}
          className="shrink-0 rounded-md border border-line px-2 py-1 text-sm text-muted hover:border-accent hover:text-accent md:hidden"
        >
          ☰
        </button>
        <div
          data-testid="brand-logo"
          className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-line bg-subtle px-2 max-sm:hidden"
        >
          <span className="grid h-4 w-4 place-items-center rounded-sm bg-accent text-micro font-bold text-white">
            CC
          </span>
          <span className="hidden text-xs font-semibold text-ink lg:inline">CodeCompass</span>
        </div>
        <select
          data-testid="repo-select"
          className="h-8 min-w-0 max-w-[42vw] truncate rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-accent sm:max-w-[260px]"
          value={currentRepo?.id ?? ''}
          onChange={(e) => onSelectRepo(e.target.value)}
        >
          <option value="" disabled>
            {loading ? '仓库加载中…' : '选择仓库'}
          </option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <span
          data-testid="watcher-status"
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-line bg-subtle px-2 py-1 text-xs font-medium text-muted xl:inline-flex"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${watcher.dotClass}`} />
          文件监视：{watcher.label}
        </span>
        <button
          type="button"
          data-testid="open-import"
          onClick={() => setShowImport(true)}
          aria-label="导入仓库"
          className="h-8 shrink-0 rounded-md bg-accent px-2 text-sm font-medium text-white hover:bg-accent/90 sm:px-3"
        >
          导入仓库
        </button>
      </div>

      {/* Round 3 Bug-03 — right cluster stays on row 1; it must never overlap
          the tab strip, which now owns row 2 on <1280px. */}
      <div className="order-2 flex min-w-0 flex-1 items-center justify-end gap-1.5 xl:order-3 xl:gap-2">
        {currentRepo && (
          <div className="relative shrink-0">
            <button
              type="button"
              ref={moreActionsRef}
              data-testid="more-actions"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="更多操作"
              aria-expanded={menuOpen}
              className="grid h-8 w-8 place-items-center rounded-md border border-line text-sm text-muted hover:border-accent hover:text-accent"
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <div
                  data-testid="more-menu-backdrop"
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  data-testid="more-menu"
                  className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-line bg-surface py-1 shadow-neon"
                >
                  {/* v1.2 票 01 — metrics 并入 topo 的「一跳可达」落点：不在一级导航
                      拥挤，深链 ?mode=metrics 契约不变，菜单即入口。 */}
                  <button
                    type="button"
                    data-testid="menu-metrics"
                    onClick={() => {
                      setMenuOpen(false);
                      onSelectView('metrics');
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted hover:bg-subtle hover:text-ink"
                  >
                    架构仪表盘
                  </button>
                  <button
                    type="button"
                    data-testid="export-onboarding"
                    onClick={() => {
                      setMenuOpen(false);
                      void handleExport();
                    }}
                    disabled={exporting}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted hover:bg-subtle hover:text-ink disabled:opacity-50"
                  >
                    导出 ONBOARDING.md
                  </button>
                  <button
                    type="button"
                    data-testid="reindex-repo"
                    onClick={() => {
                      setMenuOpen(false);
                      onReindex(currentRepo);
                    }}
                    disabled={currentRepo.status === 'indexing'}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted hover:bg-subtle hover:text-ink disabled:opacity-50"
                  >
                    重新索引
                  </button>
                  <button
                    type="button"
                    data-testid="delete-repo"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete(currentRepo);
                    }}
                    disabled={currentRepo.status === 'indexing'}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
                  >
                    删除
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {error && (
          <span
            data-testid="topbar-error"
            role="alert"
            className="flex min-w-0 items-center gap-1 text-xs text-danger"
          >
            <span className="min-w-0 truncate" title={error}>
              {error}
            </span>
            {onDismissError && (
              <button
                type="button"
                data-testid="topbar-error-dismiss"
                aria-label="关闭错误提示"
                onClick={onDismissError}
                className="shrink-0 rounded px-1 text-xs text-danger hover:bg-danger/10"
              >
                ×
              </button>
            )}
          </span>
        )}
        {exportError && (
          <span className="hidden text-xs text-danger xl:inline">{exportError}</span>
        )}
        {/* v1.2.x（R4-18）— 脱敏胶囊可点：说明「盖什么」，此前点击无任何反应
            （胶囊是 span），用户对脱敏范围无据可查。规则族摘要，取自
            engine/repoqa-masking.ts 的 13 条 pattern 归纳。 */}
        <div className="relative hidden shrink-0 xl:inline-flex">
          <span
            data-testid="masked-badge"
            role="button"
            tabIndex={0}
            onClick={() => setMaskHelpOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setMaskHelpOpen((v) => !v);
              }
            }}
            className="shrink-0 cursor-pointer rounded-full border border-line bg-subtle px-2 py-1 text-micro font-medium text-muted hover:border-accent hover:text-accent"
          >
            13 条规则已脱敏
          </span>
          {maskHelpOpen && (
            <div
              data-testid="mask-help"
              role="note"
              className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-line bg-surface p-3 text-xs text-muted shadow-neon"
            >
              <p className="mb-1.5 font-medium text-ink">出库脱敏覆盖（13 条规则）</p>
              <ul className="list-inside list-disc space-y-0.5">
                <li>私钥块：PEM（RSA/EC/OPENSSH/加密）与 PGP</li>
                <li>令牌：JWT、GitHub PAT/OAuth、OpenAI sk- 密钥、Bearer/Basic 授权头</li>
                <li>云密钥：AWS 访问密钥与临时凭据、阿里云/腾讯云密钥</li>
                <li>含口令的数据库连接串（DSN）</li>
                <li>URL 内嵌凭据（https://user:pass@host）</li>
                <li>私网/内网地址字面量</li>
              </ul>
              <p className="mt-1.5 text-micro">脱敏发生在内容入库前——索引、检索、导出与 WS 帧里的文本都已过筛。</p>
            </div>
          )}
        </div>
        {/* v1.2.x — 全局模型热切换：胶囊显示当前 profile + 配置状态点，下拉即切
            （chat/evolve 的 LLM 调用即时生效）。 */}
        <div className="relative shrink-0">
          <button
            type="button"
            data-testid="topbar-model"
            onClick={() => setModelMenuOpen((v) => !v)}
            aria-label={modelInfo?.configured ? `切换模型（当前 ${modelInfo.active}）` : '模型未配置'}
            aria-expanded={modelMenuOpen}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line bg-subtle px-2 text-xs font-medium text-muted hover:border-accent hover:text-accent"
          >
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${modelInfo?.configured ? 'bg-success' : 'bg-muted'}`}
            />
            <span className="hidden max-w-28 truncate md:inline">
              {modelInfo?.active ?? '模型'}
            </span>
            <span aria-hidden className="text-micro">▾</span>
          </button>
          {modelMenuOpen && (
            <>
              <div
                data-testid="topbar-model-backdrop"
                className="fixed inset-0 z-40"
                onClick={() => setModelMenuOpen(false)}
              />
              <div
                data-testid="topbar-model-menu"
                className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-line bg-surface py-1 shadow-neon"
              >
                {(modelInfo?.profiles ?? []).map((p) => (
                  <button
                    key={p}
                    type="button"
                    data-testid={`topbar-model-option-${p}`}
                    onClick={() => {
                      setModelMenuOpen(false);
                      onSwitchModel?.(p);
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-subtle ${
                      p === modelInfo?.active ? 'text-accent' : 'text-muted'
                    }`}
                  >
                    <span className="truncate font-mono">{p}</span>
                    {p === modelInfo?.active && <span aria-hidden>✓</span>}
                  </button>
                ))}
                {(modelInfo?.profiles ?? []).length === 0 && (
                  <p className="px-3 py-1.5 text-xs text-muted">无可用模型配置</p>
                )}
                <div className="border-t border-line px-3 py-1.5 text-micro text-muted">
                  {modelInfo?.configured ? '热切换即时生效（chat/演进共用）' : 'LLM 未配置'}
                </div>
              </div>
            </>
          )}
        </div>
        <PrivacyPill mode={llmMode} host={llmHost} />
        <button
          type="button"
          data-testid="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'cyber' ? '切换到清爽主题' : '切换到赛博主题'}
          title={theme === 'cyber' ? '切换到清爽主题' : '切换到赛博主题'}
          className="h-8 shrink-0 rounded-md border border-line px-2 text-xs font-medium text-muted hover:border-accent hover:text-accent"
        >
          <span aria-hidden className="sm:hidden">
            {theme === 'cyber' ? '🌙' : '☀️'}
          </span>
          <span className="hidden sm:inline">{theme === 'cyber' ? '清爽' : '赛博'}</span>
        </button>
        <button
          type="button"
          data-testid="topbar-copy-context"
          onClick={handleCopyAgentContext}
          disabled={!canCopyAgentContext || copying}
          aria-label="复制 Agent 上下文"
          className={`h-8 shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-50 xl:px-3 ${
            copied
              ? 'bg-success text-white'
              : 'bg-accent text-white hover:bg-accent/90'
          }`}
        >
          {copied ? '已复制' : (
            <>
              <span className="hidden xl:inline">复制 Agent 上下文</span>
              <span className="xl:hidden">复制</span>
            </>
          )}
        </button>
      </div>

      {/* Round 3 Bug-03 — the tab strip wraps to its own header row on
          <1280px (w-full + flex-wrap keeps every tab fully visible and
          hittable, no horizontal scroll, no overlap) and returns to the
          middle slot of the single 48px row at ≥1280px. */}
      <nav
        data-testid="workbench-tabs"
        aria-label="工作台视图"
        className="order-3 flex w-full flex-wrap items-center gap-0.5 rounded-md border border-line bg-subtle p-0.5 xl:order-2 xl:w-auto xl:shrink-0"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`tab-${tab.id}`}
            aria-pressed={activeView === tab.id}
            // A01 实拍发现：title 字段此前从未挂 DOM（六 tab tooltip 整排是死
            // 配置）——定位句要 hover 可见，接线在此补上。
            title={tab.title}
            onClick={() => onSelectView(tab.id)}
            className={`h-7 whitespace-nowrap rounded px-2 text-xs font-medium transition-colors ${
              activeView === tab.id
                ? 'bg-surface text-ink shadow-sm'
                : 'text-muted hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {showImport && (
        <ImportRepoModal
          open
          onClose={() => setShowImport(false)}
          onImportLocal={onImportLocal}
          onPreviewLocal={onPreviewLocal}
          onCloneRemote={onCloneRemote}
          repos={repos}
          importingRepo={importingRepo}
          onPickFolder={onPickFolder}
          cloneRetry={cloneRetry}
        />
      )}
    </header>
    <StatusStepper progress={indexingProgress ?? null} />
    </>
  );
}
