import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RepoQAClient } from '../client/RepoQAClient';
import type { GateRunRow, Repo, RepoDashboard } from '../types';
import { ScenarioGuide } from './ScenarioGuide';

interface CiGateViewProps {
  repo: Repo | null;
  dashboard: RepoDashboard | null;
  /** v0.26-B ticket 02 — 三段化的②「运行并记录」与③「门禁运行史」依赖它；
   * 不传 client 时两段隐藏，现状区（含 Issue 31 既有断言）零影响。 */
  client?: Pick<RepoQAClient, 'runGate' | 'listGateRuns'>;
}

/** 运行史每页行数（limit/offset 契约同 /api/events 先例）。 */
const HISTORY_PAGE_SIZE = 20;

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/** Q12：hash+dirty 是独立物理流——dirty 判定只看流标记后缀。 */
function isDirtyRun(run: GateRunRow): boolean {
  return run.commit.endsWith('+dirty');
}

/** 流标记的展示形态：完整 hash 截 7 位；unversioned 原样；+dirty 拆给徽章。 */
function commitLabel(commit: string): string {
  if (commit === 'unversioned') return commit;
  const hash = commit.replace(/\+dirty$/, '');
  return hash.slice(0, 7);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

/**
 * Issue 29 workbench panel: CI gate policy knobs plus the generated
 * `codecompass pr-summary` command. The panel never fabricates a gate verdict;
 * it only composes policy and reflects the current indexed baseline.
 *
 * v0.26-B ticket 02 (ADR-0017) — 视图纵向三段：①现状区（基线+命令复制，保持
 * Issue 29 原样）→ ②「运行并记录」（策略旋钮同时作为 runGate 入参，服务器跑
 * 门禁并落库）→ ③「门禁运行史」（newest-first 分页表；PASS 绿/FAIL 红/dirty
 * 徽章；行尾迷你趋势 div 条按受影响路数定宽，不引图表库；error 行首行人话常显
 * + detail 折叠，票 14 的 delta-error-detail 同款交互）。
 */
export function CiGateView({ repo, dashboard, client }: CiGateViewProps) {
  const [base, setBase] = useState('origin/main');
  const [head, setHead] = useState('HEAD');
  const [maxRoutes, setMaxRoutes] = useState(10);
  const [failOnBreak, setFailOnBreak] = useState(true);
  const [failOnAuthImpact, setFailOnAuthImpact] = useState(false);
  const [copied, setCopied] = useState(false);

  // ②③ 段状态（ticket 02）。runs/total 单一状态对象：prepend/append 原子写，
  // 去重命中与 total 自增不会拆成两个 setState（双轴 review b）。
  const [history, setHistory] = useState<{ runs: GateRunRow[]; total: number }>({
    runs: [],
    total: 0
  });
  const [running, setRunning] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // 切库竞态防线：in-flight 的 listGateRuns / runGate 出口回来后若已换请求代次
  // 则整包丢弃（与票 11 navSeq 同族的「动作信号作废旧响应」模式；代次快照同时
  // 被 handleRun 的两条出口引用，见 review a）。
  const historySeq = useRef(0);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  // R3-Bug-02 — same default-base fix as ArchitectureDeltaView: prefer the
  // working tree's default branch over the hardcoded origin/main.
  useEffect(() => {
    if (repo?.defaultBranch) setBase(repo.defaultBranch);
  }, [repo?.id, repo?.defaultBranch]);

  const loadHistory = useCallback(
    async (repoId: string, offset: number) => {
      if (!client) return;
      const seq = ++historySeq.current;
      const append = offset > 0;
      if (append) setLoadingMore(true);
      else setHistoryLoading(true);
      try {
        const page = await client.listGateRuns(repoId, { limit: HISTORY_PAGE_SIZE, offset });
        if (seq !== historySeq.current) return;
        setHistory((h) => {
          if (!append) return { runs: page.runs, total: page.total };
          // append 也按 id 去重：翻页间隙服务端落了新行会让 offset 窗口平移，
          // 不去重会产生 React 重复 key（双轴 review b 附带）。
          const seen = new Set(h.runs.map((r) => r.id));
          return { runs: [...h.runs, ...page.runs.filter((r) => !seen.has(r.id))], total: page.total };
        });
        setHistoryError(null);
      } catch (err) {
        if (seq !== historySeq.current) return;
        setHistoryError(err instanceof Error ? err.message : String(err));
      } finally {
        // 标志无条件复位自己的类型：陈旧响应滞留时最坏是转圈提前消失，
        // 好过永挂（双轴 review c）。
        if (append) setLoadingMore(false);
        else setHistoryLoading(false);
      }
    },
    [client]
  );

  // 切库换源：repo.id 变化即重置到第一页，旧库数据不残留（验收「不串数据」）。
  useEffect(() => {
    setHistory({ runs: [], total: 0 });
    setHistoryError(null);
    if (repo && client) {
      void loadHistory(repo.id, 0);
    } else {
      historySeq.current += 1; // 作废旧库 in-flight 响应
    }
  }, [repo?.id, client, loadHistory]);

  const command = useMemo(() => {
    const parts = ['npx codecompass pr-summary', base, head];
    if (repo?.localPath) parts.push(`"${repo.localPath}"`);
    parts.push(`--max-affected-routes ${maxRoutes}`);
    if (failOnBreak) parts.push('--fail-on-break');
    if (failOnAuthImpact) parts.push('--fail-on-auth-impact');
    return parts.join(' ');
  }, [base, failOnAuthImpact, failOnBreak, head, maxRoutes, repo?.localPath]);

  const handleCopy = async () => {
    await copyText(command);
    setCopied(true);
  };

  // Ticket 14 (QA-05) 同源守卫：idle/indexing/error 仓无可用 git 引用，
  // 跑了也只会得到人话 400——直接禁掉并给同一引导文案。
  const repoNotReady = repo !== null && repo.status !== 'ready';
  const notReadyHint = '该仓库尚未索引完成或无可用 Git 引用，请先在「更多操作」重建索引。';
  const canRun =
    !running && !repoNotReady && repo !== null && client !== undefined &&
    base.trim() !== '' && head.trim() !== '';

  const handleRun = async () => {
    if (!repo || !client || running || !canRun) return;
    setRunning(true);
    // P1 修复（双轴 review a）：seq 守卫此前只包住 loadHistory，runGate 的两条
    // 出口拿点击时的旧闭包写共享状态——切库后 A 库的 echo 会被 prepend 进 B 库，
    // 且失败出口的「陈旧重拉」会签发新代次把 B 库的正确响应作废（确定性击穿）。
    // 现在两条出口都以「点击时快照」为准：代次已变 → 整包作废，交给切库 effect
    // 的第一页拉取收尾。running 是动作局部标志，与库无关，仍无条件复位。
    const seqAtRun = historySeq.current;
    const runRepoId = repo.id;
    try {
      // 策略旋钮升级为 runGate 入参（不止进复制命令串）；服务器把 options
      // 快照落库，回放不回读当前配置（ADR-0017 / Q12）。
      const run = await client.runGate(runRepoId, base.trim(), head.trim(), {
        maxAffectedRoutes: maxRoutes,
        failOnBreak,
        failOnAuthImpact
      });
      if (seqAtRun !== historySeq.current) return; // 已切库——echo 整包作废
      // 成功：POST 回显的就是落库行（服务端按 runId 回读），直接置顶，
      // 免去整表重拉——新行立刻出现在历史表顶部。runs/total 原子写（review b）。
      setHistory((h) =>
        h.runs.some((r) => r.id === run.id) ? h : { runs: [run, ...h.runs], total: h.total + 1 }
      );
      setHistoryError(null);
    } catch (err) {
      if (seqAtRun !== historySeq.current) return; // 已切库——不在旧库名下发陈旧请求
      // 400（票 14）：失败行已由服务端落库——重拉历史让「表内 error 行」
      // （首行人话 + 折叠原始输出）出现在运行史里。先落一条 historyError
      // 防「落库也没成功」的极端场景错误静默蒸发（review d 尾巴）；重拉
      // 成功即被 loadHistory 清掉。纯网络失败则经同一次重拉以 historyError 显形。
      setHistoryError(err instanceof Error ? err.message : String(err));
      await loadHistory(runRepoId, 0);
    } finally {
      setRunning(false);
    }
  };

  // 趋势条归一化标尺：dirty 行默认从趋势条过滤（Q12 裁定）——不占标尺、不画条。
  const trendMax = useMemo(() => {
    let max = 0;
    for (const run of history.runs) {
      if (isDirtyRun(run)) continue;
      if (run.routesCount > max) max = run.routesCount;
    }
    return max;
  }, [history.runs]);

  if (!repo) {
    return (
      <div data-testid="ci-gate-empty" className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted">选择一个仓库后配置 CI 门禁策略。</p>
      </div>
    );
  }

  return (
    <div data-testid="ci-gate" className="workbench-grid flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">CI 门禁</h2>
            <p className="mt-0.5 truncate text-xs text-muted">{repo.name}</p>
          </div>
          <ScenarioGuide
            steps={[
              '① 配置基线：选择基线分支与调用链/诊断/扫描检查项',
              '② 生成预置命令：复制到 CI/CD 流水线阻断越界影响面',
              '③ 本地自查：任何改动先在这里验证调用边界，再做合并决策'
            ]}
          />
          <button
            type="button"
            data-testid="copy-ci-command"
            onClick={handleCopy}
            className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              copied
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-line bg-surface text-muted hover:border-accent hover:text-accent'
            }`}
          >
            {copied ? '已复制' : '复制 CI 命令'}
          </button>
        </header>

        <section className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            门禁策略
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              影响路由阈值
              <input
                data-testid="ci-max-routes"
                type="number"
                min={1}
                value={maxRoutes}
                onChange={(e) => setMaxRoutes(Number(e.target.value) || 1)}
                className="h-8 rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                data-testid="ci-fail-on-break"
                type="checkbox"
                checked={failOnBreak}
                onChange={(e) => setFailOnBreak(e.target.checked)}
                className="h-4 w-4 accent-[rgb(var(--color-accent))]"
              />
              断链检测
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                data-testid="ci-fail-on-auth-impact"
                type="checkbox"
                checked={failOnAuthImpact}
                onChange={(e) => setFailOnAuthImpact(e.target.checked)}
                className="h-4 w-4 accent-[rgb(var(--color-accent))]"
              />
              未鉴权敏感链路
            </label>
            <div className="flex items-center gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
                Base
                <input
                  data-testid="ci-base"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  className="h-8 rounded-md border border-line bg-surface px-2 font-mono text-xs text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
                Head
                <input
                  data-testid="ci-head"
                  value={head}
                  onChange={(e) => setHead(e.target.value)}
                  className="h-8 rounded-md border border-line bg-surface px-2 font-mono text-xs text-ink outline-none focus:border-accent"
                />
              </label>
            </div>
          </div>
        </section>

        <section className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">基线</h3>
          <div data-testid="ci-baseline" className="flex flex-wrap gap-2">
            <span className="rounded-md border border-line bg-subtle px-2 py-1 text-xs text-muted">
              {dashboard ? `${formatNumber(dashboard.scale.routes)} Routes` : '—'}
            </span>
            <span className="rounded-md border border-line bg-subtle px-2 py-1 text-xs text-muted">
              {dashboard ? `${formatNumber(dashboard.topApis.length)} Top APIs` : '—'}
            </span>
            <span className="rounded-md border border-line bg-subtle px-2 py-1 text-xs text-muted">
              {dashboard ? `${formatNumber(dashboard.scale.files)} Files` : '—'}
            </span>
          </div>
        </section>

        <section className="rounded-md border border-line bg-surface p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">命令</h3>
          <pre
            data-testid="ci-command"
            className="overflow-x-auto rounded-md border border-line bg-code px-3 py-2 font-mono text-[11px] leading-relaxed text-ink"
          >
            {command}
          </pre>
        </section>

        {client && (
          <section className="rounded-md border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  运行并记录
                </h3>
                <p className="mt-1 text-[11px] text-muted">
                  按上方策略在工作台内跑一次门禁，结果落库进「门禁运行史」。
                </p>
              </div>
              <button
                type="button"
                data-testid="gate-run"
                onClick={handleRun}
                disabled={!canRun}
                title={repoNotReady ? notReadyHint : undefined}
                className="h-8 shrink-0 rounded-md bg-accent px-4 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {running ? '执行中…' : '运行并记录'}
              </button>
            </div>
            {repoNotReady && (
              <p data-testid="gate-not-ready-hint" className="mt-2 text-[11px] text-warning">
                {notReadyHint}
              </p>
            )}
          </section>
        )}

        {client && (
          <section className="rounded-md border border-line bg-surface p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              门禁运行史
            </h3>
            {historyError && (
              <p data-testid="gate-history-error" className="mb-2 text-xs text-danger">
                {historyError}
              </p>
            )}
            {historyLoading && (
              <p data-testid="gate-history-loading" className="text-xs text-muted">
                加载运行史…
              </p>
            )}
            {!historyLoading && history.runs.length === 0 && !historyError && (
              <p data-testid="gate-history-empty" className="text-xs text-muted">
                还没有跑过的门禁。配好策略点「运行并记录」，这里会留下每台机器上的执行史。
              </p>
            )}
            {history.runs.length > 0 && (
              <ul data-testid="gate-run-list" className="divide-y divide-line">
                {history.runs.map((run) => {
                  const dirty = isDirtyRun(run);
                  const pct =
                    trendMax > 0 && !dirty
                      ? Math.max(Math.round((run.routesCount / trendMax) * 100), run.routesCount > 0 ? 8 : 0)
                      : 0;
                  return (
                    <li
                      key={run.id}
                      data-testid="gate-run-row"
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs"
                    >
                      <span
                        data-testid="gate-run-status"
                        className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${
                          run.status === 'PASS'
                            ? 'bg-success/10 text-success'
                            : 'bg-danger/10 text-danger'
                        }`}
                      >
                        {run.status}
                      </span>
                      {dirty && (
                        <span
                          data-testid="gate-run-dirty"
                          className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 font-medium text-warning"
                        >
                          dirty
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[11px] text-muted">
                        {commitLabel(run.commit)}
                      </span>
                      <span data-testid="gate-run-refs" className="min-w-0 truncate font-mono text-[11px] text-ink">
                        {run.base} → {run.head}
                      </span>
                      <span className="shrink-0 text-muted">
                        路 {run.routesCount}
                      </span>
                      {run.violationsCount > 0 && (
                        <span data-testid="gate-run-violations" className="shrink-0 text-danger">
                          违规 {run.violationsCount}
                        </span>
                      )}
                      <span className="shrink-0 text-muted">{run.createdAt}</span>
                      {!dirty && (
                        <div
                          role="progressbar"
                          aria-label="受影响路数"
                          aria-valuemin={0}
                          aria-valuemax={trendMax || run.routesCount}
                          aria-valuenow={run.routesCount}
                          className="ml-auto h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-subtle"
                        >
                          <div
                            data-testid="gate-trend-bar"
                            className={`h-full rounded-full ${
                              run.status === 'PASS' ? 'bg-success' : 'bg-danger'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                      {run.error && (
                        <div className="w-full text-danger" data-testid="gate-run-error">
                          <p>{run.error}</p>
                          {run.detail && run.detail !== run.error && (
                            <details className="mt-1" data-testid="gate-run-error-detail">
                              <summary className="cursor-pointer select-none text-muted">
                                原始输出
                              </summary>
                              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-code px-2 py-1 font-mono text-[11px] text-muted">
                                {run.detail}
                              </pre>
                            </details>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {history.runs.length > 0 && history.runs.length < history.total && (
              <button
                type="button"
                data-testid="gate-history-more"
                onClick={() => void loadHistory(repo.id, history.runs.length)}
                disabled={loadingMore || historyLoading}
                className="mt-2 w-full rounded-md border border-line bg-subtle px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {loadingMore ? '加载中…' : `加载更多（${history.runs.length} / ${history.total}）`}
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
