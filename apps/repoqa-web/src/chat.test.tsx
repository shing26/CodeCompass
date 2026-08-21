import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { RepoQAClient } from './client/RepoQAClient';
import type { QueryStreamLike } from './client/RepoQAClient';
import type { QueryEvent, Repo } from './types';

vi.mock('./client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async () => '<svg id="d"><text>A</text></svg>')
}));

// The Inspector's monaco wiring imports the ESM-only monaco-editor package,
// which vite-node cannot resolve; tests never create a real editor.
vi.mock('./client/monacoSetup', () => ({ monaco: {} }));

// Keep the Inspector's Monaco editor out of jsdom; the integration test below
// asserts the props the wrapper would receive (value/language/path).
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  const MockEditor = (props: {
    value?: string;
    defaultLanguage?: string;
    path?: string;
  }) =>
    React.createElement('div', {
      'data-testid': 'monaco-editor',
      'data-value': props.value,
      'data-language': props.defaultLanguage,
      'data-path': props.path
    });
  return {
    loader: { config: vi.fn() },
    // Inspector imports Editor as the default export.
    default: MockEditor,
    Editor: MockEditor
  };
});

const readyRepo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  repo_url: undefined,
  local_path: 'C:/projects/spring-petclinic',
  branch: 'main',
  status: 'ready',
  file_count: 120,
  symbol_count: 840,
  created_at: '2026-08-21T00:00:00.000Z',
  updated_at: '2026-08-21T00:00:00.000Z'
};

/** Fake SSE stream controlled by the test, satisfying QueryStreamLike. */
class FakeStream implements QueryStreamLike {
  event?: (e: QueryEvent) => void;
  err?: (e: unknown) => void;
  done?: () => void;

  onEvent(fn: (e: QueryEvent) => void) {
    this.event = fn;
    return () => undefined;
  }
  onError(fn: (e: unknown) => void) {
    this.err = fn;
    return () => undefined;
  }
  onDone(fn: () => void) {
    this.done = fn;
    return () => undefined;
  }
  connect() {
    void 0;
  }
  close() {
    void 0;
  }
}

function makeClient(stream?: FakeStream) {
  return {
    listRepos: vi.fn().mockResolvedValue([readyRepo]),
    importRepo: vi.fn().mockResolvedValue(readyRepo),
    getRepo: vi.fn(),
    listSymbols: vi.fn().mockResolvedValue([]),
    getFileRaw: vi.fn(),
    queryRepo: vi.fn().mockReturnValue(stream ?? new FakeStream()),
    baseUrl: 'http://localhost:43110'
  } as unknown as RepoQAClient;
}

async function selectRepo(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
  await user.selectOptions(screen.getByTestId('repo-select'), 'repo-1');
}

