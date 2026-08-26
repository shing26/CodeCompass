import { useState } from 'react';
import type { RepoTour } from '../types';

interface QuickToursProps {
  tours: RepoTour[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Start playing a guided tour (switches the main view to the tour player). */
  onPlay: (tour: RepoTour) => void;
}

/**
 * Quick Tours (issue 11/13): list of backend generated onboarding tours.
 * The first tour is the prominent recommended card; the rest collapse under
 * "More Tours" (review decision: no three-card row). Clicking a tour starts
 * the step-by-step tour player in the main view.
 */
export function QuickTours({ tours, loading, error, onRetry, onPlay }: QuickToursProps) {
  const [expanded, setExpanded] = useState(false);

  if (loading && tours.length === 0) {
    return <p className="text-xs text-muted">Loading tours…</p>;
  }

  if (error && tours.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-danger">Tours 加载失败</span>
        <button
          type="button"
          data-testid="tours-retry"
          onClick={onRetry}
          className="rounded border border-danger/40 bg-surface px-1.5 py-0.5 text-[11px] text-danger hover:bg-danger/10"
        >
          重试
        </button>
      </div>
    );
  }

  if (tours.length === 0) {
    return <p className="text-xs text-muted">No tours available.</p>;
  }

  const [recommended, ...rest] = tours;

  return (
    <div>
      <button
        type="button"
        data-testid={`tour-${recommended.id}`}
        onClick={() => onPlay(recommended)}
        className="mb-1 flex w-full items-center justify-between gap-2 rounded-md border border-accent/30 bg-accent-soft/50 px-2.5 py-2 text-left text-xs font-medium text-accent hover:bg-accent-soft"
      >
        <span>{recommended.title}</span>
        <span aria-hidden className="text-accent">→</span>
      </button>
      {recommended.description && (
        <p className="mb-1 px-1 text-[11px] leading-snug text-muted">
          {recommended.description}
        </p>
      )}

      {rest.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            data-testid="more-tours-toggle"
            onClick={() => setExpanded((v) => !v)}
            className="w-full px-2.5 py-1 text-left text-xs text-muted hover:text-ink"
          >
            {expanded ? 'Hide More Tours' : `More Tours (${rest.length})`}
          </button>
          {expanded && (
            <ul className="mt-1 space-y-1">
              {rest.map((tour) => (
                <li key={tour.id}>
                  <button
                    type="button"
                    data-testid={`tour-${tour.id}`}
                    onClick={() => onPlay(tour)}
                    className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-left text-xs text-muted hover:border-accent/40 hover:text-accent"
                  >
                    {tour.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
