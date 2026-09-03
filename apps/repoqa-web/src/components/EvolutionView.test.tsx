import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvolutionView } from './EvolutionView';
import { useEvolutionSession } from '../hooks/useEvolutionSession';
import type { EvolveStreamLike } from '../client/RepoQAClient';
import type { EvolveEvent, ModuleEvolutionResult, Repo } from '../types';

vi.mock('../client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async () => '<svg id="d"><text>OrderService.create</text></svg>')
}));

const repo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  localPath: 'C:/projects/petclinic',
  branch: 'main',
  status: 'ready',
  fileCount: 40,
  symbolCount: 200,
  commit: 'abc1234',
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
};

const repoB: Repo = { ...repo, id: 'repo-2', name: 'other-repo', commit: 'def5678' };
const reindexed: Repo = { ...repo, commit: 'fff0000' };

const extendResult: ModuleEvolutionResult = {
  schemaVersion: 1,
  repoId: 'repo-1',
  intentType: 'EXTEND',
  target: 'OrderService.create',
  riskLevel: 'MEDIUM',
  blastRadius: {
    impactedCallersCount: 2,
    impactedRoutes: ['GET /api/orders'],
    impactedComponents: [],
    orphanedSymbols: []
  },
  checklists: [
    {
      category: 'SERVICE',
      action: 'CREATE',
      filePath: 'src/main/java/com/demo/order/OrderExportService.java',
      description: '新建导出服务'
    }
  ],
  conventions: {
    repoId: 'repo-1',
    sampledAt: '2026-09-01T00:00:00.000Z',
    axes: [
      {
        axis: 'return_wrapping',
        supported: true,
        verdict: 'Controller methods return unified wrapper ApiResult<T>',
        primary: 'ApiResult',
        coverage: { match: 5, total: 5 },
        anchors: [{ file: 'src/OrderController.java', line: 12, symbol: 'OrderController.list' }],
        dissidents: [{ file: 'src/LegacyController.java', line: 30, symbol: 'LegacyController.raw' }]
      }
    ]
  },
  placement: {
    packagePath: 'com.demo.order',
    files: [{ filePath: 'src/main/java/com/demo/order/OrderExportService.java', role: 'single' }],
    injection: { style: 'constructor', signature: 'private final OrderRepository orderRepository' },
    handlerSignature: 'public ApiResult<String> export(Order order)',
    basedOn: [{ axis: 'return_wrapping', verdict: 'ApiResult<T>' }]
  },
  risks: [
    {
      kind: 'transaction-warning',
      message: '导出属耗时 I/O,不应挂在事务边界内',
      suggestion: '发布 SPRING_EVENT_ASYNC 事件,事务提交后处理'
    }
  ],
  cockpitDeepLink: '/?repo=repo-1'
};

function stageFrames(runner: string): EvolveEvent[] {
  return [
    { type: 'stage', payload: { stage: 'intent_parse', label: '意图解析', status: 'running' } },
    {
      type: 'stage',
      payload: {
        stage: 'intent_parse',
        label: '意图解析',
        status: 'done',
        intentEcho: {
          intentType: 'EXTEND',
          rawKeyword: '订单',
          extensionGoal: 'Excel 导出',
          resolvedTarget: 'OrderService.create',
          alternatives: [
            { symbol: 'OrderService.create', score: 78 },
            { symbol: 'ExportService', score: 62 }
          ],
          parsedBy: 'fallback'
        }
      }
    },
    { type: 'stage', payload: { stage: 'target_resolve', label: '目标锚定', status: 'running' } },
    { type: 'stage', payload: { stage: 'target_resolve', label: '目标锚定', status: 'done' } },
    { type: 'stage', payload: { stage: 'convention_scan', label: '惯例嗅探', status: 'running' } },
    { type: 'stage', payload: { stage: 'pipeline', label: runner, status: 'running' } },
    { type: 'stage', payload: { stage: 'convention_scan', label: '惯例嗅探', status: 'done' } },
    { type: 'stage', payload: { stage: 'pipeline', label: runner, status: 'done' } },
    { type: 'stage', payload: { stage: 'diagram', label: '图谱投射', status: 'running' } },
    { type: 'stage', payload: { stage: 'diagram', label: '图谱投射', status: 'done' } },
    {
      type: 'done',
      payload: {
        intentEcho: {
          intentType: 'EXTEND',
          rawKeyword: '订单',
          extensionGoal: 'Excel 导出',
          resolvedTarget: 'OrderService.create',
          alternatives: [
            { symbol: 'OrderService.create', score: 78 },
            { symbol: 'ExportService', score: 62 }
          ],
          parsedBy: 'fallback'
        },
        result: extendResult,
        mermaid: 'flowchart LR\n  OrderService.create --> OrderRepository.save',
        commit: 'abc1234'
      }
    }
  ];
}

