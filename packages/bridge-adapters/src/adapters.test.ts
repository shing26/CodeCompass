/**
 * V27-28 (B1) — bridge-adapters unit tests.
 *
 * Before this ticket the package's only guardrail was `tsc --noEmit`; a
 * behavior regression surfaced to users solely through the control-plane
 * tests that touch HarnessManager. These tests pin the adapters' contract
 * directly: lifecycle transitions, the full success event sequence
 * (logs → tokens → done), cancellation short-circuits, and the shell
 * adapter's real-process paths (stdout/stderr piping, exit-code mapping,
 * missing-command failure). Everything runs locally — zero tokens, zero
 * network.
 *
 * Deliberate pins of current (intended) oddities: StubAdapter reports
 * type 'shell' — there is no 'stub' HarnessType in the contracts union and
 * no in-repo consumer relies on a distinct value; the test documents that
 * rather than "fixing" it.
 */
import { describe, expect, it } from 'vitest';
import type { Task } from '../../contracts/src/index';
import { BrowserAdapter, CodingAdapter, ShellAdapter, StubAdapter } from './index';
import type { AdapterContext, BridgeAdapter } from './types';

function makeCtx() {
  const logs: Array<[string, string]> = [];
  const tokens: Array<[number, number]> = [];
  const done: Array<Record<string, unknown>> = [];
  const failed: string[] = [];
  const ctx: AdapterContext = {
    onLog: (stream, text) => logs.push([stream, text]),
    onToken: (input, output) => tokens.push([input, output]),
    onDone: (output) => done.push(output),
    onFailed: (error) => failed.push(error)
  };
  return { ctx, logs, tokens, done, failed };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: 'ws-test',
    type: 'shell',
    status: 'assigned',
    input: {},
    createdAt: '2026-09-14T00:00:00Z',
    updatedAt: '2026-09-14T00:00:00Z',
    ...overrides
  };
}

const simulated = [
  ['stub', () => new StubAdapter()] as const,
  ['coding', () => new CodingAdapter()] as const,
  ['browser', () => new BrowserAdapter()] as const
];

describe.each(simulated)('simulated adapter contract — %s', (_name, ctor) => {
  it('lifecycle: disconnected → ready → disconnected', async () => {
    const a = ctor();
    expect(a.status()).toBe('disconnected');
    await a.connect();
    expect(a.status()).toBe('ready');
    await a.disconnect();
    expect(a.status()).toBe('disconnected');
  });

  it('success path logs → token → done exactly once, no failure', async () => {
    const a = ctor();
    await a.connect();
    const { ctx, logs, tokens, done, failed } = makeCtx();
    await a.submit(makeTask({ input: { delayMs: 1 } }), ctx);
    expect(logs.length).toBeGreaterThan(0);
    expect(tokens).toHaveLength(1);
    expect(done).toHaveLength(1);
    expect(failed).toEqual([]);
  });

  it('cancel before submit short-circuits: no done, no tokens', async () => {
    const a = ctor();
    await a.connect();
    const task = makeTask({ input: { delayMs: 200 } });
    await a.cancel(task.id);
    const { ctx, done, tokens, failed } = makeCtx();
    await a.submit(task, ctx);
    expect(done).toEqual([]);
    expect(tokens).toEqual([]);
    // Cancellation is a silent short-circuit, not a failure signal.
    expect(failed).toEqual([]);
  });

  it('cancel of an unknown task id is a no-op', async () => {
    const a = ctor();
    await expect(a.cancel('never-existed')).resolves.toBeUndefined();
  });

  it('type discriminator is declared', () => {
    expect(['coding', 'shell', 'browser', 'external']).toContain(ctor().type);
  });
});

describe('StubAdapter (V27-28 documented oddity)', () => {
  it('reports type "shell" — no "stub" HarnessType exists (pin, not bug)', () => {
    expect(new StubAdapter().type).toBe('shell');
  });

  it('honours custom lines and reports them in done payload', async () => {
    const a = new StubAdapter();
    await a.connect();
    const { ctx, logs, done } = makeCtx();
    await a.submit(makeTask({ input: { delayMs: 1, lines: ['one', 'two'] } }), ctx);
    expect(logs.map(([, text]) => text)).toEqual(['one', 'two']);
    expect(done[0]).toMatchObject({ mode: 'stub', lines: ['one', 'two'] });
  });
});