describe('chat stream (ticket 02)', () => {
  it('streams token events into an assistant Markdown message until done', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);

    await user.type(screen.getByTestId('chat-input'), 'trace /owners');
    await user.click(screen.getByTestId('chat-submit'));

    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());
    expect(screen.getByTestId('user-message')).toHaveTextContent('trace /owners');

    await act(async () => {
      stream.event?.({ type: 'token', text: '**Business overview:** the request goes through ' });
      stream.event?.({ type: 'token', text: '`OwnerController`.' });
    });
    await waitFor(() =>
      expect(screen.getByText(/the request goes through/)).toBeInTheDocument()
    );
    expect(screen.getByText('OwnerController')).toBeInTheDocument();

    await act(async () => {
      stream.done?.();
    });
    await waitFor(() =>
      expect(screen.queryByTestId('streaming-indicator')).not.toBeInTheDocument()
    );
  });

  it('shows an error state on repository error events and stops streaming', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);

    await user.type(screen.getByTestId('chat-input'), 'who?');
    await user.click(screen.getByTestId('chat-submit'));

    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());
    await act(async () => {
      stream.event?.({ type: 'error', error: 'Static analysis break' });
    });
    await waitFor(() =>
      expect(screen.getByTestId('chat-error')).toHaveTextContent('Static analysis break')
    );
    expect(screen.queryByTestId('streaming-indicator')).not.toBeInTheDocument();
  });

  it('renders a mermaid diagram when the mermaid SSE event arrives', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);

    await user.type(screen.getByTestId('chat-input'), 'architecture');
    await user.click(screen.getByTestId('chat-submit'));

    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());
    await act(async () => {
      stream.event?.({
        type: 'mermaid',
        code: 'flowchart LR\n  A --> B'
      });
      stream.event?.({ type: 'token', text: 'overview' });
      stream.done?.();
    });
    await waitFor(() => expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument());
  });

  it('does not show a query input when no repo is selected (explicit guidance instead)', async () => {
    const client = makeClient();
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.queryByTestId('chat-input')).not.toBeInTheDocument();
    expect(client.queryRepo).not.toHaveBeenCalled();
  });

  it('opens a source trace anchor in the Inspector via onNavigate (ticket 05)', async () => {
    const stream = new FakeStream();
    const client = makeClient(stream);
    client.getFileRaw = vi.fn().mockResolvedValue('public class OwnerController {}');

    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);

    await user.type(screen.getByTestId('chat-input'), 'trace /owners');
    await user.click(screen.getByTestId('chat-submit'));
    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());

    await act(async () => {
      stream.event?.({
        type: 'anchors',
        anchors: [
          { file: 'src/main/java/OwnerController.java', line: 42, symbol: 'OwnerController' }
        ]
      });
      stream.event?.({ type: 'token', text: 'overview' });
      stream.done?.();
    });

    await waitFor(() => expect(screen.getByTestId('anchor-card-0')).toBeInTheDocument());
    await user.click(screen.getByTestId('anchor-card-0'));

    await waitFor(() =>
      expect(client.getFileRaw).toHaveBeenCalledWith(
        'repo-1',
        'src/main/java/OwnerController.java'
      )
    );
    await waitFor(() =>
      expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
        'data-value',
        'public class OwnerController {}'
      )
    );
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute(
      'data-language',
      'java'
    );
    expect(screen.getByTestId('inspector-file')).toHaveTextContent('OwnerController.java');
  });
});

