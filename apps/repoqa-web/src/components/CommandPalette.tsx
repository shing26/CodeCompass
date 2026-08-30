/**
 * v0.11 (Stage 3) — Cmd+K command palette.
 *
 * Fetches domain-radar anchors from the backend with 300ms debounce and
 * presents matching symbols alongside built-in commands (toggle theme, back
 * to dashboard). The user navigates with keyboard (↑/↓/Enter) and the parent
 * receives callbacks for focus/chosen actions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RepoQAClient } from '../client/RepoQAClient';
import type { DomainRadarAnchor } from '../types';

export interface PaletteCommand {
  id: string;
  label: string;
  shortcut?: string;
}

export interface PaletteSymbolResult {
  rank: number;
  anchor: DomainRadarAnchor;
}

interface CommandPaletteProps {
  open: boolean;
  client: RepoQAClient;
  repoId: string | null;
  onClose: () => void;
  onSelectSymbol: (symbol: string, filePath: string, line: number) => void;
  onToggleTheme?: () => void;
  onBackToDashboard?: () => void;
}

const BUILTIN_COMMANDS: PaletteCommand[] = [
  { id: 'toggle-theme', label: '切换主题', shortcut: 'T' },
  { id: 'back-dashboard', label: '返回看板', shortcut: 'B' },
];

export function CommandPalette({
  open,
  client,
  repoId,
  onClose,
  onSelectSymbol,
  onToggleTheme,
  onBackToDashboard
}: CommandPaletteProps) {
  const [input, setInput] = useState('');
  const [results, setResults] = useState<PaletteSymbolResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = input.trim();

  // Focus the input when opened.
  useEffect(() => {
    if (open) {
      setInput('');
      setResults([]);
      setSelectedIndex(0);
      // Delay-focus so the transition renders before the input steals focus.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on Escape regardless of focus target (the palette may open without
  // stealing focus in some embed contexts).
  useEffect(() => {
    if (!open) return;
    const onWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, [open, onClose]);

  // 300ms debounce: fetch radar anchors.
  useEffect(() => {
    if (!query || !repoId) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setLoading(true);
      client
        .radar(repoId, query)
        .then((radar) => {
          const ranked = radar.matchedAnchors.map((anchor, index) => ({
            rank: index + 1,
            anchor
          }));
          setResults(ranked);
          setSelectedIndex(0);
        })
        .catch(() => {
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, client, repoId]);

  // Build a combined list of builtins + results.
  const items = useMemo(() => {
    const list: Array<
      { kind: 'command'; command: PaletteCommand } | { kind: 'symbol'; result: PaletteSymbolResult }
    > = [];
    for (const cmd of BUILTIN_COMMANDS) list.push({ kind: 'command', command: cmd });
    for (const result of results) list.push({ kind: 'symbol', result });
    return list;
  }, [results]);

  // Clamp selectedIndex.
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, items.length - 1)));
  }, [items.length]);

  const execute = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      if (item.kind === 'command') {
        if (item.command.id === 'toggle-theme') onToggleTheme?.();
        else if (item.command.id === 'back-dashboard') onBackToDashboard?.();
        onClose();
      } else {
        const { anchor } = item.result;
        onSelectSymbol(anchor.symbol, anchor.filePath, anchor.line);
        onClose();
      }
    },
    [items, onClose, onSelectSymbol, onToggleTheme, onBackToDashboard]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(items.length - 1, prev + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      execute(selectedIndex);
      return;
    }
  };

  if (!open) return null;

  return (
    <div
      data-testid="command-palette-overlay"
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 pt-[15vh]"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        data-testid="command-palette"
        className="mx-4 w-full max-w-xl overflow-hidden rounded-lg border border-line bg-surface shadow-xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="text-xs text-muted">⏎</span>
          <input
            ref={inputRef}
            data-testid="palette-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="搜索符号…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/50"
          />
          {loading && (
            <span className="text-[10px] text-muted animate-pulse">搜索中…</span>
          )}
        </div>
        {items.length > 0 && (
          <div data-testid="palette-results" className="max-h-72 overflow-y-auto py-1">
            {items.map((item, idx) => (
              <button
                key={item.kind === 'command' ? item.command.id : item.result.anchor.symbol}
                type="button"
                data-testid={
                  item.kind === 'command'
                    ? `palette-cmd-${item.command.id}`
                    : `palette-symbol-${item.result.rank}`
                }
                onClick={() => execute(idx)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                  idx === selectedIndex
                    ? 'bg-accent/10 text-accent'
                    : 'text-ink hover:bg-subtle'
                }`}
              >
                {item.kind === 'command' ? (
                  <>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line text-[10px] text-muted">
                      {item.command.shortcut ?? '⌘'}
                    </span>
                    <span className="flex-1">{item.command.label}</span>
                  </>
                ) : (
                  <>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[9px] font-medium text-accent">
                      {item.result.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span
                        data-testid="palette-symbol-name"
                        className="block truncate font-medium"
                      >
                        {item.result.anchor.symbol}
                      </span>
                      <span
                        data-testid="palette-symbol-path"
                        className="block truncate text-[9px] text-muted"
                      >
                        {item.result.anchor.filePath} · L{item.result.anchor.line}
                        <span className="ml-1.5">
                          ↑{item.result.anchor.inDegree} ↓
                          {item.result.anchor.outDegree}
                        </span>
                      </span>
                    </div>
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${
                        item.result.anchor.type === 'CONTROLLER'
                          ? 'bg-accent/10 text-accent'
                          : item.result.anchor.type === 'ENTITY'
                            ? 'bg-success/10 text-success'
                            : 'bg-warning/10 text-warning'
                      }`}
                    >
                      {item.result.anchor.type}
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}
        {query !== '' && !loading && results.length === 0 && (
          <div
            data-testid="palette-empty"
            className="px-3 py-3 text-center text-xs text-muted"
          >
            未找到匹配的符号
          </div>
        )}
        <div className="border-t border-line px-3 py-1 text-[10px] text-muted/60">
          ↑↓ 导航 · Enter 确认 · Esc 关闭
        </div>
      </div>
    </div>
  );
}
