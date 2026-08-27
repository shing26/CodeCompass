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
    getRepo: vi.fn(),
    listSymbols: vi.fn(),
    getFileRaw: vi.fn(),
    queryRepo: vi.fn(),
    getDashboard: vi.fn(),
    getTours: vi.fn(),
    baseUrl: 'http://localhost:43110',
    ...overrides
  } as unknown as RepoQAClient;
}

describe('useRepoCatalog import polling (Bug-12)', () => {
  it('refreshes the catalog while the import POST is pending so the UI sees indexing state', async () => {
    let release: (repo: Repo) => void = () => {};
    const pending = new Promise<Repo>((resolve) => {
      release = resolve;
    });
    const listRepos = vi
      .fn()
      .mockResolvedValueOnce([]) // mount
      .mockResolvedValue([indexingRepo]); // polling ticks see the indexing repo
    const client = makeClient({
      listRepos,
      importRepo: vi.fn().mockReturnValue(pending)
    });

    const { result } = renderHook(() => useRepoCatalog(client, null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let importPromise: Promise<Repo>;
    act(() => {
      importPromise = result.current.importRepo('big-repo', 'C:/projects/big-repo');
    });

    // The catalog must surface the indexing repo while the POST is in flight
    // (the poll interval is 1200ms, so allow longer than the default waitFor).
    await waitFor(
      () => expect(result.current.repos).toEqual([indexingRepo]),
      { timeout: 5000 }
    );
    expect(listRepos.mock.calls.length).toBeGreaterThan(1);

    await act(async () => {
      release(readyRepo);
      await importPromise;
    });
    expect(result.current.currentRepo?.id).toBe('repo-1');
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