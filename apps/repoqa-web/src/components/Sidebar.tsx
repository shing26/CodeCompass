import { useState } from 'react';
import type { RepoSymbol, RepoTour } from '../types';
import { buildSymbolTree, filterByKind } from '../hooks/useSymbols';
import { QuickTours } from './QuickTours';

interface SidebarProps {
  repoName: string | null;
  symbols: RepoSymbol[];
  loading: boolean;
  tours: RepoTour[];
  toursLoading: boolean;
  toursError: string | null;
  onRetryTours: () => void;
  onPlayTour: (tour: RepoTour) => void;
  /** Bug-04: narrow viewports render the sidebar as an off-canvas drawer. */
  open: boolean;
  /** Issue 18: jump a symbol / route into the Monaco Inspector. */
  onNavigate?: (file: string, line: number) => void;
}

/**
 * Left sidebar: Quick Tours (Recommended + More), route list and symbol tree.
 * Route/symbol browsing is read-only navigation of deterministic AST symbols;
 * every symbol and route row opens its source location in the Inspector.
 */
export function Sidebar({
  repoName,
  symbols,
  loading,
  tours,
  toursLoading,
  toursError,
  onRetryTours,
  onPlayTour,
  open,
  onNavigate
}: SidebarProps) {
  const [symbolsExpanded, setSymbolsExpanded] = useState(false);

  const routes = filterByKind(symbols, 'route');
  const tree = buildSymbolTree(symbols);

  const openAt = (file: string, line: number | null | undefined) => {
    onNavigate?.(file, line ?? 1);
  };

  return (
    <aside
      data-testid="sidebar"
      className={`fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-slate-200 bg-slate-50 transition-transform md:static md:z-auto md:shrink-0 md:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <section className="border-b border-slate-200 p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Quick Tours
        </h2>
        {repoName && (
          <QuickTours
            tours={tours}
            loading={toursLoading}
            error={toursError}
            onRetry={onRetryTours}
            onPlay={onPlayTour}
          />
        )}
        {!repoName && (
          <p data-testid="sidebar-placeholder" className="text-xs text-slate-400">
            Choose a repo to see recommended tours.
          </p>
        )}
      </section>

      <section className="border-b border-slate-200 p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Routes ({routes.length})
        </h2>
        {loading && <p className="text-xs text-slate-400">Loading…</p>}
        {!loading && routes.length === 0 && <p className="text-xs text-slate-400">—</p>}
        <ul className="space-y-1">
          {routes.slice(0, 20).map((r) => (
            <li key={r.id}>
              <button
                type="button"
                data-testid="route-item"
                onClick={() => openAt(r.filePath, r.lineStart)}
                title={`${r.displayPath ?? r.name} · ${r.filePath}:${r.lineStart ?? 1}`}
                className="w-full truncate rounded px-1 text-left font-mono text-xs text-slate-600 hover:bg-accent/10 hover:text-accent"
              >
                {r.displayPath ?? r.name}
              </button>
            </li>
          ))}
          {routes.length > 20 && (
            <li className="text-xs text-slate-400">+{routes.length - 20} more</li>
          )}
        </ul>
      </section>

      <section className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Symbols</h2>
          <button
            type="button"
            data-testid="symbols-toggle"
            onClick={() => setSymbolsExpanded((v) => !v)}
            className="text-xs text-accent hover:underline"
          >
            {symbolsExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {loading && <p className="text-xs text-slate-400">Loading…</p>}
        {!loading && !symbolsExpanded && (
          <p className="text-xs text-slate-400">{tree.length} files — expand to browse</p>
        )}
        {!loading && symbolsExpanded && (
          <ul className="space-y-1.5">
            {tree.slice(0, 30).map((fileNode) => (
              <li key={fileNode.file}>
                <button
                  type="button"
                  data-testid="symbol-file"
                  onClick={() => openAt(fileNode.file, 1)}
                  className="w-full truncate rounded px-1 text-left text-xs font-medium text-slate-700 hover:bg-accent/10 hover:text-accent"
                  title={fileNode.file}
                >
                  {fileNode.file}
                </button>
                <ul className="ml-2 space-y-0.5 border-l border-slate-200 pl-2">
                  {fileNode.types.slice(0, 8).map((typeNode) => (
                    <li key={typeNode.symbol.id}>
                      <button
                        type="button"
                        data-testid="symbol-type"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAt(typeNode.symbol.filePath, typeNode.symbol.lineStart);
                        }}
                        className="w-full truncate rounded px-1 text-left text-xs text-slate-600 hover:bg-accent/10 hover:text-accent"
                        title={`${typeNode.symbol.filePath}:${typeNode.symbol.lineStart ?? 1}`}
                      >
                        <span className="text-slate-400">{typeNode.symbol.kind}</span>{' '}
                        {typeNode.symbol.name}
                      </button>
                      {typeNode.members.length > 0 && (
                        <ul className="ml-3 space-y-0.5 border-l border-slate-200 pl-2">
                          {typeNode.members.slice(0, 12).map((m) => (
                            <li key={m.id}>
                              <button
                                type="button"
                                data-testid="symbol-member"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openAt(m.filePath, m.lineStart);
                                }}
                                className="w-full truncate rounded px-1 text-left text-xs text-slate-500 hover:bg-accent/10 hover:text-accent"
                                title={`${m.filePath}:${m.lineStart ?? 1}`}
                              >
                                {m.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}