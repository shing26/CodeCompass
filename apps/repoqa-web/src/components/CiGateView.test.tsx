import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CiGateView } from './CiGateView';
import type { GateRunPolicyOptions, GateRunRow, Repo, RepoDashboard } from '../types';

const repo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  localPath: 'C:/projects/spring-petclinic',
  branch: 'main',
  status: 'ready',
  fileCount: 120,
  symbolCount: 840,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
};

const dashboard: RepoDashboard = {
  repoId: 'repo-1',
  repoName: 'petclinic',
  techStack: { summary: [], highlights: ['Spring Boot'] },
  config: { topology: [], maskedValues: true },
  scale: {
    routes: 3,
    services: 1,
    repositories: 1,
    advices: 0,
    plainClasses: 2,
    interfaces: 1,
    methods: 8,
    fields: 4,
    configKeys: 2,
    files: 6
  },
  topApis: []
};

describe('CiGateView (Issue 31)', () => {
  it('renders policy controls, baseline stats and a generated command', async () => {
    const user = userEvent.setup();
    render(<CiGateView repo={repo} dashboard={dashboard} />);

    expect(screen.getByTestId('ci-gate')).toBeInTheDocument();
    expect(screen.getByTestId('ci-baseline')).toHaveTextContent('3 Routes');
    expect(screen.getByTestId('ci-command')).toHaveTextContent(
      'npx codecompass pr-summary origin/main HEAD "C:/projects/spring-petclinic" --max-affected-routes 10 --fail-on-break'
    );

    await user.click(screen.getByTestId('ci-fail-on-auth-impact'));
    fireEvent.change(screen.getByTestId('ci-max-routes'), { target: { value: '5' } });
    expect(screen.getByTestId('ci-command')).toHaveTextContent('--max-affected-routes 5');
    expect(screen.getByTestId('ci-command')).toHaveTextContent('--fail-on-auth-impact');
  });

  it('defaults the base ref to the repo default branch (R3-Bug-02)', async () => {
    render(<CiGateView repo={{ ...repo, defaultBranch: 'master' }} dashboard={dashboard} />);
    await waitFor(() =>
      expect(screen.getByTestId('ci-command')).toHaveTextContent(
        'npx codecompass pr-summary master HEAD'
      )
    );
  });

  it('shows an empty state without a repo', () => {
    render(<CiGateView repo={null} dashboard={null} />);
    expect(screen.getByTestId('ci-gate-empty')).toBeInTheDocument();
  });
});

function gateRunRow(overrides: Partial<GateRunRow> = {}): GateRunRow {
  return {
    id: 'r1',
    commit: 'a1b2c3d4e5f6',
    base: 'origin/main',
    head: 'HEAD',
    options: { maxAffectedRoutes: 10, failOnBreak: true },
    status: 'PASS',
    violationsCount: 0,
    routesCount: 3,
    error: null,
    detail: null,
    durationMs: 12,
    source: 'workbench',
    createdAt: '2026-09-11 07:00:00',
    ...overrides
  };
}

