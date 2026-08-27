import { useEffect, useMemo, useState } from 'react';
import { useRepoCatalog } from './hooks/useRepoCatalog';
import { useChat } from './hooks/useChat';
import { useSymbols } from './hooks/useSymbols';
import { useInspector } from './hooks/useInspector';
import { useReverseDeps } from './hooks/useReverseDeps';
import { useSubgraphContext } from './hooks/useSubgraphContext';
import { useTours } from './hooks/useTours';
import { useDashboard } from './hooks/useDashboard';
import { RepoQAClient, resolveBaseUrl } from './client/RepoQAClient';
import { downloadTextFile } from './utils/download';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { DashboardView } from './components/DashboardView';
import { CiGateView } from './components/CiGateView';
import { ArchitectureDeltaView } from './components/ArchitectureDeltaView';
import { TourPlayer } from './components/TourPlayer';
import { PrivacyConsentModal } from './components/PrivacyConsentModal';
import type {
  Anchor,
  IndexingProgress,
  QueryMode,
  Repo,
  RepoTour,
  RuntimeInfo,
  TopApiEntry,
  WorkbenchTab
} from './types';

export interface AppProps {
  /** Dependency injection seam for tests; defaults to the real client. */
  client?: RepoQAClient;
}

/** Issue 30: derive the same-origin WebSocket endpoint from the API base. */
function repoUpdatedWebSocketUrl(baseUrl: string): string {
  if (!baseUrl) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }
  return `${baseUrl.replace(/^http/, 'ws')}/ws`;
}

/** Main view state: workbench tabs plus the guided Tour player. */
type MainView = WorkbenchTab | 'tour';

