import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TourPlayer } from './TourPlayer';
import type { RepoTour } from '../types';

vi.mock('../client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async (_uid: string) => '<svg id="tour"><text>OrderController</text></svg>')
}));

const tour: RepoTour = {
  id: 'main-flow',
  title: 'Follow the core business flow',
  description: '主业务流全链（控制器 → 服务 → 仓储）',
  steps: [
    {
      step: '1. listOrders（订单列表入口）',
      filePath: 'src/main/java/OrderController.java',
      lineNumber: 24,
      symbol: 'listOrders',
      kind: 'method'
    },
    {
      step: '2. findOrders（订单查询服务）',
      filePath: 'src/main/java/OrderService.java',
      lineNumber: 40,
      symbol: 'findOrders',
      kind: 'method'
    }
  ],
  mermaid: 'flowchart LR\n  OrderController --> OrderService'
};

describe('TourPlayer (issue 13)', () => {
  it('auto-opens the first step and shows progress', async () => {
    const onNavigate = vi.fn();
    render(<TourPlayer tour={tour} onNavigate={onNavigate} onBack={() => {}} />);
    expect(onNavigate).toHaveBeenCalledWith('src/main/java/OrderController.java', 24);
    expect(screen.getByTestId('tour-progress')).toHaveTextContent('Step 1 / 2');
    expect(screen.getByTestId('tour-player')).toHaveTextContent('Follow the core business flow');
    expect(screen.getByTestId('tour-prev')).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
  });

  it('navigates to a step when clicked and updates the progress', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<TourPlayer tour={tour} onNavigate={onNavigate} onBack={() => {}} />);
    await user.click(screen.getAllByTestId('tour-step')[1]);
    expect(onNavigate).toHaveBeenLastCalledWith('src/main/java/OrderService.java', 40);
    expect(screen.getByTestId('tour-progress')).toHaveTextContent('Step 2 / 2');
  });

  it('steps forward and backward with the footer buttons', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<TourPlayer tour={tour} onNavigate={onNavigate} onBack={() => {}} />);
    await user.click(screen.getByTestId('tour-next'));
    expect(screen.getByTestId('tour-progress')).toHaveTextContent('Step 2 / 2');
    expect(screen.getByTestId('tour-done')).toBeInTheDocument();
    await user.click(screen.getByTestId('tour-prev'));
    expect(screen.getByTestId('tour-progress')).toHaveTextContent('Step 1 / 2');
    expect(screen.getByTestId('tour-next')).toBeInTheDocument();
  });

  it('returns to the dashboard via 返回看板 or 完成', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<TourPlayer tour={tour} onNavigate={() => {}} onBack={onBack} />);
    await user.click(screen.getByTestId('tour-back'));
    expect(onBack).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('tour-next'));
    await user.click(screen.getByTestId('tour-done'));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('shows a static-analysis break note for the active step', async () => {
    const tourWithNote: RepoTour = {
      ...tour,
      steps: [
        {
          step: '1. onlyRepo.find（动态分发）',
          filePath: 'src/main/java/OnlyRepository.java',
          lineNumber: 7,
          symbol: 'find',
          kind: 'method',
          note: '动态/RPC 分发无法静态绑定，调用链在此中断'
        }
      ]
    };
    render(<TourPlayer tour={tourWithNote} onNavigate={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    expect(screen.getByTestId('tour-step-note')).toHaveTextContent('无法静态绑定');
  });
});