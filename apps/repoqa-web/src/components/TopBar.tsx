import { useState, type FormEvent } from 'react';
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
  onExport
}: TopBarProps) {
  const [showImport, setShowImport] = useState(false);
  const [name, setName] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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
    <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-semibold text-slate-900">CodeCompass</h1>
        <div className="relative">
          <select
            data-testid="repo-select"
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-accent"
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
          className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-blue-700"
        >
          Import local repo
        </button>
        {currentRepo && (
          <button
            type="button"
            data-testid="export-onboarding"
            onClick={handleExport}
            disabled={exporting}
            className="h-8 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : '导出 ONBOARDING.md'}
          </button>
        )}
      </div>

      <div className="flex items-center gap-3">
        {error && <span className="text-xs text-red-600">{error}</span>}
        {exportError && <span className="text-xs text-red-600">{exportError}</span>}
        {currentRepo ? (
          <>
            <StatusStepper status={currentRepo.status} />
            <span className="text-xs text-slate-400">{currentRepo.local_path}</span>
          </>
        ) : (
          <span className="text-xs text-slate-400">No repo selected</span>
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