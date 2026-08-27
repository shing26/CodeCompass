import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildSubgraphMermaid, SubgraphPanel } from './SubgraphPanel';
import type { SubgraphContextResult } from '../types';

vi.mock('../client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async () => '<svg />')
}));

const result: SubgraphContextResult = {
  start: { name: 'addOwner', file: 'src/OwnerController.java', line: 30 },
  nodes: [
    { name: 'addOwner', file: 'src/OwnerController.java', line: 30, distance: 0, direction: 'start', tokens: 100 },
    { name: 'OwnerUi.openForm', file: 'src/OwnerUi.java', line: 12, distance: 1, direction: 'caller', tokens: 80 },
    { name: 'OwnerRepository.save', file: 'src/OwnerRepository.java', line: 55, distance: 1, direction: 'callee', tokens: 90 },
    { name: 'SqlSession.insert', file: 'src/SqlSession.java', line: 7, distance: 2, direction: 'callee', tokens: 70 }
  ],
  tokenCount: 340,
  truncated: false,
  prunedCount: 0,
  text: 'agent context'
};

describe('buildSubgraphMermaid', () => {
  it('keeps the start node and both directions in the all view', () => {
    const code = buildSubgraphMermaid(result.nodes, 'all');
    expect(code).toContain('flowchart LR');
    expect(code).toContain('-->');
    expect(code.match(/-->/g)?.length).toBe(3);
    expect(code).toContain('code://src/OwnerRepository.java#55');
  });

  it('drops the opposite direction while keeping start', () => {
    const callers = buildSubgraphMermaid(result.nodes, 'caller');
    expect(callers.match(/-->/g)?.length).toBe(1);
    expect(callers).toContain('OwnerUi.openForm');

    const callees = buildSubgraphMermaid(result.nodes, 'callee');
    expect(callees.match(/-->/g)?.length).toBe(2);
    expect(callees).not.toContain('OwnerUi.openForm');
  });
});

describe('SubgraphPanel (v0.6 closeout)', () => {
  it('shows loading, then the diagram with direction legend counts', async () => {
    const { rerender } = render(
      <SubgraphPanel state={{ result: null, loading: true, error: null }} />
    );
    expect(screen.getByTestId('subgraph-loading')).toBeInTheDocument();

    rerender(<SubgraphPanel state={{ result, loading: false, error: null }} />);
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
    expect(screen.getByTestId('inspector-subgraph')).toHaveTextContent('Caller 1');
    expect(screen.getByTestId('inspector-subgraph')).toHaveTextContent('Callee 2');
  });

  it('filters spokes by direction via the view toggle', async () => {
    const user = userEvent.setup();
    const { renderMermaid } = await import('../client/mermaidRenderer');
    render(<SubgraphPanel state={{ result, loading: false, error: null }} />);
    await waitFor(() => expect(renderMermaid).toHaveBeenCalled());

    await user.click(screen.getByTestId('subgraph-view-caller'));
    await waitFor(() => {
      const code = vi.mocked(renderMermaid).mock.lastCall?.[1] ?? '';
      expect(code).toContain('OwnerUi.openForm');
      expect(code).not.toContain('OwnerRepository.save');
    });

    await user.click(screen.getByTestId('subgraph-view-callee'));
    await waitFor(() => {
      const code = vi.mocked(renderMermaid).mock.lastCall?.[1] ?? '';
      expect(code).toContain('OwnerRepository.save');
      expect(code).not.toContain('OwnerUi.openForm');
    });
  });

  it('shows a per-side empty hint when the filtered direction has no nodes', async () => {
    const user = userEvent.setup();
    const callerless: SubgraphContextResult = {
      ...result,
      nodes: result.nodes.filter((node) => node.direction !== 'caller')
    };
    render(<SubgraphPanel state={{ result: callerless, loading: false, error: null }} />);
    await user.click(screen.getByTestId('subgraph-view-caller'));
    expect(screen.getByTestId('subgraph-side-empty')).toBeInTheDocument();
  });

  it('surfaces a muted error when the symbol cannot be resolved', () => {
    render(
      <SubgraphPanel
        state={{ result: null, loading: false, error: 'getSubgraphContext failed: 400' }}
      />
    );
    expect(screen.getByTestId('subgraph-error')).toHaveTextContent('未定位到可解析符号');
  });

  it('distinguishes transport failures from unresolvable symbols', () => {
    render(
      <SubgraphPanel
        state={{ result: null, loading: false, error: 'getSubgraphContext failed: 0 : network down' }}
      />
    );
    expect(screen.getByTestId('subgraph-error')).toHaveTextContent('暂不可用');
    expect(screen.getByTestId('subgraph-error')).not.toHaveTextContent('未定位到可解析符号');
  });
});
