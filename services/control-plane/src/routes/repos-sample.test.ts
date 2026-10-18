/**
 * v1.4 票 01 — sample project endpoint (`POST /api/repos/sample`).
 *
 * Two layers:
 *  1. Router contract with fake deps: 202 shape, materialization on disk,
 *     double-click guard (no second index run while one is live).
 *  2. Real-index integration: the bundled sample, through RepoQARepos +
 *     RepoQAWorker on an in-memory db, must produce the routes / middleware
 *     anchor / resolvable chain the demo depends on.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerReposIngestRoutes } from './repos';
import type { HttpDeps } from './deps';
import { SAMPLE_PROJECT, sampleFileTarget } from '../ingest/sample-project';
import { openDb } from '../db';
import { RepoQARepos } from '../ingest/repoqa-repos';
import { RepoQAWorker } from '../ingest/repoqa-worker';
import { EventBus } from '../events';
import { buildCallIndex, CallResolver } from '../engine/repoqa-callchain';
import { buildTraceResult } from '../engine/repoqa-trace';
import { buildTours } from '../engine/repoqa-tours';

describe('POST /api/repos/sample contract (v1.4 ticket 01)', () => {
  let baseUrl = '';
  let server: http.Server;
  let dataDir = '';

  const repo = {
    id: 'r-sample',
    name: SAMPLE_PROJECT.name,
    localPath: '',
    branch: 'main',
    status: 'ready',
    error: null,
    fileCount: 0,
    symbolCount: 0
  };
  let repoStatus = 'ready';
  const upsertByLocalPath = vi.fn(() => ({ repo: { ...repo, status: repoStatus }, created: true }));
  const updateRepoStatus = vi.fn();
  const getRepo = vi.fn(() => ({ ...repo, status: repoStatus }));
  const indexRepo = vi.fn(() => Promise.resolve({ repo, created: true }));

  beforeAll(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sample-endpoint-'));
    const deps = {
      dataDir,
      repoqa: { upsertByLocalPath, updateRepoStatus, getRepo },
      worker: { indexRepo },
      eventBus: { emit: vi.fn() }
    } as unknown as HttpDeps;
    const app = express();
    app.use(express.json());
    registerReposIngestRoutes(app, deps);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('materializes the sample tree and answers 202 with an indexing task', async () => {
    const res = await fetch(`${baseUrl}/api/repos/sample`, { method: 'POST' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { repo?: { id?: string }; taskId?: string };
    expect(body.repo?.id).toBe('r-sample');
    expect(body.taskId).toBe('index-r-sample');
    const root = path.join(dataDir, 'samples', SAMPLE_PROJECT.slug);
    for (const [relative, content] of Object.entries(SAMPLE_PROJECT.files)) {
      await expect(fs.readFile(sampleFileTarget(root, relative), 'utf8')).resolves.toBe(content);
    }
    expect(indexRepo).toHaveBeenCalledTimes(1);
    expect(updateRepoStatus).toHaveBeenCalledWith('r-sample', 'indexing');
  });

  it('does not start a second index run while the sample is still indexing', async () => {
    repoStatus = 'indexing';
    upsertByLocalPath.mockReturnValueOnce({ repo: { ...repo, status: 'indexing' }, created: false });
    indexRepo.mockClear();
    const res = await fetch(`${baseUrl}/api/repos/sample`, { method: 'POST' });
    expect(res.status).toBe(202);
    expect(indexRepo).not.toHaveBeenCalled();
    repoStatus = 'ready';
  });

  it('does not roll back user edits unless the bundled content changes (v1.4.1 review P2)', async () => {
    const root = path.join(dataDir, 'samples', SAMPLE_PROJECT.slug);
    const serverFile = sampleFileTarget(root, 'src/server.ts');
    await fs.writeFile(serverFile, '// user edit\n', 'utf8');
    repoStatus = 'ready';
    await fetch(`${baseUrl}/api/repos/sample`, { method: 'POST' });
    await expect(fs.readFile(serverFile, 'utf8')).resolves.toBe('// user edit\n');

    // Removing the stamp forces a refresh (new bundled content / manual reset).
    await fs.rm(path.join(dataDir, 'samples', `${SAMPLE_PROJECT.slug}.stamp`), { force: true });
    await fetch(`${baseUrl}/api/repos/sample`, { method: 'POST' });
    await expect(fs.readFile(serverFile, 'utf8')).resolves.toBe(
      SAMPLE_PROJECT.files['src/server.ts']
    );
  });
});

describe('sample project indexes into a demo-ready graph (v1.4 ticket 01)', () => {
  it('produces the routes, middleware anchor and resolvable chains the demo shows', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sample-index-'));
    for (const [relative, content] of Object.entries(SAMPLE_PROJECT.files)) {
      const target = sampleFileTarget(root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
    }
    const db = openDb(':memory:');
    const repoqa = new RepoQARepos(db);
    const worker = new RepoQAWorker(repoqa, new EventBus());
    try {
      const result = await worker.indexRepo({ localPath: root, name: SAMPLE_PROJECT.name });
      expect(result.repo?.status).toBe('ready');
      expect(result.repo?.fileCount).toBe(Object.keys(SAMPLE_PROJECT.files).length);
      const graph = worker.getSymbolGraph(result.repo!.id);
      const routes = graph.symbols.filter((symbol) => symbol.kind === 'route');
      const routeNames = routes.map((symbol) => symbol.name);
      expect(routeNames).toContain('GET /api/tasks');
      expect(routeNames).toContain('POST /api/tasks');
      expect(routeNames).toContain('POST /api/tasks/:id/complete');
      expect(routeNames).toContain('USE *');

      // The middleware anchor (ticket 17 semantics) must resolve to the named
      // middleware — this is the middleware-chain tour's first edge.
      const useRoute = routes.find((symbol) => symbol.name === 'USE *')!;
      const resolver = new CallResolver(graph.symbols, graph.index);
      const middlewareCall = useRoute.calls?.[0];
      expect(middlewareCall?.method).toBe('authMiddleware');
      const middleware = resolver.resolve(useRoute, middlewareCall!);
      expect('target' in middleware && middleware.target.name).toBe('authMiddleware');

      // The create-task route resolves through the service into the repository.
      const createRoute = routes.find((symbol) => symbol.name === 'POST /api/tasks')!;
      const trace = buildTraceResult(graph.symbols, createRoute, graph.index, { up: 0, down: 3 });
      const flatten = (nodes: { name: string; children: unknown[] }[]): string[] =>
        nodes.flatMap((node) => [node.name, ...flatten(node.children as never[])]);
      const names = flatten(trace.down.roots as never[]);
      expect(names).toContain('createTask');
      expect(names).toContain('save');
      // Honest boundary accounting: the sample calls console.log and next(),
      // which the engine reports as breaks instead of inventing edges.
      expect(
        trace.breaks.dynamic + trace.breaks.external + trace.breaks.unresolved
      ).toBeGreaterThan(0);

      // At least one deterministic tour must have steps (middleware chain or
      // main flow) — the onboarding player needs something to play.
      const tours = buildTours({ repoId: result.repo!.id, symbols: graph.symbols });
      expect(tours.some((tour) => tour.steps.length > 0)).toBe(true);

      // Sanity: the call index was built from a non-empty symbol graph.
      expect(buildCallIndex(graph.symbols).methodsByName.size).toBeGreaterThan(5);
    } finally {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
