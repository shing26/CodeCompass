import { Badge } from '../ui/Badge';

/**
 * v1.2 票 08（R4-7）— 框架高亮徽章组（技术栈摘要的最短形态）。
 *
 * 从 `DashboardView` 页头抽出。仪表盘与拓扑概览层都只展示 `techStack.highlights`
 * （规范化框架标签），分类明细仍只属于仪表盘的「技术栈」分区——概览层不复刻。
 */
export function HighlightChips({ highlights }: { highlights: string[] }) {
  if (highlights.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="highlights">
      {highlights.map((h) => (
        <Badge
          key={h}
          data-testid="highlight-badge"
          tone="accent"
          outline
          className="rounded-full px-2 py-0.5 text-xs font-medium"
        >
          {h}
        </Badge>
      ))}
    </div>
  );
}
