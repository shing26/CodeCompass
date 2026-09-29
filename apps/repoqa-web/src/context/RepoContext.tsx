import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useRepoCatalog } from '../hooks/useRepoCatalog';
import { useSymbols } from '../hooks/useSymbols';
import { useTours } from '../hooks/useTours';
import { useDashboard } from '../hooks/useDashboard';
import { downloadTextFile } from '../utils/download';
import type { RepoQAClient } from '../client/RepoQAClient';
import type {
  StepperProgress,
  Repo,
  RepoTour,
  WorkbenchTab
} from '../types';

/** Main view state: workbench tabs plus the guided Tour player. */
export type MainView = WorkbenchTab | 'tour';

/**
 * Ticket 16 (QA-07): the single mapping from the URL's ?mode= to a workbench
 * view — cold load, popstate and repo selection all go through it so the
 * alias table never drifts. `incident` is the canonical value for the chat
 * tab; `chat` is a legacy alias accepted on read, and the URL is normalized
 * back to `incident` by the view-sync effect (documented in HANDOFF).
 */
function viewFromMode(mode: string | null | undefined): MainView {
  if (mode === 'diff') return 'delta';
  if (mode === 'incident' || mode === 'chat') return 'chat';
  // 票 05 — 降级页面的深链入口：`?mode=metrics` / `?mode=evolve`。既有 mode
  // 语义零改，纯增量。
  if (mode === 'metrics') return 'metrics';
  if (mode === 'evolve') return 'evolve';
  // v1.2 票 01 — 体检面回归一级后获得同款深链（?mode=scan），选库前/后一致生效。
  if (mode === 'scan') return 'scan';
  return 'topo';
}

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
  /** v1.2 票 03 — 最近一次克隆瞬断重试事件（WS `repoqa.import.clone-retry`），
   * Modal 在克隆阶段显示「网络瞬断，重试中」；null = 无。 */
  cloneRetry: { name: string; attempt: number; backoffMs: number } | null;
  activeTour: RepoTour | null;
  handlePlayTour: (tour: RepoTour) => void;
  goTopology: () => void;
  goEvolution: () => void;
  handleSelectView: (tab: WorkbenchTab) => void;
  indexingProgress: StepperProgress | null;
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
  // incident copilot view. Without a repo the deep-linked view still lands in
  // state (ticket 16): the main-area/topo fallback keeps highlight + content
  // consistent until a repo exists (see App.tsx noRepo).
  const [view, setView] = useState<MainView>(() => viewFromMode(deepLink.mode));
  const [activeTour, setActiveTour] = useState<RepoTour | null>(null);
  const [indexingProgress, setIndexingProgress] = useState<StepperProgress | null>(null);
  // v1.2 票 03 — 克隆瞬断重试的近况（Modal 克隆阶段展示；见 WS 分支）。
  const [cloneRetry, setCloneRetry] = useState<{
    name: string;
    attempt: number;
    backoffMs: number;
  } | null>(null);
  // Bug-04: narrow viewports (≤ 375px) turn the panes into off-canvas drawers.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // v1.2 票 03 — WS 常驻通道读最新值的 ref（effect 依赖收敛为 [client.baseUrl]，
  // 选库/切库不再重建 socket；见下方 effect 注释）。
  const repoIdRef = useRef(repoId);
  repoIdRef.current = repoId;
  const refreshSymbolsRef = useRef(refreshSymbolsSilent);
  refreshSymbolsRef.current = refreshSymbolsSilent;
  const refreshDashboardRef = useRef(refreshDashboardSilent);
  refreshDashboardRef.current = refreshDashboardSilent;

  // Issue 30: FS watcher hot reload — re-fetch symbols/dashboard on
  // repo_updated without changing the current view or showing loaders.
  // v0.27-B R2: the backend restart used to leave this socket permanently
  // closed (progress silently dead until F5). Now onclose schedules an
  // exponential-backoff reconnect (1s→2s→…→30s cap, spec Q6); each re-open
  // (attempt>0) triggers a silent refresh so frames missed while down are
  // caught up. attempt 0 (initial connect) never refreshes — the caller's
  // own load already did, and existing repo_updated tests rely on that.
  useEffect(() => {
    // v1.2 票 03 — 门控从「已选库」放宽为常连：克隆/导入的瞬断重试事件
    // （repoqa.import.clone-retry）与索引进度常发生在**尚未选库**时。消息
    // 分支自带 repoId 匹配过滤（progress/repo_updated），常连不改变既有语义。
    // 同时效应依赖收敛为 [client.baseUrl] 一个：repoId 与其派生的 silent
    // refresh 走 ref 读最新值——选库/切库不再重建 socket（常驻通道语义，
    // 也消除切库瞬间的重连窗口）。
    if (typeof WebSocket === 'undefined') return;
    let ws: WebSocket | null = null;
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (cancelled) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(repoUpdatedWebSocketUrl(client.baseUrl));
      } catch {
        schedule(); // transient connect failure (e.g. backend mid-restart)
        return;
      }
      ws = socket;
      const isConnectedRefresh = attempt > 0;
      socket.onopen = () => {
        attempt = 0; // reset backoff after a successful link
        // v1.2 票 03 — 常连后补上 repoId 守卫：未选库时重连不自刷（无仓可刷）。
        if (isConnectedRefresh && repoIdRef.current) {
          void refreshSymbolsRef.current();
          void refreshDashboardRef.current();
        }
      };
      socket.onmessage = (event) => {
        if (cancelled) return;
        try {
          const message = JSON.parse(String(event.data)) as {
            type?: string;
            payload?: { repoId?: string; phase?: StepperProgress['phase']; percent?: number };
          };
          if (message.type === 'repoqa.index.progress') {
            const payload = message.payload as StepperProgress | undefined;
            if (payload && payload.repoId === repoIdRef.current) {
              setIndexingProgress(payload);
              if (payload.phase === 'FINALIZING' && payload.percent === 100) {
                void refreshSymbolsRef.current();
                void refreshDashboardRef.current();
              }
            }
          } else if (message.type === 'repo_updated' && message.payload?.repoId === repoIdRef.current) {
            void refreshSymbolsRef.current();
            void refreshDashboardRef.current();
          } else if (message.type === 'repoqa.import.clone-retry') {
            // v1.2 票 03 — 克隆瞬断重试上屏（Modal 克隆阶段显示；无 repoId
            // 依赖，故常连下即可收到——门控放宽的原因之一）。
            const payload = message.payload as
              | { name?: string; attempt?: number; backoffMs?: number }
              | undefined;
            if (payload && typeof payload.attempt === 'number') {
              setCloneRetry({
                name: payload.name ?? '',
                attempt: payload.attempt,
                backoffMs: payload.backoffMs ?? 0
              });
            }
          }
        } catch {
          // malformed frame — ignore and keep the connection alive
        }
      };
      socket.onclose = () => {
        if (!cancelled) schedule();
      };
      socket.onerror = () => {
        // onclose always follows; nothing extra to do but keep a no-op here
        // so an unhandled 'error' never crashes the page.
      };
    };

    const schedule = () => {
      if (cancelled || retryTimer) return;
      const delay = Math.min(1000 * 2 ** attempt, 30_000);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        open();
      }, delay);
    };

    open();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
    // v1.2 票 03 — 常连后依赖收敛：repoId 与 silent refresh 走 ref 读最新值，
    // 选库/切库不重建 socket（repoId 仅作为分支过滤的当前值使用）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.baseUrl]);

  useEffect(() => {
    setIndexingProgress(null);
  }, [repoId]);

  // V27-23 (v029/04): the stepper used to persist forever after a completed
  // index — the WS handler only SETS indexingProgress (FINALIZING/100 closes
  // the stream with no clearing frame), and the only reset was the repo-switch
  // effect. Now the catalog poll is the authority for "done": once the current
  // repo leaves the active statuses (cloning/parsing/indexing → ready/error),
  // the progress overlay is cleared. Active-state list mirrors useRepoCatalog.
  useEffect(() => {
    if (!indexingProgress || !currentRepo) return;
    const active = ['cloning', 'parsing', 'indexing'].includes(currentRepo.status);
    if (!active) setIndexingProgress(null);
  }, [currentRepo, indexingProgress]);

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
    // Ticket 16 (QA-07): a pending ?mode= deep link takes effect the moment a
    // repo exists — until then the URL param sat inert behind the topo guide.
    setView(viewFromMode(new URLSearchParams(window.location.search).get('mode')));
  };

  // Bug-08: restore the selected repo when the user navigates back/forward
  // in browser history (the URL is the single source of truth for selection).
  // v0.8: the mode param rides along, so back/forward also restores delta view.
  // Issue 23: mode=incident restores the incident copilot view.
  // Ticket 13 (QA-04): the doctrine extended to the negative case — a history
  // entry WITHOUT ?repo means "no repo selected". Back from a repo view to
  // the plain entry deselects through the same state machine the delete flow
  // uses (selectRepo('')), which also clears symbols/dashboard and, via the
  // repoId effect, the Inspector slice + drawer close (InspectorContext).
  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('repo');
      if (!id) {
        if (currentRepo?.id) selectRepo('');
        setActiveTour(null);
        setView(viewFromMode(params.get('mode')));
        return;
      }
      if (id !== currentRepo?.id) {
        selectRepo(id);
        setActiveTour(null);
        setView(viewFromMode(params.get('mode')));
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [currentRepo?.id, selectRepo]);

  // v0.8 — keep the URL's mode param in step with the workbench tab so a
  // refreshed deep link lands on the same view (delta ↔ mode=diff,
  // incident ↔ mode=incident). 票 05 — the demoted metrics/evolve pages gain the
  // same round-trip: `?mode=metrics` / `?mode=evolve` must SURVIVE while the repo
  // is being selected, or the pending deep link is wiped before it can apply.
  useEffect(() => {
    if (view === 'tour') return;
    try {
      const url = new URL(window.location.href);
      if (view === 'delta') url.searchParams.set('mode', 'diff');
      else if (view === 'chat') url.searchParams.set('mode', 'incident');
      else if (view === 'metrics') url.searchParams.set('mode', 'metrics');
      else if (view === 'evolve') url.searchParams.set('mode', 'evolve');
      else if (view === 'scan') url.searchParams.set('mode', 'scan');
      else url.searchParams.delete('mode');
      window.history.replaceState(null, '', url.toString());
    } catch {
      // history/URL unavailable (rare test env) — view state still works
    }
  }, [view]);

  const handleImportLocal = async (name: string, localPath: string): Promise<Repo> => {
    // v1.2 票 03（V29-1 后半）：202 语义——拿到 indexing 行即返回，收尾与
    // clone 同款（刷新目录、选中、切拓扑）；索引进度由 WS + catalog 轮询承载，
    // Modal 在 ready 时自动关（error 由 Modal 从行数据读并显示重试建议）。
    const repo = await importRepo(name, localPath);
    await refresh();
    selectRepo(repo.id);
    setActiveTour(null);
    setView('topo');
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
    cloneRetry,
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
