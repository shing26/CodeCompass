import type { RepoDashboard, ConfigTopologyItem, TopApiEntry } from '../types';

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
  /** Switch to the Q&A chat view. */
  onOpenChat: () => void;
}

const SCALE_ORDER: Array<{ key: keyof RepoDashboard['scale']; label: string }> = [
  { key: 'routes', label: 'Routes' },
  { key: 'services', label: 'Services' },
  { key: 'repositories', label: 'Repositories' },
  { key: 'advices', label: 'Advices' },
  { key: 'plainClasses', label: 'Plain Classes' },
  { key: 'interfaces', label: 'Interfaces' },
  { key: 'methods', label: 'Methods' },
  { key: 'fields', label: 'Fields' },
  { key: 'configKeys', label: 'Config keys' },
  { key: 'files', label: 'Files' }
];

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
  onOpenChat
}: DashboardViewProps) {
  if (loading && !dashboard) {
    return (
      <div data-testid="dashboard-loading" className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted">Loading dashboard…</p>
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
              <div className="mt-2 flex flex-wrap gap-1.5" data-testid="highlights">
                {dashboard.techStack.highlights.map((h) => (
                  <span
                    key={h}
                    data-testid="highlight-badge"
                    className="rounded-full border border-accent/30 bg-accent-soft/50 px-2 py-0.5 text-xs font-medium text-accent"
                  >
                    {h}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            data-testid="open-chat"
            onClick={onOpenChat}
            className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
          >
            提问
          </button>
        </header>

        {/* ——— Tech stack ——— */}
        <section className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Tech Stack
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
                    <span className="rounded bg-subtle px-1.5 text-muted">{group.count}</span>
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
            Architecture Scale
          </h3>
          <div data-testid="scale" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {SCALE_ORDER.map(({ key, label }) => (
              <div
                key={key}
                data-testid={`scale-${key}`}
                className="rounded-md border border-line bg-subtle px-2 py-1.5 text-center"
              >
                <div className="text-lg font-semibold text-ink">{dashboard.scale[key]}</div>
                <div className="text-[11px] text-muted">{label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ——— Config topology ——— */}
        <section className="rounded-md border border-line bg-surface p-3">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Config Topology
            </h3>
            {dashboard.config.maskedValues && (
              <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
                值已脱敏
              </span>
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
                    <span className="rounded bg-subtle px-1.5 font-mono text-[10px] text-muted">
                      {item.group}
                    </span>
                    <span className="truncate font-mono">{item.key}</span>
                    {item.sensitive && (
                      <span className="ml-auto shrink-0 rounded bg-danger/10 px-1.5 text-[10px] text-danger">
                        sensitive
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ——— Top core APIs ——— */}
        <section className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Top Core API 入口 · 点击追踪调用链
          </h3>
          {dashboard.topApis.length === 0 ? (
            <p className="text-xs text-muted">—</p>
          ) : (
            <ul data-testid="top-apis" className="space-y-1.5">
              {dashboard.topApis.map((api: TopApiEntry, idx: number) => (
                <li key={`${api.name}-${idx}`}>
                  <button
                    type="button"
                    data-testid="api-entry"
                    onClick={() => onTrace(api)}
                    className="w-full rounded-md border border-line px-2.5 py-2 text-left hover:border-accent/40 hover:bg-accent-soft/20"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-sm font-medium text-ink">
                        {api.name}
                      </span>
                      <span className="shrink-0 rounded bg-subtle px-1.5 text-[10px] text-muted">
                        {api.controller}
                      </span>
                      <span className="ml-auto shrink-0 rounded bg-accent-soft px-1.5 text-[10px] font-medium text-accent">
                        depth {api.depth}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted">
                      {api.hops.join(' → ')}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
