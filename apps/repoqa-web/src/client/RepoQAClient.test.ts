import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryStream } from './RepoQAClient';
import type { QueryEvent } from '../types';

/**
 * Minimal EventSource double so QueryStream can be driven deterministically.
 * jsdom does not implement EventSource, so the QueryStream is unit-tested
 * against this fake instead of through the whole App.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static reset() {
    FakeEventSource.instances = [];
  }
  url: string;
  readyState = 0; // EventSource.CONNECTING
  onerror: (() => void) | null = null;
  private handlers = new Map<string, Set<(e: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.handlers.get(type)?.delete(fn);
  }

  close() {
    this.readyState = 2; // EventSource.CLOSED
  }

  /** Test helper: dispatch an SSE message to listeners of `type`. */
  dispatch(type: string, data: string) {
    this.handlers.get(type)?.forEach((fn) => fn({ data, type } as MessageEvent));
  }

  /** Test helper: simulate a dropped connection / server failure. */
  fail() {
    this.readyState = 0; // EventSource.CONNECTING — connection lost
    this.onerror?.();
  }
}

function lastHandled(stream: QueryStream): { events: QueryEvent[]; done: () => boolean } {
  const events: QueryEvent[] = [];
  let doneCount = 0;
  stream.onEvent((e) => events.push(e));
  stream.onDone(() => {
    doneCount++;
  });
  return { events, done: () => doneCount > 0 };
}

describe('QueryStream done payload (ticket 06)', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses the done payload into a done event before finishing', () => {
    const stream = new QueryStream('http://api', 'repo-1', 'trace /owners');
    const { events, done } = lastHandled(stream);
    stream.connect();

    FakeEventSource.instances[0].dispatch(
      'repoqa.query.done',
      JSON.stringify({ answer: 'a', suggestedAction: 'Trace POST /owners', anchors: [] })
    );

    expect(events.at(-1)).toEqual({
      type: 'done',
      payload: { answer: 'a', suggestedAction: 'Trace POST /owners', anchors: [] }
    });
    expect(done()).toBe(true);
  });

  it('tolerates a malformed done payload and still finishes', () => {
    const stream = new QueryStream('http://api', 'repo-1', 'q');
    const { events, done } = lastHandled(stream);
    stream.connect();

    FakeEventSource.instances[0].dispatch('repoqa.query.done', 'not-json');

    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(done()).toBe(true);
  });

  it('forwards token/mermaid/anchors events as they arrive (reveal order)', () => {
    const stream = new QueryStream('http://api', 'repo-1', 'architecture');
    const { events } = lastHandled(stream);
    stream.connect();

    const src = FakeEventSource.instances[0];
    // Real backend frames are JSON.stringify(payload), e.g. {"token":"..."}.
    src.dispatch('repoqa.query.token', JSON.stringify({ token: 'overview ' }));
    src.dispatch('repoqa.query.mermaid', JSON.stringify({ mermaid: 'flowchart LR\n  A --> B' }));
    src.dispatch('repoqa.query.anchors', JSON.stringify({ anchors: [{ file: 'A.java', line: 1, symbol: 'A' }] }));

    expect(events[0]).toEqual({ type: 'token', text: 'overview ' });
    expect(events[1]).toEqual({ type: 'mermaid', code: 'flowchart LR\n  A --> B' });
    expect(events[2]).toEqual({ type: 'anchors', anchors: [{ file: 'A.java', line: 1, symbol: 'A' }] });
    expect(events).toHaveLength(3);
  });

  it('falls back to raw data for non-JSON token/mermaid frames', () => {
    const stream = new QueryStream('http://api', 'repo-1', 'q');
    const { events } = lastHandled(stream);
    stream.connect();

    const src = FakeEventSource.instances[0];
    src.dispatch('repoqa.query.token', 'plain text');
    src.dispatch('repoqa.query.mermaid', 'flowchart LR\n  A --> B');

    expect(events[0]).toEqual({ type: 'token', text: 'plain text' });
    expect(events[1]).toEqual({ type: 'mermaid', code: 'flowchart LR\n  A --> B' });
  });

  it('builds the query URL with question and mode', () => {
    const stream = new QueryStream('http://api', 'my repo', 'how?', 'call-chain');
    stream.connect();
    const src = FakeEventSource.instances[0];
    expect(src.url).toBe(
      'http://api/api/repos/my%20repo/query?question=how%3F&mode=call-chain'
    );
    stream.close();
  });
});