describe('staged reveal, micro-win and off-ramp (ticket 06)', () => {
  it('reveals stages only as their SSE events arrive (token → mermaid → anchors → micro-win)', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);

    await user.type(screen.getByTestId('chat-input'), 'architecture');
    await user.click(screen.getByTestId('chat-submit'));
    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());

    await act(async () => {
      stream.event?.({ type: 'token', text: 'overview' });
    });
    expect(screen.getByText('overview')).toBeInTheDocument();
    expect(screen.queryByTestId('mermaid-diagram')).not.toBeInTheDocument();
    expect(screen.queryByTestId('source-trace-drawer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('micro-win')).not.toBeInTheDocument();

    await act(async () => {
      stream.event?.({ type: 'mermaid', code: 'flowchart LR\n  A --> B' });
    });
    await waitFor(() => expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument());
    expect(screen.queryByTestId('source-trace-drawer')).not.toBeInTheDocument();

    await act(async () => {
      stream.event?.({
        type: 'anchors',
        anchors: [{ file: 'A.java', line: 1, symbol: 'A' }]
      });
    });
    await waitFor(() => expect(screen.getByTestId('source-trace-drawer')).toBeInTheDocument());
    // Still streaming: no micro-win before done.
    expect(screen.queryByTestId('micro-win')).not.toBeInTheDocument();

    await act(async () => {
      stream.event?.({ type: 'done', payload: { suggestedAction: 'Trace POST /owners' } });
      stream.done?.();
    });
    await waitFor(() => expect(screen.getByTestId('micro-win')).toBeInTheDocument());
    expect(screen.getByTestId('micro-win-label')).toHaveTextContent('✓ 已确认 1 个源码锚点');
    expect(screen.queryByTestId('break-marker')).not.toBeInTheDocument();
  });

  it('shows a quantitative micro-win and drives every off-ramp exit', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);

    await user.type(screen.getByTestId('chat-input'), 'trace /owners');
    await user.click(screen.getByTestId('chat-submit'));
    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());

    await act(async () => {
      stream.event?.({ type: 'token', text: 'overview' });
      stream.event?.({
        type: 'anchors',
        anchors: [
          { file: 'A.java', line: 1, symbol: 'A' },
          { file: 'B.java', line: 2, symbol: 'B' }
        ]
      });
      stream.event?.({ type: 'done', payload: { suggestedAction: 'Trace POST /owners' } });
      stream.done?.();
    });

    await waitFor(() => expect(screen.getByTestId('micro-win')).toBeInTheDocument());
    expect(screen.getByTestId('micro-win-label')).toHaveTextContent('✓ 已确认 2 个源码锚点');
    expect(screen.getByTestId('off-ramp-suggested')).toHaveTextContent('Trace POST /owners');

    // Suggested off-ramp submits the backend suggestion as the next question.
    await user.click(screen.getByTestId('off-ramp-suggested'));
    await waitFor(() =>
      expect(screen.getAllByTestId('user-message').at(-1)).toHaveTextContent('Trace POST /owners')
    );

    // Finish the follow-up query so the input is enabled again.
    await act(async () => {
      stream.event?.({ type: 'token', text: 'done.' });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });

    // Continue off-ramp focuses the chat input.
    await user.click(screen.getByTestId('off-ramp-continue'));
    expect(screen.getByTestId('chat-input')).toHaveFocus();

    // Top off-ramp scrolls the message list back to the top without crashing.
    await user.click(screen.getByTestId('off-ramp-top'));
    expect(screen.getByTestId('micro-win')).toBeInTheDocument();
  });

  it('shows a plain "✓ 分析完成" micro-win for diagram-only traces without a suggested follow-up', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);

    await user.type(screen.getByTestId('chat-input'), 'architecture');
    await user.click(screen.getByTestId('chat-submit'));
    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());

    await act(async () => {
      stream.event?.({ type: 'mermaid', code: 'flowchart LR\n  A --> B' });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });

    await waitFor(() => expect(screen.getByTestId('micro-win')).toBeInTheDocument());
    expect(screen.getByTestId('micro-win-label')).toHaveTextContent('✓ 分析完成');
    expect(screen.queryByTestId('off-ramp-suggested')).not.toBeInTheDocument();
    expect(screen.queryByTestId('break-marker')).not.toBeInTheDocument();
  });

  it('renders a break marker — never a micro-win — when the error event carries content', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);

    await user.type(screen.getByTestId('chat-input'), 'who?');
    await user.click(screen.getByTestId('chat-submit'));
    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());

    await act(async () => {
      stream.event?.({ type: 'token', text: 'partial answer' });
      stream.event?.({ type: 'error', error: 'Static analysis break at OwnerController' });
    });

    await waitFor(() => expect(screen.getByTestId('break-marker')).toBeInTheDocument());
    expect(screen.getByTestId('break-marker')).toHaveTextContent('Static Analysis Break');
    expect(screen.queryByTestId('micro-win')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-error')).toHaveTextContent('Static analysis break at OwnerController');
  });

  it('renders a break marker when done arrives with neither anchors nor a diagram', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);

    await user.type(screen.getByTestId('chat-input'), 'trace unknown symbol');
    await user.click(screen.getByTestId('chat-submit'));
    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());

    await act(async () => {
      stream.event?.({ type: 'token', text: 'no evidence found' });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });

    await waitFor(() => expect(screen.getByTestId('break-marker')).toBeInTheDocument());
    expect(screen.getByTestId('break-marker')).toHaveTextContent('Static Analysis Break');
    expect(screen.queryByTestId('micro-win')).not.toBeInTheDocument();
    expect(screen.getByText('no evidence found')).toBeInTheDocument();
  });
});

