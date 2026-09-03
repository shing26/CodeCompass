import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EvolutionView } from './EvolutionView';
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
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
};

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

const echoFrames: EvolveEvent[] = [
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
        alternatives: [],
        parsedBy: 'fallback'
      }
    }
  },
  { type: 'stage', payload: { stage: 'target_resolve', label: '目标锚定', status: 'running' } },
  {
    type: 'stage',
    payload: {
      stage: 'target_resolve',
      label: '目标锚定',
      status: 'done',
      intentEcho: {
        intentType: 'EXTEND',
        rawKeyword: '订单',
        extensionGoal: 'Excel 导出',
        resolvedTarget: 'OrderService.create',
        alternatives: [
          { symbol: 'OrderService.create', score: 78 },
          { symbol: 'ExportService', score: 62 },
          { symbol: 'ReportHandler', score: 55 }
        ],
        parsedBy: 'fallback'
      }
    }
  },
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
        intentType: 'EXTEND',
        rawKeyword: '订单',
        extensionGoal: 'Excel 导出',
        resolvedTarget: 'OrderService.create',
        alternatives: [
          { symbol: 'OrderService.create', score: 78 },
          { symbol: 'ExportService', score: 62 },
          { symbol: 'ReportHandler', score: 55 }
        ],
        parsedBy: 'fallback'
      },
      result: extendResult,
      mermaid: 'flowchart LR\n  OrderService.create --> OrderRepository.save',
      commit: 'abc1234'
    }
  }
];

/** Replay a scripted frame list on connect(), then finish. */
function scriptedStream(frames: EvolveEvent[]): EvolveStreamLike {
  let onFrame: ((event: EvolveEvent) => void) | undefined;
  let onDone: (() => void) | undefined;
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
      for (const frame of frames) onFrame?.(frame);
      onDone?.();
    },
    close: () => undefined
  };
}

function makeClient(streams: EvolveStreamLike[]) {
  return {
    evolveStream: vi.fn(() => streams.shift() ?? scriptedStream([]))
  };
}

describe('EvolutionView (Issue 24 / Ticket 04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams the stages, echoes the anchored target and renders the artifact cards', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const client = makeClient([scriptedStream(echoFrames)]);
    render(<EvolutionView repo={repo} client={client} onNavigate={onNavigate} />);

    await user.type(screen.getByTestId('evolve-intent'), '给订单模块加 Excel 导出');
    await user.click(screen.getByTestId('evolve-run'));

    // Intent echo + Correction Pill: anchored target with match score.
    await waitFor(() => expect(screen.getByTestId('evolve-target-pill')).toHaveTextContent('OrderService.create'));
    expect(screen.getByTestId('evolve-echo')).toHaveTextContent('EXTEND');
    expect(screen.getByTestId('evolve-echo-parsedby')).toHaveTextContent('确定性解析');
    expect(screen.getByTestId('evolve-echo')).toHaveTextContent('78%');

    // Five stage chips all reach done.
    const stages = screen.getByTestId('evolve-stages');
    expect(stages).toHaveTextContent('意图解析');
    expect(stages).toHaveTextContent('图谱投射');
    expect(stages.textContent).toContain('✓');

    // Convention manifest card: STRICT coverage + divergent sample anchor.
    expect(screen.getByTestId('evolve-conventions')).toHaveTextContent('5/5');
    expect(screen.getByTestId('evolve-axis-return_wrapping')).toHaveTextContent('return_wrapping');

    // Placement card: file path, injection style, handler signature.
    const placement = screen.getByTestId('evolve-placement');
    expect(placement).toHaveTextContent('OrderExportService.java');
    expect(placement).toHaveTextContent('constructor');
    expect(placement).toHaveTextContent('public ApiResult<String> export(Order order)');

    // Risk card: transaction decoupling warning.
    expect(screen.getByTestId('evolve-risks')).toHaveTextContent('事务解耦');

    // Checklist + engine diagram.
    expect(screen.getByTestId('evolve-checklists')).toHaveTextContent('OrderExportService.java');
    expect(screen.getByTestId('evolve-diagram')).toBeInTheDocument();

    // Placement file click deep-links into the Inspector.
    await user.click(screen.getAllByText('src/main/java/com/demo/order/OrderExportService.java')[0]);
    expect(onNavigate).toHaveBeenCalledWith('src/main/java/com/demo/order/OrderExportService.java', 1);

    // Correction Pill switch: clicking an alternative re-submits with a pinned target.
    await user.click(screen.getByTestId('evolve-alt-ExportService'));
    await waitFor(() => expect(client.evolveStream).toHaveBeenCalledTimes(2));
    expect(client.evolveStream).toHaveBeenLastCalledWith('repo-1', '给订单模块加 Excel 导出', 'ExportService');
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
    const onNavigate = vi.fn();
    const client = makeClient([scriptedStream(conflictFrames)]);
    render(<EvolutionView repo={repo} client={client} onNavigate={onNavigate} />);

    await user.type(screen.getByTestId('evolve-intent'), '给 OrderController 加裸返回');
    await user.click(screen.getByTestId('evolve-run'));

    const conflict = await waitFor(() => screen.getByTestId('evolve-conflict'));
    expect(conflict).toHaveTextContent('return_wrapping');
    expect(conflict).toHaveTextContent('5/5');
    expect(conflict).toHaveTextContent('Return ApiResult<T> from the new handler.');
    expect(screen.queryByTestId('evolve-placement')).not.toBeInTheDocument();

    // The conflict anchor deep-links into the Inspector.
    await user.click(screen.getByText('src/OrderController.java:12'));
    expect(onNavigate).toHaveBeenCalledWith('src/OrderController.java:12', 12);

    // Stream finished — the run button is re-enabled for a corrected re-submit.
    await waitFor(() => expect(screen.getByTestId('evolve-run')).toBeEnabled());
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
    render(<EvolutionView repo={repo} client={client} onNavigate={onNavigate} />);

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

  it('shows the empty state without a repo', () => {
    const client = makeClient([]);
    render(<EvolutionView repo={null} client={client} />);
    expect(screen.getByTestId('evolution-empty')).toBeInTheDocument();
  });
});
