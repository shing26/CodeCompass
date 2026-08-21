import { useCallback, useEffect, useRef, useState } from 'react';
import type { Repo, RepoStatus } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';

const ACTIVE_STATUSES: RepoStatus[] = ['cloning', 'parsing'];

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
 */
export function useRepoCatalog(client: RepoQAClient): UseRepoCatalogResult {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      .then(() => {
        if (!cancelled) setError(null);
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
  }, [refresh]);

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
      try {
        const repo = await client.importRepo({ name, localPath });
        setRepos((prev) => [repo, ...prev.filter((r) => r.id !== repo.id)]);
        setCurrentId(repo.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [client]
  );

  const currentRepo = repos.find((r) => r.id === currentId) ?? null;

  return { repos, currentRepo, loading, error, selectRepo, importRepo, refresh };
}