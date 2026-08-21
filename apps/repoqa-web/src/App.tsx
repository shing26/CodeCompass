import { useMemo } from 'react';
import { useRepoCatalog } from './hooks/useRepoCatalog';
import { useChat } from './hooks/useChat';
import { useSymbols } from './hooks/useSymbols';
import { useInspector } from './hooks/useInspector';
import { RepoQAClient, resolveBaseUrl } from './client/RepoQAClient';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';

export interface AppProps {
  /** Dependency injection seam for tests; defaults to the real client. */
  client?: RepoQAClient;
}

export function App({ client: clientProp }: AppProps) {
  // Build the default client once: constructing it during render (e.g. in a
  // default parameter) yields a new instance on every render, which changes
  // hook dependencies and causes an infinite effect loop (max update depth).
  const client = useMemo(() => clientProp ?? new RepoQAClient(resolveBaseUrl()), [clientProp]);
  const { repos, currentRepo, loading, error, selectRepo, importRepo } = useRepoCatalog(client);
  const repoId = currentRepo?.id ?? null;
  const { messages, streaming, reconnecting, error: chatError, submit, retry } = useChat(client, repoId);
  const { symbols, loading: symbolsLoading } = useSymbols(client, repoId);
  const inspector = useInspector(client, repoId);

  return (
    <div className="flex h-full flex-col bg-white text-slate-900">
      <TopBar
        repos={repos}
        currentRepo={currentRepo}
        loading={loading}
        error={error}
        onSelectRepo={selectRepo}
        onImport={importRepo}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          repoName={currentRepo?.name ?? null}
          symbols={symbols}
          loading={symbolsLoading}
          onTour={(question) => submit(question)}
        />
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