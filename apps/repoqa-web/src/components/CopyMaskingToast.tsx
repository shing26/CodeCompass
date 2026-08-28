import { useEffect, useState } from 'react';

export interface CopyMaskingToastProps {
  /** Monotonic trigger timestamp (Date.now()); 0 = never shown. */
  trigger: number;
  /** Auto-dismiss delay in ms. */
  durationMs?: number;
}

/**
 * v0.7 — one-shot masking disclosure: every "copy agent context" success
 * raises `trigger`, and this toast tells the user the payload was masked by
 * design (13-rule credential masking) instead of looking like data loss.
 */
export function CopyMaskingToast({ trigger, durationMs = 2500 }: CopyMaskingToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [trigger, durationMs]);

  if (!visible) return null;
  return (
    <div
      data-testid="copy-masking-toast"
      role="status"
      className="fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-md border border-success/40 bg-surface px-3 py-1.5 text-xs text-success shadow-neon"
    >
      已复制 Agent 上下文（凭据已按 13 规则脱敏，不含真实密钥值）
    </div>
  );
}
