import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SnippetView } from './SnippetView';
import type { RepoQAClient } from '../client/RepoQAClient';
import type { SnippetGraph } from '../types';

vi.mock('../client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async () => '<svg />')
}));

const graph: SnippetGraph = {
  nodes: [
    { id: 's0', name: 'loadUser', kind: 'method', file: 'auth.ts', line: 1, lineEnd: 4, inDegree: 0, outDegree: 2 },
    { id: 's1', name: 'fetchUser', kind: 'method', file: 'auth.ts', line: 6, lineEnd: 8, inDegree: 1, outDegree: 1 },
    { id: 's2', name: 'normalize', kind: 'method', file: 'auth.ts', line: 10, lineEnd: 12, inDegree: 2, outDegree: 0 }
  ],
  edges: [
    { from: 's0', to: 's1', line: 2 },
    { from: 's1', to: 's2', line: 7 }
  ],
  breaks: { external: 1, unresolved: 0, dynamic: 1, total: 2 },
  stats: { symbols: 3, edges: 2, truncated: false, droppedNodes: 0 },
  mermaid: 'flowchart LR\n  s0["loadUser · L1"] --> s1["fetchUser · L6"]'
};

function fakeClient(overrides: Partial<RepoQAClient> = {}): RepoQAClient {
  return {
    analyzeSnippet: vi.fn().mockResolvedValue(graph),
    ...overrides
  } as unknown as RepoQAClient;
}

describe('SnippetView (v1.4 ticket 02)', () => {
  it('parses the pasted source and renders the graph, list and break counts', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    render(<SnippetView client={client} />);
    await user.click(screen.getByTestId('snippet-analyze'));
    await waitFor(() => expect(client.analyzeSnippet).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('snippet-stats')).toHaveTextContent('3 个符号');
    expect(screen.getByTestId('snippet-stats')).toHaveTextContent('片段外 1');
    expect(screen.getByTestId('snippet-stats')).toHaveTextContent('动态派发 1');
    const list = screen.getByTestId('snippet-function-list');
    expect(list).toHaveTextContent('loadUser');
    expect(list).toHaveTextContent('入 2 / 出 0');
    await waitFor(() => expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument());
  });

  it('passes the optional file name through to the client', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    render(<SnippetView client={client} />);
    await user.type(screen.getByTestId('snippet-filename'), 'auth.ts');
    await user.click(screen.getByTestId('snippet-analyze'));
    await waitFor(() =>
      expect(client.analyzeSnippet).toHaveBeenCalledWith(expect.any(String), 'auth.ts')
    );
  });

  it('shows the failure message instead of a stale graph', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      analyzeSnippet: vi.fn().mockRejectedValue(new Error('analyzeSnippet failed: 400: source is required'))
    } as unknown as Partial<RepoQAClient>);
    render(<SnippetView client={client} />);
    await user.click(screen.getByTestId('snippet-analyze'));
    await waitFor(() => expect(screen.getByTestId('snippet-error')).toBeInTheDocument());
    expect(screen.queryByTestId('snippet-stats')).not.toBeInTheDocument();
  });
});
