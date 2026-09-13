/**
 * V27-24 (A1 container smoke) regression pin.
 *
 * The container CMD boots `cli.js` with no `--no-browser`; inside
 * node:*-slim images `xdg-open` does not exist, so the platform spawn fails
 * with an ASYNC ENOENT that a sync try/catch cannot see. Without an 'error'
 * listener the ChildProcess throws an uncaught exception and the just-started
 * server dies — the bug the image had from day one, invisible because CI
 * never built or ran the container. This test pins both halves of the fix:
 * the listener is attached, and an emitted ENOENT stays contained.
 */
import type { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const { spawned } = vi.hoisted(() => ({ spawned: [] as Array<{ child: EventEmitter & { unref(): void } }> }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref(): void };
      child.unref = () => {};
      spawned.push({ child });
      // Mimic the real failure mode: ENOENT lands on the NEXT tick.
      setImmediate(() => {
        const err = Object.assign(new Error('spawn xdg-open ENOENT'), {
          code: 'ENOENT',
          errno: -2,
          syscall: 'spawn'
        });
        child.emit('error', err);
      });
      return child;
    })
  };
});

describe('openBrowser best-effort contract (V27-24)', () => {
  it('attaches an error listener so async spawn ENOENT cannot kill the server', async () => {
    const { openBrowser } = await import('./cli.js');
    openBrowser('http://127.0.0.1:43110/');
    expect(spawned.length).toBe(1);
    expect(spawned[0].child.listenerCount('error')).toBeGreaterThan(0);
    // The setImmediate above emits ENOENT; with a listener it is swallowed.
    // Without the fix this surfaces as an unhandled error and fails the file.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(spawned[0].child.listenerCount('error')).toBeGreaterThan(0);
  });
});
