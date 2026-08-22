import { useMemo, useState } from 'react';
import { useRepoCatalog } from './hooks/useRepoCatalog';
import { useChat } from './hooks/useChat';
import { useSymbols } from './hooks/useSymbols';
import { useInspector } from './hooks/useInspector';
import { useTours } from './hooks/useTours';
import { useDashboard } from './hooks/useDashboard';
import { RepoQAClient, resolveBaseUrl } from './client/RepoQAClient';
import { downloadTextFile } from './utils/download';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { DashboardView } from './components/DashboardView';
import { TourPlayer } from './components/TourPlayer';
import type { RepoTour } from './types';

export interface AppProps {
  /** Dependency injection seam for tests; defaults to the real client. */
  client?: RepoQAClient;
}

/** Main view state: Onboarding Dashboard / guided Tour player / Q&A chat. */
type MainView = 'dashboard' | 'tour' | 'chat';

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
  const { repos, currentRepo, loading, error, selectRepo, importRepo } = useRepoCatalog(
    client,
    initialRepoId
  );
  const repoId = currentRepo?.id ?? null;
  const { messages, streaming, reconnecting, error: chatError, submit, retry } = useChat(client, repoId);
  const { symbols, loading: symbolsLoading } = useSymbols(client, repoId);
  const inspector = useInspector(client, repoId);
  const { tours, loading: toursLoading, error: toursError, refresh: refreshTours } = useTours(client, repoId);
  const {
    dashboard,
    loading: dashboardLoading,
    error: dashboardError,
    refresh: refreshDashboard
  } = useDashboard(client, repoId);

  // Issue 13: main-view switcher between dashboard / tour playback / chat.
  const [view, setView] = useState<MainView>('dashboard');
  const [activeTour, setActiveTour] = useState<RepoTour | null>(null);

  const showDashboard = () => {
    setActiveTour(null);
    setView('dashboard');
  };

  const handleSelectRepo = (id: string) => {
    selectRepo(id);
    setActiveTour(null);
    setView('dashboard');
  };

  const handleImport = async (name: string, localPath: string) => {
    await importRepo(name, localPath);
    setActiveTour(null);
    setView('dashboard');
  };

  const handlePlayTour = (tour: RepoTour) => {
    setActiveTour(tour);
    setView('tour');
  };

  const handleTrace = (question: string) => {
    setView('chat');
    submit(question);
  };

  // Issue 14: fetch the handover document and trigger `{repoName}-ONBOARDING.md`.
  const handleExport = async () => {
    if (!currentRepo) return;
    const markdown = await client.exportOnboarding(currentRepo.id);
    downloadTextFile(`${currentRepo.name}-ONBOARDING.md`, markdown);
  };

  return (
    <div className="flex h-full flex-col bg-white text-slate-900">
      <TopBar
        repos={repos}
        currentRepo={currentRepo}
        loading={loading}
        error={error}
        onSelectRepo={handleSelectRepo}
        onImport={handleImport}
        onExport={handleExport}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          repoName={currentRepo?.name ?? null}
          symbols={symbols}
          loading={symbolsLoading}
          tours={tours}
          toursLoading={toursLoading}
          toursError={toursError}
          onRetryTours={refreshTours}
          onPlayTour={handlePlayTour}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {repoId && view !== 'dashboard' && (
            <div
              data-testid="view-header"
              className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5"
            >
              <button
                type="button"
                data-testid="back-to-dashboard"
                onClick={showDashboard}
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-accent/40 hover:text-accent"
              >
                ← 返回看板
              </button>
              <span className="truncate text-xs text-slate-500">
                {view === 'tour' ? `Tour · ${activeTour?.title ?? ''}` : '问答流'}
              </span>
            </div>
          )}
          {!repoId || view === 'chat' ? (
            <Canvas
              repo={currentRepo}
              messages={messages}
              streaming={streaming}
              reconnecting={reconnecting}
              error={chatError}
              onSubmit={submit}
              onRetry={retry}
              onNavigate={inspector.openFile}
            />
          ) : view === 'tour' && activeTour ? (
            <TourPlayer
              key={activeTour.id}
              tour={activeTour}
              onNavigate={inspector.openFile}
              onBack={showDashboard}
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
              onOpenChat={() => setView('chat')}
            />
          )}
        </div>
        <Inspector
          file={inspector.file}
          text={inspector.text}
          loading={inspector.loading}
          error={inspector.error}
          glow={inspector.glow}
          onBack={inspector.goBack}
          onForward={inspector.goForward}
          canGoBack={inspector.canGoBack}
          canGoForward={inspector.canGoForward}
        />
      </div>
    </div>
  );
}