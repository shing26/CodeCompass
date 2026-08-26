import { useState } from 'react';
import type { LlmRuntimeMode, Repo, RepoPreview, WorkbenchTab } from '../types';
import { ImportRepoModal } from './ImportRepoModal';
import { PrivacyPill } from './PrivacyPill';
import { useTheme } from '../hooks/useTheme';

interface TopBarProps {
  repos: Repo[];
  currentRepo: Repo | null;
  loading: boolean;
  error: string | null;
  onSelectRepo: (id: string) => void;
  /** Issue 19: local ingestion — name + local path (double-tab import dialog). */
  onImportLocal: (name: string, localPath: string) => Promise<void>;
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
  llmMode: LlmRuntimeMode;
  llmHost?: string;
  /** Issue 31: active workbench tab. */
  activeView: WorkbenchTab;
  onSelectView: (tab: WorkbenchTab) => void;
  /** Issue 28: copy the Graph RAG agent context from the TopBar. */
  onCopyAgentContext: () => void | Promise<void>;
  canCopyAgentContext: boolean;
}

const TABS: Array<{ id: WorkbenchTab; label: string }> = [
  { id: 'topo', label: '拓扑探查' },
  { id: 'metrics', label: '架构指标' },
  { id: 'gate', label: 'CI 门禁' }
];

function watcherState(status: Repo['status'] | undefined) {
  switch (status) {
    case 'ready':
      return { label: 'Ready', dotClass: 'bg-success' };
    case 'indexing':
    case 'cloning':
    case 'parsing':
      return { label: 'Indexing', dotClass: 'bg-warning animate-pulse' };
    case 'error':
      return { label: 'Offline', dotClass: 'bg-danger' };
    default:
      return { label: 'Standby', dotClass: 'bg-muted' };
  }
}

/**
 * TopBar: 48px workbench header with repo/watcher state on the left, the
 * topo/metrics/gate segmented tabs in the middle and privacy/theme/agent
 * actions on the right. Repo lifecycle actions live in the overflow menu.
 */
export function TopBar({
  repos,
  currentRepo,
  loading,
  error,
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
  llmMode,
  llmHost,
  activeView,
  onSelectView,
  onCopyAgentContext,
  canCopyAgentContext
}: TopBarProps) {
  const [showImport, setShowImport] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const watcher = watcherState(currentRepo?.status);

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
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-subtle bg-surface px-2 sm:gap-3 sm:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
        <button
          type="button"
          data-testid="sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-expanded={sidebarOpen}
          className="shrink-0 rounded-md border border-line px-2 py-1 text-sm text-muted hover:border-accent hover:text-accent md:hidden"
        >
          ☰
        </button>
        <div
          data-testid="brand-logo"
          className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-line bg-subtle px-2"
        >
          <span className="grid h-4 w-4 place-items-center rounded-sm bg-accent text-[10px] font-bold text-white">
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
            {loading ? 'Loading repos…' : 'Select a repo'}
          </option>
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <span
          data-testid="watcher-status"
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-line bg-subtle px-2 py-1 text-[11px] font-medium text-muted min-[520px]:inline-flex"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${watcher.dotClass}`} />
          Watcher: {watcher.label}
        </span>
        <button
          type="button"
          data-testid="open-import"
          onClick={() => setShowImport(true)}
          className="h-8 shrink-0 rounded-md bg-accent px-2 text-sm font-medium text-white hover:bg-accent/90 sm:px-3"
        >
          Import<span className="hidden sm:inline"> repo</span>
        </button>
      </div>

      <nav
        data-testid="workbench-tabs"
        aria-label="Workbench views"
        className="flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-line bg-subtle p-0.5"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`tab-${tab.id}`}
            aria-pressed={activeView === tab.id}
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

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        {currentRepo && (
          <div className="relative shrink-0">
            <button
              type="button"
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
        {error && <span className="hidden text-xs text-danger xl:inline">{error}</span>}
        {exportError && (
          <span className="hidden text-xs text-danger xl:inline">{exportError}</span>
        )}
        <span
          data-testid="masked-badge"
          className="hidden rounded-full border border-line bg-subtle px-2 py-1 text-[10px] font-medium text-muted lg:inline-flex"
        >
          13-Rules Masked
        </span>
        <PrivacyPill mode={llmMode} host={llmHost} />
        <button
          type="button"
          data-testid="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'cyber' ? 'Switch to clean theme' : 'Switch to cyber theme'}
          title={theme === 'cyber' ? '切换到 Clean 主题' : '切换到 Cyber 主题'}
          className="h-8 shrink-0 rounded-md border border-line px-2 text-xs font-medium text-muted hover:border-accent hover:text-accent"
        >
          {theme === 'cyber' ? 'Clean' : 'Cyber'}
        </button>
        <button
          type="button"
          data-testid="topbar-copy-context"
          onClick={handleCopyAgentContext}
          disabled={!canCopyAgentContext || copying}
          className={`h-8 shrink-0 rounded-md px-3 text-xs font-medium transition-colors disabled:opacity-50 ${
            copied
              ? 'bg-success text-white'
              : 'bg-accent text-white hover:bg-accent/90'
          }`}
        >
          {copied ? '已复制' : '复制 Agent 上下文'}
        </button>
      </div>

      {showImport && (
        <ImportRepoModal
          open
          onClose={() => setShowImport(false)}
          onImportLocal={onImportLocal}
          onPreviewLocal={onPreviewLocal}
          onCloneRemote={onCloneRemote}
          repos={repos}
          importingRepo={importingRepo}
        />
      )}
    </header>
  );
}