export function App({ client: clientProp }: AppProps) {
  // Build the default client once: constructing it during render (e.g. in a
  // default parameter) yields a new instance on every render, which changes
  // hook dependencies and causes an infinite effect loop (max update depth).
  const client = useMemo(() => clientProp ?? new RepoQAClient(resolveBaseUrl()), [clientProp]);

  // Issue 16: the CLI opens `/?repo=<id>` to jump straight into a repo's
  // cockpit; the catalog auto-selects it once loaded (no-op without the param).
  const initialRepoId = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('repo');
    } catch {
      return null;
    }
  }, []);
  const { repos, currentRepo, loading, error, selectRepo, importRepo, refresh } = useRepoCatalog(
    client,
    initialRepoId
  );
  const repoId = currentRepo?.id ?? null;
  const {
    messages,
    streaming,
    reconnecting,
    recovered,
    error: chatError,
    submit,
    retry,
    totalUsage
  } = useChat(client, repoId);
  const [runtime, setRuntime] = useState<RuntimeInfo>({ llm: { mode: 'none' } });
  const [llmConsented, setLlmConsented] = useState(false);
  const [consentPending, setConsentPending] = useState<{
    question: string;
    mode?: QueryMode;
    start?: { name: string; file: string };
  } | null>(null);

  useEffect(() => {
    client
      .getRuntime()
      .then(setRuntime)
      .catch(() => {
        // Runtime metadata is best-effort; the app still works without it.
      });
  }, [client]);
  const {
    symbols,
    loading: symbolsLoading,
    refreshSilent: refreshSymbolsSilent
  } = useSymbols(client, repoId);
  const inspector = useInspector(client, repoId);
  const reverseDeps = useReverseDeps(client, repoId, inspector.symbolName);
  const subgraph = useSubgraphContext(client, repoId, inspector.symbolName);
  const { tours, loading: toursLoading, error: toursError, refresh: refreshTours } = useTours(client, repoId);
  const {
    dashboard,
    loading: dashboardLoading,
    error: dashboardError,
    refresh: refreshDashboard,
    refreshSilent: refreshDashboardSilent
  } = useDashboard(client, repoId);

  // Issue 30: FS watcher hot reload — re-fetch symbols/dashboard on
  // repo_updated without changing the current view or showing loaders.
  useEffect(() => {
    if (!repoId || typeof WebSocket === 'undefined') return;
    let ws: WebSocket | null = null;
    let cancelled = false;
    try {
      ws = new WebSocket(repoUpdatedWebSocketUrl(client.baseUrl));
    } catch {
      return;
    }
    ws.onmessage = (event) => {
      if (cancelled) return;
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          payload?: { repoId?: string; phase?: IndexingProgress['phase']; percent?: number };
        };
        if (message.type === 'repoqa.index.progress') {
          const payload = message.payload as IndexingProgress | undefined;
          if (payload && payload.repoId === repoId) {
            setIndexingProgress(payload);
            if (payload.phase === 'FINALIZING' && payload.percent === 100) {
              void refreshSymbolsSilent();
              void refreshDashboardSilent();
            }
          }
        } else if (message.type === 'repo_updated' && message.payload?.repoId === repoId) {
          void refreshSymbolsSilent();
          void refreshDashboardSilent();
        }
      } catch {
        // malformed frame — ignore and keep the connection alive
      }
    };
    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [client.baseUrl, repoId, refreshSymbolsSilent, refreshDashboardSilent]);

  // Issue 31: the three-pane workbench is the default; the dashboard and CI
  // gate are explicit TopBar tabs.
  const [view, setView] = useState<MainView>('topo');
  const [activeTour, setActiveTour] = useState<RepoTour | null>(null);
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress | null>(null);
  // Bug-04: narrow viewports (≤ 375px) turn the panes into off-canvas drawers.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  // Opening a file (diagram node / anchor / tour step) auto-reveals the
  // Inspector on mobile; on desktop the drawer classes are inert (md:static).
  useEffect(() => {
    if (inspector.file) setInspectorOpen(true);
  }, [inspector.file]);

  useEffect(() => {
    setIndexingProgress(null);
  }, [repoId]);

  const goTopology = () => {
    setActiveTour(null);
    setView('topo');
  };

  const handleSelectRepo = (id: string) => {
    selectRepo(id);
    // Bug-R2-02: pushState (not replaceState) so switching repos creates a
    // history entry and browser back returns to the previous repo instead of
    // escaping to about:blank. F5 still restores ?repo= via initialRepoId.
    if (id !== currentRepo?.id) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('repo', id);
        window.history.pushState(null, '', url.toString());
      } catch {
        // history/URL unavailable (rare test env) — selection still works locally
      }
    }
    setActiveTour(null);
    setView('topo');
  };

  // Bug-08: restore the selected repo when the user navigates back/forward
  // in browser history (the URL is the single source of truth for selection).
  useEffect(() => {
    const onPopState = () => {
      const id = new URLSearchParams(window.location.search).get('repo');
      if (id && id !== currentRepo?.id) {
        selectRepo(id);
        setActiveTour(null);
        setView('topo');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [currentRepo?.id, selectRepo]);

  const handleImportLocal = async (name: string, localPath: string): Promise<Repo> => {
    const repo = await importRepo(name, localPath);
    if (repo.status !== 'error') {
      setActiveTour(null);
      setView('topo');
    }
    return repo;
  };

  // Issue 19: remote clone — POST /api/repos/clone returns once the clone
  // lands (repo status `indexing`), then the catalog poll takes over and the
  // import dialog auto-closes when the repo flips to `ready`.
  const handleCloneRemote = async (url: string, branch?: string): Promise<Repo> => {
    const repo = await client.cloneRepo(url, branch);
    await refresh();
    selectRepo(repo.id);
    setActiveTour(null);
    setView('topo');
    return repo;
  };

  const handlePlayTour = (tour: RepoTour) => {
    setActiveTour(tour);
    setView('tour');
  };

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

  const handleSubmit: typeof submit = (question, mode, start) => {
    if (runtime.llm.mode === 'remote' && !llmConsented) {
      setConsentPending({ question, mode, start });
      return;
    }
    submit(question, mode, start);
  };

  const confirmConsent = () => {
    setLlmConsented(true);
    if (consentPending) submit(consentPending.question, consentPending.mode, consentPending.start);
    setConsentPending(null);
  };

  // Issue 14: fetch the handover document and trigger `{repoName}-ONBOARDING.md`.
  const handleExport = async () => {
    if (!currentRepo) return;
    const markdown = await client.exportOnboarding(currentRepo.id);
    downloadTextFile(`${currentRepo.name}-ONBOARDING.md`, markdown);
  };

  const handleCopyAgentContext = async () => {
    if (!repoId || !inspector.file) return;
    const query = inspector.file.split(/[\\/]/).pop() ?? inspector.file;
    const context = await client.getSubgraphContext(repoId, query);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(context.text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = context.text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  };

  const handleReindex = async (repo: Repo) => {
    if (!window.confirm(`重新索引「${repo.name}」？现有索引会被重建。`)) return;
    try {
      await client.reindexRepo(repo.id);
      await refresh();
      selectRepo(repo.id);
      setActiveTour(null);
      setView('topo');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (repo: Repo) => {
    if (!window.confirm(`删除「${repo.name}」的索引？源文件不会被删除。`)) return;
    try {
      await client.deleteRepo(repo.id);
      await refresh();
      selectRepo('');
      setActiveTour(null);
      setView('topo');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  };

  // The Inspector's 2-Hop slice panel follows the latest resolved trace.
  const inspectorSlices = useMemo<Anchor[]>(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === 'assistant' && message.anchors?.length) {
        return message.anchors;
      }
    }
    return [];
  }, [messages]);

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
        llmMode={runtime.llm.mode}
        llmHost={runtime.llm.host}
        activeView={view === 'tour' ? 'topo' : view}
        onSelectView={(tab) => {
          setActiveTour(null);
          setView(tab);
        }}
        onCopyAgentContext={handleCopyAgentContext}
        canCopyAgentContext={repoId !== null && inspector.file !== null}
        indexingProgress={indexingProgress}
      />
      {consentPending && (
        <PrivacyConsentModal
          host={runtime.llm.host}
          onConfirm={confirmConsent}
          onCancel={() => setConsentPending(null)}
        />
      )}
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
          {!repoId || view === 'topo' ? (
            <Canvas
              repo={currentRepo}
              messages={messages}
              streaming={streaming}
              reconnecting={reconnecting}
              recovered={recovered}
              error={chatError}
              totalUsage={totalUsage}
              onSubmit={handleSubmit}
              onRetry={retry}
              onNavigate={inspector.openFile}
              symbols={symbols}
            />
          ) : view === 'tour' && activeTour ? (
            <TourPlayer
              key={activeTour.id}
              tour={activeTour}
              onNavigate={inspector.openFile}
              onBack={goTopology}
            />
          ) : view === 'gate' ? (
            <CiGateView repo={currentRepo} dashboard={dashboard} />
          ) : view === 'delta' ? (
            <ArchitectureDeltaView
              repo={currentRepo}
              client={client}
              onNavigate={inspector.openFile}
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
        </div>
        <Inspector
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
          slices={inspectorSlices}
          reverseDeps={reverseDeps}
          subgraph={subgraph}
          onOpenFile={inspector.openFile}
        />
      </div>
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
