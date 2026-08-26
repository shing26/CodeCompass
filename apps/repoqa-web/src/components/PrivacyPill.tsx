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

export function PrivacyPill({ mode, host }: PrivacyPillProps) {
  return (
    <div
      data-testid="privacy-pill"
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-line bg-subtle px-2.5 text-xs font-medium text-muted"
      title={mode === 'remote' && host ? `LLM host: ${host}` : undefined}
    >
      <span className={`h-2 w-2 rounded-full ${DOT_CLASSES[mode]}`} />
      <span>
        {LABELS[mode]}
        {mode === 'remote' && host ? ` · ${host}` : ''}
      </span>
    </div>
  );
}
