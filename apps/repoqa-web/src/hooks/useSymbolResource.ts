import { useEffect, useState } from 'react';
import type { RepoQAClient } from '../client/RepoQAClient';

export interface SymbolResourceState<T> {
  result: T | null;
  loading: boolean;
  error: string | null;
}

/** Stable empty state so consumers can default optional props without
 * re-allocating a fresh literal on every render. */
export const EMPTY_SYMBOL_RESOURCE: SymbolResourceState<never> = {
  result: null,
  loading: false,
  error: null
};

/** A `: 400` in a client error message means the backend rejected the symbol
 * lookup itself (unresolvable symbol); anything else is a transport/server
 * failure. Panels use this to pick the right muted hint. */
export function isSymbolResolutionError(error: string): boolean {
  return /:\s*400\b/.test(error);
}

/**
 * Shared loader for the Inspector's per-symbol panels (reverse-deps,
 * subgraph): fetches when a symbol is focused, resets when it clears, and
 * surfaces failures as a soft error so panels can render a muted hint.
 */
export function useSymbolResource<T>(
  client: RepoQAClient,
  repoId: string | null,
  symbolName: string | null,
  fetch: (client: RepoQAClient, repoId: string, symbolName: string) => Promise<T>
): SymbolResourceState<T> {
  const [state, setState] = useState<SymbolResourceState<T>>({
    result: null,
    loading: false,
    error: null
  });

  useEffect(() => {
    if (!repoId || !symbolName) {
      setState({ result: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ result: null, loading: true, error: null });
    fetch(client, repoId, symbolName)
      .then((result) => {
        if (!cancelled) setState({ result, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            result: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, repoId, symbolName]);

  return state;
}
