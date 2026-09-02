import type { EvidenceItem, EvidenceStatus } from '../types';

interface EvidenceCardProps {
  evidence: EvidenceItem[];
  /** Issue 23 — navigate an assertion into the Inspector source slice. */
  onNavigate?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
}

const STATUS_BADGE: Record<EvidenceStatus, { label: string; className: string }> = {
  VERIFIED: {
    label: 'VERIFIED',
    className: 'border-success/40 bg-success/10 text-success'
  },
  BREAK: {
    label: 'BREAK',
    className: 'border-danger/40 bg-danger/10 text-danger'
  },
  SUSPECT: {
    label: 'SUSPECT',
    className: 'border-warning/40 bg-warning/10 text-warning'
  }
};

/** A file:line row is navigable only when it is physically resolvable. */
function isNavigable(row: EvidenceItem): boolean {
  return row.status !== 'BREAK' && row.file.length > 0 && row.line > 0;
}

/**
 * Issue 23 — grounded-assertion card: every row is one assertion from the
 * incident answer with its Zero-Hallucination badge (VERIFIED = raw-file
 * validated, BREAK = no physical counterpart, SUSPECT = dead-end hop) plus
 * the physical file:line and the commit short-hash chip (ADR-0010 quad).
 * BREAK rows are deliberately not clickable: there is no source to open.
 */
export function EvidenceCard({ evidence, onNavigate }: EvidenceCardProps) {
  if (!evidence.length) return null;
  return (
    <div
      data-testid="evidence-card"
      className="mt-2 rounded-md border border-line bg-subtle p-2"
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        证据 · 零幻觉锚定
      </div>
      <ul className="flex flex-col gap-1">
        {evidence.map((row, index) => {
          const badge = STATUS_BADGE[row.status];
          const navigable = isNavigable(row);
          const body = (
            <>
              <span
                data-testid={`evidence-status-${index}`}
                className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold leading-none ${badge.className}`}
              >
                {badge.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-ink" title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted">{row.location}</span>
              {row.commit && (
                <span
                  data-testid={`evidence-commit-${index}`}
                  className="shrink-0 rounded bg-surface px-1 py-0.5 font-mono text-[9px] text-muted"
                  title={`commit ${row.commit}`}
                >
                  {row.commit.slice(0, 7)}
                </span>
              )}
            </>
          );
          return (
            <li key={`${row.status}-${row.label}-${row.location}-${index}`}>
              {navigable && onNavigate ? (
                <button
                  type="button"
                  data-testid={`evidence-row-${index}`}
                  onClick={() =>
                    onNavigate(row.file, row.line, undefined, row.status === 'VERIFIED' ? row.label : undefined)
                  }
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-surface"
                >
                  {body}
                </button>
              ) : (
                <div
                  data-testid={`evidence-row-${index}`}
                  className="flex items-center gap-2 px-1 py-0.5"
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
