import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { startServer, type RunningServer } from './server';

/**
 * V27-31 graceful-shutdown regression pin.
 *
 * wss.close() and server.closeAllConnections() do NOT destroy an upgraded
 * WebSocket connection (probed on Node 24 + ws@8), so with a browser tab
 * holding /ws open, `await server.close()` inside RunningServer.close()
 * never resolved — SIGTERM's graceful handler hung forever, keeping the
 * process alive with a half-open client socket. Windows masks this because
 * child.kill() is TerminateProcess; Linux (CI Release UI smoke, v0.27.0
 * first run) exposed it: the page never saw 'close', never reconnected,
 * and the R2 lock went red. The fix terminates live ws clients before
 * closing the server; these tests pin BOTH halves: close() completes, and
 * the client actually observes the close.
 */

const servers: RunningServer[] = [];

async function boot(): Promise<RunningServer & { port: number }> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-shutdown-'));
  const running = await startServer({ env: { MHW_DATA_DIR: dataDir }, port: 0, watch: false });
  servers.push(running);
  const port = (running.server.address() as AddressInfo).port;
  return Object.assign(running, { port });
}

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    // Bounded teardown: if the bug regressed, a hanging close must not
    // wedge the whole suite — race it, and let the test assertion itself
    // report the hang. 8s window: loaded-CI scheduling slack (v0.29 flaky).
    await Promise.race([s.close(), new Promise((r) => setTimeout(r, 8000))]);
  }
});

describe('graceful shutdown with live WebSocket clients (V27-31)', () => {
  // CI hardening (v0.29 T6 flaky post-mortem): these tests do real socket
  // round-trips; the vitest 5s default collided with our own 3s observation
  // races on loaded runners. Test budget 15s, internal windows widened —
  // still far below any hang threshold, so a real V27-31 regression fails fast.
  it('close() resolves within budget while a /ws client is connected', { timeout: 15_000 }, async () => {
    const running = await boot();
    const client = new WebSocket(`ws://127.0.0.1:${running.port}/ws`);
    // The server sends system.welcome right after the handshake; await the
    // FRAME (not just 'open') so the connection is undeniably live at close.
    const welcome = await new Promise<string>((resolve, reject) => {
      client.on('message', (data) => resolve(String(data)));
      client.on('error', reject);
      setTimeout(() => reject(new Error('no welcome frame')), 8000);
    });
    expect(welcome).toContain('system.welcome');

    let hung = true;
    await Promise.race([
      running.close().then(() => {
        hung = false;
      }),
      new Promise((r) => setTimeout(r, 8000))
    ]);
    client.close();
    expect(hung, 'RunningServer.close() hung: live WS clients are not terminated before server.close()').toBe(false);
  });

  it('the client observes the close event (socket is really destroyed, not just the listener)', { timeout: 15_000 }, async () => {
    const running = await boot();
    const client = new WebSocket(`ws://127.0.0.1:${running.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      client.on('message', () => resolve());
      client.on('error', reject);
      setTimeout(() => reject(new Error('no welcome frame')), 3000);
    });
    const closedByServer = new Promise<boolean>((resolve) => {
      client.on('close', () => resolve(true));
      setTimeout(() => resolve(false), 8000);
    });
    await running.close();
    expect(await closedByServer).toBe(true);
  });

  it('idle connections are refused after close (listener gone)', async () => {
    const running = await boot();
    await running.close();
    await expect(
      new Promise((_res, rej) => {
        const c = new WebSocket(`ws://127.0.0.1:${running.port}/ws`);
        c.on('error', rej);
        setTimeout(() => rej(new Error('still accepting')), 2000);
      })
    ).rejects.toThrow();
  });
});
