import { useCallback, useEffect, useRef, useState } from 'react';
import type { Repo, RepoStatus } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';

// Backend status flow is idle → indexing → ready/error. Legacy 'cloning'/
// 'parsing' remain for older servers; 'indexing' is what makes polling work.
const ACTIVE_STATUSES: RepoStatus[] = ['cloning', 'parsing', 'indexing'];

export interface UseRepoCatalogResult {
  repos: Repo[];
  currentRepo: Repo | null;
  loading: boolean;
  error: string | null;
  selectRepo: (id: string) => void;
  importRepo: (name: string, localPath: string) => Promise<void>;
  refresh: () => Promise<Repo[]>;
}

/**
 * Owns the repo catalog: list, current selection, import, and polling while a
 * repo is still indexing. Polling stops as soon as status is terminal.
 *
 * `initialRepoId` (e.g. from a `?repo=` deep link opened by the CLI) is
 * applied once the catalog has loaded; it never overrides an explicit user
 * selection made afterwards.
 */
export function useRepoCatalog(
  client: RepoQAClient,
  initialRepoId?: string | null
): UseRepoCatalogResult {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didApplyInitial = useRef(false);

  const selectRepo = useCallback((id: string) => {
    setCurrentId(id);
  }, []);

  const refresh = useCallback(async (): Promise<Repo[]> => {
    const list = await client.listRepos();
    setRepos(list);
    return list;
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh()
      .then((list) => {
        if (cancelled) return;
        setError(null);
        if (initialRepoId && !didApplyInitial.current) {
          didApplyInitial.current = true;
          setCurrentId((prev) =>
            prev === null && list.some((r) => r.id === initialRepoId)
              ? initialRepoId
              : prev
          );
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh, initialRepoId]);

  // Poll repo status while any repo is active (indexing), then stop.
  useEffect(() => {
    const active = repos.some((r) => ACTIVE_STATUSES.includes(r.status));
    if (!active) return;
    const tick = async () => {
      try {
        const list = await client.listRepos();
        setRepos(list);
      } catch {
        // transient poll failure — keep current state and retry next tick
      }
    };
    pollTimer.current = setInterval(tick, 1500);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [client, repos]);

  const importRepo = useCallback(
    async (name: string, localPath: string) => {
      setError(null);
      // Bug-12: while the single POST /api/repos call is in flight (large
      // imports take tens of seconds) keep refreshing the catalog so the UI
      // can show live phase feedback from the repo's `indexing` status.
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      try {
        const repoPromise = client.importRepo({ name, localPath });
        pollTimer = setInterval(() => {
          client
            .listRepos()
            .then(setRepos)
            .catch(() => {
              // transient poll failure — the awaited import will resolve anyway
            });
        }, 1200);
        const repo = await repoPromise;
        setRepos((prev) => [repo, ...prev.filter((r) => r.id !== repo.id)]);
        setCurrentId(repo.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        if (pollTimer) clearInterval(pollTimer);
      }
    },
    [client]
  );

  const currentRepo = repos.find((r) => r.id === currentId) ?? null;

  return { repos, currentRepo, loading, error, selectRepo, importRepo, refresh };
}