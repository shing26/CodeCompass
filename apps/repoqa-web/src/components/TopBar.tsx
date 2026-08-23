import { useEffect, useState, type FormEvent } from 'react';
import type { Repo } from '../types';
import { StatusStepper } from './StatusStepper';

interface TopBarProps {
  repos: Repo[];
  currentRepo: Repo | null;
  loading: boolean;
  error: string | null;
  onSelectRepo: (id: string) => void;
  onImport: (name: string, localPath: string) => Promise<void>;
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
 * TopBar: repo selector + import entry + index status stepper.
 * Import keeps a minimal inline dialog so the flow stays in one ceremony.
 */
export function TopBar({
  repos,
  currentRepo,
  loading,
  error,
  onSelectRepo,
  onImport,
  onExport,
  onToggleSidebar,
  sidebarOpen,
  importingRepo
}: TopBarProps) {
  const [showImport, setShowImport] = useState(false);
  const [name, setName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Bug-11: standard dialog behavior — Escape closes the import dialog.
  // Listener lives only while the dialog is mounted; the overlay click uses
  // the same close path, and Escape never leaks to other components.
  useEffect(() => {
    if (!showImport) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowImport(false);
        setImportError(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showImport]);

  const submitImport = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !localPath.trim() || busy) return;
    setBusy(true);
    setImportError(null);
    try {
      await onImport(name.trim(), localPath.trim());
      setName('');
      setLocalPath('');
      setShowImport(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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
          Import<span className="hidden sm:inline"> local repo</span>
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
        <div
          data-testid="import-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30"
          role="dialog"
          aria-modal="true"
          aria-label="Import local repo"
          onClick={() => setShowImport(false)}
        >
          <form
            className="w-96 rounded-lg border border-slate-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitImport}
          >
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Import local repo</h2>
            <label className="mb-2 block text-xs font-medium text-slate-600">
              Name
              <input
                data-testid="import-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="petclinic"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </label>
            <label className="mb-3 block text-xs font-medium text-slate-600">
              Local path
              <input
                data-testid="import-path"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="C:/projects/spring-petclinic"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
            </label>
            {importError && <p className="mb-2 text-xs text-red-600">{importError}</p>}
            {busy &&
              (importingRepo ? (
                <div
                  data-testid="import-progress"
                  className="mb-2 flex items-center gap-2 rounded-md border border-accent-soft bg-accent-soft/40 px-2 py-1.5 text-xs text-accent"
                >
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                  {importingRepo.fileCount > 0
                    ? `正在解析 AST…（${importingRepo.fileCount} 个文件）`
                    : '正在扫描仓库…（索引中）'}
                </div>
              ) : (
                <p
                  data-testid="import-progress"
                  className="mb-2 text-xs text-slate-500"
                >
                  正在启动导入…
                </p>
              ))}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowImport(false)}
                className="h-8 rounded-md px-3 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="import-submit"
                disabled={busy || !name.trim() || !localPath.trim()}
                className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </form>
        </div>
      )}
    </header>
  );
}