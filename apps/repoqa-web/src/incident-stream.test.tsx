import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { RepoQAClient } from './client/RepoQAClient';
import type { QueryStreamLike } from './client/RepoQAClient';
import type { QueryEvent, Repo, RepoDashboard } from './types';

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
  repoUrl: undefined,
  localPath: 'C:/projects/spring-petclinic',
  branch: 'main',
  status: 'ready',
  fileCount: 120,
  symbolCount: 840,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
};

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

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

const emptyDashboard: RepoDashboard = {
  repoId: 'repo-1',
  repoName: 'petclinic',
  techStack: { summary: [], highlights: [] },
  config: { topology: [], maskedValues: true },
  scale: {
    routes: 0,
    services: 0,
    repositories: 0,
    advices: 0,
    plainClasses: 0,
    interfaces: 0,
    methods: 0,
    fields: 0,
    configKeys: 0,
    files: 0
  },
  topApis: []
};

function makeClient(stream?: FakeStream) {
  return {
    listRepos: vi.fn().mockResolvedValue([readyRepo]),
    getRuntime: vi.fn().mockResolvedValue({ llm: { mode: 'none' } }),
    importRepo: vi.fn().mockResolvedValue(readyRepo),
    getRepo: vi.fn(),
    listSymbols: vi.fn().mockResolvedValue([]),
    getFileRaw: vi.fn(),
    getDashboard: vi.fn().mockResolvedValue(emptyDashboard),
    getTours: vi.fn().mockResolvedValue([]),
    // Inspector symbol-focus hooks fire once an evidence row navigates.
    listReverseDeps: vi.fn().mockResolvedValue({
      repoId: 'repo-1',
      target: { name: 'OwnerController', file: 'src/main/java/OwnerController.java', line: 42 },
      callers: [],
      count: 0,
      fallback: false
    }),
    getSubgraphContext: vi.fn().mockResolvedValue({
      start: { name: 'OwnerController', file: 'src/main/java/OwnerController.java', line: 42 },
      nodes: [],
      tokenCount: 0,
      truncated: false,
      prunedCount: 0,
      text: '# Agent Context: OwnerController'
    }),
    queryRepo: vi.fn().mockReturnValue(stream ?? new FakeStream()),
    baseUrl: 'http://localhost:43110'
  } as unknown as RepoQAClient;
}

async function selectRepo(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByTestId('repo-select')).toBeInTheDocument());
  await user.selectOptions(screen.getByTestId('repo-select'), 'repo-1');
  // Issue 31: the topology workbench is the default view once a repo is selected.
  await waitFor(() => expect(screen.getByTestId('offline-hint')).toBeInTheDocument());
}

/** Issue 25 / Ticket 01 — free-form questions ride the incident copilot. */
async function openIncidentCopilot(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('tab-incident'));
  await waitFor(() => expect(screen.getByTestId('incident-view')).toBeInTheDocument());
}

async function askIncident(
  user: ReturnType<typeof userEvent.setup>,
  question: string,
  stack?: string
) {
  await user.type(screen.getByTestId('incident-question'), question);
  if (stack) {
    await user.click(screen.getByTestId('incident-toggle-stack'));
    await user.type(screen.getByTestId('incident-stack'), stack);
  }
  await user.click(screen.getByTestId('incident-submit'));
}

