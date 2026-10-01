import type { TopApiEntry } from '../../types';
import { Badge } from '../ui/Badge';

/**
 * v1.2 票 08（R4-7）— Top 核心 API 入口列表（点击发起确定性调用链）。
 *
 * 从 `DashboardView` 抽出，仪表盘传全量、拓扑概览层传 `limit={5}`——同一条
 * 渲染实现与同一份 `onTrace` 语义（worker 绕过 LLM 的 call-chain 模式）。
 */

export function TopApiBlock({
  apis,
  onTrace,
  limit,
  title = 'Top 核心 API 入口 · 点击追踪调用链'
}: {
  apis: TopApiEntry[];
  onTrace: (api: TopApiEntry) => void;
  /** 概览层只展示前 N 条并明示省略条数；不传则全量。 */
  limit?: number;
  title?: string;
}) {
  const shown = typeof limit === 'number' ? apis.slice(0, limit) : apis;
  const hidden = apis.length - shown.length;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {shown.length === 0 ? (
        <p className="text-xs text-muted">—</p>
      ) : (
        <ul data-testid="top-apis" className="space-y-1.5">
          {shown.map((api: TopApiEntry, idx: number) => (
            <li key={`${api.name}-${idx}`}>
              <button
                type="button"
                data-testid="api-entry"
                onClick={() => onTrace(api)}
                className="w-full rounded-md border border-line px-2.5 py-2 text-left hover:border-accent/40 hover:bg-accent-soft/20"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-sm font-medium text-ink">{api.name}</span>
                  <Badge>{api.controller}</Badge>
                  {/* v1.2.x（Round5 红线 ①）— hops 为空 = 静态图谱没记录该入口的出边
                      （Express 内联处理函数体未归属 / 动态分派）。入口本身仍是确定
                      性事实照常列出，但不再编一条链路，也不写「深度 0」。 */}
                  {api.hops.length > 0 ? (
                    <Badge tone="accent" className="ml-auto">
                      深度 {api.depth}
                    </Badge>
                  ) : (
                    <Badge tone="subtle" outline className="ml-auto">
                      无法静态解析
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">
                  {api.hops.length > 0 ? api.hops.join(' → ') : '静态图谱未记录该入口的出边，不做推测'}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className="mt-1.5 text-micro text-muted" data-testid="top-apis-more">
          另有 {hidden} 个入口未展示——完整清单见「⋯ 更多操作 → 架构仪表盘」。
        </p>
      )}
    </div>
  );
}
