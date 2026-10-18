/**
 * v1.4 票 03 — 导入路径契约：文案说绝对路径，服务端却默默按 cwd 解析相对路径。
 * 契约收口 = preview 显式回传 resolvedPath/wasRelative，POST 存**绝对路径**，
 * 400 消息带上解析结果。
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

describe('import path contract (v1.4 ticket 03)', () => {
  let baseUrl = '';
  let server: http.Server;
  let absDir = '';
  let relName = '';
  let relDir = '';

  const upsertByLocalPath = vi.fn(() => ({
    repo: {
      id: 'r-path',
      name: 'path-repo',
      localPath: '',
      branch: 'main',
      status: 'indexing',
      error: null,
      fileCount: 0,
      symbolCount: 0
    },
    created: true
  }));
  const updateRepoStatus = vi.fn();
  const getRepo = vi.fn(() => ({
    id: 'r-path',
    name: 'path-repo',
    localPath: '',
    branch: 'main',
    status: 'indexing',
    error: null,
    fileCount: 0,
    symbolCount: 0
  }));
  const indexRepo = vi.fn(() => Promise.resolve({ repo: getRepo(), created: true }));

  beforeAll(async () => {
    absDir = await fs.mkdtemp(path.join(os.tmpdir(), 'path-abs-'));
    // 相对路径用例：临时目录建在包根（cwd）下，跨盘符的 path.relative 不可靠。
    relName = `.tmp-path-contract-${Date.now()}`;
    relDir = relName;
    await fs.mkdir(path.join(process.cwd(), relName, 'src'), { recursive: true });
    await fs.writeFile(path.join(process.cwd(), relName, 'src', 'a.ts'), 'export const a = 1;\n');

    const deps = {
      dataDir: absDir,
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
    await fs.rm(absDir, { recursive: true, force: true });
    await fs.rm(path.join(process.cwd(), relDir), { recursive: true, force: true });
  });

  it('preview echoes the resolved absolute path and flags relative input', async () => {
    const absRes = await fetch(`${baseUrl}/api/repos/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPath: absDir })
    });
    expect(absRes.status).toBe(200);
    const absBody = (await absRes.json()) as {
      preview: { path: string; resolvedPath?: string; wasRelative?: boolean };
    };
    expect(absBody.preview.wasRelative).toBe(false);
    expect(absBody.preview.resolvedPath).toBe(path.resolve(absDir));

    const relRes = await fetch(`${baseUrl}/api/repos/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPath: relDir })
    });
    expect(relRes.status).toBe(200);
    const relBody = (await relRes.json()) as {
      preview: { path: string; resolvedPath?: string; wasRelative?: boolean; fileCount: number };
    };
    expect(relBody.preview.wasRelative).toBe(true);
    expect(relBody.preview.path).toBe(relDir);
    expect(relBody.preview.resolvedPath).toBe(path.resolve(relDir));
    expect(relBody.preview.fileCount).toBe(1);
  });

  it('stores the resolved absolute path on import', async () => {
    upsertByLocalPath.mockClear();
    const res = await fetch(`${baseUrl}/api/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPath: relDir })
    });
    expect(res.status).toBe(202);
    expect(upsertByLocalPath).toHaveBeenCalledWith(
      expect.objectContaining({ localPath: path.resolve(relDir) })
    );
    expect(indexRepo).toHaveBeenCalledWith(expect.objectContaining({ localPath: path.resolve(relDir) }));
  });

  it('names the resolved path in the 400 message when a relative path does not exist', async () => {
    const res = await fetch(`${baseUrl}/api/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ localPath: '.tmp-definitely-missing-dir' })
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body.code).toBe('import_failed');
    expect(body.error).toContain('resolved to');
    expect(body.error).toContain(path.resolve('.tmp-definitely-missing-dir'));
  });
});
