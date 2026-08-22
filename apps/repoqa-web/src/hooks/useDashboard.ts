import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepoDashboard } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';

export interface UseDashboardResult {
  dashboard: RepoDashboard | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Loads the zero-prompt dashboard for the current repo once per repo id
 * (issue 12/13). Dashboard output is a deterministic symbol-table aggregation,
 * so a failed load can just be retried without harming any other state.
 */
export function useDashboard(client: RepoQAClient, repoId: string | null): UseDashboardResult {
  const [dashboard, setDashboard] = useState<RepoDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!repoId) {
      setDashboard(null);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await client.getDashboard(repoId);
      if (seq === requestSeq.current) setDashboard(result);
    } catch (err) {
      if (seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [client, repoId]);

  useEffect(() => {
    setDashboard(null);
    setError(null);
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return { dashboard, loading, error, refresh };
}