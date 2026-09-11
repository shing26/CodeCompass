import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Canvas } from './Canvas';
import type { Anchor, Repo } from '../types';

vi.mock('../client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async () => '<svg />')
}));

const readyRepo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  localPath: 'C:/projects/spring-petclinic',
  branch: 'main',
  status: 'ready',
  fileCount: 1,
  symbolCount: 1,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
};

function renderCanvas(props: Partial<Parameters<typeof Canvas>[0]> = {}) {
  return render(<Canvas repo={readyRepo} {...props} />);
}

describe('Canvas offline UX (Issue 18)', () => {
  it('shows the offline-mode hint with a repo loaded', () => {
    renderCanvas();
    expect(screen.getByTestId('offline-hint')).toBeInTheDocument();
  });

  it('renders the pinned back-to-dashboard entry and invokes the callback', async () => {
    const user = userEvent.setup();
    const onBackToDashboard = vi.fn();
    renderCanvas({ onBackToDashboard });

    const back = screen.getByTestId('canvas-back-to-dashboard');
    expect(back).toBeInTheDocument();
    await user.click(back);
    expect(onBackToDashboard).toHaveBeenCalledTimes(1);
  });

  it('omits the pinned entry when no callback is given', () => {
    renderCanvas();
    expect(screen.queryByTestId('canvas-back-to-dashboard')).not.toBeInTheDocument();
  });

  it('does not show the hint before a repo is connected', () => {
    renderCanvas({ repo: null });
    expect(screen.queryByTestId('offline-hint')).not.toBeInTheDocument();
  });
});

describe('Canvas onboarding copy (ticket 15, QA-06)', () => {
  it('names only current controls: Import repo/+ forms and the six real tab labels', () => {
    renderCanvas({ repo: null });
    const guide = screen.getByTestId('empty-state');
    // 导入入口：桌面/窄屏两形态均有交代
    expect(guide).toHaveTextContent('Import repo');
    expect(guide).toHaveTextContent('窄屏为「+」');
    // 视图名 = 现行六枚 tab 名
    expect(guide).toHaveTextContent('架构仪表盘');
    expect(guide).toHaveTextContent('架构问答');
    expect(guide).toHaveTextContent('变更审计');
    expect(guide).toHaveTextContent('Diff 影响面');
    expect(guide).toHaveTextContent('规范演进');
    // 8ac9bea 轮改名漏网的旧控件名不再出现（分写=copy-guard 封条自豁免）
    expect(guide.textContent).not.toContain('架构' + '指标');
    expect(guide.textContent).not.toContain('智能体' + '对话');
    expect(guide.textContent).not.toContain('对话页');
  });

  it('② uses the 两动词前置结构 with the read-only bottom line (v0.26-A ticket 01)', () => {
    renderCanvas({ repo: null });
    const text = screen.getByTestId('empty-state').textContent ?? '';
    // 存在性先行（review P1-3：indexOf 缺失返回 -1 会恒小于，动词退场时空过）
    expect(text).toContain('要方案');
    expect(text).toContain('问现状');
    // 动词前置：「要方案」紧邻其入口名之前、「问现状」亦然——新人 10 秒选对入口
    expect(text.indexOf('要方案')).toBeLessThan(text.indexOf('规范演进'));
    expect(text.indexOf('问现状')).toBeLessThan(text.indexOf('架构问答'));
    expect(text.indexOf('要方案')).toBeLessThan(text.indexOf('问现状')); // spec 清单 6 顺序
    // 底线声明随动词常驻；退场的旧收尾不再出现
    expect(text).toContain('引擎只读');
    expect(text).not.toContain('演进推演');
  });
});