const echoFrames = stageFrames('演进推演');

/**
 * Scripted evolve stream with a manually-fired connect() — lets a test hold
 * the stream open mid-run (no done frame) to drive follow-up interactions.
 */
function scriptedStream(frames: EvolveEvent[], auto = true): EvolveStreamLike & { fire: () => void } {
  let onFrame: ((event: EvolveEvent) => void) | undefined;
  let onDone: (() => void) | undefined;
  let fired = false;
  return {
    onEvent(fn) {
      onFrame = fn;
      return () => undefined;
    },
    onError(_fn) {
      return () => undefined;
    },
    onDone(fn) {
      onDone = fn;
      return () => undefined;
    },
    connect: async () => {
      if (!auto || fired) return;
      fired = true;
      for (const frame of frames) onFrame?.(frame);
      onDone?.();
    },
    close: () => undefined,
    fire: () => {
      fired = true;
      for (const frame of frames) onFrame?.(frame);
      onDone?.();
    }
  };
}

function makeClient(streams: (EvolveStreamLike & { fire?: () => void })[]) {
  return {
    evolveStream: vi.fn(() => streams.shift() ?? scriptedStream([]))
  };
}

/** Host render: the session hook is App-owned, so tests mount it the same way. */
function SessionHost({
  client,
  repo: currentRepo,
  onNavigate
}: {
  client: ReturnType<typeof makeClient>;
  repo: Repo | null;
  onNavigate?: (file: string, line: number) => void;
}) {
  const session = useEvolutionSession(client as never, currentRepo);
  return <EvolutionView repo={currentRepo} session={session} onNavigate={onNavigate} />;
}