describe('SSE reconnect resilience (ticket 07)', () => {
  it('keeps completed bubbles intact, resets the in-flight bubble and recovers on replay', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);

    // First query completes — this bubble must survive the later disconnect.
    await user.type(screen.getByTestId('chat-input'), 'first question');
    await user.click(screen.getByTestId('chat-submit'));
    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());
    await act(async () => {
      stream.event?.({ type: 'token', text: 'first answer ' });
      stream.event?.({
        type: 'anchors',
        anchors: [{ file: 'Owners.java', line: 1, symbol: 'Owners' }]
      });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });
    await waitFor(() => expect(screen.getByTestId('micro-win')).toBeInTheDocument());

    // Second query: mid-stream the connection drops (transient).
    await user.type(screen.getByTestId('chat-input'), 'second question');
    await user.click(screen.getByTestId('chat-submit'));
    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());
    await act(async () => {
      stream.event?.({ type: 'token', text: 'partial' });
      stream.err?.({ kind: 'transient', attempt: 1, maxAttempts: 3 });
    });

    await waitFor(() => expect(screen.getByTestId('reconnecting-indicator')).toBeInTheDocument());
    // Completed bubble + its micro-win are preserved.
    expect(screen.getByText('first answer')).toBeInTheDocument();
    expect(screen.getAllByTestId('micro-win')).toHaveLength(1);
    // The in-flight bubble was reset so the replay does not duplicate tokens.
    await waitFor(() => expect(screen.queryByText('partial')).not.toBeInTheDocument());

    // Replay arrives and completes; reconnect notice clears.
    await act(async () => {
      stream.event?.({ type: 'token', text: 'full replay answer ' });
      stream.event?.({
        type: 'anchors',
        anchors: [{ file: 'Owners.java', line: 1, symbol: 'Owners' }]
      });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });
    await waitFor(() => expect(screen.getByText(/full replay answer/)).toBeInTheDocument());
    expect(screen.queryByTestId('reconnecting-indicator')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('micro-win')).toHaveLength(2);
  });

  it('shows a permanent error with a manual retry once the reconnect budget is exhausted', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);

    await user.type(screen.getByTestId('chat-input'), 'trace x');
    await user.click(screen.getByTestId('chat-submit'));
    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());
    await act(async () => {
      stream.event?.({ type: 'token', text: 'partial answer' });
      stream.err?.({ kind: 'permanent', cause: new Error('budget exhausted') });
    });

    await waitFor(() => expect(screen.getByTestId('break-marker')).toBeInTheDocument());
    expect(screen.getByTestId('chat-error')).toHaveTextContent('自动重连失败');
    expect(screen.getByTestId('retry-query')).toBeInTheDocument();
    expect(screen.queryByTestId('reconnecting-indicator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('micro-win')).not.toBeInTheDocument();

    // Manual retry re-runs the same question in place (single user bubble).
    await user.click(screen.getByTestId('retry-query'));
    await waitFor(() => expect(screen.getByTestId('streaming-indicator')).toBeInTheDocument());
    expect(screen.getAllByTestId('user-message')).toHaveLength(1);
    expect(screen.getAllByTestId('user-message')[0]).toHaveTextContent('trace x');

    await act(async () => {
      stream.event?.({ type: 'token', text: 'recovered answer ' });
      stream.event?.({
        type: 'anchors',
        anchors: [{ file: 'Owners.java', line: 1, symbol: 'Owners' }]
      });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });
    await waitFor(() => expect(screen.getByText(/recovered answer/)).toBeInTheDocument());
    expect(screen.getByTestId('micro-win')).toBeInTheDocument();
    expect(screen.queryByTestId('break-marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-error')).not.toBeInTheDocument();
  });
});