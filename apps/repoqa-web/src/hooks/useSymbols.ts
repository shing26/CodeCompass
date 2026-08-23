import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepoSymbol, SymbolKind } from '../types';
import type { RepoQAClient } from '../client/RepoQAClient';

export interface UseSymbolsResult {
  symbols: RepoSymbol[];
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * Loads the full symbol list for the current repo once per repo id; the caller
 * filters by kind as needed (routes, files, classes, methods). CLI evidence —
 * deterministic AST symbols, no semantic retrieval.
 */
export function useSymbols(client: RepoQAClient, repoId: string | null): UseSymbolsResult {
  const [symbols, setSymbols] = useState<RepoSymbol[]>([]);
  const [loading, setLoading] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    if (!repoId) {
      setSymbols([]);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const list = await client.listSymbols(repoId);
      if (seq === requestSeq.current) setSymbols(list);
    } catch {
      // transient — leave current state; caller may refresh via UI
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [client, repoId]);

  useEffect(() => {
    setSymbols([]);
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return { symbols, loading, refresh };
}

export function filterByKind(symbols: RepoSymbol[], kind: SymbolKind): RepoSymbol[] {
  return symbols.filter((s) => s.kind === kind);
}

/** Group symbols into file → class/interface → members, for a compact tree. */
export function buildSymbolTree(symbols: RepoSymbol[]): Array<{
  file: string;
  types: Array<{ symbol: RepoSymbol; members: RepoSymbol[] }>;
}> {
  const byFile = new Map<string, RepoSymbol[]>();
  for (const s of symbols) {
    const list = byFile.get(s.filePath) ?? [];
    list.push(s);
    byFile.set(s.filePath, list);
  }

  const tree: Array<{ file: string; types: Array<{ symbol: RepoSymbol; members: RepoSymbol[] }> }> =
    [];
  for (const [file, list] of byFile) {
    const types = list.filter((s) => s.kind === 'class' || s.kind === 'interface');
    const members = list.filter((s) => s.kind === 'method' || s.kind === 'field' || s.kind === 'route');
    const typeNodes = types.map((typeSymbol) => ({
      symbol: typeSymbol,
      members: members.filter(
        (m) =>
          m.lineStart !== null &&
          typeSymbol.lineStart !== null &&
          typeSymbol.lineEnd !== null &&
          m.lineStart >= typeSymbol.lineStart &&
          m.lineEnd !== null &&
          m.lineEnd <= typeSymbol.lineEnd
      )
    }));
    // Include routes/services/repositories that are not nested under a class.
    tree.push({ file, types: typeNodes });
  }
  return tree;
}