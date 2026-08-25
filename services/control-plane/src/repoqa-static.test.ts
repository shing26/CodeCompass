import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { EventBus } from './events';
import { HarnessManager } from './harness-manager';
import { createHttpApp } from './http';
import { Orchestrator } from './orchestrator';
import { RepoQARepos } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { Repos } from './repos';

const INDEX_MARKER = '<html><body>CC-STATIC</body></html>';
const ASSET_BODY = 'console.log("cc")';

async function makeStaticDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-static-'));
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), INDEX_MARKER);
  await fs.writeFile(path.join(dir, 'assets', 'app.js'), ASSET_BODY);
  return dir;
}

interface StaticTestServer {
  baseUrl: string;
  close(): Promise<void>;
}

async function startStaticServer(staticDir?: string): Promise<StaticTestServer> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-static-data-'));
  const db = openDb(':memory:');
  const repos = new Repos(db);
  const repoqa = new RepoQARepos(db);
  const eventBus = new EventBus();
  const worker = new RepoQAWorker(repoqa, eventBus);
  const orchestrator = new Orchestrator(repos);
  const harnessManager = new HarnessManager({ repos, eventBus });
  const app = createHttpApp({
    repos,
    orchestrator,
    harnessManager,
    repoqa,
    worker,
    eventBus,
    version: 'test',
    dataDir: tempDir,
    port: 0,
    exportDir: path.join(tempDir, 'exports'),
    staticDir
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
    }
  };
}

describe('Issue 16 static hosting + SPA fallback', () => {
  it('serves index.html and asset files from the static dir', async () => {
    const staticDir = await makeStaticDir();
    const ctx = await startStaticServer(staticDir);

    const root = await fetch(`${ctx.baseUrl}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('CC-STATIC');

    const index = await fetch(`${ctx.baseUrl}/index.html`);
    expect(index.status).toBe(200);
    expect((index.headers.get('content-type') ?? '').includes('text/html')).toBe(true);

    const asset = await fetch(`${ctx.baseUrl}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe(ASSET_BODY);

    await ctx.close();
  });

  it('falls back to index.html for unknown non-API GETs (SPA deep links)', async () => {
    const staticDir = await makeStaticDir();
    const ctx = await startStaticServer(staticDir);

    const deep = await fetch(`${ctx.baseUrl}/repos/repo-1/whatever`);
    expect(deep.status).toBe(200);
    expect((deep.headers.get('content-type') ?? '').includes('text/html')).toBe(true);
    expect(await deep.text()).toContain('CC-STATIC');

    const head = await fetch(`${ctx.baseUrl}/nested/path`, { method: 'HEAD' });
    expect(head.status).toBe(200);

    await ctx.close();
  });

  it('never lets the SPA fallback swallow /api routes', async () => {
    const staticDir = await makeStaticDir();
    const ctx = await startStaticServer(staticDir);

    const api = await fetch(`${ctx.baseUrl}/api/repos`);
    expect(api.status).toBe(200);
    const body = (await api.json()) as { repos: unknown[] };
    expect(Array.isArray(body.repos)).toBe(true);

    const missingApi = await fetch(`${ctx.baseUrl}/api/nonexistent`);
    expect(missingApi.status).toBe(404);
    expect((missingApi.headers.get('content-type') ?? '').includes('application/json')).toBe(true);
    const missingBody = (await missingApi.json()) as { error: string };
    expect(missingBody.error).toBe('not found');

    await ctx.close();
  });

  it('does not serve SPA html for non-GET verbs', async () => {
    const staticDir = await makeStaticDir();
    const ctx = await startStaticServer(staticDir);

    const post = await fetch(`${ctx.baseUrl}/`, { method: 'POST', body: 'x' });
    expect(post.status).toBe(404);
    expect(await post.text()).not.toContain('CC-STATIC');

    await ctx.close();
  });

  it('leaves routes untouched when no static dir is configured', async () => {
    const ctx = await startStaticServer();

    const root = await fetch(`${ctx.baseUrl}/`);
    expect(root.status).toBe(404);

    const api = await fetch(`${ctx.baseUrl}/api/repos`);
    expect(api.status).toBe(200);

    await ctx.close();
  });

  it('skips static mounting when the dir has no index.html', async () => {
    const staticDir = await makeStaticDir();
    await fs.rm(path.join(staticDir, 'index.html'));
    const ctx = await startStaticServer(staticDir);

    const root = await fetch(`${ctx.baseUrl}/`);
    expect(root.status).toBe(404);

    await ctx.close();
  });
});
