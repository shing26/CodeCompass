import type { Anchor } from '../types';

interface SourceTraceDrawerProps {
  anchors: Anchor[];
  onNavigate?: (file: string, line: number) => void;
}

/**
 * Source Trace drawer: one code card per anchor (spec FR-3). Each card shows
 * file:line + symbol; clicking routes a `code://` deep link via onNavigate
 * (consumed by the Inspector in ticket 05).
 */
export function SourceTraceDrawer({ anchors, onNavigate }: SourceTraceDrawerProps) {
  if (anchors.length === 0) return null;
  return (
    <section data-testid="source-trace-drawer" className="mt-3 border-t border-line pt-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Source trace
      </h3>
      <ul className="space-y-2">
        {anchors.map((anchor, idx) => (
          <li key={`${anchor.file}:${anchor.line}:${idx}`}>
            <button
              type="button"
              data-testid={`anchor-card-${idx}`}
              onClick={() => onNavigate?.(anchor.file, anchor.line)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-accent/40"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-xs text-ink">{anchor.file}</span>
                <span className="shrink-0 font-mono text-xs text-muted">L{anchor.line}</span>
              </div>
              {anchor.symbol && (
                <div className="truncate text-xs font-medium text-accent">{anchor.symbol}</div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