describe('QueryStream reconnect (ticket 07)', () => {
  beforeEach(() => {
    FakeEventSource.reset();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reopens with exponential backoff after a dropped connection and keeps streaming', () => {
    const stream = new QueryStream('http://api', 'repo-1', 'q', undefined, 100, 3);
    const events: QueryEvent[] = [];
    const errors: unknown[] = [];
    let done = false;
    stream.onEvent((e) => events.push(e));
    stream.onError((e) => errors.push(e));
    stream.onDone(() => {
      done = true;
    });
    stream.connect();

    const first = FakeEventSource.instances[0];
    first.dispatch('repoqa.query.token', JSON.stringify({ token: 'hello ' }));
    expect(events).toEqual([{ type: 'token', text: 'hello ' }]);
    expect(FakeEventSource.instances).toHaveLength(1);

    first.fail();

    expect(errors).toEqual([{ kind: 'transient', attempt: 1, maxAttempts: 3 }]);
    expect(first.readyState).toBe(2); // old source closed, browser retry suppressed
    expect(FakeEventSource.instances).toHaveLength(1); // reopen is scheduled

    vi.advanceTimersByTime(100);
    expect(FakeEventSource.instances).toHaveLength(2);
    const second = FakeEventSource.instances[1];

    second.dispatch('repoqa.query.token', JSON.stringify({ token: 'world' }));
    second.dispatch('repoqa.query.done', JSON.stringify({}));
    expect(events.slice(0, 2)).toEqual([
      { type: 'token', text: 'hello ' },
      { type: 'token', text: 'world' }
    ]);
    expect(events[2]).toEqual({ type: 'done', payload: {} });
    expect(done).toBe(true);
  });

  it('emits a permanent error after the reconnect budget is exhausted', () => {
    const stream = new QueryStream('http://api', 'repo-1', 'q', undefined, 100, 3);
    const errors: unknown[] = [];
    stream.onError((e) => errors.push(e));
    stream.connect();

    let src = FakeEventSource.instances[0];
    src.fail();
    vi.advanceTimersByTime(100);
    src = FakeEventSource.instances[1];
    src.fail();
    vi.advanceTimersByTime(200);
    src = FakeEventSource.instances[2];
    src.fail();
    vi.advanceTimersByTime(400);
    src = FakeEventSource.instances[3];
    src.fail();

    expect(errors).toEqual([
      { kind: 'transient', attempt: 1, maxAttempts: 3 },
      { kind: 'transient', attempt: 2, maxAttempts: 3 },
      { kind: 'transient', attempt: 3, maxAttempts: 3 },
      expect.objectContaining({ kind: 'permanent' })
    ]);
    // No further reopen after the permanent error.
    expect(FakeEventSource.instances).toHaveLength(4);
  });

  it('does not reopen after close() during the backoff window', () => {
    const stream = new QueryStream('http://api', 'repo-1', 'q', undefined, 100, 3);
    stream.connect();
    FakeEventSource.instances[0].fail();
    stream.close();
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('closes the source on done so a late EOF error does not reconnect', () => {
    const stream = new QueryStream('http://api', 'repo-1', 'q', undefined, 100, 3);
    const errors: unknown[] = [];
    let done = false;
    stream.onError((e) => errors.push(e));
    stream.onDone(() => {
      done = true;
    });
    stream.connect();

    const src = FakeEventSource.instances[0];
    src.dispatch('repoqa.query.done', JSON.stringify({}));
    expect(done).toBe(true);
    expect(src.readyState).toBe(2); // stream closed it

    src.fail(); // any late error after finish is ignored
    expect(errors).toEqual([]);
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});