interface PrivacyConsentModalProps {
  host?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PrivacyConsentModal({ host, onConfirm, onCancel }: PrivacyConsentModalProps) {
  return (
    <div
      data-testid="consent-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40"
      role="dialog"
      aria-modal="true"
      aria-label="远程模型隐私确认"
      onClick={onCancel}
    >
      <div
        className="w-[24rem] rounded-lg border border-line bg-surface p-4 shadow-neon"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink">远程模型隐私确认</h2>
        <p className="mt-2 text-sm text-muted">
          本次分析将向 <span className="font-medium text-ink">{host ?? '远程服务'}</span>{' '}
          发送脱敏后的关联代码切片。
        </p>
        <p className="mt-1 text-xs text-muted">
          该选择只在当前页面会话内生效，不会写入本地存储。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-testid="consent-cancel"
            onClick={onCancel}
            className="h-8 rounded-md px-3 text-sm text-muted hover:bg-subtle"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="consent-confirm"
            onClick={onConfirm}
            className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent/90"
          >
            允许本次会话
          </button>
        </div>
      </div>
    </div>
  );
}
