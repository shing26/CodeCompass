import type { IndexingPhase, IndexingProgress } from '../types';

const PHASES: Array<{ id: IndexingPhase; label: string }> = [
  { id: 'DISCOVERY', label: '发现文件' },
  { id: 'AST_EXTRACTION', label: 'AST 提取' },
  { id: 'CROSS_LANG_BRIDGE', label: '跨语言桥接' },
  { id: 'FINALIZING', label: '拓扑收敛' }
];

function phaseState(phase: IndexingPhase, current: IndexingPhase): 'done' | 'active' | 'pending' {
  const currentIndex = PHASES.findIndex((entry) => entry.id === current);
  const index = PHASES.findIndex((entry) => entry.id === phase);
  if (index < currentIndex) return 'done';
  if (index === currentIndex) return 'active';
  return 'pending';
}

/** v0.6.0 — compact four-stage indexing stepper shown while a repo is indexing. */
export function StatusStepper({ progress }: { progress: IndexingProgress | null }) {
  if (!progress) return null;
  const percent = Math.max(0, Math.min(100, progress.percent ?? 0));
  return (
    <div
      data-testid="status-stepper"
      className="flex h-9 shrink-0 items-center gap-3 border-b border-subtle bg-surface px-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {PHASES.map((phase) => {
          const state = phaseState(phase.id, progress.phase);
          return (
            <div
              key={phase.id}
              data-testid={`status-step-${phase.id}`}
              className={`flex min-w-0 items-center gap-1.5 text-[11px] font-medium ${
                state === 'active'
                  ? 'text-accent'
                  : state === 'done'
                    ? 'text-success'
                    : 'text-muted'
              }`}
            >
              <span
                className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] ${
                  state === 'active'
                    ? 'border-accent bg-accent/10'
                    : state === 'done'
                      ? 'border-success bg-success/10'
                      : 'border-line bg-subtle'
                }`}
              >
                {state === 'done' ? '✓' : PHASES.findIndex((entry) => entry.id === phase.id) + 1}
              </span>
              <span className="hidden truncate sm:inline">{phase.label}</span>
            </div>
          );
        })}
      </div>
      <div
        data-testid="status-progress"
        role="progressbar"
        aria-label="Indexing progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-subtle"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-150"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[10px] text-muted">{percent}%</span>
      {progress.currentFile && (
        <span
          data-testid="status-current-file"
          className="hidden max-w-[220px] truncate font-mono text-[10px] text-muted xl:inline"
        >
          {progress.currentFile}
        </span>
      )}
    </div>
  );
}
