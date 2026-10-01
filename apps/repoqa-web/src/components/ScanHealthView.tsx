import { useCallback, useEffect, useState } from 'react';
import type { Repo, PrecisionSummary, RepoChunkRow, ScanResult } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';
import { statusLabel } from '../client/statusLabel';
import { Badge } from './ui/Badge';

/**
 * v1.2 票 02 — 体检面数据面（票 01 骨架转正）：五桶候选 + 检索精度态势。
 * 数据来自 `GET /api/repos/:id/scan`（MCP `codecompass_scan` 的 HTTP twin，
 * 引擎只读、服务端按 (repoId, commit) TTL 缓存）与 `GET /api/precision/summary`。
 *
 * 文案红线（v0.21 scan 定位红线 + ADR-0018，组件测试与 copy-guard 双执法）：
 * 候选是确定性事实（「零静态调用者」），不得出现「可安全删除 / 死代码」类语义
 * 判断——那是 chat 侧 agent 的职责；testOnly 只标「仅测试调用」，不扩写结论。
 * 引擎的英文 title/nextAction（面向 agent 的指引）不进 UI，展示层走 statusLabel。
 */

const INDEXING_LABEL: Record<string, string> = {
  indexing: '索引中',
  cloning: '克隆中',
  parsing: '解析中',
  idle: '待机'
};

const BUCKET_REDLINE =
  '以上均为静态图谱直读的确定性事实；「零静态调用者」不代表可删除——是否该动、怎么动，交给「架构问答」里的证据分析。';

