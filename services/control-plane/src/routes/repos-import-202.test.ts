/**
 * v1.2 票 03（V29-1 后半）— POST /api/repos 转 202 契约：
 * ① 有效路径 → **202 秒回** { repo(status=indexing), taskId }，索引在后台跑
 *    （用例以挂起的 indexRepo promise 证明「不等」）；
 * ② 坏路径 → 400 import_failed 且**不建行**（upsert 零调用，保留旧语义）；
 * ③ 僵尸防线：fire-and-forget 的 indexRepo reject → 行翻 error 带根因
 *    （ADR-0016 §3 禁止行永远停在 indexing）。
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

describe('POST /api/repos → 202 (v1.2 票 03)', () => {
  let baseUrl = '';
  let server: http.Server;
  let dirPath = '';
  let filePath = '';

  const repo = {
    id: 'r1',
    name: 'demo',
    localPath: '',
    branch: 'main',
    status: 'idle',
    error: null,
    fileCount: 0,
    symbolCount: 0
  };
  const upsertByLocalPath = vi.fn(() => ({ repo, created: true }));
  const updateRepoStatus = vi.fn();
  const getRepo = vi.fn(() => repo);
  const indexRepo = vi.fn(() => Promise.resolve({ repo, created: true }));

  beforeAll(async () => {
    dirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'import-202-'));
    filePath = path.join(dirPath, 'a-file.txt');
    await fs.writeFile(filePath, 'x');
    const deps = {
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
    await fs.rm(dirPath, { recursive: true, force: true });
  });

  it('returns 202 { repo, taskId } without waiting for the index to finish', async () => {
    upsertByLocalPath.mockClear();
    updateRepoStatus.mockClear();
    indexRepo.mockClear();
    // indexRepo 挂起不落——若路由仍在 await，这个请求会超时而非秒回。
    let release!: () => void;
    indexRepo.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ repo, created: true });
        })
    );

    const res = await fetch(`${baseUrl}/api/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPath: dirPath, name: 'demo' })
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { repo: typeof repo; taskId: string };
    expect(body.taskId).toBe('index-r1');
    expect(body.repo.id).toBe('r1');
    expect(updateRepoStatus).toHaveBeenCalledWith('r1', 'indexing');
    expect(indexRepo).toHaveBeenCalledTimes(1);
    expect(upsertByLocalPath).toHaveBeenCalledWith(
      expect.objectContaining({ localPath: dirPath, name: 'demo' })
    );
    release();
  });

  it('rejects a non-directory path with 400 and creates no repo row', async () => {
    upsertByLocalPath.mockClear();
    const missing = await fetch(`${baseUrl}/api/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPath: path.join(dirPath, 'nope') })
    });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { code?: string }).code).toBe('import_failed');

    const notADir = await fetch(`${baseUrl}/api/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPath: filePath })
    });
    expect(notADir.status).toBe(400);
    // 坏路径不建行：upsert 一次都没被调用（旧语义保留）
    expect(upsertByLocalPath).not.toHaveBeenCalled();
  });

  it('zombie defense: a pre-try rejection flips the row to error with the cause', async () => {
    updateRepoStatus.mockClear();
    indexRepo.mockImplementationOnce(() => Promise.reject(new Error('pre-try boom')));
    const res = await fetch(`${baseUrl}/api/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPath: dirPath })
    });
    expect(res.status).toBe(202);
    await vi.waitFor(() => {
      expect(updateRepoStatus).toHaveBeenCalledWith('r1', 'error', undefined, undefined, 'pre-try boom');
    });
  });
});
