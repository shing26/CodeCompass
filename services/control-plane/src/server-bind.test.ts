import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startServer, type RunningServer } from './server';
import { displayHost, isLoopbackListenAddress, loadConfig, cockpitBaseUrl } from './config';
import type { AddressInfo } from 'node:net';

/**
 * v0.27-B R4（V27-1 安全票）——控制面默认绑 127.0.0.1。
 * 现网默认 = Express 无 host listen → 全网卡零鉴权暴露面。裁决 Q2：
 * 默认回环，MHW_CP_HOST=0.0.0.0 显式逃生（本机产品允许 LAN 展示场景）。
 */

const servers: RunningServer[] = [];

async function boot(env: Record<string, string | undefined>): Promise<RunningServer> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-bind-'));
  const running = await startServer({
    env: { MHW_DATA_DIR: dataDir, ...env },
    port: 0,
    watch: false
  });
  servers.push(running);
  return running;
}

afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
  vi.restoreAllMocks();
});

describe('v0.27-B R4: loopback-first binding (V27-1)', () => {
  it('default binds 127.0.0.1 and /health echoes boundHost', { timeout: 15_000 }, async () => {
    const running = await boot({ MHW_CP_HOST: undefined });
    const addr = running.server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
    const health = (await (await fetch(`http://127.0.0.1:${addr.port}/health`)).json()) as {
      status: string;
      boundHost: string;
    };
    expect(health.status).toBe('ok');
    expect(health.boundHost).toBe('127.0.0.1');
  });

  // CI hardening (v0.29 T3 flaky post-mortem): real listen+fetch round-trips
  // need more than vitest's 5s default on loaded runners.
  it('MHW_CP_HOST=0.0.0.0 escapes to all interfaces AND logs a LAN warning', { timeout: 15_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const running = await boot({ MHW_CP_HOST: '0.0.0.0' });
    const addr = running.server.address() as AddressInfo;
    expect(addr.address).toBe('0.0.0.0');
    const health = (await (await fetch(`http://127.0.0.1:${addr.port}/health`)).json()) as {
      boundHost: string;
    };
    expect(health.boundHost).toBe('0.0.0.0');
    expect(
      warn.mock.calls.some(
        (c) => String(c[0]).includes('0.0.0.0') && String(c[0]).toLowerCase().includes('lan')
      )
    ).toBe(true);
  });

  it('MHW_CP_HOST=127.0.0.1 is an explicit no-op (no warning)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const running = await boot({ MHW_CP_HOST: '127.0.0.1' });
    expect((running.server.address() as AddressInfo).address).toBe('127.0.0.1');
    expect(warn).not.toHaveBeenCalled();
  });

  it('an unbindable host rejects cleanly (no half-dead listener, R4 review P2-6)', async () => {
    // 203.0.113.0/24 = TEST-NET-3，任何机器都不该持有 → 必 EADDRNOTAVAIL。
    await expect(boot({ MHW_CP_HOST: '203.0.113.42' })).rejects.toThrow(/EADDRNOTAVAIL|address/);
  });

  it('loadConfig host rules: trim, blank→default, explicit kept', () => {
    expect(loadConfig({}).host).toBe('127.0.0.1');
    expect(loadConfig({ MHW_CP_HOST: '   ' }).host).toBe('127.0.0.1');
    expect(loadConfig({ MHW_CP_HOST: ' 0.0.0.0 ' }).host).toBe('0.0.0.0');
    expect(loadConfig({ MHW_CP_HOST: '::1' }).host).toBe('::1');
  });

  it('displayHost + isLoopbackListenAddress units (shared rules, P2-3)', () => {
    expect(displayHost('0.0.0.0')).toBe('localhost');
    expect(displayHost('::')).toBe('localhost');
    expect(displayHost('')).toBe('localhost');
    expect(displayHost('127.0.0.1')).toBe('127.0.0.1');
    expect(displayHost('192.168.1.5')).toBe('192.168.1.5');
    // 回环段整体判真（127.0.0.2 不该误报告警）；::1 两写法；路由地址必假。
    expect(isLoopbackListenAddress('127.0.0.1', 'IPv4')).toBe(true);
    expect(isLoopbackListenAddress('127.5.5.5', 'IPv4')).toBe(true);
    expect(isLoopbackListenAddress('::1', 'IPv6')).toBe(true);
    expect(isLoopbackListenAddress('0:0:0:0:0:0:0:1', 'IPv6')).toBe(true);
    expect(isLoopbackListenAddress('0.0.0.0', 'IPv4')).toBe(false);
    expect(isLoopbackListenAddress('192.168.1.5', 'IPv4')).toBe(false);
    expect(isLoopbackListenAddress(undefined, undefined)).toBe(false);
  });

  it('cockpitBaseUrl = display host + port, the one deep-link authority (V27-22)', () => {
    // Default loopback bind → 127.0.0.1 literal (NOT the old hardcoded
    // "http://localhost" the MCP deep links carried before V27-22).
    expect(cockpitBaseUrl({})).toBe('http://127.0.0.1:43110');
    // LAN escape: unreachable bind host degrades to localhost for display…
    expect(cockpitBaseUrl({ MHW_CP_HOST: '0.0.0.0' })).toBe('http://localhost:43110');
    // …while a concrete interface stays reachable verbatim — deep links now
    // actually open instead of pointing at a localhost nobody bound.
    expect(cockpitBaseUrl({ MHW_CP_HOST: '192.168.1.7', MHW_CP_PORT: '5555' })).toBe(
      'http://192.168.1.7:5555'
    );
  });
});
