import { useEffect, useRef, useState } from 'react';
import type { RepoSymbol, RepoTour } from '../types';
import { buildSymbolTree, filterByKind } from '../hooks/useSymbols';
import { QuickTours } from './QuickTours';

function matchesSymbol(symbol: RepoSymbol, query: string): boolean {
  return [
    symbol.name,
    symbol.displayPath,
    symbol.filePath,
    symbol.parentType,
    symbol.signature
  ].some((value) => typeof value === 'string' && value.toLowerCase().includes(query));
}

function languageBadgeFor(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'java':
      return 'Java';
    case 'ts':
    case 'tsx':
      return 'TS';
    case 'js':
    case 'jsx':
      return 'JS';
    case 'py':
      return 'Python';
    case 'go':
      return 'Go';
    case 'xml':
      return 'XML';
    default:
      return 'CODE';
  }
}

function httpMethodFor(symbol: RepoSymbol): string {
  const haystack = [symbol.name, ...(symbol.annotations ?? [])].join(' ');
  const mapping = haystack.match(/@(Get|Post|Put|Delete|Patch)(?:Mapping)?\b/i);
  if (mapping) return mapping[1].toUpperCase();
  const call = haystack.match(/\.(get|post|put|delete|patch)\s*\(/i);
  if (call) return call[1].toUpperCase();
  const inline = haystack.match(/\b(GET|POST|PUT|DELETE|PATCH)\s+\//);
  if (inline) return inline[1];
  return 'API';
}

function lineRangeFor(symbol: RepoSymbol): string {
  if (!symbol.lineStart) return '';
  if (symbol.lineEnd && symbol.lineEnd > symbol.lineStart) {
    return `L${symbol.lineStart}-${symbol.lineEnd}`;
  }
  return `L${symbol.lineStart}`;
}

function filterSymbolTree(
  tree: ReturnType<typeof buildSymbolTree>,
  query: string
): ReturnType<typeof buildSymbolTree> {
  if (!query) return tree;
  return tree.flatMap((fileNode) => {
    const fileMatches = fileNode.file.toLowerCase().includes(query);
    const types = fileNode.types.flatMap((typeNode) => {
      const typeMatches = matchesSymbol(typeNode.symbol, query);
      const members = typeMatches
        ? typeNode.members
        : typeNode.members.filter((member) => matchesSymbol(member, query));
      if (!typeMatches && members.length === 0) return [];
      return [{ symbol: typeNode.symbol, members }];
    });
    if (!fileMatches && types.length === 0) return [];
    return [{ file: fileNode.file, types }];
  });
}

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
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || !searchRef.current) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      searchRef.current.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const routes = filterByKind(symbols, 'route');
  const tree = buildSymbolTree(symbols);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRoutes = normalizedQuery
    ? routes.filter((route) => matchesSymbol(route, normalizedQuery))
    : routes;
  const visibleTree = filterSymbolTree(tree, normalizedQuery);
  const symbolsVisible = normalizedQuery !== '' || symbolsExpanded;
  const routeItems = visibleRoutes.slice(0, normalizedQuery ? 50 : 20);
  const symbolItems = visibleTree.slice(0, normalizedQuery ? 100 : 30);

  const openAt = (file: string, line: number | null | undefined) => {
    onNavigate?.(file, line ?? 1);
  };

  return (
    <aside
      data-testid="sidebar"
      className={`custom-scroll fixed inset-y-0 left-0 z-40 w-[280px] overflow-y-auto border-r border-line bg-subtle transition-transform md:static md:z-auto md:shrink-0 md:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <section className="border-b border-line p-3">
        <input
          ref={searchRef}
          data-testid="sidebar-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="过滤路由与符号"
          aria-label="过滤路由与符号"
          className="h-8 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-accent"
        />
      </section>

      <section className="border-b border-line p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
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
          <p data-testid="sidebar-placeholder" className="text-xs text-muted">
            Choose a repo to see recommended tours.
          </p>
        )}
      </section>

      <section className="border-b border-line p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Routes ({routes.length})
        </h2>
        {loading && <p className="text-xs text-muted">Loading…</p>}
        {!loading && routeItems.length === 0 && (
          <p className="text-xs text-muted">—</p>
        )}
        <ul className="space-y-1">
          {routeItems.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                data-testid="route-item"
                onClick={() => openAt(r.filePath, r.lineStart)}
                title={`${r.displayPath ?? r.name} · ${r.filePath}:${r.lineStart ?? 1}`}
                className="flex w-full items-center gap-2 rounded px-1 text-left font-mono text-xs text-muted hover:bg-accent/10 hover:text-accent"
              >
                <span className="shrink-0 rounded bg-accent/10 px-1 text-[9px] font-semibold text-accent">
                  {httpMethodFor(r)}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.displayPath ?? r.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted">
                  {lineRangeFor(r)}
                </span>
              </button>
            </li>
          ))}
          {routes.length > 20 && !normalizedQuery && (
            <li className="text-xs text-muted">+{routes.length - 20} more</li>
          )}
        </ul>
      </section>

      <section className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Symbols</h2>
          <button
            type="button"
            data-testid="symbols-toggle"
            onClick={() => setSymbolsExpanded((v) => !v)}
            className="text-xs text-accent hover:underline"
          >
            {symbolsVisible ? 'Collapse' : 'Expand'}
          </button>
        </div>
        {loading && <p className="text-xs text-muted">Loading…</p>}
        {!loading && !symbolsVisible && (
          <p className="text-xs text-muted">{tree.length} files — expand to browse</p>
        )}
        {!loading && symbolsVisible && symbolItems.length === 0 && (
          <p className="text-xs text-muted">无匹配符号</p>
        )}
        {!loading && symbolsVisible && (
          <ul className="space-y-1.5">
            {symbolItems.map((fileNode) => (
              <li key={fileNode.file}>
                <button
                  type="button"
                  data-testid="symbol-file"
                  onClick={() => openAt(fileNode.file, 1)}
                  className="flex w-full items-center gap-2 rounded px-1 text-left text-xs font-medium text-ink hover:bg-accent/10 hover:text-accent"
                  title={fileNode.file}
                >
                  <span className="shrink-0 rounded bg-subtle px-1 text-[9px] font-semibold text-muted">
                    {languageBadgeFor(fileNode.file)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{fileNode.file}</span>
                  <span className="shrink-0 font-mono text-[10px] text-muted">L1</span>
                </button>
                <ul className="ml-2 space-y-0.5 border-l border-line pl-2">
                  {fileNode.types.slice(0, 8).map((typeNode) => (
                    <li key={typeNode.symbol.id}>
                      <button
                        type="button"
                        data-testid="symbol-type"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAt(typeNode.symbol.filePath, typeNode.symbol.lineStart);
                        }}
                        className="flex w-full items-center gap-2 rounded px-1 text-left text-xs text-muted hover:bg-accent/10 hover:text-accent"
                        title={`${typeNode.symbol.filePath}:${typeNode.symbol.lineStart ?? 1}`}
                      >
                        {typeNode.symbol.displayPath && (
                          <span className="shrink-0 rounded bg-callee/10 px-1 text-[9px] font-semibold text-callee">
                            {httpMethodFor(typeNode.symbol)}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-muted">{typeNode.symbol.kind}</span>{' '}
                          {typeNode.symbol.name}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted">
                          {lineRangeFor(typeNode.symbol)}
                        </span>
                      </button>
                      {typeNode.members.length > 0 && (
                        <ul className="ml-3 space-y-0.5 border-l border-line pl-2">
                          {typeNode.members.slice(0, 12).map((m) => (
                            <li key={m.id}>
                              <button
                                type="button"
                                data-testid="symbol-member"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openAt(m.filePath, m.lineStart);
                                }}
                                className="flex w-full items-center gap-2 rounded px-1 text-left text-xs text-muted hover:bg-accent/10 hover:text-accent"
                                title={`${m.filePath}:${m.lineStart ?? 1}`}
                              >
                                {m.displayPath && (
                                  <span className="shrink-0 rounded bg-callee/10 px-1 text-[9px] font-semibold text-callee">
                                    {httpMethodFor(m)}
                                  </span>
                                )}
                                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                                <span className="shrink-0 font-mono text-[10px] text-muted">
                                  {lineRangeFor(m)}
                                </span>
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
