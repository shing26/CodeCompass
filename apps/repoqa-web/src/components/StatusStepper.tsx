import type { RepoStatus } from '../types';

const STEPS: Array<{ key: RepoStatus | 'idle'; label: string }> = [
  { key: 'cloning', label: 'Cloning' },
  { key: 'parsing', label: 'Parsing AST' },
  { key: 'ready', label: 'Graph Ready' }
];

/**
 * Index status stepper (spec: Cloning → Parsing AST → Graph Ready).
 * Terminal/error states are shown as distinct blocks; never fake readiness.
 */
export function StatusStepper({ status }: { status: RepoStatus }) {
  if (status === 'error') {
    return (
      <span
        data-testid="status"
        className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200"
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Error
      </span>
    );
  }

  const activeIdx = STEPS.findIndex((s) => s.key === status);
  return (
    <ol data-testid="status" className="flex items-center gap-1 text-xs" aria-label="index status">
      {STEPS.map((step, idx) => {
        const done = idx <= activeIdx;
        const active = idx === activeIdx;
        return (
          <li key={step.key} className="flex items-center gap-1">
            {idx > 0 && <span aria-hidden className="text-slate-300">—</span>}
            <span
              className={`rounded-full px-2 py-0.5 ${
                active
                  ? 'bg-accent-soft font-semibold text-accent ring-1 ring-accent'
                  : done
                    ? 'font-medium text-emerald-700'
                    : 'text-slate-400'
              }`}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}