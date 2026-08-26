import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryStream, RepoQAClient } from './RepoQAClient';
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
  it('appends startName/startFile when an explicit trace start is given', () => {
    const stream = new QueryStream('http://api', 'my repo', 'how?', 'call-chain', {
      name: 'initCreationForm',
      file: 'src/main/java/org/springframework/samples/petclinic/owner/PetController.java'
    });
    stream.connect();
    const src = FakeEventSource.instances[0];
    expect(src.url).toContain('question=how%3F');
    expect(src.url).toContain('mode=call-chain');
    expect(src.url).toContain(
      'startName=initCreationForm&startFile=src%2Fmain%2Fjava%2Forg%2Fspringframework%2Fsamples%2Fpetclinic%2Fowner%2FPetController.java'
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
    const stream = new QueryStream('http://api', 'repo-1', 'q', undefined, undefined, 100, 3);
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
    const stream = new QueryStream('http://api', 'repo-1', 'q', undefined, undefined, 100, 3);
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
    const stream = new QueryStream('http://api', 'repo-1', 'q', undefined, undefined, 100, 3);
    stream.connect();
    FakeEventSource.instances[0].fail();
    stream.close();
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('closes the source on done so a late EOF error does not reconnect', () => {
    const stream = new QueryStream('http://api', 'repo-1', 'q', undefined, undefined, 100, 3);
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
describe('RepoQAClient dashboard/tours (issue 13)', () => {
  it('unwraps the runtime LLM classification payload', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ llm: { mode: 'remote', host: 'api.***.com' } })
    });
    const client = new RepoQAClient('http://api', fetcher as unknown as typeof fetch);
    await expect(client.getRuntime()).resolves.toEqual({
      llm: { mode: 'remote', host: 'api.***.com' }
    });
    expect(fetcher).toHaveBeenCalledWith('http://api/api/runtime');
  });

  it('unwraps the { dashboard } payload and URL-encodes the repo id', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dashboard: { repoId: 'r 1' } })
    });
    const client = new RepoQAClient('http://api', fetcher as unknown as typeof fetch);
    await expect(client.getDashboard('r 1')).resolves.toEqual({ repoId: 'r 1' });
    expect(fetcher).toHaveBeenCalledWith('http://api/api/repos/r%201/dashboard');
  });

  it('unwraps the { tours } payload and passes an optional type filter', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tours: [{ id: 'main-flow' }] })
    });
    const client = new RepoQAClient('http://api', fetcher as unknown as typeof fetch);
    await expect(client.getTours('repo-1', 'main-flow')).resolves.toEqual([{ id: 'main-flow' }]);
    expect(fetcher).toHaveBeenCalledWith('http://api/api/repos/repo-1/tours?type=main-flow');
  });

  it('unwraps Issue 28 subgraph context and encodes query + maxTokens', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        context: {
          start: { name: 'loadOrders', file: 'web/orders.ts', line: 1 },
          nodes: [],
          tokenCount: 12,
          truncated: false,
          prunedCount: 0,
          text: '# Agent Context: loadOrders'
        }
      })
    });
    const client = new RepoQAClient('http://api', fetcher as unknown as typeof fetch);
    const context = await client.getSubgraphContext('repo-1', 'loadOrders', 1200);
    expect(context.start.name).toBe('loadOrders');
    expect(fetcher).toHaveBeenCalledWith(
      'http://api/api/repos/repo-1/subgraph-context?query=loadOrders&maxTokens=1200'
    );
  });

  it('returns null for a missing dashboard (404) and throws on other failures', async () => {
    const notFound = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const client404 = new RepoQAClient('http://api', notFound as unknown as typeof fetch);
    await expect(client404.getDashboard('missing')).resolves.toBeNull();

    const failed = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const client500 = new RepoQAClient('http://api', failed as unknown as typeof fetch);
    await expect(client500.getTours('repo-1')).rejects.toThrow('getTours failed: 500');
  });
});

describe('RepoQAClient pre-import preview (Round 2 B4)', () => {
  it('posts the local path and unwraps the preview payload', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        preview: {
          path: 'C:/petclinic',
          fileCount: 47,
          javaFileCount: 9,
          xmlFileCount: 2,
          skippedDirCount: 2,
          skippedDirs: ['.git', 'node_modules']
        }
      })
    });
    const client = new RepoQAClient('http://api', fetcher as unknown as typeof fetch);
    await expect(client.previewRepo('C:/petclinic')).resolves.toMatchObject({
      fileCount: 47,
      skippedDirCount: 2
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://api/api/repos/preview',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ localPath: 'C:/petclinic' })
      })
    );
  });

  it('surfaces backend errors on non-ok responses', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'local path is not a directory' })
    });
    const client = new RepoQAClient('http://api', fetcher as unknown as typeof fetch);
    await expect(client.previewRepo('C:/nope')).rejects.toThrow(
      'previewRepo failed: 400: local path is not a directory'
    );
  });
});

describe('RepoQAClient personal lifecycle', () => {
  it('deletes a repo index and reindexes an existing repo', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 204 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ repo: { id: 'repo-1' } })
      });
    const client = new RepoQAClient('http://api', fetcher as unknown as typeof fetch);

    await expect(client.deleteRepo('r 1')).resolves.toBeUndefined();
    await expect(client.reindexRepo('r 1')).resolves.toEqual({ id: 'repo-1' });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      'http://api/api/repos/r%201',
      { method: 'DELETE' }
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      'http://api/api/repos/r%201/reindex',
      { method: 'POST' }
    );
  });

  it('surfaces backend errors for delete and reindex', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'repo is still indexing' })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Repo not found' })
      });
    const client = new RepoQAClient('http://api', fetcher as unknown as typeof fetch);

    await expect(client.deleteRepo('repo-1')).rejects.toThrow(
      'deleteRepo failed: 409: repo is still indexing'
    );
    await expect(client.reindexRepo('missing')).rejects.toThrow(
      'reindexRepo failed: 404: Repo not found'
    );
  });
});

describe('RepoQAClient onboarding export (issue 14)', () => {
  it('returns the ONBOARDING.md text and URL-encodes the repo id', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '# demo — ONBOARDING 架构交接手册\n'
    });
    const client = new RepoQAClient('http://api', fetcher as unknown as typeof fetch);
    await expect(client.exportOnboarding('r 1')).resolves.toContain('ONBOARDING');
    expect(fetcher).toHaveBeenCalledWith('http://api/api/repos/r%201/export/onboarding');
  });

  it('throws on non-ok responses so the UI can surface the failure', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const client = new RepoQAClient('http://api', fetcher as unknown as typeof fetch);
    await expect(client.exportOnboarding('repo-1')).rejects.toThrow(
      'exportOnboarding failed: 500'
    );
  });
});
