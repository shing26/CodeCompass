import { useState } from 'react';
import type { RepoSymbol } from '../types';
import { buildSymbolTree, filterByKind } from '../hooks/useSymbols';
import { QuickTours } from './QuickTours';

interface SidebarProps {
  repoName: string | null;
  symbols: RepoSymbol[];
  loading: boolean;
  onTour: (question: string) => void;
}

/**
 * Left sidebar: Quick Tours (Recommended + More), route list and symbol tree.
 * Route/symbol browsing is read-only navigation of deterministic AST symbols.
 */
export function Sidebar({ repoName, symbols, loading, onTour }: SidebarProps) {
  const [symbolsExpanded, setSymbolsExpanded] = useState(false);

  const routes = filterByKind(symbols, 'route');
  const tree = buildSymbolTree(symbols);

  return (
    <aside
      data-testid="sidebar"
      className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50"
    >
      <section className="border-b border-slate-200 p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Quick Tours
        </h2>
        {repoName && (
          <QuickTours repoName={repoName} symbols={symbols} onTour={onTour} />
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
            <li key={r.id} className="truncate text-xs text-slate-600" title={`${r.file_path}:${r.line_start}`}>
              {r.name}
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
                <div className="truncate text-xs font-medium text-slate-700" title={fileNode.file}>
                  {fileNode.file}
                </div>
                <ul className="ml-2 space-y-0.5 border-l border-slate-200 pl-2">
                  {fileNode.types.slice(0, 8).map((typeNode) => (
                    <li key={typeNode.symbol.id} className="text-xs text-slate-600">
                      <span className="text-slate-400">{typeNode.symbol.kind}</span>{' '}
                      {typeNode.symbol.name}
                      {typeNode.members.length > 0 && (
                        <ul className="ml-3 space-y-0.5 border-l border-slate-200 pl-2">
                          {typeNode.members.slice(0, 12).map((m) => (
                            <li key={m.id} className="truncate text-xs text-slate-500">
                              {m.name}
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