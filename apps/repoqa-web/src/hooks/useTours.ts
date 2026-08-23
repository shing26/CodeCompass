import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepoTour } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';

export interface UseToursResult {
  tours: RepoTour[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Loads the AST-heuristic onboarding tours for the current repo once per repo
 * id (issue 11/13). The backend guarantees a deterministic, ordered tour set
 * (auth-chain / main-flow / error-handling).
 */
export function useTours(client: RepoQAClient, repoId: string | null): UseToursResult {
  const [tours, setTours] = useState<RepoTour[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!repoId) {
      setTours([]);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const list = await client.getTours(repoId);
      // A tour without locatable steps is not playable; drop it so the UI
      // never presents a broken "Step 1 / 0" player.
      const playable = list.filter((t) => Array.isArray(t.steps) && t.steps.length > 0);
      if (seq === requestSeq.current) setTours(playable);
    } catch (err) {
      if (seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [client, repoId]);

  useEffect(() => {
    setTours([]);
    setError(null);
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return { tours, loading, error, refresh };
}