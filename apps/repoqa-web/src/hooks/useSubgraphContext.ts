import type { RepoQAClient } from '../client/RepoQAClient';
import type { SubgraphContextResult } from '../types';
import { useSymbolResource, type SymbolResourceState } from './useSymbolResource';

export type UseSubgraphContextResult = SymbolResourceState<SubgraphContextResult>;

/** v1.4 票 04 — focus-mode depths; the panel's defaults (1 caller / 1 callee)
 * keep the view centered on the selected method instead of pre-expanding a
 * deep callee arm. The backend default stays 1/3 for other API consumers. */
export interface SubgraphDepths {
  up: number;
  down: number;
}

export const DEFAULT_SUBGRAPH_DEPTHS: SubgraphDepths = { up: 1, down: 1 };

/**
 * v0.6 closeout: fetch the deterministic Graph RAG subgraph for the
 * Inspector's focused symbol. Nodes carry `direction` (start/caller/callee);
 * the view toggle in SubgraphPanel filters them client-side.
 *
 * v1.4 票 04: depths are part of the fetch key — changing them refetches.
 */
export function useSubgraphContext(
  client: RepoQAClient,
  repoId: string | null,
  symbolName: string | null,
  depths: SubgraphDepths = DEFAULT_SUBGRAPH_DEPTHS
): UseSubgraphContextResult {
  return useSymbolResource(
    client,
    repoId,
    symbolName,
    (c, repoId_, name) =>
      c.getSubgraphContext(repoId_, name, {
        callerDepth: depths.up,
        calleeDepth: depths.down
      }),
    `${depths.up}:${depths.down}`
  );
}
