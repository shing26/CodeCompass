import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTours } from './useTours';
import type { RepoQAClient } from '../client/RepoQAClient';
import type { RepoTour } from '../types';

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

const tour: RepoTour = {
  id: 'auth-chain',
  title: 'Trace the auth filter chain',
  description: '',
  steps: [
    { step: '1. AuthFilter', filePath: 'src/AuthFilter.java', lineNumber: 5, symbol: 'AuthFilter', kind: 'class' }
  ],
  mermaid: 'flowchart LR\n  AuthFilter --> Stop'
};

describe('useTours', () => {
  it('loads tours for the selected repo once', async () => {
    const client = makeClient({ getTours: vi.fn().mockResolvedValue([tour]) });
    const { result } = renderHook(() => useTours(client, 'repo-1'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.tours).toEqual([tour]));
    expect(client.getTours).toHaveBeenCalledTimes(1);
    expect(client.getTours).toHaveBeenCalledWith('repo-1');
  });

  it('clears tours and skips the request when no repo is selected', async () => {
    const client = makeClient({ getTours: vi.fn() });
    const { result } = renderHook(() => useTours(client, null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tours).toEqual([]);
    expect(client.getTours).not.toHaveBeenCalled();
  });

  it('surfaces a load failure and reloads on refresh', async () => {
    const client = makeClient({
      getTours: vi
        .fn()
        .mockRejectedValueOnce(new Error('tours failed'))
        .mockResolvedValueOnce([tour])
    });
    const { result } = renderHook(() => useTours(client, 'repo-1'));
    await waitFor(() => expect(result.current.error).toContain('tours failed'));
    expect(result.current.tours).toEqual([]);

    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.tours).toEqual([tour]));
    expect(result.current.error).toBeNull();
  });
});