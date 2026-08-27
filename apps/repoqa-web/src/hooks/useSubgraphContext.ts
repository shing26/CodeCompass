import type { RepoQAClient } from '../client/RepoQAClient';
import type { SubgraphContextResult } from '../types';
import { useSymbolResource, type SymbolResourceState } from './useSymbolResource';

export type UseSubgraphContextResult = SymbolResourceState<SubgraphContextResult>;

/**
 * v0.6 closeout: fetch the deterministic Graph RAG subgraph for the
 * Inspector's focused symbol. Nodes carry `direction` (start/caller/callee);
 * the view toggle in SubgraphPanel filters them client-side.
 */
export function useSubgraphContext(
  client: RepoQAClient,
  repoId: string | null,
  symbolName: string | null
): UseSubgraphContextResult {
  return useSymbolResource(client, repoId, symbolName, (c, repoId_, name) =>
    c.getSubgraphContext(repoId_, name)
  );
}
