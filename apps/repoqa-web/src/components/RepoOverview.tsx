import { useEffect, useState } from 'react';
import type { Repo, RepoDashboard, TopApiEntry, DomainRadarResult } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';
import { statusLabel } from '../client/statusLabel';
import { Badge } from './ui/Badge';
import { ScaleBlock } from './overview/ScaleBlock';
import { TopApiBlock } from './overview/TopApiBlock';
import { HighlightChips } from './overview/HighlightChips';

/**
 * v1.2 票 08（R4-7）— 拓扑概览层：这仓库结构是什么。
 *
 * 病根不是「缺数据」——`/dashboard` 与 `/radar` 一直都在，缺的是**一级导航里
 * 有一个首屏不回答这个问题的视图**：代码拓扑的内容 100% 派生自最后一条问答的
 * 调用链，进入时自动落一条与用户无关的「首条 Top API 示例链路」。本层把
 * 「零点击就能看到的结构事实」放到画布顶部，链路降为下半部分的下钻结果。
 *
 * 双源、零新增端点（ADR-0020 的 Web 面只增不改 MCP 面的边界）：
 *   - `/dashboard` 由 App 的 `useDashboard` 全局加载，本组件只收 props，不重复请求；
 *     规模网格与入口列表与仪表盘**共用** `ScaleBlock` / `TopApiBlock` 实现。
 *   - `/radar` 空 query 即可运行（服务端按 (repoId, query) 60s 缓存），给出枢纽
 *     符号（度 + PageRank）与持久层实体数——枢纽是真正的拓扑量，Top API 不是。
 *
 * 文案红线：枢纽按静态图谱直读，「被调 94 · 调用 71」是事实计数，不写成
 * 「核心业务」「应该先看」这类判断；pagerank 只在 title 里留原始值备查。
 */

const HUB_LIMIT = 5;

export function RepoOverview({
  repo,
  client,
  dashboard,
  dashboardLoading,
  dashboardError,
  onRetryDashboard,
  onTraceApi,
  onTraceSymbol
}: {
  repo: Repo | null;
  client: RepoQAClient;
  dashboard: RepoDashboard | null;
  dashboardLoading: boolean;
  dashboardError: string | null;
  onRetryDashboard: () => void;
  /** Top API 入口 → 确定性 call-chain（与仪表盘同一路径，worker 绕过 LLM）。 */
  onTraceApi: (api: TopApiEntry) => void;
  /** 枢纽符号 → 同一 call-chain，只给名字不给文件。 */
  onTraceSymbol: (symbol: string) => void;
}) {
  const [radar, setRadar] = useState<DomainRadarResult | null>(null);
  const [radarError, setRadarError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const ready = Boolean(repo && repo.status === 'ready');

  useEffect(() => {
    if (!repo || repo.status !== 'ready') {
      setRadar(null);
      setRadarError(null);
      return;
    }
    let cancelled = false;
    setRadarError(null);
    client
      .radar(repo.id, '')
      .then((result) => {
        if (!cancelled) setRadar(result);
      })
      .catch((err) => {
        if (!cancelled) setRadarError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [repo?.id, repo?.status, client, attempt]);

  if (!ready) return null;

  return (
    <section
      data-testid="repo-overview"
      className="mx-auto mb-4 max-w-4xl space-y-3 rounded-md border border-line bg-surface p-3"
    >
      <header>
        <h2 className="text-sm font-semibold text-ink">这仓库是什么</h2>
        <p className="mt-0.5 text-xs text-muted">
          下面全部来自静态代码分析（不调模型、不联网）；点任一入口展开它的确定性调用链。
        </p>
        {dashboard && <HighlightChips highlights={dashboard.techStack.highlights} />}
      </header>

      {dashboardError && !dashboard ? (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-danger">{dashboardError}</p>
          <button
            type="button"
            data-testid="overview-retry"
            onClick={onRetryDashboard}
            className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:border-accent/40 hover:text-accent"
          >
            重试
          </button>
        </div>
      ) : dashboardLoading && !dashboard ? (
        <p className="text-xs text-muted" data-testid="overview-loading">
          结构概览加载中…
        </p>
      ) : dashboard ? (
        <>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              结构规模
            </h3>
            <ScaleBlock scale={dashboard.scale} />
          </div>
          <div>
            <TopApiBlock apis={dashboard.topApis} onTrace={onTraceApi} limit={HUB_LIMIT} />
          </div>
        </>
      ) : null}

      {/* 枢纽来自 radar，与 dashboard 是两个独立请求——任一挂掉都不牵连另一半。 */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {/* v1.2.x（Round5 R5-10）— 口径订正：排序依据是 PageRank（度 + 全图
              随机游走），不是「被调次数」。写「调用密度」与实际排序不符，用户按
              被调数核对会发现非单调。度数只作展示，不作排序依据。 */}
          枢纽符号 · 按静态图谱影响力排序
        </h3>
        {radarError ? (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-muted">
              枢纽数据暂不可用（规模与入口不受影响）。
            </p>
            <button
              type="button"
              data-testid="overview-hub-retry"
              onClick={() => setAttempt((n) => n + 1)}
              className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:border-accent/40 hover:text-accent"
            >
              重试
            </button>
          </div>
        ) : !radar ? (
          <p className="text-xs text-muted">枢纽计算中…</p>
        ) : radar.hubNodes.length === 0 ? (
          <p className="text-xs text-muted">—</p>
        ) : (
          <>
            <ul className="space-y-1" data-testid="hub-nodes">
              {radar.hubNodes.slice(0, HUB_LIMIT).map((hub) => (
                <li key={hub.symbol}>
                  <button
                    type="button"
                    data-testid="hub-entry"
                    onClick={() => onTraceSymbol(hub.symbol)}
                    title={`PageRank ${hub.pagerank.toFixed(4)}`}
                    className="flex w-full items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:border-accent/40 hover:bg-accent-soft/20"
                  >
                    <span className="truncate font-mono text-xs font-medium text-ink">{hub.symbol}</span>
                    <Badge>{statusLabel(hub.role)}</Badge>
                    <span className="ml-auto shrink-0 text-micro text-muted">
                      被调 {hub.inDegree} · 调用 {hub.outDegree}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {radar.persistenceEntities.length > 0 && (
              <p className="mt-1.5 text-micro text-muted" data-testid="persistence-line">
                持久层：{radar.persistenceEntities.length} 个仓储 / 映射 / 模型类
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
