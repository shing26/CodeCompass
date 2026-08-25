import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDashboard } from './useDashboard';
import type { RepoQAClient } from '../client/RepoQAClient';
import type { RepoDashboard } from '../types';

function makeClient(overrides: Partial<RepoQAClient> = {}): RepoQAClient {
  return {
    listRepos: vi.fn(),
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

const dashboard: RepoDashboard = {
  repoId: 'repo-1',
  repoName: 'petclinic',
  techStack: { summary: [], highlights: ['Spring Boot'] },
  config: { topology: [], maskedValues: true },
  scale: {
    routes: 1,
    services: 1,
    repositories: 1,
    advices: 1,
    plainClasses: 2,
    interfaces: 1,
    methods: 4,
    fields: 2,
    configKeys: 1,
    files: 3
  },
  topApis: []
};

describe('useDashboard', () => {
  it('loads the dashboard for the selected repo once', async () => {
    const client = makeClient({ getDashboard: vi.fn().mockResolvedValue(dashboard) });
    const { result } = renderHook(() => useDashboard(client, 'repo-1'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.dashboard).toEqual(dashboard));
    expect(client.getDashboard).toHaveBeenCalledTimes(1);
    expect(client.getDashboard).toHaveBeenCalledWith('repo-1');
  });

  it('returns null dashboard when no repo is selected', async () => {
    const client = makeClient({ getDashboard: vi.fn() });
    const { result } = renderHook(() => useDashboard(client, null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dashboard).toBeNull();
    expect(client.getDashboard).not.toHaveBeenCalled();
  });

  it('surfaces a load failure and recovers on refresh', async () => {
    const client = makeClient({
      getDashboard: vi
        .fn()
        .mockRejectedValueOnce(new Error('dashboard failed'))
        .mockResolvedValueOnce(dashboard)
    });
    const { result } = renderHook(() => useDashboard(client, 'repo-1'));
    await waitFor(() => expect(result.current.error).toContain('dashboard failed'));
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.dashboard).toEqual(dashboard));
    expect(result.current.error).toBeNull();
  });
});
