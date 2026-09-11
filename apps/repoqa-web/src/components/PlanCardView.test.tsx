import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanCardView } from './PlanCardView';
import type { ChatPlanCard } from '../client/RepoQAClient';

const cards: ChatPlanCard[] = [
  {
    intentType: 'DEPRECATE',
    target: 'LegacyOrderService',
    riskLevel: 'HIGH',
    items: [
      { category: '调用方迁移', action: 'REPLACE', filePath: 'src/api/OrderApi.java', description: '改用 OrderServiceV2' },
      { category: '删除清单', action: 'DELETE', filePath: 'src/service/LegacyOrderService.java', description: '零调用方确认后删除' }
    ]
  }
];

describe('PlanCardView (v0.26-A ticket 02, Q3 方案摘要)', () => {
  it('titles the card 方案摘要 and pins the read-only bottom line in the header', () => {
    render(<PlanCardView cards={cards} sessionId="s-t1" />);
    const head = document.querySelector('.plan-card-head');
    expect(head).toHaveTextContent('方案摘要');
    expect(head).toHaveTextContent('DEPRECATE');
    expect(head).toHaveTextContent('LegacyOrderService');
    // 旧名退场（Q3/黑名单）
    expect(document.querySelector('.plan-card')?.textContent).not.toContain('拆除计划');
    // 底线句常驻头部行：直接可见文本，非 <details> 折叠
    const line = screen.getByTestId('plan-bottomline');
    expect(line).toHaveTextContent('引擎只读，改动由你执行');
    expect(line.closest('details')).toBeNull();
  });

  it('renders the CTA only with a callback, and it jumps to the evolution workbench', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PlanCardView cards={cards} sessionId="s-t2a" />);
    // 无回调（ChatView 独立测试等既有渲染点）→ CTA 不渲染
    expect(screen.queryByTestId('plan-open-evolution')).not.toBeInTheDocument();
    unmount();

    const onOpenEvolution = vi.fn();
    render(<PlanCardView cards={cards} sessionId="s-t2b" onOpenEvolution={onOpenEvolution} />);
    await user.click(screen.getByTestId('plan-open-evolution'));
    expect(onOpenEvolution).toHaveBeenCalledTimes(1);
  });

  it('keeps checkbox local tracking: toggle marks done and persists to localStorage (CM-04 行为不变)', () => {
    const key = `0:src/api/OrderApi.java:REPLACE`;
    localStorage.removeItem(`chat-plan-checks:s-t3`);
    render(<PlanCardView cards={cards} sessionId="s-t3" />);
    const box = screen.getAllByRole('checkbox')[0];
    expect(box).not.toBeChecked();

    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(box.closest('label')).toHaveClass('done');
    expect(JSON.parse(localStorage.getItem(`chat-plan-checks:s-t3`) ?? '[]')).toEqual([key]);
    // 进度徽标跟进 1/2
    expect(document.querySelector('.plan-progress')).toHaveTextContent('1/2');
  });
});
