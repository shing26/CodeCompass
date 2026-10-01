import type { RepoDashboard } from '../../types';

/**
 * v1.2 票 08（R4-7）—「结构规模」计数网格。
 *
 * 从 `DashboardView` 原样抽出，供仪表盘与拓扑概览层共用：同一个概念只能有一处
 * 渲染实现，否则两个视图的规模数字迟早漂移（票 09/10 单表派生的同一条纪律）。
 */

export const SCALE_ORDER: Array<{ key: keyof RepoDashboard['scale']; label: string }> = [
  { key: 'routes', label: '接口' },
  { key: 'services', label: '服务' },
  { key: 'repositories', label: '仓储' },
  { key: 'advices', label: '切面' },
  { key: 'plainClasses', label: '普通类' },
  { key: 'interfaces', label: '接口定义' },
  { key: 'methods', label: '方法' },
  { key: 'fields', label: '字段' },
  { key: 'configKeys', label: '配置键' },
  { key: 'files', label: '文件' }
];

export function ScaleBlock({
  scale,
  columns = 'grid-cols-2 gap-2 sm:grid-cols-5'
}: {
  scale: RepoDashboard['scale'];
  /** 概览层用更密的 5 列布局；默认沿用仪表盘原样。 */
  columns?: string;
}) {
  return (
    <div data-testid="scale" className={`grid ${columns}`}>
      {SCALE_ORDER.map(({ key, label }) => (
        <div
          key={key}
          data-testid={`scale-${key}`}
          className="rounded-md border border-line bg-subtle px-2 py-1.5 text-center"
        >
          <div className="text-lg font-semibold text-ink">{scale[key]}</div>
          <div className="text-xs text-muted">{label}</div>
        </div>
      ))}
    </div>
  );
}
