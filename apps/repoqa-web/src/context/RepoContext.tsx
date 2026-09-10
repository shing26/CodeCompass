import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useRepoCatalog } from '../hooks/useRepoCatalog';
import { useSymbols } from '../hooks/useSymbols';
import { useTours } from '../hooks/useTours';
import { useDashboard } from '../hooks/useDashboard';
import { downloadTextFile } from '../utils/download';
import type { RepoQAClient } from '../client/RepoQAClient';
import type {
  IndexingProgress,
  Repo,
  RepoTour,
  WorkbenchTab
} from '../types';

/** Main view state: workbench tabs plus the guided Tour player. */
export type MainView = WorkbenchTab | 'tour';

/** Issue 30: derive the same-origin WebSocket endpoint from the API base. */
function repoUpdatedWebSocketUrl(baseUrl: string): string {
  if (!baseUrl) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }
  return `${baseUrl.replace(/^http/, 'ws')}/ws`;
}

interface RepoContextValue {
  client: RepoQAClient;
  initialRepoId: string | null;
  deepLink: { focus: string | null; mode: string | null; traceId: string | null };
  repos: Repo[];
  currentRepo: Repo | null;
  repoId: string | null;
  loading: boolean;
  error: string | null;
  selectRepo: (id: string) => void;
  refresh: ReturnType<typeof useRepoCatalog>['refresh'];
  symbols: ReturnType<typeof useSymbols>['symbols'];
  symbolsLoading: boolean;
  tours: ReturnType<typeof useTours>['tours'];
  toursLoading: boolean;
  toursError: ReturnType<typeof useTours>['error'];
  refreshTours: () => void;
  dashboard: ReturnType<typeof useDashboard>['dashboard'];
  dashboardLoading: boolean;
  dashboardError: ReturnType<typeof useDashboard>['error'];
  refreshDashboard: () => void;
  view: MainView;
  setView: (v: MainView) => void;
  activeTour: RepoTour | null;
  handlePlayTour: (tour: RepoTour) => void;
  goTopology: () => void;
  goEvolution: () => void;
  handleSelectView: (tab: WorkbenchTab) => void;
  indexingProgress: IndexingProgress | null;
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  handleSelectRepo: (id: string) => void;
  handleImportLocal: (name: string, localPath: string) => Promise<Repo>;
  handleCloneRemote: (url: string, branch?: string) => Promise<Repo>;
  handleReindex: (repo: Repo) => Promise<void>;
  handleDelete: (repo: Repo) => Promise<void>;
  handleExport: () => Promise<void>;
}

const RepoContext = createContext<RepoContextValue | null>(null);

/**
 * v0.25.0 批次 3：仓库域状态分片——catalog/符号/导览/仪表盘、视图路由、
 * URL 同步与 FS-watcher 热更新都收敛在这里。Provider 挂在 <App/> 内部
 * （暗礁防御：不迁 main.tsx，render(<App/>) 依然自带完整上下文）。
 */
export function RepoProvider({ client, children }: { client: RepoQAClient; children: ReactNode }) {
  // Issue 16: the CLI opens `/?repo=<id>` to jump straight into a repo's
  // cockpit; the catalog auto-selects it once loaded (no-op without the param).
  const initialRepoId = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('repo');
    } catch {
      return null;
    }
  }, []);
  // v0.8 — deep links: ?focus=<symbol>&traceId=<id> restore the trace scene in
  // the topology canvas; ?mode=diff opens the delta workbench tab directly.
  const deepLink = useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return {
        focus: params.get('focus'),
        mode: params.get('mode'),
        traceId: params.get('traceId')
      };
    } catch {
      return { focus: null, mode: null, traceId: null };
    }
  }, []);
  const { repos, currentRepo, loading, error, selectRepo, importRepo, refresh } = useRepoCatalog(
    client,
    initialRepoId
  );
  const repoId = currentRepo?.id ?? null;
  const {
    symbols,
    loading: symbolsLoading,
    refreshSilent: refreshSymbolsSilent
  } = useSymbols(client, repoId);
  const { tours, loading: toursLoading, error: toursError, refresh: refreshTours } = useTours(client, repoId);
  const {
    dashboard,
    loading: dashboardLoading,
    error: dashboardError,
    refresh: refreshDashboard,
    refreshSilent: refreshDashboardSilent
  } = useDashboard(client, repoId);

  // Issue 31: the three-pane workbench is the default; the dashboard and CI
  // gate are explicit TopBar tabs. Issue 23: ?mode=incident deep-links the
  // incident copilot view.
  const [view, setView] = useState<MainView>(
    deepLink.mode === 'diff' ? 'delta' : deepLink.mode === 'incident' || deepLink.mode === 'chat' ? 'chat' : 'topo'
  );
  const [activeTour, setActiveTour] = useState<RepoTour | null>(null);
  const [indexingProgress, setIndexingProgress] = useState<IndexingProgress | null>(null);
  // Bug-04: narrow viewports (≤ 375px) turn the panes into off-canvas drawers.
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  useEffect(() => {
    setIndexingProgress(null);
  }, [repoId]);

  const goTopology = () => {
    setActiveTour(null);
    setView('topo');
  };

  const goEvolution = () => {
    setActiveTour(null);
    setView('evolve');
  };

  const handleSelectView = (tab: WorkbenchTab) => {
    setActiveTour(null);
    setView(tab);
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
  // v0.8: the mode param rides along, so back/forward also restores delta view.
  // Issue 23: mode=incident restores the incident copilot view.
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('repo');
      if (id && id !== currentRepo?.id) {
        selectRepo(id);
        setActiveTour(null);
        const mode = params.get('mode');
        setView(mode === 'diff' ? 'delta' : mode === 'incident' || mode === 'chat' ? 'chat' : 'topo');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [currentRepo?.id, selectRepo]);

  // v0.8 — keep the URL's mode param in step with the workbench tab so a
  // refreshed deep link lands on the same view (delta ↔ mode=diff,
  // incident ↔ mode=incident).
  useEffect(() => {
    if (view === 'tour') return;
    try {
      const url = new URL(window.location.href);
      if (view === 'delta') url.searchParams.set('mode', 'diff');
      else if (view === 'chat') url.searchParams.set('mode', 'incident');
      else url.searchParams.delete('mode');
      window.history.replaceState(null, '', url.toString());
    } catch {
      // history/URL unavailable (rare test env) — view state still works
    }
  }, [view]);

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

  // Issue 14: fetch the handover document and trigger `{repoName}-ONBOARDING.md`.
  const handleExport = async () => {
    if (!currentRepo) return;
    const markdown = await client.exportOnboarding(currentRepo.id);
    downloadTextFile(`${currentRepo.name}-ONBOARDING.md`, markdown);
  };

  const value: RepoContextValue = {
    client,
    initialRepoId,
    deepLink,
    repos,
    currentRepo,
    repoId,
    loading,
    error,
    selectRepo,
    refresh,
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
  };

  return <RepoContext.Provider value={value}>{children}</RepoContext.Provider>;
}

export function useRepo(): RepoContextValue {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error('useRepo must be used inside <RepoProvider>');
  return ctx;
}