describe('CiGateView (v0.26-B ticket 02 — 三段化：运行并记录 + 门禁运行史)', () => {
  const makeGateClient = (
    overrides: {
      runGate?: (repoId: string, base: string, head: string, options?: GateRunPolicyOptions) => Promise<GateRunRow>;
      listGateRuns?: (repoId: string, params?: { limit?: number; offset?: number; commit?: string }) => Promise<{ runs: GateRunRow[]; total: number }>;
    } = {}
  ) => ({
    runGate: vi.fn(overrides.runGate ?? (async () => gateRunRow({ id: 'echo', routesCount: 5 }))),
    listGateRuns: vi.fn(
      overrides.listGateRuns ?? (async () => ({ runs: [gateRunRow({ id: 'h1' })], total: 1 }))
    ),
  });

  it('runs the gate and prepends the echo row to the history list, then shows its verdict badge', async () => {
    const user = userEvent.setup();
    const client = makeGateClient();
    render(<CiGateView repo={repo} dashboard={dashboard} client={client} />);
    // 现状回放：一行历史
    await waitFor(() => expect(screen.getAllByTestId('gate-run-row')).toHaveLength(1));

    await user.click(screen.getByTestId('gate-run'));

    // runGate 以当前策略旋钮为入参（不止进复制命令串）
    expect(client.runGate).toHaveBeenCalledWith('repo-1', 'origin/main', 'HEAD', {
      maxAffectedRoutes: 10,
      failOnBreak: true,
      failOnAuthImpact: false
    });
    // 新行置顶（echo 落库行）；历史仍是一屏两行
    await waitFor(() => expect(screen.getAllByTestId('gate-run-row')).toHaveLength(2));
    const firstRow = screen.getAllByTestId('gate-run-row')[0];
    expect(firstRow).toHaveTextContent('PASS');
    // 「路 5」是 echo 独有（h1 是 路 3）——只断言 PASS/refs 两行都满足，append
    // 实现也能通过（review g：断言必须有鉴别力）
    expect(firstRow).toHaveTextContent('路 5');
    expect(client.listGateRuns).toHaveBeenCalledTimes(1); // 成功走 echo 置顶，不整表重拉
  });

  it('renders PASS green / FAIL red / dirty badges and the inline trend div bar', async () => {
    const listGateRuns = vi.fn(async () => ({
      runs: [
        gateRunRow({ id: 'pass', status: 'PASS', routesCount: 4 }),
        gateRunRow({ id: 'fail', status: 'FAIL', routesCount: 8, violationsCount: 2 }),
        // dirty 行 routesCount 故意 = 12 > 非 dirty 最大值 8：若实现误把 dirty
        // 计入标尺，50%/100% 会变 33%/67%——断言因此有鉴别力（review g）
        gateRunRow({ id: 'dirty', status: 'PASS', routesCount: 12, commit: 'a1b2c3d4e5f6+dirty' })
      ],
      total: 3
    }));
    render(
      <CiGateView repo={repo} dashboard={dashboard} client={{ runGate: vi.fn(), listGateRuns }} />
    );
    await waitFor(() => expect(screen.getAllByTestId('gate-run-row')).toHaveLength(3));

    expect(screen.getByTestId('gate-run-dirty')).toBeInTheDocument();
    // PASS/FAIL 徽章都在
    expect(screen.getAllByText('PASS').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('FAIL').length).toBeGreaterThanOrEqual(1);
    // 趋势条 = 每个非 dirty 行一条 div 条；dirty 行从趋势条过滤（Q12）
    const bars = screen.getAllByTestId('gate-trend-bar');
    expect(bars).toHaveLength(2);
    // trendMax = 8（dirty 行的 routes 不计入标尺）→ 4/8=50%、8/8=100%
    expect(bars[0]).toHaveStyle({ width: '50%' });
    expect(bars[1]).toHaveStyle({ width: '100%' });
    // 违规计数在 FAIL 行出现
    expect(screen.getByTestId('gate-run-violations')).toHaveTextContent('2');
  });

  it('keeps the whole gate history in the DOM without pulling in a chart library', async () => {
    // 趋势是行内 div，无 svg/canvas 图形元素（验收判据：不引图表库；此处防回归护栏）
    const listGateRuns = vi.fn(async () => ({
      runs: [gateRunRow({ id: 'a' }), gateRunRow({ id: 'b', status: 'FAIL', routesCount: 7 })],
      total: 2
    }));
    const { container } = render(
      <CiGateView repo={repo} dashboard={dashboard} client={{ runGate: vi.fn(), listGateRuns }} />
    );
    await waitFor(() => expect(screen.getAllByTestId('gate-trend-bar')).toHaveLength(2));
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('shows a folded 人话 error row and re-enables retry after a 400', async () => {
    const err = Object.assign(new Error('无法解析 git 引用 "origin/nope"。'), {
      detail: 'fatal: ambiguous argument origin/nope'
    });
    // runGate 抛出票 14 错误 → catch 走重拉历史：服务端已落库的 error 行回放出来。
    const listGateRuns = vi
      .fn()
      .mockResolvedValueOnce({ runs: [], total: 0 })
      .mockResolvedValueOnce({
        runs: [gateRunRow({ id: 'e', status: 'FAIL', error: err.message, detail: err.detail, routesCount: 0 })],
        total: 1
      });
    const user = userEvent.setup();
    render(
      <CiGateView repo={repo} dashboard={dashboard} client={{ runGate: vi.fn().mockRejectedValue(err), listGateRuns }} />
    );
    await waitFor(() => expect(screen.getByTestId('gate-history-empty')).toBeInTheDocument());

    await user.click(screen.getByTestId('gate-run'));

    // 表内 error 行：首行人话常显
    await waitFor(() =>
      expect(screen.getByTestId('gate-run-error')).toHaveTextContent('无法解析 git 引用 "origin/nope"。')
    );
    // 原始输出折叠在 <details>（票 14 同款）
    const detail = screen.getByTestId('gate-run-error-detail');
    expect(detail.querySelector('summary')).toHaveTextContent('原始输出');
    expect(detail.querySelector('pre')).toHaveTextContent('fatal: ambiguous argument origin/nope');
    // 按钮可重试（running 复位）
    expect(screen.getByTestId('gate-run')).toBeEnabled();
  });

  it('paginates with limit/offset: 加载更多 appends the next page and hides at the tail', async () => {
    const listGateRuns = vi
      .fn()
      .mockResolvedValueOnce({
        runs: Array.from({ length: 20 }, (_, i) => gateRunRow({ id: `p1-${i}` })),
        total: 25
      })
      .mockResolvedValueOnce({
        runs: Array.from({ length: 5 }, (_, i) => gateRunRow({ id: `p2-${i}` })),
        total: 25
      });
    const user = userEvent.setup();
    render(
      <CiGateView repo={repo} dashboard={dashboard} client={{ runGate: vi.fn(), listGateRuns }} />
    );
    await waitFor(() => expect(screen.getAllByTestId('gate-run-row')).toHaveLength(20));

    await user.click(screen.getByTestId('gate-history-more'));
    expect(listGateRuns).toHaveBeenLastCalledWith('repo-1', { limit: 20, offset: 20 });

    await waitFor(() => expect(screen.getAllByTestId('gate-run-row')).toHaveLength(25));
    expect(screen.queryByTestId('gate-history-more')).not.toBeInTheDocument();
  });

  it('switching repos re-sources the list and never mixes stale in-flight data', async () => {
    // holder 对象绕开 TS 对「仅在闭包里赋值的局部变量」的 never 收窄
    const stale: { resolve?: (v: { runs: GateRunRow[]; total: number }) => void } = {};
    const clientA = { runGate: vi.fn(), listGateRuns: vi.fn() };
    clientA.listGateRuns
      // repo-1：故意悬挂，模拟慢响应（切库后才回来）
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            stale.resolve = resolve as (v: { runs: GateRunRow[]; total: number }) => void;
          })
      )
      // repo-2：立即回一行
      .mockResolvedValueOnce({ runs: [gateRunRow({ id: 'fresh', commit: 'beefcafe1234' })], total: 1 });

    const { rerender } = render(<CiGateView repo={repo} dashboard={dashboard} client={clientA} />);
    // repo-1 请求未回 → 暂无行
    expect(screen.queryByTestId('gate-run-row')).not.toBeInTheDocument();

    rerender(
      <CiGateView
        repo={{ ...repo, id: 'repo-2', name: 'other' }}
        dashboard={dashboard}
        client={clientA}
      />
    );
    await waitFor(() => expect(screen.getAllByTestId('gate-run-row')).toHaveLength(1));
    expect(screen.getByTestId('gate-run-row')).toHaveTextContent('beefca');

    // 旧库的慢响应姗姗来迟——代次作废旧数据（验收「不串数据」）
    await act(async () => {
      stale.resolve?.({ runs: [gateRunRow({ id: 'stale', commit: 'deadbeef9999' })], total: 1 });
    });
    expect(screen.getByTestId('gate-run-row')).toHaveTextContent('beefca');
    expect(screen.queryByText('deadbe')).not.toBeInTheDocument();
  });

  // —— P1 回归（双轴 review a）：seq 守卫必须同样罩住 runGate 的两条出口。
  // 只测 listGateRuns 换源等于没测守卫边界——击穿路径正是 A 库在飞的 run。
  it('discards a run echo that lands after a repo switch (review P1-a, success exit)', async () => {
    let releaseRun: ((r: GateRunRow) => void) | undefined;
    const runGate = vi.fn(
      () =>
        new Promise<GateRunRow>((res) => {
          releaseRun = res;
        })
    );
    const listGateRuns = vi
      .fn()
      .mockResolvedValueOnce({ runs: [], total: 0 }) // repo-1 挂载首拉
      .mockResolvedValueOnce({ runs: [gateRunRow({ id: 'b1', base: 'repo-b-base' })], total: 1 }); // repo-b 换源
    const client = { runGate, listGateRuns };

    const { rerender } = render(<CiGateView repo={repo} dashboard={dashboard} client={client} />);
    await waitFor(() => expect(screen.getByTestId('gate-history-empty')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('gate-run')); // A 库的 run 在飞

    rerender(<CiGateView repo={{ ...repo, id: 'repo-b' }} dashboard={dashboard} client={client} />);
    await waitFor(() => expect(screen.getByTestId('gate-run-refs')).toHaveTextContent('repo-b-base'));

    await act(async () => {
      releaseRun?.(gateRunRow({ id: 'echo-a', base: 'feature/leak' }));
    });

    // A 库 verdict 不得进 B 库运行史，total 也不 +1（无第三次拉取）
    expect(screen.queryByText(/feature\/leak/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('gate-run-row')).toHaveLength(1);
    expect(listGateRuns).toHaveBeenCalledTimes(2);
  });

  it('a failed run of the previous repo never re-fetches under the new repo (review P1-a, catch exit)', async () => {
    let rejectRun: ((e: Error) => void) | undefined;
    const runGate = vi.fn(
      () =>
        new Promise<GateRunRow>((_, rej) => {
          rejectRun = rej;
        })
    );
    const listGateRuns = vi
      .fn()
      .mockResolvedValueOnce({ runs: [], total: 0 }) // repo-1 挂载首拉
      .mockResolvedValueOnce({ runs: [gateRunRow({ id: 'b1', base: 'repo-b-base' })], total: 1 }); // repo-b 换源
    const client = { runGate, listGateRuns };

    const { rerender } = render(<CiGateView repo={repo} dashboard={dashboard} client={client} />);
    await waitFor(() => expect(screen.getByTestId('gate-history-empty')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('gate-run'));

    rerender(<CiGateView repo={{ ...repo, id: 'repo-b' }} dashboard={dashboard} client={client} />);
    await waitFor(() => expect(screen.getByTestId('gate-run-refs')).toHaveTextContent('repo-b-base'));

    await act(async () => {
      rejectRun?.(new Error('无法解析 git 引用 "origin/nope"。'));
    });

    // 关键：陈旧 catch 不得再发 loadHistory('repo-1')（旧实现会签发新代次
    // 把 B 库正确响应作废，且 A 库整页历史显示在 B 库名下）
    expect(listGateRuns).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId('gate-run-row')).toHaveLength(1);
    expect(screen.getByTestId('gate-run-refs')).toHaveTextContent('repo-b-base');
  });

  it('surfaces a history load failure in the panel', async () => {
    const listGateRuns = vi.fn().mockRejectedValue(new Error('listGateRuns failed: 500'));
    render(
      <CiGateView repo={repo} dashboard={dashboard} client={{ runGate: vi.fn(), listGateRuns }} />
    );
    await waitFor(() =>
      expect(screen.getByTestId('gate-history-error')).toHaveTextContent('listGateRuns failed: 500')
    );
  });

  it('hides 运行并记录 and 运行史 when no client is injected (现状区保持 Issue 31 原样)', () => {
    render(<CiGateView repo={repo} dashboard={dashboard} />);
    expect(screen.getByTestId('ci-command')).toBeInTheDocument();
    expect(screen.queryByTestId('gate-run')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gate-run-list')).not.toBeInTheDocument();
  });

  it('disables 运行并记录 for a non-ready repo with the same guidance as the delta tab (QA-05 同源)', async () => {
    const user = userEvent.setup();
    render(
      <CiGateView
        repo={{ ...repo, status: 'indexing' }}
        dashboard={dashboard}
        client={makeGateClient()}
      />
    );
    await waitFor(() => expect(screen.getByTestId('gate-run')).toBeDisabled());
    expect(screen.getByTestId('gate-not-ready-hint')).toBeInTheDocument();
    await user.click(screen.getByTestId('ci-fail-on-auth-impact'));
    // 策略旋钮照常可改，但禁用态不触发任何 run（QA-05 门控）
    expect(screen.getByTestId('gate-run')).toBeDisabled();
    expect(screen.getByTestId('ci-fail-on-auth-impact')).toBeChecked();
  });
});
