import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildSubgraphMermaid, SubgraphPanel } from './SubgraphPanel';
import type { SubgraphContextResult } from '../types';

vi.mock('../client/mermaidRenderer', () => ({
  // v1.4 票 04 — render the labels the code actually declares so node-click
  // routing (label→binding lookup + re-center) is exercisable in jsdom.
  renderMermaid: vi.fn(async (_uid: string, code: string) => {
    const labels = [...code.matchAll(/([A-Za-z_][\w]*)\["([^"]+)"\]/g)].map((match) => match[2]);
    return (
      '<svg>' +
      labels
        .map((label) => `<g class="node"><text class="label">${label}</text></g>`)
        .join('') +
      '</svg>'
    );
  })
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
    expect(screen.getByTestId('inspector-subgraph')).toHaveTextContent('调用方 1');
    expect(screen.getByTestId('inspector-subgraph')).toHaveTextContent('被调方 2');
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

describe('SubgraphPanel focus mode (v1.4 ticket 04)', () => {
  const depths = { up: 1, down: 1 };

  it('shows the center, defaults to 1/1 depths, and reports depth changes', async () => {
    const user = userEvent.setup();
    const onDepthsChange = vi.fn();
    render(
      <SubgraphPanel
        state={{ result, loading: false, error: null }}
        focusName="addOwner"
        depths={depths}
        onDepthsChange={onDepthsChange}
      />
    );
    expect(screen.getByTestId('subgraph-center')).toHaveTextContent('中心：addOwner');
    expect(screen.getByTestId('subgraph-depth-up')).toHaveValue('1');
    expect(screen.getByTestId('subgraph-depth-down')).toHaveValue('1');
    await user.selectOptions(screen.getByTestId('subgraph-depth-down'), '3');
    expect(onDepthsChange).toHaveBeenCalledWith({ up: 1, down: 3 });
    expect(screen.getByTestId('subgraph-back')).toBeDisabled();
  });

  it('re-centers on a node click and walks back through visited centers', async () => {
    const user = userEvent.setup();
    const onRecenter = vi.fn();
    const { rerender } = render(
      <SubgraphPanel
        state={{ result, loading: false, error: null }}
        focusName="addOwner"
        depths={depths}
        onRecenter={onRecenter}
      />
    );
    await waitFor(() => expect(screen.getByText('OwnerRepository.save · d1')).toBeInTheDocument());
    await user.click(screen.getByText('OwnerRepository.save · d1'));
    expect(onRecenter).toHaveBeenCalledWith(
      'OwnerRepository.save',
      'src/OwnerRepository.java',
      55
    );

    // Parent applies the re-center: new focus arrives with a matching result.
    const focused: SubgraphContextResult = {
      ...result,
      start: { name: 'OwnerRepository.save', file: 'src/OwnerRepository.java', line: 55 },
      nodes: [
        { name: 'OwnerRepository.save', file: 'src/OwnerRepository.java', line: 55, distance: 0, direction: 'start', tokens: 90 },
        { name: 'addOwner', file: 'src/OwnerController.java', line: 30, distance: 1, direction: 'caller', tokens: 100 }
      ]
    };
    rerender(
      <SubgraphPanel
        state={{ result: focused, loading: false, error: null }}
        focusName="OwnerRepository.save"
        depths={depths}
        onRecenter={onRecenter}
      />
    );
    expect(screen.getByTestId('subgraph-center')).toHaveTextContent('中心：OwnerRepository.save');
    const back = screen.getByTestId('subgraph-back');
    expect(back).toBeEnabled();
    await user.click(back);
    // Walks back to the previous center; its file/line come from the graph.
    expect(onRecenter).toHaveBeenLastCalledWith('addOwner', 'src/OwnerController.java', 30);
  });

  it('clears the back-trail when the center changes from elsewhere', async () => {
    const user = userEvent.setup();
    const onRecenter = vi.fn();
    const { rerender } = render(
      <SubgraphPanel
        state={{ result, loading: false, error: null }}
        focusName="addOwner"
        depths={depths}
        onRecenter={onRecenter}
      />
    );
    await waitFor(() => expect(screen.getByText('OwnerRepository.save · d1')).toBeInTheDocument());
    await user.click(screen.getByText('OwnerRepository.save · d1'));
    rerender(
      <SubgraphPanel
        state={{ result, loading: false, error: null }}
        focusName="OwnerRepository.save"
        depths={depths}
        onRecenter={onRecenter}
      />
    );
    expect(screen.getByTestId('subgraph-back')).toBeEnabled();
    // A sidebar/palette selection (not this panel) must not inherit the trail.
    rerender(
      <SubgraphPanel
        state={{ result, loading: false, error: null }}
        focusName="OwnerUi.openForm"
        depths={depths}
        onRecenter={onRecenter}
      />
    );
    expect(screen.getByTestId('subgraph-back')).toBeDisabled();
  });

  it('surfaces backend budget pruning instead of hiding it', async () => {
    const pruned: SubgraphContextResult = { ...result, truncated: true, prunedCount: 12 };
    render(<SubgraphPanel state={{ result: pruned, loading: false, error: null }} />);
    expect(screen.getByTestId('subgraph-pruned')).toHaveTextContent('另有 12 个节点因上下文预算未入图');
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
  });
});
