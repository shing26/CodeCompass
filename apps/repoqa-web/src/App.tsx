import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from './hooks/useTheme';
import { RepoQAClient, resolveBaseUrl } from './client/RepoQAClient';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { DashboardView } from './components/DashboardView';
import { CiGateView } from './components/CiGateView';
import { ArchitectureDeltaView } from './components/ArchitectureDeltaView';
import { EvolutionView } from './components/EvolutionView';
import { ChatView } from './components/ChatView';
import { AskDock } from './components/AskDock';
import { TourPlayer } from './components/TourPlayer';
import { CommandPalette } from './components/CommandPalette';
import { PrivacyConsentModal } from './components/PrivacyConsentModal';
import { CopyMaskingToast } from './components/CopyMaskingToast';
import { RepoProvider, useRepo } from './context/RepoContext';
import { InspectorProvider, useInspectorContext } from './context/InspectorContext';
import { ChatRuntimeProvider, useChatRuntime } from './context/ChatRuntimeContext';

export interface AppProps {
  /** Dependency injection seam for tests; defaults to the real client. */
  client?: RepoQAClient;
}

/**
 * v0.25.0 批次 3：App 缩为组装壳——域状态收敛进 context/ 三片
 * （RepoContext / InspectorContext / ChatRuntimeContext）。暗礁防御：三个
 * Provider 挂在 <App/> 内部最外层（不迁 main.tsx），render(<App/>) 依然
 * 自带完整上下文，组件级测试与 270 条断言零修改。Provider 单向依赖：
 * Inspector/Chat → Repo，彼此不 cross-import。
 */
export function App({ client: clientProp }: AppProps) {
  // Build the default client once: constructing it during render (e.g. in a
  // default parameter) yields a new instance on every render, which changes
  // hook dependencies and causes an infinite effect loop (max update depth).
  const client = useMemo(() => clientProp ?? new RepoQAClient(resolveBaseUrl()), [clientProp]);

  return (
    <RepoProvider client={client}>
      <InspectorProvider>
        <ChatRuntimeProvider>
          <WorkbenchShell />
        </ChatRuntimeProvider>
      </InspectorProvider>
    </RepoProvider>
  );
}

