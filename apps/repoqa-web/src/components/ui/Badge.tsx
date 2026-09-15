import type { ReactNode } from 'react';

/**
 * v0.30 票 04（D6 组件化双件之一）——统一小徽章。
 * 徽章族 9 家 → Badge + CountPill 双件；tone 是唯一配色入口（语义 token 自动
 * 跟主题），mono 承载等宽技术标签族（slice/config/language），outline 承载描边
 * 形态。调用方只给「tone + 文本」，不再手抄 className。
 * testid 经 data-testid 透传——定位符零改动是本战役铁律。
 */
export type BadgeTone = 'success' | 'danger' | 'warning' | 'accent' | 'subtle' | 'callee';

const TONE_CLASS: Record<BadgeTone, string> = {
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  accent: 'bg-accent/10 text-accent',
  subtle: 'bg-subtle text-muted',
  callee: 'bg-callee/10 text-callee'
};

const OUTLINE_CLASS: Record<BadgeTone, string> = {
  success: 'border-success/40',
  danger: 'border-danger/40',
  warning: 'border-warning/40',
  accent: 'border-accent/30',
  subtle: 'border-line',
  callee: 'border-callee/30'
};

interface BadgeProps {
  tone?: BadgeTone;
  mono?: boolean;
  outline?: boolean;
  className?: string;
  title?: string;
  'data-testid'?: string;
  children: ReactNode;
}

export function Badge({
  tone = 'subtle',
  mono = false,
  outline = false,
  className = '',
  title,
  'data-testid': testId,
  children
}: BadgeProps) {
  return (
    <span
      data-testid={testId}
      title={title}
      className={`shrink-0 rounded px-1.5 py-0.5 text-micro font-semibold leading-none ${
        outline ? `border ${OUTLINE_CLASS[tone]}` : ''
      } ${TONE_CLASS[tone]} ${mono ? 'font-mono' : ''} ${className}`}
    >
      {children}
    </span>
  );
}