export function ScanHealthView({
  repo,
  client,
  onNavigate
}: {
  repo: Repo | null;
  client: RepoQAClient;
  onNavigate: (file: string, line: number) => void;
}) {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [precision, setPrecision] = useState<PrecisionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // v1.2 票 06 — 检索分区：看 chunk 命中原文（检索质量的日常验收台）。
  const [chunkQuery, setChunkQuery] = useState('');
  const [chunkHits, setChunkHits] = useState<RepoChunkRow[] | null>(null);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [chunkError, setChunkError] = useState<string | null>(null);

  const ready = Boolean(repo && repo.status === 'ready');

  useEffect(() => {
    if (!repo || repo.status !== 'ready') {
      setScan(null);
      setPrecision(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      client.getScan(repo.id),
      client.getPrecisionSummary().catch(() => null)
    ])
      .then(([scanResult, precisionResult]) => {
        if (cancelled) return;
        setScan(scanResult);
        setPrecision(precisionResult);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo?.id, repo?.status, client, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // v1.2 票 06 — 检索防抖（250ms，非逐键打屏）：<2 字符不查（服务端 LIKE/FTS
  // 短查询语义都吃 2+）；仓库/索引态变化即清空命中。
  // v1.2 收口（评审 P2）：query 变化立即清旧结果（防抖+请求窗内不得显示上一问
  // 的命中）；失败走独立 error 态，不再伪装成「无命中」。
  useEffect(() => {
    const query = chunkQuery.trim();
    setChunkError(null);
    if (!repo || repo.status !== 'ready' || query.length < 2) {
      setChunkHits(null);
      setChunkLoading(false);
      return;
    }
    setChunkHits(null);
    let cancelled = false;
    const timer = setTimeout(() => {
      setChunkLoading(true);
      client
        .searchChunks(repo.id, query)
        .then((hits) => {
          if (!cancelled && hits) setChunkHits(hits);
        })
        .catch(() => {
          if (!cancelled) setChunkError('检索失败——稍后重试或换个关键词。');
        })
        .finally(() => {
          if (!cancelled) setChunkLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chunkQuery, repo?.id, repo?.status, client]);

  if (!repo) {
    return (
      <section
        data-testid="scan-health"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <p className="text-sm font-medium text-ink">先在上方选择一个仓库，再运行代码体检。</p>
        <p className="max-w-md text-xs text-muted">
          体检会列出零静态调用者候选、枢纽、超大方法/文件等确定性事实，并展示检索精度态势。
        </p>
      </section>
    );
  }

  if (repo.status === 'error') {
    return (
      <section
        data-testid="scan-health"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <p className="text-sm font-medium text-ink">{repo.name} 索引异常，暂无法体检。</p>
        <p className="text-xs text-muted">可在右上角 ⋯ 菜单尝试「重新索引」。</p>
      </section>
    );
  }

  if (!ready) {
    return (
      <section
        data-testid="scan-health"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <p className="text-sm font-medium text-ink">
          {repo.name} {INDEXING_LABEL[repo.status] ?? '处理中'}——索引完成后即可体检。
        </p>
        <p className="text-xs text-muted">体检基于索引完成的符号图谱，扫描过程不需要你操作。</p>
      </section>
    );
  }

  const self = precision?.available ? precision.baseline.samples?.self : undefined;

  return (
    <section data-testid="scan-health" className="workbench-grid flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">{repo.name} · 代码体检</h2>
          <button
            type="button"
            data-testid="scan-refresh"
            onClick={retry}
            disabled={loading}
            className="shrink-0 rounded-md border border-line bg-subtle px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
          >
            重新扫描
          </button>
        </header>

        {loading && (
          <p data-testid="scan-loading" className="text-xs text-muted">
            正在扫描符号图谱…
          </p>
        )}
        {error && (
          <p data-testid="scan-error" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            体检失败：{error}——可点「重新扫描」重试。
          </p>
        )}

        {scan && !loading && (
          <>
            {scan.buckets.map((bucket) => (
              <section
                key={bucket.id}
                data-testid={`scan-bucket-${bucket.id}`}
                className="rounded-md border border-line bg-surface p-3"
              >
                <header className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">
                    {statusLabel(bucket.id)}
                  </h3>
                  <Badge data-testid={`scan-bucket-total-${bucket.id}`}>{bucket.total}</Badge>
                  {bucket.id === 'orphanedPublic' && bucket.wiredExcluded !== undefined && (
                    <span data-testid="scan-wired-excluded" className="text-micro text-muted">
                      另有 {bucket.wiredExcluded} 个零调用符号已按规则排除（外部装配入口，非本桶事实）
                    </span>
                  )}
                </header>
                {bucket.total === 0 ? (
                  <p className="text-xs text-muted">本桶无候选。</p>
                ) : (
                  <ul className="space-y-0.5 font-mono text-xs">
                    {bucket.items.map((item) => (
                      <li
                        key={`${item.filePath}:${item.line}:${item.symbol}`}
                        data-testid="scan-item"
                        // v1.2 收口（评审 P2）— 引擎 detail 是英文判据串（"0 static
                        // callers"/"PageRank 0.43; in 5 / out 3"），不再进正文渲染
                        //（v0.30 用户可见文案中文纪律），挂 title 悬浮可达。
                        title={item.detail}
                        className="flex min-w-0 items-center gap-2"
                      >
                        <button
                          type="button"
                          data-testid="scan-item-node"
                          onClick={() => onNavigate(item.filePath, item.line)}
                          title={`${item.filePath}:${item.line}`}
                          className="min-w-0 truncate text-left text-ink hover:text-accent"
                        >
                          {item.symbol}
                        </button>
                        <span className="hidden shrink-0 text-muted sm:inline">
                          {item.filePath}:{item.line}
                        </span>
                        {item.testOnly && (
                          <Badge data-testid="scan-test-only" tone="warning">
                            仅测试调用
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
            <p data-testid="scan-redline" className="text-micro text-muted">
              {BUCKET_REDLINE}
            </p>
          </>
        )}

        {/* v1.2 票 06 — 检索分区（形态 A）：chunk 命中原文原样查看。文案口径：
            关键词/子串匹配、入库前已脱敏、不看语义相似度（v1.1 票 07 边界表述；
            全组件不出现「语义检索」字样）。 */}
        {scan && !loading && (
          <section data-testid="scan-search" className="rounded-md border border-line bg-surface p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">
              检索命中原样查看
            </h3>
            <input
              data-testid="scan-search-input"
              value={chunkQuery}
              onChange={(e) => setChunkQuery(e.target.value)}
              placeholder="输入关键词，例如：脱敏、分块、reindex"
              className="w-full rounded-md border border-line px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
            />
            <p className="mt-1 text-micro text-muted">
              关键词/子串匹配 chunk 文本（入库前已脱敏）；不看语义相似度。
            </p>
            {chunkLoading && (
              <p data-testid="scan-search-loading" className="mt-2 text-xs text-muted">
                检索中…
              </p>
            )}
            {chunkError && (
              <p data-testid="scan-search-error" className="mt-2 text-xs text-danger">
                {chunkError}
              </p>
            )}
            {chunkHits && chunkHits.length === 0 && !chunkLoading && (
              <p data-testid="scan-search-empty" className="mt-2 text-xs text-muted">
                无命中（换个关键词试试）。
              </p>
            )}
            {chunkHits && chunkHits.length > 0 && (
              <ul data-testid="scan-search-hits" className="mt-2 space-y-1.5">
                {chunkHits.map((hit) => (
                  <li key={hit.id} data-testid="scan-search-hit" className="text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge mono>{statusLabel(hit.chunkType)}</Badge>
                      {hit.filePath && (
                        <button
                          type="button"
                          data-testid="scan-search-hit-node"
                          onClick={() => onNavigate(hit.filePath!, hit.lineStart ?? 1)}
                          title={`${hit.filePath}:${hit.lineStart ?? 1}`}
                          className="min-w-0 truncate font-mono text-xs text-ink hover:text-accent"
                        >
                          {hit.filePath}
                          {hit.lineStart ? `:${hit.lineStart}` : ''}
                        </button>
                      )}
                    </div>
                    <p className="mt-0.5 max-h-24 overflow-hidden whitespace-pre-wrap break-all font-mono text-micro text-muted">
                      {hit.content.slice(0, 300)}
                      {hit.content.length > 300 ? '…' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section data-testid="scan-precision" className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent">检索精度态势</h3>
          {precision?.available ? (
            <>
              <ul className="space-y-1 text-xs text-ink">
                <li data-testid="precision-ratio">
                  自仓孤儿/符号比{' '}
                  {self?.ratio !== undefined ? `${(self.ratio * 100).toFixed(1)}%` : '—'}
                  {self?.orphanTotal !== undefined && self?.symbolCount !== undefined
                    ? `（${self.orphanTotal} / ${self.symbolCount}）`
                    : ''}
                </li>
                <li data-testid="precision-meta" className="text-muted">
                  指标方向{' '}
                  {precision.baseline.metric_direction === 'inverse'
                    ? '反向——孤儿比上升可能是改进被看见，以假边条数读进度'
                    : (precision.baseline.metric_direction ?? '—')}
                  {' · '}抽样 {precision.baseline.sampling ?? '—'}（top-N，不外推为全仓率）
                </li>
                <li data-testid="precision-commit" className="text-muted">
                  基线取样 {self?.commit ?? '—'}
                  {self?.recordedAt ? `（${self.recordedAt.slice(0, 10)}）` : ''}
                </li>
              </ul>
              <p className="mt-2 text-micro text-muted">
                真仓 top-10 假阳性数字以 <span className="font-mono">docs/reports/</span> 的复测报告为准；
                CI 无 clone，此区是只读摘要，不替代发版前人工复测。
              </p>
            </>
          ) : (
            <p data-testid="precision-unavailable" className="text-xs text-muted">
              {precision?.reason ?? '精度摘要不可用（仅在仓库内运行时可用）。'}
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
