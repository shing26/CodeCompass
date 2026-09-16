import type { EvidenceItem, EvidenceStatus } from '../types';
import { statusLabel } from '../client/statusLabel';
import { Badge, type BadgeTone } from './ui/Badge';

interface EvidenceCardProps {
  evidence: EvidenceItem[];
  /** Issue 23 — navigate an assertion into the Inspector source slice. */
  onNavigate?: (file: string, line: number, lineEnd?: number, symbolName?: string) => void;
}

// v0.30 票 04：徽章形态收进 Badge，契约值（EvidenceStatus）不动、展示过 statusLabel。
const STATUS_TONE: Record<EvidenceStatus, BadgeTone> = {
  VERIFIED: 'success',
  BREAK: 'danger',
  SUSPECT: 'warning'
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
      <div className="mb-1 text-micro font-semibold uppercase tracking-wide text-muted">
        证据 · 逐字可查
      </div>
      <ul className="flex flex-col gap-1">
        {evidence.map((row, index) => {
          const navigable = isNavigable(row);
          const body = (
            <>
              <Badge
                data-testid={`evidence-status-${index}`}
                tone={STATUS_TONE[row.status]}
                outline
              >
                {statusLabel(row.status)}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-xs text-ink" title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 font-mono text-micro text-muted">{row.location}</span>
              {row.commit && (
                <span
                  data-testid={`evidence-commit-${index}`}
                  className="shrink-0 rounded bg-surface px-1 py-0.5 font-mono text-micro text-muted"
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
