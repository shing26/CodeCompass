import { useEffect, type ReactNode } from 'react';

/**
 * v1.2.x（Round5 实测「仓库不能删除」）— 应用内确认框。
 *
 * 为什么不用 `window.confirm`：删除流程原本把**唯一的反馈通道**押在原生对话框
 * 上，而原生对话框会被宿主吞掉——ZCode 内置浏览器（webview）、部分 kiosk 与自动化
 * 环境里 `confirm` 直接返回 false 且不显示任何东西，于是「点删除」静默失效，
 * 用户只看到「点了没反应」。失败分支的 `window.alert` 同理，错误也一并蒸发。
 *
 * 这不是宿主的问题，是我们把关键交互外包给了宿主可控的 API。应用内对话框不依赖
 * 宿主行为，与已有的 `PrivacyConsentModal` 同一套模式（fixed inset-0 + role=dialog
 * + Esc 可关 + 遮罩点击取消），键盘与屏幕阅读器行为一致。
 */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** 破坏性操作用红色，默认即红色。 */
  onConfirm: () => void;
  onCancel: () => void;
  /** 确认按钮上的等待态（如删除请求在途）。 */
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false
}: ConfirmDialogProps) {
  // Esc 取消：与导入弹窗、隐私确认一致（R4-10 修的正是「纯键盘用户被卡死」）。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      data-testid="confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-[26rem] rounded-lg border border-line bg-surface p-4 shadow-neon"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <div className="mt-2 text-sm text-muted">{body}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-testid="confirm-cancel"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-muted hover:bg-subtle disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="confirm-ok"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white hover:bg-danger/90 disabled:opacity-50"
          >
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
