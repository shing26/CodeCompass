import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IncidentView } from './IncidentView';
import { useEvolutionSession } from '../hooks/useEvolutionSession';
import type { QueryStreamLike, RepoQAClient } from '../client/RepoQAClient';
import type { QueryEvent, Repo } from '../types';

vi.mock('../client/mermaidRenderer', () => ({
  renderMermaid: vi.fn(async (_uid: string, code: string) => {
    if (code.includes('INVALID')) throw new Error('parse error');
    return [
      '<svg id="diagram">',
      '<g class="node"><text class="label">OrderService</text></g>',
      '</svg>'
    ].join('');
  })
}));

const readyRepo: Repo = {
  id: 'repo-1',
  name: 'sample-java',
  localPath: 'C:/projects/sample-java',
  branch: 'main',
  status: 'ready',
  fileCount: 12,
  symbolCount: 40,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z'
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

/** Answer whose `- ` lines parse into grounded evidence rows. */
const VERIFIED_ANSWER = [
  '排查结论',
  '',
  '- [VERIFIED] SERVICE findById @ src/main/java/com/demo/OrderService.java:11',
  '- at com.demo.ThirdParty.run(ThirdParty.java:99) -> BREAK (unresolved)'
].join('\n');

/** Answer with only an unresolvable frame — no VERIFIED crash point. */
const BREAK_ONLY_ANSWER =
  '- at com.acme.Missing.run(Missing.java:99) -> BREAK (index has no frame)';

/** One stream per submission, in delivery order. */
function makeClient(streams: FakeStream[]): RepoQAClient {
  return {
    evolveStream: vi.fn(),
    queryRepo: vi.fn(() => streams.shift() ?? new FakeStream()),
    // Ticket 03 hydrate replay — default empty unless a test seeds rows.
    getWorkbenchCards: vi.fn(async () => [])
  } as unknown as RepoQAClient;
}

function SessionHost({
  client,
  onNavigate,
  onOpenInWorkbench,
  onTraceCrash
}: {
  client: RepoQAClient;
  onNavigate?: (file: string, line: number) => void;
  onOpenInWorkbench?: () => void;
  onTraceCrash?: (symbol: string, file: string) => void;
}) {
  const session = useEvolutionSession(client, readyRepo);
  return (
    <IncidentView
      repoName={readyRepo.name}
      session={session}
      symbols={[]}
      onSubmit={(question, stack) => {
        session.submitIncident(question, stack);
      }}
      onNavigate={onNavigate}
      onOpenInWorkbench={onOpenInWorkbench}
      onTraceCrash={onTraceCrash}
    />
  );
}

async function ask(user: ReturnType<typeof userEvent.setup>, question: string, stack?: string) {
  await user.type(screen.getByTestId('incident-question'), question);
  if (stack) {
    await user.click(screen.getByTestId('incident-toggle-stack'));
    await user.type(screen.getByTestId('incident-stack'), stack);
  }
  await user.click(screen.getByTestId('incident-submit'));
}

beforeEach(() => {
  cleanup();
});

describe('IncidentView — artifact-card timeline (Issue 25 / Ticket 01)', () => {
  it('streams the answer into a card with diagram, evidence and provenance meta', async () => {
    const user = userEvent.setup();
    const stream = new FakeStream();
    render(<SessionHost client={makeClient([stream])} />);
    expect(screen.getByTestId('incident-empty')).toBeInTheDocument();

    await ask(user, 'NPE at Demo.run');
    expect(screen.queryByTestId('incident-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('incident-card-live')).toBeInTheDocument();
    expect(screen.getByTestId('incident-user-message')).toHaveTextContent('NPE at Demo.run');

    await act(async () => {
      stream.event?.({ type: 'token', text: VERIFIED_ANSWER });
      stream.event?.({
        type: 'mermaid',
        code: 'graph LR\n  A[A] --> B[B]\nclick A "code://src/A.java#5"'
      });
      stream.event?.({
        type: 'anchors',
        anchors: [
          {
            file: 'src/main/java/com/demo/OrderService.java',
            line: 11,
            symbol: 'findById',
            commit: '942ae5a'
          }
        ]
      });
      stream.event?.({
        type: 'done',
        payload: {
          provenance: 'llm',
          usage: { input: 100, output: 50, total: 150, source: 'provider' }
        }
      });
      stream.done?.();
    });

    expect(screen.getByTestId('incident-card-done')).toBeInTheDocument();
    expect(await screen.findByTestId('mermaid-diagram')).toBeTruthy();
    expect(screen.getByTestId('evidence-card')).toBeTruthy();
    expect(screen.getByTestId('evidence-status-0').textContent).toBe('VERIFIED');
    expect(screen.getByTestId('evidence-commit-0').textContent).toBe('942ae5a');
    expect(screen.getByTestId('incident-provenance').textContent).toBe('模型推理');
    expect(screen.getByTestId('incident-usage').textContent).toContain('150 tokens');
    expect(screen.queryByTestId('incident-break')).not.toBeInTheDocument();
  });

  it('echoes the pasted stack and forwards it to the query stream', async () => {
    const user = userEvent.setup();
    const stream = new FakeStream();
    const client = makeClient([stream]);
    render(<SessionHost client={client} />);

    await ask(user, 'NPE at Demo.run', 'at Demo.run(Demo.java:9)');
    expect(client.queryRepo).toHaveBeenCalledWith(
      'repo-1',
      'NPE at Demo.run',
      'incident',
      undefined,
      'at Demo.run(Demo.java:9)'
    );
    expect(screen.getByTestId('incident-user-stack')).toHaveTextContent(
      'at Demo.run(Demo.java:9)'
    );
  });

  it('offers workbench actions on the latest done card only', async () => {
    const user = userEvent.setup();
    const first = new FakeStream();
    const second = new FakeStream();
    render(
      <SessionHost
        client={makeClient([first, second])}
        onNavigate={vi.fn()}
        onTraceCrash={vi.fn()}
        onOpenInWorkbench={vi.fn()}
      />
    );

    await ask(user, 'first incident');
    await act(async () => {
      first.event?.({ type: 'token', text: '- [VERIFIED] SERVICE findById @ src/main/java/com/demo/OrderService.java:11' });
      first.event?.({ type: 'done', payload: {} });
      first.done?.();
    });
    await ask(user, 'second incident');
    await act(async () => {
      second.event?.({ type: 'token', text: '- [VERIFIED] SERVICE resolveOrder @ src/main/java/com/demo/OrderService.java:44' });
      second.event?.({ type: 'done', payload: {} });
      second.done?.();
    });

    const actionBars = screen.getAllByTestId('incident-actions');
    expect(actionBars.length).toBe(1);
    // The crash point comes from the latest completed card's evidence.
    expect(screen.getByTestId('incident-trace-crash').textContent).toContain('resolveOrder');
  });

  it('traces the crash symbol and opens the workbench through App callbacks', async () => {
    const user = userEvent.setup();
    const stream = new FakeStream();
    const onTraceCrash = vi.fn();
    const onOpenInWorkbench = vi.fn();
    render(
      <SessionHost
        client={makeClient([stream])}
        onTraceCrash={onTraceCrash}
        onOpenInWorkbench={onOpenInWorkbench}
      />
    );

    await ask(user, 'NPE at Demo.run');
    await act(async () => {
      stream.event?.({ type: 'token', text: VERIFIED_ANSWER });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });

    await user.click(screen.getByTestId('incident-trace-crash'));
    expect(onTraceCrash).toHaveBeenCalledWith(
      'findById',
      'src/main/java/com/demo/OrderService.java'
    );
    await user.click(screen.getByTestId('incident-open-workbench'));
    expect(onOpenInWorkbench).toHaveBeenCalledTimes(1);
  });

  it('hides the trace action and shows the break marker without a VERIFIED crash point', async () => {
    const user = userEvent.setup();
    const stream = new FakeStream();
    render(
      <SessionHost client={makeClient([stream])} onTraceCrash={vi.fn()} onOpenInWorkbench={vi.fn()} />
    );

    await ask(user, 'unknown failure');
    await act(async () => {
      stream.event?.({ type: 'token', text: BREAK_ONLY_ANSWER });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });

    expect(screen.queryByTestId('incident-trace-crash')).toBeNull();
    expect(screen.getByTestId('incident-open-workbench')).toBeTruthy();
    // No anchors and no diagram — the done is presented as a break.
    expect(screen.getByTestId('incident-break')).toHaveTextContent('Static Analysis Break');
  });

  it('collapses the latest card through the toggle and hides its findings', async () => {
    const user = userEvent.setup();
    const stream = new FakeStream();
    render(<SessionHost client={makeClient([stream])} />);

    await ask(user, 'NPE at Demo.run');
    await act(async () => {
      stream.event?.({ type: 'token', text: VERIFIED_ANSWER });
      stream.event?.({ type: 'done', payload: {} });
      stream.done?.();
    });
    expect(screen.getByTestId('evidence-card')).toBeTruthy();

    await user.click(screen.getByTestId('incident-card-toggle'));
    expect(screen.queryByTestId('evidence-card')).not.toBeInTheDocument();
    // The collapsed summary row (intent echo) stays visible.
    expect(screen.getByTestId('incident-user-message')).toHaveTextContent('NPE at Demo.run');
  });

  it('keeps completed cards intact, resets the in-flight card and recovers on replay', async () => {
    const user = userEvent.setup();
    const first = new FakeStream();
    const second = new FakeStream();
    render(<SessionHost client={makeClient([first, second])} />);

    // First investigation completes — this card must survive the disconnect.
    await ask(user, 'first incident');
    await act(async () => {
      first.event?.({ type: 'token', text: 'first answer' });
      first.event?.({
        type: 'anchors',
        anchors: [{ file: 'src/A.java', line: 1, symbol: 'A' }]
      });
      first.event?.({ type: 'done', payload: {} });
      first.done?.();
    });
    expect(screen.getByTestId('incident-card-done')).toBeInTheDocument();

    // Second investigation: mid-stream the connection drops (transient).
    await ask(user, 'second incident');
    await act(async () => {
      second.event?.({ type: 'token', text: 'partial' });
      second.err?.({ kind: 'transient', attempt: 1, maxAttempts: 3 });
    });
    expect(screen.getByTestId('incident-reconnecting')).toBeInTheDocument();
    // History cards stay collapsed but intact — expand the first one to verify
    // its answer survived the disconnect.
    await user.click(screen.getAllByTestId('incident-card-toggle')[0]);
    expect(screen.getByText('first answer')).toBeInTheDocument();

    // Replay arrives: the reconnect notice flips into a recovery confirmation.
    await act(async () => {
      second.event?.({ type: 'token', text: 'full replay answer' });
      second.event?.({
        type: 'anchors',
        anchors: [{ file: 'src/A.java', line: 1, symbol: 'A' }]
      });
      second.event?.({ type: 'done', payload: {} });
      second.done?.();
    });
    expect(screen.getByTestId('incident-recovered')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-reconnecting')).not.toBeInTheDocument();
    expect(screen.getByText('full replay answer')).toBeInTheDocument();
    expect(screen.queryByText('partial')).not.toBeInTheDocument();
  });

  it('finalizes the card as failed on a terminal stream error', async () => {
    const user = userEvent.setup();
    const stream = new FakeStream();
    render(<SessionHost client={makeClient([stream])} />);

    await ask(user, 'who broke?');
    await act(async () => {
      stream.event?.({ type: 'token', text: 'partial answer' });
      stream.event?.({ type: 'error', error: 'Static analysis break at OwnerController' });
    });

    expect(screen.getByTestId('incident-card-failed')).toBeInTheDocument();
    expect(screen.getByTestId('incident-error')).toHaveTextContent(
      'Static analysis break at OwnerController'
    );
    // In-flight content is kept on the failed card — never a silent success.
    expect(screen.getByText('partial answer')).toBeInTheDocument();
  });

  it('hydrates persisted incident cards and recomputes evidence (Ticket 03)', async () => {
    const client = makeClient([]);
    (client.getWorkbenchCards as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: '11',
        seq: 1,
        kind: 'incident',
        intent: 'NPE at Demo.run',
        echo: 'at Demo.run(Demo.java:9)',
        status: 'done',
        result: {
          answer: VERIFIED_ANSWER,
          anchors: [
            {
              file: 'src/main/java/com/demo/OrderService.java',
              line: 11,
              symbol: 'findById',
              commit: '942ae5a'
            }
          ],
          usage: { input: 100, output: 50, total: 150, source: 'provider' },
          provenance: 'llm',
          lowConfidence: false
        },
        mermaid: null,
        error: null,
        createdAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: '12',
        seq: 2,
        kind: 'incident',
        intent: 'who broke?',
        status: 'error',
        mermaid: null,
        error: 'Static analysis break at OwnerController',
        createdAt: '2026-09-01T00:01:00.000Z'
      }
    ]);

    render(<SessionHost client={client} />);
    await waitFor(() => {
      expect(screen.getByText('NPE at Demo.run')).toBeInTheDocument();
    });
    expect(screen.getByText('who broke?')).toBeInTheDocument();
    expect(screen.getByTestId('incident-card-failed')).toBeInTheDocument();
    // The done card is not the latest (the error card is) — expand it to
    // inspect the replayed findings.
    await userEvent.setup().click(screen.getAllByTestId('incident-card-toggle')[0]);
    // Evidence is re-parsed deterministically from the stored answer + anchors.
    expect(screen.getByTestId('evidence-status-0').textContent).toBe('VERIFIED');
    expect(screen.getByTestId('incident-provenance').textContent).toBe('模型推理');
    expect(screen.queryByTestId('incident-break')).not.toBeInTheDocument();
    // Hydrate pins the bucket's physical commit stream (readyRepo has no
    // commit — the backend resolves 'unversioned').
    expect(client.getWorkbenchCards).toHaveBeenCalledWith('repo-1', 'unversioned');
  });
});
