import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useInspector } from './useInspector';
import type { RepoQAClient } from '../client/RepoQAClient';

function makeClient(overrides: Partial<RepoQAClient> = {}): RepoQAClient {
  return {
    listRepos: vi.fn(),
    importRepo: vi.fn(),
    getRepo: vi.fn(),
    listSymbols: vi.fn(),
    getFileRaw: vi.fn(),
    queryRepo: vi.fn(),
    baseUrl: 'http://localhost:43110',
    ...overrides
  } as unknown as RepoQAClient;
}

describe('useInspector (ticket 05)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts empty with no navigation available', () => {
    const client = makeClient();
    const { result } = renderHook(() => useInspector(client, 'repo-1'));
    expect(result.current.file).toBeNull();
    expect(result.current.text).toBeNull();
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);
  });

  it('loads a file via getFileRaw and sets the target line glow', async () => {
    const client = makeClient({
      getFileRaw: vi.fn().mockResolvedValue('class A {}')
    });
    const { result } = renderHook(() => useInspector(client, 'repo-1'));

    act(() => {
      result.current.openFile('src/a/A.java', 42, 47);
    });
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.text).toBe('class A {}'));
    expect(client.getFileRaw).toHaveBeenCalledWith('repo-1', 'src/a/A.java');
    expect(result.current.file).toBe('src/a/A.java');
    expect(result.current.glow).toEqual({ line: 42, lineEnd: 47 });
  });

  it('caches file contents so repeat navigation does not re-request', async () => {
    const client = makeClient({
      getFileRaw: vi.fn().mockResolvedValue('cached')
    });
    const { result } = renderHook(() => useInspector(client, 'repo-1'));

    act(() => {
      result.current.openFile('cache/A.java', 1);
    });
    await waitFor(() => expect(result.current.text).toBe('cached'));

    act(() => {
      result.current.openFile('cache/A.java', 9);
    });
    await waitFor(() => expect(result.current.file).toBe('cache/A.java'));
    expect(client.getFileRaw).toHaveBeenCalledTimes(1);
  });

  it('maintains a back/forward navigation stack', async () => {
    const client = makeClient({
      getFileRaw: vi
        .fn()
        .mockResolvedValueOnce('file A')
        .mockResolvedValueOnce('file B')
    });
    const { result } = renderHook(() => useInspector(client, 'repo-1'));

    act(() => {
      result.current.openFile('nav/A.java', 3);
    });
    await waitFor(() => expect(result.current.text).toBe('file A'));

    act(() => {
      result.current.openFile('nav/B.java', 8);
    });
    await waitFor(() => expect(result.current.text).toBe('file B'));
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);

    act(() => {
      result.current.goBack();
    });
    await waitFor(() => expect(result.current.file).toBe('nav/A.java'));
    expect(result.current.text).toBe('file A');
    expect(result.current.glow?.line).toBe(3);
    expect(result.current.canGoForward).toBe(true);

    act(() => {
      result.current.goForward();
    });
    await waitFor(() => expect(result.current.file).toBe('nav/B.java'));
    expect(result.current.text).toBe('file B');
    expect(result.current.glow?.line).toBe(8);
  });

  it('surfaces a load failure as a friendly error without crashing', async () => {
    const client = makeClient({
      getFileRaw: vi.fn().mockRejectedValue(new Error('404 path not found'))
    });
    const { result } = renderHook(() => useInspector(client, 'repo-1'));

    act(() => {
      result.current.openFile('missing/Nope.java', 1);
    });
    await waitFor(() => expect(result.current.error).toContain('404 path not found'));
    expect(result.current.loading).toBe(false);
    expect(result.current.text).toBeNull();
  });

  it('ignores navigation when no repo is selected', () => {
    const client = makeClient({ getFileRaw: vi.fn() });
    const { result } = renderHook(() => useInspector(client, null));

    act(() => {
      result.current.openFile('A.java', 1);
    });
    expect(client.getFileRaw).not.toHaveBeenCalled();
    expect(result.current.file).toBeNull();
  });

  it('clears state and navigation when the repo changes', async () => {
    const client = makeClient({
      getFileRaw: vi.fn().mockResolvedValue('content')
    });
    const { result, rerender } = renderHook(
      ({ repoId }: { repoId: string | null }) => useInspector(client, repoId),
      { initialProps: { repoId: 'repo-1' } }
    );

    act(() => {
      result.current.openFile('switch/A.java', 3);
    });
    await waitFor(() => expect(result.current.file).toBe('switch/A.java'));

    rerender({ repoId: 'repo-2' });
    expect(result.current.file).toBeNull();
    expect(result.current.text).toBeNull();
    expect(result.current.canGoBack).toBe(false);
  });

  it('clears the glow decoration after 1.5 seconds', async () => {
    vi.useFakeTimers();
    const client = makeClient({
      getFileRaw: vi.fn().mockResolvedValue('content')
    });
    const { result } = renderHook(() => useInspector(client, 'repo-1'));

    await act(async () => {
      result.current.openFile('glow/A.java', 12);
      await Promise.resolve();
    });
    expect(result.current.glow?.line).toBe(12);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.glow).toBeNull();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});