describe('EvolutionView (Issue 24 / Ticket 24.5 — artifact stream)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delivers the first card, then keeps a follow-up intent in the same stream', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const client = makeClient([
      scriptedStream(echoFrames),
      scriptedStream(stageFrames('影响面推演'))
    ]);
    render(<SessionHost client={client} repo={repo} onNavigate={onNavigate} />);

    await user.type(screen.getByTestId('evolve-intent'), '给订单模块加 Excel 导出');
    await user.click(screen.getByTestId('evolve-run'));

    // First card delivered with artifacts.
    await waitFor(() => expect(screen.getByTestId('evolve-card-done')).toBeInTheDocument());
    const placement = screen.getByTestId('evolve-placement');
    expect(placement).toHaveTextContent('OrderExportService.java');
    expect(placement).toHaveTextContent('constructor');
    expect(placement).toHaveTextContent('public ApiResult<String> export(Order order)');
    expect(screen.getByTestId('evolve-conventions')).toHaveTextContent('5/5');
    expect(screen.getByTestId('evolve-risks')).toHaveTextContent('事务解耦');
    expect(screen.getByTestId('evolve-checklists')).toHaveTextContent('OrderExportService.java');
    expect(screen.getByTestId('evolve-diagram')).toBeInTheDocument();

    // Stream header shows the isolation key and one card.
    expect(screen.getByTestId('evolution-view')).toHaveTextContent('abc1234');
    expect(screen.getByTestId('evolution-view')).toHaveTextContent('1 张工件卡');

    // Follow-up: the input is promoted to a follow-up box and delivers card #2.
    await user.type(screen.getByTestId('evolve-intent'), '排查这次落位对调用方的影响面');
    await user.click(screen.getByTestId('evolve-run'));

    await waitFor(() => expect(client.evolveStream).toHaveBeenCalledTimes(2));
    expect(client.evolveStream).toHaveBeenLastCalledWith('repo-1', '排查这次落位对调用方的影响面', undefined);
    await waitFor(() => expect(screen.getByTestId('evolution-view')).toHaveTextContent('2 张工件卡'));
    // Cards keep delivery order and both stay in the timeline.
    expect(screen.getByText('给订单模块加 Excel 导出')).toBeInTheDocument();
    expect(screen.getByText('排查这次落位对调用方的影响面')).toBeInTheDocument();

    // History is collapsed, latest is expanded.
    const toggles = screen.getAllByTestId('evolve-card-toggle');
    expect(toggles).toHaveLength(2);
    expect(toggles[0]).toHaveTextContent('展开');
    expect(toggles[1]).toHaveTextContent('收起');
    // Only the expanded (latest) card exposes the artifact cards.
    expect(screen.getAllByTestId('evolve-placement')).toHaveLength(1);

    // Deep-link still works from the latest card.
    await user.click(screen.getAllByText('src/main/java/com/demo/order/OrderExportService.java')[0]);
    expect(onNavigate).toHaveBeenCalledWith('src/main/java/com/demo/order/OrderExportService.java', 1);
  });

  it('switching repos opens a new stream and never mixes cards', async () => {
    const user = userEvent.setup();
    const client = makeClient([scriptedStream(echoFrames)]);
    const { rerender } = render(<SessionHost client={client} repo={repo} />);

    await user.type(screen.getByTestId('evolve-intent'), '给订单模块加 Excel 导出');
    await user.click(screen.getByTestId('evolve-run'));
    await waitFor(() => expect(screen.getByTestId('evolve-card-done')).toBeInTheDocument());
    expect(screen.getByTestId('evolution-view')).toHaveTextContent('1 张工件卡');

    // Repo switch → the stream flips to repo-2's empty bucket.
    rerender(<SessionHost client={client} repo={repoB} />);
    expect(screen.getByTestId('evolution-view')).toHaveTextContent('工件流未开始');
    expect(screen.queryByText('给订单模块加 Excel 导出')).not.toBeInTheDocument();

    // …and back to repo-1: the bucket persisted (in-memory v1).
    rerender(<SessionHost client={client} repo={repo} />);
    expect(screen.getByTestId('evolution-view')).toHaveTextContent('1 张工件卡');
    expect(screen.getByText('给订单模块加 Excel 导出')).toBeInTheDocument();
  });

  it('re-index (commit change) opens a new stream for the same repo', async () => {
    const user = userEvent.setup();
    const client = makeClient([scriptedStream(echoFrames)]);
    const { rerender } = render(<SessionHost client={client} repo={repo} />);

    await user.type(screen.getByTestId('evolve-intent'), '给订单模块加 Excel 导出');
    await user.click(screen.getByTestId('evolve-run'));
    await waitFor(() => expect(screen.getByTestId('evolve-card-done')).toBeInTheDocument());

    rerender(<SessionHost client={client} repo={reindexed} />);
    expect(screen.getByTestId('evolution-view')).toHaveTextContent('fff0000');
    expect(screen.getByTestId('evolution-view')).toHaveTextContent('工件流未开始');
    expect(screen.queryByText('给订单模块加 Excel 导出')).not.toBeInTheDocument();

    // The old (repoId, commit) bucket is still there when the commit reverts.
    rerender(<SessionHost client={client} repo={repo} />);
    expect(screen.getByTestId('evolution-view')).toHaveTextContent('1 张工件卡');
  });

  it('an in-flight card is marked interrupted when the stream switches', async () => {
    const user = userEvent.setup();
    const manual = scriptedStream(echoFrames, false);
    const client = makeClient([manual]);
    const { rerender } = render(<SessionHost client={client} repo={repo} />);

    await user.type(screen.getByTestId('evolve-intent'), '给订单模块加 Excel 导出');
    await user.click(screen.getByTestId('evolve-run'));
    expect(screen.getByTestId('evolve-card-live')).toBeInTheDocument();

    // Switch away mid-run: the interrupted card is finalized as an error.
    rerender(<SessionHost client={client} repo={repoB} />);
    expect(screen.queryByTestId('evolve-card-live')).not.toBeInTheDocument();

    rerender(<SessionHost client={client} repo={repo} />);
    expect(screen.getByTestId('evolve-card-failed')).toBeInTheDocument();
    expect(screen.getByTestId('evolution-view')).toHaveTextContent('会话已切换，推演中断。');
  });

  it('correction-pill alternative re-delivery appends a new card with the pinned target', async () => {
    const user = userEvent.setup();
    const client = makeClient([
      scriptedStream(echoFrames),
      scriptedStream(stageFrames('备选重投'))
    ]);
    render(<SessionHost client={client} repo={repo} />);

    await user.type(screen.getByTestId('evolve-intent'), '给订单模块加 Excel 导出');
    await user.click(screen.getByTestId('evolve-run'));
    await waitFor(() => expect(screen.getByTestId('evolve-card-done')).toBeInTheDocument());

    await user.click(screen.getByTestId('evolve-alt-ExportService'));
    await waitFor(() => expect(client.evolveStream).toHaveBeenCalledTimes(2));
    expect(client.evolveStream).toHaveBeenLastCalledWith('repo-1', '给订单模块加 Excel 导出', 'ExportService');
    await waitFor(() => expect(screen.getByTestId('evolution-view')).toHaveTextContent('2 张工件卡'));
  });

  it('renders the structured conventionConflict card and recovers', async () => {
    const user = userEvent.setup();
    const conflictFrames: EvolveEvent[] = [
      { type: 'stage', payload: { stage: 'intent_parse', label: '意图解析', status: 'running' } },
      { type: 'stage', payload: { stage: 'intent_parse', label: '意图解析', status: 'done' } },
      { type: 'stage', payload: { stage: 'target_resolve', label: '目标锚定', status: 'running' } },
      { type: 'stage', payload: { stage: 'target_resolve', label: '目标锚定', status: 'done' } },
      { type: 'stage', payload: { stage: 'convention_scan', label: '惯例嗅探', status: 'running' } },
      { type: 'stage', payload: { stage: 'pipeline', label: '演进推演', status: 'running' } },
      {
        type: 'error',
        payload: {
          error: 'Convention conflict on return_wrapping: intent fights the STRICT convention "ApiResult<T>".',
          conventionConflict: {
            axis: 'return_wrapping',
            verdict: 'Controller methods return unified wrapper ApiResult<T>',
            coverage: { match: 5, total: 5 },
            anchors: [{ file: 'src/OrderController.java', line: 12, symbol: 'OrderController.list' }],
            suggestion: 'Return ApiResult<T> from the new handler.'
          }
        }
      }
    ];
    const client = makeClient([scriptedStream(conflictFrames)]);
    render(<SessionHost client={client} repo={repo} />);

    await user.type(screen.getByTestId('evolve-intent'), '给 OrderController 加裸返回');
    await user.click(screen.getByTestId('evolve-run'));

    const conflict = await waitFor(() => screen.getByTestId('evolve-conflict'));
    expect(conflict).toHaveTextContent('return_wrapping');
    expect(conflict).toHaveTextContent('5/5');
    expect(conflict).toHaveTextContent('Return ApiResult<T> from the new handler.');
    expect(screen.queryByTestId('evolve-placement')).not.toBeInTheDocument();
    expect(screen.getByTestId('evolve-card-failed')).toBeInTheDocument();

    // Stream finished — typing a corrective intent re-enables the run button.
    expect(screen.getByTestId('evolve-run')).toBeDisabled();
    await user.type(screen.getByTestId('evolve-intent'), '改回 ApiResult 包装再重投');
    expect(screen.getByTestId('evolve-run')).toBeEnabled();
  });

  it('lists the DEPRECATE dead-code cascade with source anchors', async () => {
    const user = userEvent.setup();
    const deprecateResult: ModuleEvolutionResult = {
      ...extendResult,
      intentType: 'DEPRECATE',
      placement: undefined,
      risks: [],
      blastRadius: {
        impactedCallersCount: 0,
        impactedRoutes: [],
        impactedComponents: [],
        orphanedSymbols: [
          { name: 'OrderRepository.findAll', filePath: 'src/main/java/com/demo/order/OrderRepository.java', line: 9 }
        ]
      }
    };
    const frames: EvolveEvent[] = [
      { type: 'stage', payload: { stage: 'intent_parse', label: '意图解析', status: 'running' } },
      { type: 'stage', payload: { stage: 'intent_parse', label: '意图解析', status: 'done' } },
      { type: 'stage', payload: { stage: 'target_resolve', label: '目标锚定', status: 'running' } },
      { type: 'stage', payload: { stage: 'target_resolve', label: '目标锚定', status: 'done' } },
      { type: 'stage', payload: { stage: 'convention_scan', label: '惯例嗅探', status: 'running' } },
      { type: 'stage', payload: { stage: 'pipeline', label: '演进推演', status: 'running' } },
      { type: 'stage', payload: { stage: 'convention_scan', label: '惯例嗅探', status: 'done' } },
      { type: 'stage', payload: { stage: 'pipeline', label: '演进推演', status: 'done' } },
      { type: 'stage', payload: { stage: 'diagram', label: '图谱投射', status: 'running' } },
      { type: 'stage', payload: { stage: 'diagram', label: '图谱投射', status: 'done' } },
      {
        type: 'done',
        payload: {
          intentEcho: {
            intentType: 'DEPRECATE',
            rawKeyword: '订单',
            resolvedTarget: 'OrderRepository',
            alternatives: [{ symbol: 'OrderRepository', score: 90 }],
            parsedBy: 'fallback'
          },
          result: deprecateResult,
          commit: 'abc1234'
        }
      }
    ];
    const onNavigate = vi.fn();
    const client = makeClient([scriptedStream(frames)]);
    render(<SessionHost client={client} repo={repo} onNavigate={onNavigate} />);

    await user.type(screen.getByTestId('evolve-intent'), '下线订单模块');
    await user.click(screen.getByTestId('evolve-run'));

    const dead = await waitFor(() => screen.getByTestId('evolve-deadcode'));
    expect(dead).toHaveTextContent('OrderRepository.findAll');
    expect(screen.queryByTestId('evolve-placement')).not.toBeInTheDocument();

    await user.click(screen.getByText('src/main/java/com/demo/order/OrderRepository.java:9'));
    expect(onNavigate).toHaveBeenCalledWith(
      'src/main/java/com/demo/order/OrderRepository.java:9',
      9
    );
  });

  it('collapses and re-expands a history card on toggle', async () => {
    const user = userEvent.setup();
    const client = makeClient([
      scriptedStream(echoFrames),
      scriptedStream(stageFrames('影响面推演'))
    ]);
    render(<SessionHost client={client} repo={repo} />);

    await user.type(screen.getByTestId('evolve-intent'), '给订单模块加 Excel 导出');
    await user.click(screen.getByTestId('evolve-run'));
    await waitFor(() => expect(screen.getByTestId('evolve-card-done')).toBeInTheDocument());

    await user.type(screen.getByTestId('evolve-intent'), '排查影响面');
    await user.click(screen.getByTestId('evolve-run'));
    await waitFor(() => expect(screen.getByTestId('evolution-view')).toHaveTextContent('2 张工件卡'));
    expect(screen.getAllByTestId('evolve-placement')).toHaveLength(1);

    // Re-open the history card — now both artifact sets are on screen.
    const toggleOf = (index: number) => screen.getAllByTestId('evolve-card-toggle')[index];
    await user.click(toggleOf(0));
    expect(screen.getAllByTestId('evolve-placement')).toHaveLength(2);

    // Collapse it again.
    await user.click(toggleOf(0));
    expect(screen.getAllByTestId('evolve-placement')).toHaveLength(1);
  });

  it('shows the empty state without a repo', () => {
    const client = makeClient([]);
    render(<SessionHost client={client} repo={null} />);
    expect(screen.getByTestId('evolution-empty')).toBeInTheDocument();
  });
});
