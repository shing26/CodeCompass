import type { RepoQAClient } from '../client/RepoQAClient';
import type { ReverseDepsResult } from '../types';
import { useSymbolResource, type SymbolResourceState } from './useSymbolResource';

export type UseReverseDepsResult = SymbolResourceState<ReverseDepsResult>;

/**
 * v0.6 closeout: fetch static reverse dependencies ("who calls this symbol")
 * for the Inspector's currently focused symbol. The backend answers 400 with
 * `{ error }` when the symbol cannot be resolved at all.
 */
export function useReverseDeps(
  client: RepoQAClient,
  repoId: string | null,
  symbolName: string | null
): UseReverseDepsResult {
  return useSymbolResource(client, repoId, symbolName, (c, repoId_, name) =>
    c.listReverseDeps(repoId_, name)
  );
}
