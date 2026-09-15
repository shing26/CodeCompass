import type { ReactNode } from 'react';

/**
 * v0.30 票 04（D6 组件化双件之二）——计数丸。
 * 「↑ API 3」「3 受影响」「rank」这类数字胶囊统一收口于此；
 * fill=accent 实心（默认），outline=描边（拓扑图的 API/SQL 计数）。
 */
interface CountPillProps {
  variant?: 'fill' | 'outline';
  className?: string;
  title?: string;
  'data-testid'?: string;
  children: ReactNode;
}

export function CountPill({
  variant = 'fill',
  className = '',
  title,
  'data-testid': testId,
  children
}: CountPillProps) {
  return (
    <span
      data-testid={testId}
      title={title}
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-full px-1.5 py-0.5 text-micro font-medium leading-none ${
        variant === 'fill' ? 'bg-accent/10 text-accent' : 'border border-line font-mono text-muted'
      } ${className}`}
    >
      {children}
    </span>
  );
}