describe('Canvas topology flow cards (Issue 31)', () => {
  const anchors: Anchor[] = [
    { file: 'src/main/java/OrderController.java', line: 10, symbol: 'listOrders' },
    { file: 'src/main/java/OrderService.java', line: 20, symbol: 'findOrders' },
    { file: 'src/main/resources/OrderMapper.xml', line: 30, symbol: 'findAll' }
  ];

  it('renders Caller/Target/Callee cards from the latest trace anchors', () => {
    renderCanvas({ anchors });

    expect(screen.getAllByTestId('flow-card')).toHaveLength(3);
    expect(screen.getByTestId('selected-node')).toHaveTextContent('listOrders');
    expect(screen.getByTestId('affected-count')).toHaveTextContent('3 波及');
    expect(screen.getAllByTestId('flow-arrow')).toHaveLength(2);
    expect(screen.getByText('Caller')).toBeInTheDocument();
    expect(screen.getByText('Callee')).toBeInTheDocument();
  });

  it('falls back to the repo name and the skeleton before a trace resolves', () => {
    renderCanvas();
    expect(screen.getByTestId('selected-node')).toHaveTextContent('petclinic');
    expect(screen.getByTestId('flow-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('flow-card')).not.toBeInTheDocument();
  });
});

describe('Canvas Top API focus flash (v0.7 issue 12)', () => {
  it('flashes the start flow card once when a trace lands', () => {
    renderCanvas({
      anchors: [
        { file: 'src/main/java/OrderController.java', line: 10, symbol: 'listOrders' },
        { file: 'src/main/java/OrderService.java', line: 20, symbol: 'findOrders' }
      ]
    });
    const cards = screen.getAllByTestId('flow-card');
    expect(cards[0].className).toContain('focus-flash');
    expect(cards[1].className).not.toContain('focus-flash');
  });
});

describe('Canvas external focus request (v0.11 Stage 3)', () => {
  it('flashes the flow card matching the requested symbol', () => {
    renderCanvas({
      anchors: [
        { file: 'src/main/java/OrderController.java', line: 10, symbol: 'listOrders' },
        { file: 'src/main/java/OrderService.java', line: 20, symbol: 'findOrders' }
      ],
      focusRequest: { symbol: 'findOrders', requestId: 1 }
    });
    const cards = screen.getAllByTestId('flow-card');
    expect(cards[0].className).not.toContain('focus-flash');
    expect(cards[1].className).toContain('focus-flash');
  });
});

describe('Canvas live trace strip (v0.11 Stage 4)', () => {
  it('hides the strip when no trace steps are given', () => {
    renderCanvas({ anchors: [{ file: 'A.java', line: 1, symbol: 'a' }] });
    expect(screen.queryByTestId('trace-strip')).not.toBeInTheDocument();
  });

  it('steps through trace steps and navigates the Inspector', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderCanvas({
      anchors: [{ file: 'A.java', line: 1, symbol: 'a' }],
      traceSteps: [
        { file: 'src/main/java/Controller.java', line: 10, symbol: 'listOrders', status: 'VERIFIED' },
        {
          file: 'src/main/java/Service.java',
          line: 20,
          symbol: 'findOrders',
          status: 'VERIFIED',
          httpMethod: 'GET'
        },
        { file: 'src/main/java/Mapper.java', line: 30, symbol: 'findAll', status: 'BROKEN' }
      ],
      onNavigate
    });

    const strip = screen.getByTestId('trace-strip');
    expect(strip).toBeInTheDocument();
    // Starts at step 1 of 3.
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('Step 1/3');

    await user.click(screen.getByTestId('trace-step-next'));
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('Step 2/3');
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('GET');
    expect(onNavigate).toHaveBeenLastCalledWith('src/main/java/Service.java', 20, undefined, 'findOrders');

    await user.click(screen.getByTestId('trace-step-next'));
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('Step 3/3');
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('BROKEN');
    expect(onNavigate).toHaveBeenLastCalledWith('src/main/java/Mapper.java', 30, undefined, 'findAll');

    // The Next button is disabled at the final step.
    expect(screen.getByTestId('trace-step-next')).toBeDisabled();

    await user.click(screen.getByTestId('trace-step-prev'));
    expect(screen.getByTestId('trace-step-label')).toHaveTextContent('Step 2/3');
  });
});
