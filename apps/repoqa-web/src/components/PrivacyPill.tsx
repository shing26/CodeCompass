import type { LlmRuntimeMode } from '../types';

interface PrivacyPillProps {
  mode: LlmRuntimeMode;
  host?: string;
}

const LABELS: Record<LlmRuntimeMode, string> = {
  none: '纯本地确定性',
  local: '本地模型',
  remote: '远程模型'
};

const DOT_CLASSES: Record<LlmRuntimeMode, string> = {
  none: 'bg-success',
  local: 'bg-warning',
  remote: 'bg-danger'
};

/**
 * Round 3 Bug-03 — the full label only fits at >=1280px; below that the pill
 * collapses to its color dot (the status stays discoverable via the tooltip).
 * Keeps the TopBar's right cluster on one row at 375/768/1024.
 */
export function PrivacyPill({ mode, host }: PrivacyPillProps) {
  return (
    <div
      data-testid="privacy-pill"
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-line bg-subtle px-2 text-xs font-medium text-muted xl:px-2.5"
      title={mode === 'remote' && host ? `LLM host: ${host}` : undefined}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASSES[mode]}`} />
      <span className="hidden xl:inline">
        {LABELS[mode]}
        {mode === 'remote' && host ? ` · ${host}` : ''}
      </span>
    </div>
  );
}
