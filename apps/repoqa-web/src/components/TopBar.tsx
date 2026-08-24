import { useState } from 'react';
import type { Repo } from '../types';
import { StatusStepper } from './StatusStepper';
import { ImportRepoModal } from './ImportRepoModal';

interface TopBarProps {
  repos: Repo[];
  currentRepo: Repo | null;
  loading: boolean;
  error: string | null;
  onSelectRepo: (id: string) => void;
  /** Issue 19: local ingestion — name + local path (double-tab import dialog). */
  onImportLocal: (name: string, localPath: string) => Promise<void>;
  /** Issue 19: remote ingestion — clone URL + optional branch. */
  onCloneRemote: (url: string, branch?: string) => Promise<Repo>;
  /** Issue 14: fetch the ONBOARDING.md handover doc and trigger the download. */
  onExport: () => Promise<void>;
  /** Bug-04: hamburger toggle for the mobile sidebar drawer. */
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  /** Bug-12: repo currently being indexed (from catalog polling) — lets the
   * import dialog show live phase feedback while POST /api/repos is pending. */
  importingRepo?: Repo | null;
}

/**
 * TopBar: repo selector + import entry + index status stepper. The import
 * ceremony lives in ImportRepoModal (Issue 19); this header only owns when it
 * is open.
 */
export function TopBar({
  repos,
  currentRepo,
  loading,
  error,
  onSelectRepo,
  onImportLocal,
  onCloneRemote,
  onExport,
  onToggleSidebar,
  sidebarOpen,
  importingRepo
}: TopBarProps) {
  const [showImport, setShowImport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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

  return (
    <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-2 py-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          data-testid="sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-expanded={sidebarOpen}
          className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:border-accent hover:text-accent md:hidden"
        >
          ☰
        </button>
        <h1 className="hidden shrink-0 text-sm font-semibold text-slate-900 min-[420px]:inline">
          CodeCompass
        </h1>
        <div className="relative min-w-0 max-w-[38vw]">
          <select
            data-testid="repo-select"
            className="h-8 w-full min-w-0 truncate rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-accent sm:max-w-none"
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
        </div>
        <button
          type="button"
          data-testid="open-import"
          onClick={() => setShowImport(true)}
          className="h-8 shrink-0 rounded-md bg-accent px-2 text-sm font-medium text-white hover:bg-blue-700 sm:px-3"
        >
          Import<span className="hidden sm:inline"> repo</span>
        </button>
        {currentRepo && (
          <button
            type="button"
            data-testid="export-onboarding"
            onClick={handleExport}
            disabled={exporting}
            className="h-8 shrink-0 rounded-md border border-slate-300 px-2 text-sm font-medium text-slate-700 hover:border-accent hover:text-accent disabled:opacity-50 sm:px-3"
          >
            {exporting ? (
              <span className="sm:hidden">…</span>
            ) : (
              <>
                <span className="hidden sm:inline">导出 ONBOARDING.md</span>
                <span className="sm:hidden">导出</span>
              </>
            )}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {error && <span className="hidden text-xs text-red-600 sm:inline">{error}</span>}
        {exportError && <span className="hidden text-xs text-red-600 sm:inline">{exportError}</span>}
        {currentRepo ? (
          <>
            <div className="hidden sm:block">
              <StatusStepper status={currentRepo.status} />
            </div>
            <span className="hidden max-w-[220px] truncate text-xs text-slate-400 lg:inline">{currentRepo.localPath}</span>
          </>
        ) : (
          <span className="hidden text-xs text-slate-400 sm:inline">No repo selected</span>
        )}
      </div>

      {showImport && (
        <ImportRepoModal
          open
          onClose={() => setShowImport(false)}
          onImportLocal={onImportLocal}
          onCloneRemote={onCloneRemote}
          repos={repos}
          importingRepo={importingRepo}
        />
      )}
    </header>
  );
}