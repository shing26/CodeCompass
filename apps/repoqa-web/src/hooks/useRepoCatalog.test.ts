import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useRepoCatalog } from './useRepoCatalog';
import type { RepoQAClient } from '../client/RepoQAClient';
import type { Repo } from '../types';

const readyRepo: Repo = {
  id: 'repo-1',
  name: 'petclinic',
  localPath: 'C:/petclinic',
  branch: 'main',
  status: 'ready',
  fileCount: 47,
  symbolCount: 344,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

const indexingRepo: Repo = {
  ...readyRepo,
  id: 'repo-2',
  name: 'big-repo',
  status: 'indexing',
  fileCount: 131,
  symbolCount: 0
};

function makeClient(overrides: Partial<RepoQAClient> = {}): RepoQAClient {
  return {
    listRepos: vi.fn().mockResolvedValue([]),
    importRepo: vi.fn(),
    listSymbols: vi.fn(),
    getFileRaw: vi.fn(),
    queryRepo: vi.fn(),
    getDashboard: vi.fn(),
    getTours: vi.fn(),
    baseUrl: 'http://localhost:43110',
    ...overrides
  } as unknown as RepoQAClient;
}

describe('useRepoCatalog import (v1.2 票 03：202 语义)', () => {
  it('inserts the returned indexing row immediately and the standing poll advances it to ready', async () => {
    const listRepos = vi
      .fn()
      .mockResolvedValueOnce([]) // mount
      // 常驻轮询（active 即 1500ms）：同一行翻到终态（真实语义），不是换行。
      .mockResolvedValue([{ ...indexingRepo, status: 'ready', symbolCount: 344 }]);
    const client = makeClient({
      listRepos,
      importRepo: vi.fn().mockResolvedValue({ repo: indexingRepo, taskId: 'index-repo-2' })
    });

    const { result } = renderHook(() => useRepoCatalog(client, null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let imported: Repo | undefined;
    await act(async () => {
      imported = await result.current.importRepo('big-repo', 'C:/projects/big-repo');
    });
    // 202 秒回的 indexing 行立即入目录并选中——不再等 POST 全量结束。
    expect(imported?.status).toBe('indexing');
    expect(result.current.currentRepo?.id).toBe('repo-2');
    // Bug-12 手轮询退役后，进度由常驻状态轮询接管（行 active 即起拍）。
    await waitFor(() => expect(result.current.currentRepo?.status).toBe('ready'), {
      timeout: 5000
    });
  });

  it('still surfaces the import error and keeps previous repos when import fails', async () => {
    const client = makeClient({
      listRepos: vi.fn().mockResolvedValue([readyRepo]),
      importRepo: vi.fn().mockRejectedValue(new Error('import boom'))
    });
    const { result } = renderHook(() => useRepoCatalog(client, null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.importRepo('x', 'nope').catch(() => {});
    });
    expect(result.current.error).toBe('import boom');
    expect(result.current.repos).toEqual([readyRepo]);
  });
});