describe('BrowserAdapter details', () => {
  it('logs the target url and defaults to about:blank', async () => {
    const a = new BrowserAdapter();
    await a.connect();
    const { ctx, logs } = makeCtx();
    await a.submit(makeTask({ input: { delayMs: 1 } }), ctx);
    expect(logs[0]).toEqual(['system', 'browser harness: opening about:blank']);
  });
});

describe('CodingAdapter details', () => {
  it('truncates the planning line to 80 chars of the prompt', async () => {
    const a = new CodingAdapter();
    await a.connect();
    const long = 'x'.repeat(200);
    const { ctx, logs } = makeCtx();
    await a.submit(makeTask({ input: { delayMs: 1, prompt: long } }), ctx);
    expect(logs[0]![1]).toContain('x'.repeat(80));
    expect(logs[0]![1]).not.toContain('x'.repeat(81));
  });
});

describe('ShellAdapter (real child processes, no network)', () => {
  it('success: stdout streamed, exit 0 → done with exitCode/command', async () => {
    const a = new ShellAdapter();
    await a.connect();
    const { ctx, logs, tokens, done, failed } = makeCtx();
    await a.submit(makeTask({ input: { command: 'echo cc-bridge-smoke' } }), ctx);
    expect(logs.some(([, t]) => t.includes('cc-bridge-smoke'))).toBe(true);
    expect(tokens).toEqual([[10, 0]]);
    expect(done[0]).toMatchObject({ exitCode: 0, command: 'echo cc-bridge-smoke' });
    expect(failed).toEqual([]);
  });

  it('non-zero exit maps to onFailed, not onDone', async () => {
    const a = new ShellAdapter();
    await a.connect();
    const { ctx, done, failed } = makeCtx();
    // cmd.exe accepts `exit 7`; POSIX sh accepts it too — cross-platform by design.
    await a.submit(makeTask({ input: { command: 'exit 7' } }), ctx);
    expect(done).toEqual([]);
    expect(failed).toEqual(['command exited with code 7']);
  });

  it('missing command fails fast without spawning', async () => {
    const a = new ShellAdapter();
    await a.connect();
    const { ctx, done, failed, logs } = makeCtx();
    await a.submit(makeTask({ input: {} }), ctx);
    expect(failed).toEqual(['shell task input.command is required']);
    expect(done).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('unresolvable command surfaces as failure (not silence)', async () => {
    const a = new ShellAdapter();
    await a.connect();
    const { ctx, done, failed } = makeCtx();
    await a.submit(makeTask({ input: { command: 'definitely-not-a-real-binary-xyz' } }), ctx);
    expect(done).toEqual([]);
    expect(failed.length).toBe(1);
  });

  it('cancel kills the running child: no done arrives afterwards', async () => {
    const a = new ShellAdapter();
    await a.connect();
    const task = makeTask({
      // bounded sleeper, portable without extra binaries; the || arms cover
      // cmd.exe (ping -n, nul) and POSIX sh (ping -c, /dev/null)
      input: { command: 'ping -n 10 127.0.0.1 > nul 2>&1 || ping -c 10 127.0.0.1 >/dev/null' }
    });
    const { ctx, done } = makeCtx();
    const running = a.submit(task, ctx);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await a.cancel(task.id);
    // Do NOT await `running` unconditionally: a killed shell's 'close' event
    // can be delayed by the grandchild holding inherited stdio pipes (platform
    // dependent). Observing "no done within the window" is the real contract.
    await Promise.race([running.catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]);
    expect(done).toEqual([]);
  });

  it('disconnect kills tracked children and clears state', async () => {
    const a = new ShellAdapter();
    await a.connect();
    const { ctx, logs } = makeCtx();
    await a.submit(makeTask({ input: { command: 'echo bye' } }), ctx);
    await a.disconnect();
    expect(a.status()).toBe('disconnected');
    expect(logs.some(([, t]) => t.includes('bye'))).toBe(true);
  });
});

describe('BridgeAdapter shape (type-level, zero runtime)', () => {
  it('all four classes satisfy the interface', () => {
    const adapters: BridgeAdapter[] = [
      new StubAdapter(),
      new ShellAdapter(),
      new BrowserAdapter(),
      new CodingAdapter()
    ];
    for (const a of adapters) {
      expect(typeof a.connect).toBe('function');
      expect(typeof a.disconnect).toBe('function');
      expect(typeof a.submit).toBe('function');
      expect(typeof a.cancel).toBe('function');
      expect(typeof a.status()).toBe('string');
      expect(['disconnected', 'connecting', 'ready', 'busy', 'error']).toContain(a.status());
    }
  });
});
