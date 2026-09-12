import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import {
  asyncHandler,
  errorMiddleware,
  requestIdMiddleware
} from './http-error';
import { createHttpApp } from './http';
import { openDb } from './db';
import { EventBus } from './events';
import { HarnessManager } from './harness-manager';
import { Orchestrator } from './orchestrator';
import { Repos } from './repos';
import { RepoQARepos } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';

function buildApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.get('/boom', asyncHandler(async () => {
    throw new Error('postgres://user:super-secret-pw@db/app');
  }));
  app.get('/boom-sync', () => {
    throw new Error('sync-boom-secret');
  });
  app.get('/boom-after-head', asyncHandler(async (req, res) => {
    res.write('partial-body');
    await new Promise((r) => setTimeout(r, 10));
    throw new Error('late-boom');
  }));
  app.get('/ok', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/too-large', asyncHandler(async () => {
    const e = new Error('request entity too large') as Error & { status: number };
    e.status = 413;
    throw e;
  }));
  app.use(errorMiddleware);
  return app;
}

async function withServer(
  app: express.Express,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('v0.27-B R1: asyncHandler + error middleware + request id', () => {
  it('async rejection → JSON 500, generic message, no secret leak', async () => {
    await withServer(buildApp(), async (base) => {
      const res = await fetch(`${base}/boom`);
      expect(res.status).toBe(500);
      const body = await res.text();
      expect(JSON.parse(body)).toEqual({
        error: 'internal server error',
        code: 'internal_error'
      });
      expect(body).not.toContain('super-secret-pw');
      expect(body).not.toContain('at ');
    });
  });

  it('sync throw → JSON 500 too (never Express HTML page)', async () => {
    await withServer(buildApp(), async (base) => {
      const res = await fetch(`${base}/boom-sync`);
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = await res.text();
      expect(body).not.toContain('sync-boom-secret');
    });
  });

  it('request id header present and unique per request', async () => {
    await withServer(buildApp(), async (base) => {
      const a = await fetch(`${base}/ok`);
      const b = await fetch(`${base}/ok`);
      const ida = a.headers.get('x-mhw-request-id');
      const idb = b.headers.get('x-mhw-request-id');
      expect(ida).toMatch(/^req-/);
      expect(idb).toMatch(/^req-/);
      expect(ida).not.toBe(idb);
    });
  });

  it('500 response carries the request id for correlation', async () => {
    await withServer(buildApp(), async (base) => {
      const res = await fetch(`${base}/boom`);
      expect(res.headers.get('x-mhw-request-id')).toMatch(/^req-/);
    });
  });

  it('throw after headers sent: partial bytes delivered, server stays alive (no crash)', async () => {
    // Raw http client on purpose: undici rejects the socket-destroyed stream
    // as `terminated`; the R1 contract is "the process does not crash and the
    // bytes already written are what the client gets".
    const app = buildApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const raw = await new Promise<{ status: number; body: string }>((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/boom-after-head`, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          res.on('error', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on('error', () => {});
      });
      expect(raw.status).toBe(200);
      expect(raw.body).toBe('partial-body');
      // server still healthy after the late throw
      const ok = await fetch(`http://127.0.0.1:${port}/ok`);
      expect(ok.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('real createHttpApp wires requestId on existing routes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-httpr1-'));
    const db = openDb(':memory:');
    const repoqa = new RepoQARepos(db);
    const eventBus = new EventBus();
    const app = createHttpApp({
      repos: new Repos(db),
      orchestrator: new Orchestrator(new Repos(db)),
      harnessManager: new HarnessManager({
        repos: new Repos(db),
        eventBus
      }),
      repoqa,
      worker: new RepoQAWorker(repoqa, eventBus),
      eventBus,
      version: 'test',
      dataDir: tempDir,
      port: 0,
      exportDir: path.join(tempDir, 'exports')
    });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/repos`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-mhw-request-id')).toMatch(/^req-/);
      // malformed JSON still answers the JSON 400 (Bug-13 regression)
      const bad = await fetch(`${base}/api/repos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{oops'
      });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({ error: 'invalid JSON body', code: 'invalid_json' });
    });
    db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('body-parser 4xx family keeps its status (not flattened to 500)', async () => {
    await withServer(buildApp(), async (base) => {
      const res = await fetch(`${base}/too-large`);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'request error', code: 'request_error' });
    });
  });

  // R1 review P1-1/P2-2 — stderr 行契约：requestId 可关联 + 凭据掩码（DSN 不得裸落）。
  it('stderr line: request-id correlation + credential masking (R5 pre-contract)', async () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk) => {
        writes.push(String(chunk));
        return true;
      });
    try {
      await withServer(buildApp(), async (base) => {
        const res = await fetch(`${base}/boom`);
        const reqId = res.headers.get('x-mhw-request-id');
        const line = writes
          .map((w) => {
            try {
              return JSON.parse(w) as Record<string, unknown>;
            } catch {
              return null;
            }
          })
          .find((o) => o && o.scope === 'http' && o.level === 'error');
        expect(line, 'expected one stderr JSON line for the 500').toBeTruthy();
        expect(line!.requestId).toBe(reqId);
        expect(line!.method).toBe('GET');
        expect(line!.path).toBe('/boom');
        const rendered = JSON.stringify(line);
        expect(rendered).not.toContain('super-secret-pw');
      });
    } finally {
      spy.mockRestore();
    }
  });

  // R1 review P2-3 — headersSent 守卫的单元级钉：必须 next(err) 且不碰 res。
  it('headersSent: guard forwards to next, never touches res (unit-level)', () => {
    const next = vi.fn();
    const res = {
      headersSent: true,
      status: vi.fn(),
      json: vi.fn(),
      locals: { requestId: 'req-test' }
    } as unknown as Parameters<typeof errorMiddleware>[2];
    const req = { method: 'GET', path: '/boom' } as unknown as Parameters<
      typeof errorMiddleware
    >[1];
    errorMiddleware(new Error('late'), req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
