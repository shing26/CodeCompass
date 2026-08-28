import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Canvas } from './Canvas';
import type { ChatMessage } from '../hooks/useChat';
import type { Anchor } from '../types';
import type { Repo } from '../types';

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

const anchors: Anchor[] = [
  { symbol: 'listOrders', file: 'src/OrderController.java', line: 10 },
  { symbol: 'createOrder', file: 'src/OrderService.java', line: 20 },
  { symbol: 'insertOrder', file: 'src/OrderMapper.xml', line: 5 }
];

const traceMessage: ChatMessage = {
  id: 'msg-1',
  role: 'assistant',
  text: 'trace',
  status: 'done',
  anchors
};

function renderCanvas(props: Partial<Parameters<typeof Canvas>[0]> = {}) {
  return render(
    <Canvas
      repo={readyRepo}
      messages={[]}
      streaming={false}
      reconnecting={false}
      recovered={false}
      error={null}
      totalUsage={{ input: 0, output: 0, total: 0, source: 'estimate' }}
      onSubmit={() => {}}
      onRetry={() => {}}
      {...props}
    />
  );
}

describe('Canvas deep links (v0.8)', () => {
  it('shows the deep-link focus banner with symbol and trace id', () => {
    renderCanvas({ deepLinkFocus: 'createOrder', deepLinkTraceId: 'dg-abc123' });
    const banner = screen.getByTestId('deeplink-focus');
    expect(banner).toHaveTextContent('createOrder');
    expect(banner).toHaveTextContent('dg-abc123');
  });

  it('omits the banner without deep-link params', () => {
    renderCanvas();
    expect(screen.queryByTestId('deeplink-focus')).not.toBeInTheDocument();
  });

  it('flashes the flow card matching the focused symbol', () => {
    vi.useFakeTimers();
    renderCanvas({
      messages: [traceMessage],
      deepLinkFocus: 'createOrder',
      deepLinkTraceId: 'dg-abc123'
    });
    const cards = screen.getAllByTestId('flow-card');
    expect(cards).toHaveLength(3);
    expect(cards[1].className).toContain('focus-flash');
    // The last card never flashes: the first card flashes via the v0.7
    // trace-start highlight and the second via the deep-link focus.
    expect(cards[2].className).not.toContain('focus-flash');
    vi.useRealTimers();
  });

  it('does not flash beyond the trace-start card when no deep-link focus is present', () => {
    renderCanvas({ messages: [traceMessage] });
    const cards = screen.getAllByTestId('flow-card');
    expect(cards[0].className).toContain('focus-flash'); // v0.7 trace-start
    expect(cards[1].className).not.toContain('focus-flash');
    expect(cards[2].className).not.toContain('focus-flash');
  });
});