/** 三栏工作台布局壳：只做「Context → 组件 props」的接线，不持业务状态。 */
function WorkbenchShell() {
  const {
    client,
    deepLink,
    repos,
    currentRepo,
    repoId,
    loading,
    error,
    symbols,
    symbolsLoading,
    tours,
    toursLoading,
    toursError,
    refreshTours,
    dashboard,
    dashboardLoading,
    dashboardError,
    refreshDashboard,
    view,
    setView,
    activeTour,
    handlePlayTour,
    goTopology,
    goEvolution,
    handleSelectView,
    indexingProgress,
    sidebarOpen,
    setSidebarOpen,
    handleSelectRepo,
    handleImportLocal,
    handleCloneRemote,
    handleReindex,
    handleDelete,
    handleExport
  } = useRepo();
  const {
    inspector,
    reverseDeps,
    subgraph,
    inspectorOpen,
    setInspectorOpen,
    paletteFocus,
    handlePaletteSelect,
    maskingToastAt,
    handleCopyAgentContext,
    canCopyAgentContext
  } = useInspectorContext();
  const {
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
  } = useChatRuntime();

  const { toggleTheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // v0.27-UI ticket 02 (U3)：AskDock 提交的问题经此草稿通道预填进 chat composer。
  // 草稿带 repoId 归属（review P1-1）：viewFromMode('incident')→chat 让切库不离开
  // chat 视图，无归属时 A 库的预填会静默残留进 B 库 composer。
  const [askDraft, setAskDraft] = useState<{ repoId: string; text: string } | null>(null);
  const clearAskDraft = useCallback(() => setAskDraft(null), []);

  // Ticket 16 (QA-07): one condition source for "the main area renders the
  // topology guide instead of repo views" — both the TopBar highlight and the
  // view switch below derive from it, so they can never drift apart.
  const noRepo = repoId === null;

  // v0.11 (Stage 3) — global Cmd/Ctrl+K toggles the palette.
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-x-hidden bg-canvas text-ink">
      <TopBar
        repos={repos}
        currentRepo={currentRepo}
        loading={loading}
        error={error}
        onSelectRepo={handleSelectRepo}
        onImportLocal={handleImportLocal}
        onPreviewLocal={(path) => client.previewRepo(path)}
        onCloneRemote={handleCloneRemote}
        onExport={handleExport}
        onReindex={handleReindex}
        onDelete={handleDelete}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        sidebarOpen={sidebarOpen}
        importingRepo={repos.find((r) => r.status === 'indexing') ?? null}
        onPickFolder={() => client.pickFolder()}
        llmMode={runtime.llm.mode}
        llmHost={runtime.llm.host}
        activeView={noRepo || view === 'tour' ? 'topo' : view}
        onSelectView={handleSelectView}
        onCopyAgentContext={handleCopyAgentContext}
        canCopyAgentContext={canCopyAgentContext}
        indexingProgress={indexingProgress}
      />
      {consentPending && (
        <PrivacyConsentModal
          host={runtime.llm.host}
          onConfirm={confirmConsent}
          onCancel={() => setConsentPending(null)}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        client={client}
        repoId={repoId}
        onClose={() => setPaletteOpen(false)}
        onSelectSymbol={handlePaletteSelect}
        onToggleTheme={toggleTheme}
        onBackToDashboard={goTopology}
      />
      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <div
            data-testid="sidebar-mask"
            className="fixed inset-0 z-30 bg-ink/30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {inspectorOpen && (
          <div
            data-testid="inspector-mask"
            className="fixed inset-0 z-30 bg-ink/30 md:hidden"
            onClick={() => setInspectorOpen(false)}
          />
        )}
        <Sidebar
          repoName={currentRepo?.name ?? null}
          symbols={symbols}
          loading={symbolsLoading}
          tours={tours}
          toursLoading={toursLoading}
          toursError={toursError}
          onRetryTours={refreshTours}
          onPlayTour={handlePlayTour}
          open={sidebarOpen}
          onNavigate={inspector.openFile}
          onOpenEvolution={goEvolution}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {repoId && view === 'tour' && (
            <div
              data-testid="view-header"
              className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-1.5"
            >
              <button
                type="button"
                data-testid="back-to-dashboard"
                onClick={goTopology}
                className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-muted hover:border-accent/40 hover:text-accent"
              >
                ← 返回工作台
              </button>
              <span className="truncate text-xs text-muted">Tour · {activeTour?.title ?? ''}</span>
            </div>
          )}
          {noRepo || view === 'topo' ? (
            <Canvas
              repo={currentRepo}
              anchors={canvasAnchors}
              traceSteps={canvasTraceSteps}
              onNavigate={inspector.openFile}
              symbols={symbols}
              deepLinkFocus={deepLink.focus}
              deepLinkTraceId={deepLink.traceId}
              focusRequest={paletteFocus}
            />
          ) : view === 'tour' && activeTour ? (
            <TourPlayer
              key={activeTour.id}
              tour={activeTour}
              onNavigate={inspector.openFile}
              onBack={goTopology}
            />
          ) : view === 'gate' ? (
            <CiGateView
              repo={currentRepo}
              dashboard={dashboard}
              client={client}
              onNavigate={inspector.openFile}
            />
          ) : view === 'chat' ? (
            <ChatView
              // 切库重挂载（review P1-1）：sessions/entries/input 全部随 repoId 归零，
              // 草稿只在 repoId 归属匹配时注入。
              key={repoId}
              client={client}
              repoId={repoId}
              repoName={currentRepo?.name ?? null}
              onNavigate={(symbol) => {
                setView('topo');
                // Same deterministic call-chain entry as the Dashboard Top API
                // click: explicit (name) start, LLM bypassed by the worker.
                handleSubmit(`${symbol} 的完整调用链是怎样的？`, 'call-chain', {
                  name: symbol,
                  file: ''
                });
              }}
              onBackToWorkbench={() => setView('topo')}
              onSend={chatGuardSend}
              // v0.26-A ticket 02 (Q3)：方案摘要卡 → 规范演进之桥
              onOpenEvolution={goEvolution}
              // v0.27-UI ticket 02 (U3)：AskDock 草稿预填（不自动发送），repoId 匹配才注入
              initialDraft={askDraft && askDraft.repoId === repoId ? askDraft.text : undefined}
              onDraftConsumed={clearAskDraft}
            />
          ) : view === 'delta' ? (
            <ArchitectureDeltaView
              repo={currentRepo}
              client={client}
              onNavigate={inspector.openFile}
            />
          ) : view === 'evolve' ? (
            <EvolutionView
              repo={currentRepo}
              session={evolutionSession}
              onNavigate={inspector.openFile}
              client={client}
            />
          ) : (
            <DashboardView
              repoName={currentRepo?.name ?? null}
              dashboard={dashboard}
              loading={dashboardLoading}
              error={dashboardError}
              onRetry={refreshDashboard}
              onTrace={handleTrace}
              onNavigate={inspector.openFile}
              onOpenChat={() => setView('topo')}
            />
          )}
          {/* v0.27-UI ticket 02 (U3)：全局常驻对话条——chat 视图自带 composer 故隐藏；
              无库无可问；tour 播放器沉浸动线不打断（review P2-4）；窄屏 Inspector 抽屉
              打开时由遮罩层自然盖住（mask 而非卸载，票 Comments 已记裁决）。 */}
          {!noRepo && view !== 'chat' && view !== 'tour' && (
            <AskDock
              key={repoId}
              repoName={currentRepo?.name ?? ''}
              onSubmit={(question) => {
                if (!repoId) return;
                setAskDraft({ repoId, text: question });
                setView('chat');
              }}
            />
          )}
        </div>
        <Inspector
          repoName={currentRepo?.name ?? null}
          file={inspector.file}
          text={inspector.text}
          loading={inspector.loading}
          error={inspector.error}
          glow={inspector.glow}
          symbolName={inspector.symbolName}
          onBack={inspector.goBack}
          onForward={inspector.goForward}
          canGoBack={inspector.canGoBack}
          canGoForward={inspector.canGoForward}
          open={inspectorOpen}
          onClose={() => setInspectorOpen(false)}
          onCopyAgentContext={handleCopyAgentContext}
          usage={totalUsage}
          slices={canvasAnchors}
          reverseDeps={reverseDeps}
          subgraph={subgraph}
          onOpenFile={inspector.openFile}
          onBackToDashboard={goTopology}
        />
      </div>
      <CopyMaskingToast trigger={maskingToastAt} />
      <footer
        data-testid="footer-status"
        className="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-line bg-surface px-3 text-[10px] text-muted"
      >
        <span className="min-w-0 truncate">{currentRepo?.localPath ?? '未连接仓库'}</span>
        <span className="flex shrink-0 items-center gap-3">
          <span>{currentRepo ? `${currentRepo.fileCount} files` : ''}</span>
          <span>{currentRepo ? `${currentRepo.symbolCount} symbols` : ''}</span>
          <span className="font-medium text-accent">Local-First</span>
        </span>
      </footer>
    </div>
  );
}
