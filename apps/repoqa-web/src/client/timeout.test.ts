import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  NetworkTimeoutError,
  fetchWithTimeout
} from './timeout';

afterEach(() => {
  vi.useRealTimers();
});

describe('v0.27-B R2: fetchWithTimeout', () => {
  it('rejects with NetworkTimeoutError (code network_timeout) once the header budget elapses', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    const fetchImpl = ((_: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {}); // never settles — hung server
    }) as unknown as typeof fetch;

    const promise = fetchWithTimeout(fetchImpl, 'http://x/api', {}, 15_000);
    const rejection = expect(promise).rejects.toBeInstanceOf(NetworkTimeoutError);
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(capturedSignal?.aborted).toBe(true);
    const err = (await promise.catch((e) => e)) as NetworkTimeoutError;
    expect(err.code).toBe('network_timeout');
  });

  it('init.timeoutMs overrides the default budget', async () => {
    vi.useFakeTimers();
    const fetchImpl = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const p = fetchWithTimeout(fetchImpl, 'http://x', { timeoutMs: 30_000 } as RequestInit);
    const r = expect(p).rejects.toBeInstanceOf(NetworkTimeoutError);
    await vi.advanceTimersByTimeAsync(15_000); // default budget gone, override still alive
    await vi.advanceTimersByTimeAsync(15_000);
    await r;
  });

  it('the timer is cleared when headers arrive — slow bodies are never aborted', async () => {
    vi.useFakeTimers();
    // Body enqueues 30s after headers; a naive 15s abort timer would kill it.
    // Correct behavior: once headers resolve, the budget timer is cleared, so
    // advancing past 15s (and even past 30s+) must NOT reject.
    const fetchImpl = ((_: RequestInfo | URL, init?: RequestInit) => {
      const aborted = init?.signal;
      return new Promise<Response>((resolve, reject) => {
        const inner = setTimeout(() => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(new TextEncoder().encode('late-chunk'));
                controller.close();
              }, 20_000);
            }
          });
          resolve(new Response(body, { status: 200 }));
        }, 14_000);
        void inner;
        aborted?.addEventListener('abort', () => reject(new Error('abort')));
      });
    }) as unknown as typeof fetch;

    const resPromise = fetchWithTimeout(fetchImpl, 'http://x/stream', {}, 15_000);
    await vi.advanceTimersByTimeAsync(14_500); // headers land (inner 14s)
    const res = await resPromise;
    await vi.advanceTimersByTimeAsync(40_000); // well past the 15s budget + body delay
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('late-chunk');
  });

  it('non-timeout rejections pass through untouched', async () => {
    const boom = new TypeError('Failed to fetch');
    const fetchImpl = (() => Promise.reject(boom)) as unknown as typeof fetch;
    await expect(fetchWithTimeout(fetchImpl, 'http://x', {})).rejects.toBe(boom);
  });

  it('Infinity (or any non-finite/non-positive budget) disables the timeout', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const res = await fetchWithTimeout(fetchImpl, 'http://x', { timeoutMs: Infinity });
    expect(res.status).toBe(200);
    // and the caller's own signal is forwarded untouched (no wrapper controller)
    const controller = new AbortController();
    await fetchWithTimeout(fetchImpl, 'http://x2', { timeoutMs: 0, signal: controller.signal });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1].signal).toBe(
      controller.signal
    );
  });

  it('a synchronous throw from the fetch impl still clears its timer (P2-4)', async () => {
    vi.useFakeTimers();
    const fetchImpl = (() => {
      throw new Error('sync boom');
    }) as unknown as typeof fetch;
    await expect(fetchWithTimeout(fetchImpl, 'http://x', {}, 50_000)).rejects.toThrow('sync boom');
    // If the catch branch forgot clearTimeout, a 50s abort timer would linger.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caller-provided signal survives alongside the budget (P2-2)', async () => {
    let seenSignal: AbortSignal | undefined;
    const fetchImpl = ((_: RequestInfo | URL, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;
    const caller = new AbortController();
    await fetchWithTimeout(fetchImpl, 'http://x', { signal: caller.signal }, 50_000);
    expect(seenSignal).toBeDefined();
    // with AbortSignal.any support it's the merged signal; without, the caller's.
    caller.abort();
    expect(seenSignal!.aborted || seenSignal === caller.signal).toBeTruthy();
  });

  it('default budget is exported and sane', () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBe(15_000);
  });
});
