import { useCallback, useEffect, useState } from 'react';
import type { RepoQAClient } from '../client/RepoQAClient';
import type { McpAuditSummary } from '../types';

/**
 * 票 04 — Agent 活动视图（ADR-0021 维护者驾驶舱，非产品面）。
 *
 * 数据全部来自服务端已落盘的 MCP 审计日志（`/api/audit/mcp/summary`），
 * 本视图零新增采集。三个读数：per-tool 用量与延迟分布、最近失败样本、
 * 最近调用流——回答的是「agent 到底怎么用我的引擎、哪类调用在失败、
 * 哪些工具没人用」，直接驱动工具描述与编排 prompt 的调优。
 */

function fmtRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtTs(ts: string): string {
  if (!ts) return '—';
  return ts.replace('T', ' ').replace('Z', '').slice(0, 19);
}

export function AgentActivityView({ client }: { client: RepoQAClient }) {
  const [summary, setSummary] = useState<McpAuditSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await client.fetchAuditSummary());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-6" data-testid="agent-activity-view">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink">Agent 活动</h2>
          <p className="mt-1 text-xs text-muted">
            MCP 工具调用的服务端审计读数——只读聚合，判断留给维护者。
            {summary?.window.sinceTs ? `窗口起点 ${fmtTs(summary.window.sinceTs)}（近 3 个日志文件）。` : ''}
          </p>
        </div>
        <button
          type="button"
          data-testid="audit-refresh"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-md border border-line bg-surface px-3 py-1 text-xs text-muted hover:border-accent/40 hover:text-accent disabled:opacity-50"
        >
          刷新
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-surface px-4 py-3 text-sm text-danger" data-testid="audit-error">
          {error}
        </div>
      )}

      {loading && !summary && (
        <div className="rounded-md border border-line bg-surface px-4 py-6 text-sm text-muted" data-testid="audit-loading">
          读取 MCP 审计日志…
        </div>
      )}

      {summary && !summary.logsPresent && (
        <div className="rounded-md border border-line bg-surface px-4 py-6 text-sm text-muted" data-testid="audit-empty">
          该数据目录还没有控制面日志。用 <code className="text-ink">codecompass mcp &lt;repo&gt;</code> 跑一次
          agent 会话后再回来看。
        </div>
      )}

      {summary && summary.logsPresent && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="audit-totals">
            <div className="rounded-md border border-line bg-surface px-4 py-3">
              <div className="text-xs text-muted">总调用</div>
              <div className="text-xl font-semibold text-ink">{summary.totals.calls}</div>
            </div>
            <div className="rounded-md border border-line bg-surface px-4 py-3">
              <div className="text-xs text-muted">成功率</div>
              <div className="text-xl font-semibold text-ink">{fmtRate(summary.totals.okRate)}</div>
            </div>
            <div className="rounded-md border border-line bg-surface px-4 py-3">
              <div className="text-xs text-muted">失败</div>
              <div className="text-xl font-semibold text-ink">{summary.totals.failed}</div>
            </div>
            <div className="rounded-md border border-line bg-surface px-4 py-3">
              <div className="text-xs text-muted">工具数</div>
              <div className="text-xl font-semibold text-ink">{summary.byTool.length}</div>
            </div>
          </div>

          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <table className="w-full text-left text-xs" data-testid="audit-bytool">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">工具</th>
                  <th className="px-4 py-2 font-medium">调用</th>
                  <th className="px-4 py-2 font-medium">成功率</th>
                  <th className="px-4 py-2 font-medium">p50</th>
                  <th className="px-4 py-2 font-medium">p95</th>
                </tr>
              </thead>
              <tbody>
                {summary.byTool.map((tool) => (
                  <tr key={tool.tool} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2 font-mono text-ink">{tool.tool}</td>
                    <td className="px-4 py-2 text-muted">{tool.calls}</td>
                    <td className={tool.failed > 0 ? 'px-4 py-2 text-warning' : 'px-4 py-2 text-muted'}>
                      {fmtRate(tool.okRate)}
                    </td>
                    <td className="px-4 py-2 text-muted">{tool.p50Ms}ms</td>
                    <td className="px-4 py-2 text-muted">{tool.p95Ms}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {summary.recentFailures.length > 0 && (
            <div className="rounded-md border border-line bg-surface">
              <div className="border-b border-line px-4 py-2 text-xs font-medium text-muted">
                最近失败（服务端已脱敏）
              </div>
              <ul className="divide-y divide-line/60" data-testid="audit-failures">
                {summary.recentFailures.map((failure, index) => (
                  <li key={`${failure.ts}-${index}`} className="px-4 py-2 text-xs">
                    <span className="text-muted">{fmtTs(failure.ts)}</span>{' '}
                    <span className="font-mono text-ink">{failure.tool}</span>
                    {failure.repoId ? <span className="text-muted"> · {failure.repoId}</span> : null}
                    <div className="mt-0.5 text-danger">{failure.error}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <div className="border-b border-line px-4 py-2 text-xs font-medium text-muted">最近调用流</div>
            <table className="w-full text-left text-xs" data-testid="audit-recent">
              <tbody>
                {summary.recentCalls.map((call, index) => (
                  <tr key={`${call.ts}-${index}`} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-1.5 text-muted">{fmtTs(call.ts)}</td>
                    <td className="px-4 py-1.5 font-mono text-ink">{call.tool}</td>
                    <td className={`px-4 py-1.5 ${call.ok ? 'text-success' : 'text-danger'}`}>
                      {call.ok ? 'ok' : 'fail'}
                    </td>
                    <td className="px-4 py-1.5 text-right text-muted">{call.durationMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