describe('incident artifact stream (Issue 25 / Ticket 01)', () => {
  it('streams token events into the incident card until done', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);
    await openIncidentCopilot(user);

    await askIncident(user, 'trace /owners');
    expect(screen.getByTestId('incident-card-live')).toBeInTheDocument();
    expect(screen.getByTestId('incident-user-message')).toHaveTextContent('trace /owners');

    await act(async () => {
      stream.event?.({ type: 'token', text: 'the request goes through ' });
      stream.event?.({ type: 'token', text: 'OwnerController.' });
    });
    await waitFor(() =>
      expect(screen.getByText(/the request goes through/)).toBeInTheDocument()
    );

    await act(async () => {
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });
    await waitFor(() => expect(screen.getByTestId('incident-card-done')).toBeInTheDocument());
    expect(screen.queryByTestId('incident-card-live')).not.toBeInTheDocument();
  });

  it('finalizes the card as failed on a terminal error event and stops streaming', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);
    await openIncidentCopilot(user);

    await askIncident(user, 'who?');
    expect(screen.getByTestId('incident-card-live')).toBeInTheDocument();
    await act(async () => {
      stream.event?.({ type: 'error', error: 'Static analysis break' });
    });
    await waitFor(() => expect(screen.getByTestId('incident-card-failed')).toBeInTheDocument());
    expect(screen.getByTestId('incident-error')).toHaveTextContent('Static analysis break');
    expect(screen.queryByTestId('incident-card-live')).not.toBeInTheDocument();
  });

  it('renders a mermaid diagram when the mermaid SSE event arrives', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);
    await openIncidentCopilot(user);

    await askIncident(user, 'architecture');
    await act(async () => {
      stream.event?.({ type: 'mermaid', code: 'flowchart LR\n  A --> B' });
      stream.event?.({ type: 'token', text: 'overview' });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });
    await waitFor(() => expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument());
  });

  it('does not show an incident input when no repo is selected (explicit guidance instead)', async () => {
    const client = makeClient();
    render(<App client={client} />);
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    expect(screen.queryByTestId('incident-input')).not.toBeInTheDocument();
    expect(client.queryRepo).not.toHaveBeenCalled();
  });

  it('opens a grounded evidence row in the Inspector via onNavigate (ticket 05)', async () => {
    const stream = new FakeStream();
    const client = makeClient(stream);
    client.getFileRaw = vi.fn().mockResolvedValue('public class OwnerController {}');

    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);
    await openIncidentCopilot(user);

    await askIncident(user, 'trace /owners');
    await act(async () => {
      stream.event?.({
        type: 'anchors',
        anchors: [
          { file: 'src/main/java/OwnerController.java', line: 42, symbol: 'OwnerController' }
        ]
      });
      stream.event?.({ type: 'token', text: 'overview' });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });

    // The validated anchor lands as a VERIFIED evidence row once done lands.
    await waitFor(() => expect(screen.getByTestId('evidence-card')).toBeInTheDocument());
    await user.click(screen.getByTestId('evidence-row-0'));

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
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-language', 'java');
    expect(screen.getByTestId('inspector-file')).toHaveTextContent('OwnerController.java');
  });

  it('stages the reveal: answer, then diagram, then evidence after done', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);
    await openIncidentCopilot(user);

    await askIncident(user, 'architecture');
    await act(async () => {
      stream.event?.({ type: 'token', text: 'overview' });
    });
    expect(screen.getByText('overview')).toBeInTheDocument();
    expect(screen.queryByTestId('mermaid-diagram')).not.toBeInTheDocument();
    expect(screen.queryByTestId('evidence-card')).not.toBeInTheDocument();

    await act(async () => {
      stream.event?.({ type: 'mermaid', code: 'flowchart LR\n  A --> B' });
    });
    await waitFor(() => expect(screen.getByTestId('mermaid-diagram')).toBeInTheDocument());
    // Evidence is a done-time artifact — never parsed mid-stream.
    expect(screen.queryByTestId('evidence-card')).not.toBeInTheDocument();

    await act(async () => {
      stream.event?.({
        type: 'anchors',
        anchors: [{ file: 'A.java', line: 1, symbol: 'A' }]
      });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });
    await waitFor(() => expect(screen.getByTestId('evidence-card')).toBeInTheDocument());
    expect(screen.getByTestId('evidence-status-0')).toHaveTextContent('VERIFIED');
  });

  it('marks the card as a break when done arrives with neither anchors nor a diagram', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);
    await openIncidentCopilot(user);

    await askIncident(user, 'trace unknown symbol');
    await act(async () => {
      stream.event?.({ type: 'token', text: 'no evidence found' });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });

    await waitFor(() => expect(screen.getByTestId('incident-break')).toBeInTheDocument());
    expect(screen.getByTestId('incident-break')).toHaveTextContent('Static Analysis Break');
    expect(screen.getByText('no evidence found')).toBeInTheDocument();
  });

  it('keeps completed cards intact, resets the in-flight card and recovers on replay', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);
    await openIncidentCopilot(user);

    // First investigation completes — this card must survive the later disconnect.
    await askIncident(user, 'first question');
    await act(async () => {
      stream.event?.({ type: 'token', text: 'first answer ' });
      stream.event?.({
        type: 'anchors',
        anchors: [{ file: 'Owners.java', line: 1, symbol: 'Owners' }]
      });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });
    await waitFor(() => expect(screen.getByTestId('incident-card-done')).toBeInTheDocument());

    // Second investigation: mid-stream the connection drops (transient).
    await askIncident(user, 'second question');
    await act(async () => {
      stream.event?.({ type: 'token', text: 'partial' });
      stream.err?.({ kind: 'transient', attempt: 1, maxAttempts: 3 });
    });

    await waitFor(() => expect(screen.getByTestId('incident-reconnecting')).toBeInTheDocument());
    // Completed cards stay collapsed but intact — expand the first to verify
    // its answer survived the disconnect.
    await user.click(screen.getAllByTestId('incident-card-toggle')[0]);
    expect(screen.getByText('first answer')).toBeInTheDocument();
    // The in-flight card was reset so the replay does not duplicate tokens.
    await waitFor(() => expect(screen.queryByText('partial')).not.toBeInTheDocument());

    // Replay arrives and completes; the reconnect notice becomes a recovery toast.
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
    await waitFor(() => expect(screen.getByTestId('incident-recovered')).toBeInTheDocument());
    expect(screen.queryByTestId('incident-reconnecting')).not.toBeInTheDocument();
  });

  it('surfaces a permanent failure and frees the composer for a manual re-ask', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);
    await openIncidentCopilot(user);

    await askIncident(user, 'trace x');
    await act(async () => {
      stream.event?.({ type: 'token', text: 'partial answer' });
      stream.err?.({ kind: 'permanent', cause: new Error('budget exhausted') });
    });

    await waitFor(() => expect(screen.getByTestId('incident-card-failed')).toBeInTheDocument());
    expect(screen.getByTestId('incident-error')).toHaveTextContent('自动重连失败');
    expect(screen.queryByTestId('incident-reconnecting')).not.toBeInTheDocument();

    // The terminal failure released the stream slot: a re-ask opens a new card.
    await askIncident(user, 'trace x again');
    await waitFor(() => expect(screen.getByTestId('incident-card-live')).toBeInTheDocument());
    const cardRows = screen.getAllByTestId('incident-user-message');
    expect(cardRows[cardRows.length - 1]).toHaveTextContent('trace x again');
  });

  it('renders provenance, low-confidence and per-card usage from the done payload', async () => {
    const stream = new FakeStream();
    const user = userEvent.setup();
    render(<App client={makeClient(stream)} />);
    await selectRepo(user);
    await openIncidentCopilot(user);

    await askIncident(user, 'trace owner flow');
    await act(async () => {
      stream.event?.({ type: 'token', text: 'static analysis ' });
      stream.event?.({
        type: 'anchors',
        anchors: [{ file: 'A.java', line: 1, symbol: 'A' }]
      });
      stream.event?.({
        type: 'done',
        payload: {
          provenance: 'static',
          lowConfidence: true,
          confidence: 0.2,
          usage: { input: 10, output: 20, total: 30, source: 'estimate' }
        }
      });
      stream.done?.();
    });

    await waitFor(() =>
      expect(screen.getByTestId('incident-provenance')).toHaveTextContent('静态图谱')
    );
    expect(screen.getByText('低置信度')).toBeInTheDocument();
    expect(screen.getByTestId('incident-usage')).toHaveTextContent('本次 30 tokens');
  });

  it('buckets incident cards per repo and restores them on repo switch', async () => {
    const repo2: Repo = { ...readyRepo, id: 'repo-2', name: 'cc-self' };
    const stream = new FakeStream();
    const client = makeClient(stream);
    (client as { listRepos: unknown }).listRepos = vi
      .fn()
      .mockResolvedValue([readyRepo, repo2]);
    (client as { queryRepo: unknown }).queryRepo = vi.fn().mockReturnValue(stream);
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);
    await openIncidentCopilot(user);

    await askIncident(user, 'initCreationForm 的调用链');
    await act(async () => {
      stream.event?.({ type: 'token', text: 'PetController 的链路' });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });
    await waitFor(() =>
      expect(screen.getByTestId('incident-user-message')).toHaveTextContent(
        'initCreationForm 的调用链'
      )
    );

    // Switching repos swaps the (repoId, commit) bucket: cards never mix.
    await user.selectOptions(screen.getByTestId('repo-select'), 'repo-2');
    await openIncidentCopilot(user);
    expect(screen.getByTestId('incident-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-user-message')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('repo-select'), 'repo-1');
    await openIncidentCopilot(user);
    expect(screen.getByTestId('incident-user-message')).toHaveTextContent(
      'initCreationForm 的调用链'
    );
  });

  it('restores the completed card usage when switching back to a repo', async () => {
    const repo2: Repo = { ...readyRepo, id: 'repo-2', name: 'cc-self' };
    const stream = new FakeStream();
    const client = makeClient(stream);
    (client as { listRepos: unknown }).listRepos = vi
      .fn()
      .mockResolvedValue([readyRepo, repo2]);
    (client as { queryRepo: unknown }).queryRepo = vi.fn().mockReturnValue(stream);
    const user = userEvent.setup();
    render(<App client={client} />);
    await selectRepo(user);
    await openIncidentCopilot(user);

    await askIncident(user, 'usage question');
    await act(async () => {
      stream.event?.({ type: 'token', text: 'answer ' });
      stream.event?.({
        type: 'anchors',
        anchors: [{ file: 'A.java', line: 1, symbol: 'A' }]
      });
      stream.event?.({
        type: 'done',
        payload: { usage: { input: 12, output: 18, total: 30, source: 'estimate' } }
      });
      stream.done?.();
    });
    await waitFor(() => expect(screen.getByTestId('incident-usage')).toHaveTextContent('30'));

    await user.selectOptions(screen.getByTestId('repo-select'), 'repo-2');
    await openIncidentCopilot(user);
    expect(screen.queryByTestId('incident-usage')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByTestId('repo-select'), 'repo-1');
    await openIncidentCopilot(user);
    await waitFor(() => expect(screen.getByTestId('incident-usage')).toHaveTextContent('30'));
  });
});
