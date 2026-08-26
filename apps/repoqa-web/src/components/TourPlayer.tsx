import { useEffect, useRef, useState } from 'react';
import type { RepoTour } from '../types';
import { MermaidDiagram } from './MermaidDiagram';

interface TourPlayerProps {
  tour: RepoTour;
  /** Open a step's source location in the Monaco Inspector. */
  onNavigate: (file: string, line: number) => void;
  /** Leave the tour player (back to dashboard). */
  onBack: () => void;
}

/**
 * Guided step-by-step tour player (issue 11/13). Renders the tour's ordered
 * steps with a progress bar and the mermaid sequence diagram; each step (and
 * every code:// bound diagram node) positions the Monaco Inspector. The first
 * step opens automatically when a new tour starts.
 */
export function TourPlayer({ tour, onNavigate, onBack }: TourPlayerProps) {
  const [active, setActive] = useState(0);
  // Keep the latest navigator in a ref: inspector.openFile's identity changes
  // whenever the nav stack index changes, and including it in the effect deps
  // would re-open the first step forever (open → new identity → effect rerun).
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;

  // Reset and open the first step whenever a new tour is played.
  useEffect(() => {
    setActive(0);
    const first = tour.steps[0];
    if (first) navigateRef.current(first.filePath, first.lineNumber);
  }, [tour.id, tour.steps]);

  const stepCount = tour.steps.length;
  const activeStep = tour.steps[Math.min(active, Math.max(stepCount - 1, 0))];

  // A tour with no locatable steps is a dead end; never render a "Step 1 / 0"
  // player, just offer a way back to the dashboard.
  if (stepCount === 0) {
    return (
      <div data-testid="tour-player" className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
          <p data-testid="tour-empty" className="text-sm text-muted">
            该 Tour 没有可定位的源码步骤。
          </p>
          <button
            type="button"
            data-testid="tour-back"
            onClick={onBack}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:border-accent/40 hover:text-accent"
          >
            ← 返回看板
          </button>
        </div>
      </div>
    );
  }

  const go = (index: number) => {
    const next = Math.min(Math.max(index, 0), Math.max(stepCount - 1, 0));
    setActive(next);
    const step = tour.steps[next];
    if (step) onNavigate(step.filePath, step.lineNumber);
  };

  return (
    <div data-testid="tour-player" className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-line bg-surface px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              data-testid="tour-back"
              onClick={onBack}
              className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:border-accent/40 hover:text-accent"
            >
              ← 返回看板
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-ink">{tour.title}</h2>
              <p className="truncate text-xs text-muted">{tour.description}</p>
            </div>
          </div>
          <span data-testid="tour-progress" className="shrink-0 text-xs text-muted">
            Step {active + 1} / {stepCount}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
          <div
            data-testid="tour-progress-bar"
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${stepCount > 0 ? ((active + 1) / stepCount) * 100 : 0}%` }}
          />
        </div>
        {activeStep?.note && (
          <p data-testid="tour-step-note" className="mt-1.5 text-xs text-warning">
            {activeStep.note}
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-72 shrink-0 overflow-y-auto border-r border-line bg-subtle p-2">
          <ul className="space-y-1">
            {tour.steps.map((step, idx) => {
              const isActive = idx === active;
              return (
                <li key={`${step.symbol}-${idx}`}>
                  <button
                    type="button"
                    data-testid="tour-step"
                    onClick={() => go(idx)}
                    className={`w-full rounded-md border px-2.5 py-2 text-left text-xs ${
                      isActive
                        ? 'border-accent/40 bg-accent-soft/40 text-ink'
                        : 'border-transparent text-muted hover:bg-surface hover:border-line'
                    }`}
                  >
                    <span
                      className={`mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium ${
                        isActive ? 'bg-accent text-white' : 'bg-subtle text-muted'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    {step.step}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-3">
          <MermaidDiagram code={tour.mermaid} onNavigate={onNavigate} />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line bg-surface px-4 py-2">
        <button
          type="button"
          data-testid="tour-prev"
          onClick={() => go(active - 1)}
          disabled={active <= 0}
          className="h-8 rounded-md border border-line px-3 text-sm text-muted hover:border-accent/40 hover:text-accent disabled:opacity-40"
        >
          ← 上一步
        </button>
        {active >= stepCount - 1 ? (
          <button
            type="button"
            data-testid="tour-done"
            onClick={onBack}
            className="h-8 rounded-md bg-success px-3 text-sm font-medium text-white hover:bg-success/90"
          >
            完成
          </button>
        ) : (
          <button
            type="button"
            data-testid="tour-next"
            onClick={() => go(active + 1)}
            className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90"
          >
            下一步 →
          </button>
        )}
      </div>
    </div>
  );
}
