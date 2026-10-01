import type { RepoDashboard, ConfigTopologyItem, TopApiEntry } from '../types';
import { Badge } from './ui/Badge';
import { ScaleBlock } from './overview/ScaleBlock';
import { TopApiBlock } from './overview/TopApiBlock';
import { HighlightChips } from './overview/HighlightChips';

interface DashboardViewProps {
  repoName: string | null;
  dashboard: RepoDashboard | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Trigger a call-chain trace from a clicked Top API entry. */
  onTrace: (api: TopApiEntry) => void;
  /** code:// navigation to the Inspector (tech stack chips / config keys). */
  onNavigate: (file: string, line: number) => void;
  /** 查调用链（页头按钮）：跳拓扑并聚焦首条 Top API；无候选时仅切视图。
   * v1.2 票 04④（V27-5）— 修前是 onOpenChat「只跳视图不聚焦」，名实不符。 */
  onTraceTop: () => void;
}

/**
 * Zero-prompt onboarding dashboard (issue 12/13): a single screen of tech stack
 * badges, architecture scale, config topology (no values) and top call-chain
 * API entries. Clicking a Top API immediately starts a call-chain trace; every
 * source-backed chip navigates the Monaco Inspector.
 */
export function DashboardView({
  repoName,
  dashboard,
  loading,
  error,
  onRetry,
  onTrace,
  onNavigate,
  onTraceTop
}: DashboardViewProps) {
  if (loading && !dashboard) {
    return (
      <div data-testid="dashboard-loading" className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted">仪表盘加载中…</p>
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div data-testid="dashboard-error" className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="text-sm text-danger">{error}</p>
          <button
            type="button"
            data-testid="dashboard-retry"
            onClick={onRetry}
            className="mt-3 rounded-md border border-danger/40 bg-surface px-3 py-1 text-sm text-danger hover:bg-danger/10"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div data-testid="dashboard-empty" className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted">暂无看板数据。</p>
      </div>
    );
  }

  return (
    <div data-testid="dashboard" className="workbench-grid custom-scroll flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">
              {repoName ?? dashboard.repoName ?? 'Dashboard'}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              技术栈、架构规模与核心 API 概览（零 Prompt 驾驶舱）
            </p>
            {dashboard.techStack.highlights.length > 0 && (
              <HighlightChips highlights={dashboard.techStack.highlights} />
            )}
          </div>
          <button
            type="button"
            data-testid="open-trace-top"
            onClick={onTraceTop}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            查调用链
          </button>
        </header>

        {/* ——— Tech stack ——— */}
        <section className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            技术栈
          </h3>
          <div data-testid="tech-stack" className="space-y-3">
            {dashboard.techStack.summary.length === 0 ? (
              <p data-testid="tech-stack-empty" className="text-xs text-muted">
                未检测到构建元数据，仅展示源码分析结果
              </p>
            ) : (
              dashboard.techStack.summary.map((group) => (
                <div key={group.category} data-testid="tech-category">
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
                    <span>{group.label}</span>
                    <Badge>{group.count}</Badge>
                  </div>
                  {group.items.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {group.items.map((item, idx) => (
                        <button
                          type="button"
                          key={`${item.name}-${idx}`}
                          data-testid="tech-chip"
                          onClick={() => onNavigate(item.filePath, item.lineStart ?? 1)}
                          className="rounded border border-line bg-subtle px-2 py-0.5 text-xs text-ink hover:border-accent/40 hover:text-accent"
                          title={item.filePath}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* ——— Architecture scale ——— */}
        <section className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            结构规模
          </h3>
          <ScaleBlock scale={dashboard.scale} />
        </section>

        {/* ——— Config topology ——— */}
        <section className="rounded-md border border-line bg-surface p-3">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              配置拓扑
            </h3>
            {dashboard.config.maskedValues && (
              <Badge tone="warning">值已脱敏</Badge>
            )}
          </div>
          {dashboard.config.topology.length === 0 ? (
            <p className="text-xs text-muted">—</p>
          ) : (
            <ul data-testid="config-topology" className="mt-1 space-y-1">
              {dashboard.config.topology.map((item: ConfigTopologyItem, idx: number) => (
                <li key={`${item.key}-${idx}`}>
                  <button
                    type="button"
                    data-testid="config-item"
                    onClick={() => onNavigate(item.filePath, item.lineStart ?? 1)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-ink hover:bg-subtle"
                    title={item.filePath}
                  >
                    <Badge mono>{item.group}</Badge>
                    <span className="truncate font-mono">{item.key}</span>
                    {item.sensitive && (
                      <Badge tone="danger" className="ml-auto">敏感</Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ——— Top core APIs ——— */}
        <section className="rounded-md border border-line bg-surface p-3">
          <TopApiBlock apis={dashboard.topApis} onTrace={onTrace} />
        </section>
      </div>
    </div>
  );
}
