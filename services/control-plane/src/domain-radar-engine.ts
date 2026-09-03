import type {
  DomainRadarAnchor,
  DomainRadarHub,
  DomainRadarResult
} from '../../../packages/contracts/src/index';
import { symbolIdentity, buildFullCallersIndex, type SymbolIndex } from './repoqa-callchain';
import type { RepoSymbol } from './repoqa-repos';
import { fuzzyMatchScore } from './repoqa-worker';
import { layerOf, isTestPath } from './diagnose-engine';

/**
 * v0.9.0 — Domain radar engine (deterministic, zero-LLM).
 *
 * Aggregates the symbol graph into a domain panorama: hub nodes by degree and
 * a small deterministic PageRank, top external APIs, the persistence layer,
 * and — when a natural-language intent is given — deterministic anchor
 * matching. Scoring blends three evidence sources, none of them semantic:
 *
 *  1. `fuzzyMatchScore` identifier chain (Issue 18, latin identifiers),
 *  2. chunk LIKE hits (doc comments / README carrying the intent phrase),
 *     passed in by the caller as `chunkHitFiles`,
 *  3. graph rank (degree/PageRank) as a bounded boost.
 *
 * PageRank follows the standard formulation: damping 0.85, and sink nodes
 * (out-degree 0 — leaf services, mapper XML SQL) redistribute their mass
 * uniformly every iteration so rank never leaks. Bridge edges (TS fetch/axios
 * → Controller) are resolved through the same CallResolver as every other
 * edge, so externally-facing controllers earn their in-degree.
 */

export interface DomainRadarInput {
  repoId: string;
  query?: string;
  symbols: RepoSymbol[];
  index: SymbolIndex;
  /** Files whose doc/readme chunks matched the query (Chinese-intent bridge). */
  chunkHitFiles?: string[];
  /** Hub count returned (default 5). */
  hubLimit?: number;
}

export interface RadarGraph {
  symbolsById: Map<string, RepoSymbol>;
  inDegree: Map<string, number>;
  outDegree: Map<string, number>;
  edges: Array<[string, string]>;
}

const PRODUCTION_KINDS = new Set([
  'method',
  'route',
  'service',
  'repository',
  'class',
  'interface',
  // Mapper XML SQL nodes participate as sinks so PageRank sees them.
  'sql',
  'mapper'
]);

/** Resolve every call edge once (routes and HTTP bridges included). */
export function buildRadarGraph(symbols: RepoSymbol[], index: SymbolIndex): RadarGraph {
  const { identityMap, callersOf } = buildFullCallersIndex(symbols, index);
  const symbolsById = new Map<string, RepoSymbol>();
  for (const symbol of symbols) {
    if (PRODUCTION_KINDS.has(symbol.kind) && !isTestPath(symbol.filePath)) {
      symbolsById.set(symbolIdentity(symbol), symbol);
    }
  }

  const edgeSet = new Set<string>();
  const edges: Array<[string, string]> = [];
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const id of symbolsById.keys()) {
    inDegree.set(id, 0);
    outDegree.set(id, 0);
  }
  for (const [targetId, callers] of callersOf) {
    if (!symbolsById.has(targetId)) continue;
    for (const caller of callers) {
      const from = symbolIdentity(caller);
      const to = targetId;
      if (from === to || !symbolsById.has(from)) continue;
      const key = `${from}=>${to}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push([from, to]);
      outDegree.set(from, (outDegree.get(from) ?? 0) + 1);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }
  return { symbolsById, inDegree, outDegree, edges };
}

/**
 * Deterministic PageRank: damping 0.85, 30 fixed iterations, sink mass
 * redistributed uniformly across all nodes each round (no rank leakage from
 * leaf SQL/mapper nodes).
 */
export function computePageRank(
  nodeIds: string[],
  edges: Array<[string, string]>,
  options: { damping?: number; iterations?: number } = {}
): Map<string, number> {
  const damping = options.damping ?? 0.85;
  const iterations = options.iterations ?? 30;
  const n = nodeIds.length;
  const rank = new Map<string, number>();
  if (n === 0) return rank;
  for (const id of nodeIds) rank.set(id, 1 / n);

  const outNeighbors = new Map<string, string[]>();
  for (const [from, to] of edges) {
    const list = outNeighbors.get(from) ?? [];
    list.push(to);
    outNeighbors.set(from, list);
  }
  const sinks = nodeIds.filter((id) => (outNeighbors.get(id) ?? []).length === 0);
  const incoming = new Map<string, string[]>();
  for (const [from, to] of edges) {
    const list = incoming.get(to) ?? [];
    list.push(from);
    incoming.set(to, list);
  }

  for (let i = 0; i < iterations; i++) {
    let sinkMass = 0;
    for (const sink of sinks) sinkMass += rank.get(sink) ?? 0;
    const next = new Map<string, number>();
    const base = (1 - damping) / n + (damping * sinkMass) / n;
    for (const id of nodeIds) {
      let sum = 0;
      for (const parent of incoming.get(id) ?? []) {
        const outCount = (outNeighbors.get(parent) ?? []).length;
        if (outCount > 0) sum += (rank.get(parent) ?? 0) / outCount;
      }
      next.set(id, base + damping * sum);
    }
    for (const [id, value] of next) rank.set(id, value);
  }
  return rank;
}

function anchorType(symbol: RepoSymbol, index: SymbolIndex): DomainRadarAnchor['type'] {
  const layer = layerOf(symbol, index);
  if (layer === 'HTTP_ROUTER') return 'CONTROLLER';
  if (layer === 'DATA_MAPPER') return 'ENTITY';
  if (symbol.kind === 'class' || symbol.kind === 'interface') return 'ENTITY';
  return 'SERVICE';
}

function roleOf(symbol: RepoSymbol, index: SymbolIndex): string {
  const layer = layerOf(symbol, index);
  if (layer === 'HTTP_ROUTER') return 'CONTROLLER';
  if (layer === 'SERVICE') return 'SERVICE';
  if (layer === 'DATA_MAPPER') return 'DATA_MAPPER';
  return symbol.kind.toUpperCase();
}

/** Model classes declared in mapper/repository method signatures. */
function persistenceEntityNames(symbols: RepoSymbol[]): string[] {
  const isMapper =
    (symbol: RepoSymbol) =>
      symbol.kind === 'repository' ||
      symbol.kind === 'mapper' ||
      symbol.kind === 'sql' ||
      // MyBatis mapper interfaces index as plain interfaces.
      (symbol.kind === 'interface' && /Mapper$/.test(symbol.name));
  const mappers = symbols.filter((symbol) => isMapper(symbol) && !isTestPath(symbol.filePath));
  const classNames = new Set(
    symbols
      .filter((symbol) => symbol.kind === 'class')
      .map((symbol) => symbol.name)
  );
  const entities = new Set<string>(mappers.map((symbol) => symbol.name));
  for (const mapper of mappers) {
    if (!mapper.signature) continue;
    for (const name of classNames) {
      if (name.length >= 3 && mapper.signature.includes(name)) entities.add(name);
    }
  }
  return [...entities].sort();
}

export function runDomainRadar(input: DomainRadarInput): DomainRadarResult {
  const { repoId, symbols, index } = input;
  const query = (input.query ?? '').trim();
  const graph = buildRadarGraph(symbols, index);
  const nodeIds = [...graph.symbolsById.keys()];
  const pagerank = computePageRank(nodeIds, graph.edges);
  const hubLimit = input.hubLimit ?? 5;
  const chunkHitFiles = new Set(
    (input.chunkHitFiles ?? []).map((file) => file.replace(/\\/g, '/'))
  );

  // Hub nodes: PageRank order, deterministic tie-breaks.
  const hubNodes: DomainRadarHub[] = nodeIds
    .map((id) => {
      const symbol = graph.symbolsById.get(id)!;
      return {
        symbol: symbol.parentType ? `${symbol.parentType}.${symbol.name}` : symbol.name,
        inDegree: graph.inDegree.get(id) ?? 0,
        outDegree: graph.outDegree.get(id) ?? 0,
        pagerank: pagerank.get(id) ?? 0,
        role: roleOf(symbol, index)
      };
    })
    .sort(
      (a, b) =>
        b.pagerank - a.pagerank ||
        b.inDegree - a.inDegree ||
        a.symbol.localeCompare(b.symbol)
    )
    .slice(0, hubLimit);

  // Top external APIs: routes ranked by PageRank (bridge in-degree included).
  const topApis = nodeIds
    .map((id) => graph.symbolsById.get(id)!)
    .filter((symbol) => symbol.displayPath)
    .sort(
      (a, b) =>
        (pagerank.get(symbolIdentity(b)) ?? 0) - (pagerank.get(symbolIdentity(a)) ?? 0) ||
        (a.lineStart ?? 0) - (b.lineStart ?? 0)
    )
    .slice(0, 10)
    .map((symbol) => {
      const label = symbol.parentType ? `${symbol.parentType}.${symbol.name}` : symbol.name;
      return `${symbol.displayPath} — ${label}`;
    });

  // Anchor matching for a natural-language intent (optional).
  const matchedAnchors: DomainRadarAnchor[] = [];
  if (query) {
    const scored: Array<{ symbol: RepoSymbol; score: number; matchedBy: DomainRadarAnchor['matchedBy'] }> = [];
    for (const id of nodeIds) {
      const symbol = graph.symbolsById.get(id)!;
      if (symbol.kind !== 'method' && symbol.kind !== 'route' && symbol.kind !== 'class') {
        continue;
      }
      const fuzzyBase = Math.max(
        fuzzyMatchScore(query, symbol.name),
        symbol.parentType ? Math.round(fuzzyMatchScore(query, symbol.parentType) * 0.9) : 0
      );
      const normalizedFile = symbol.filePath.replace(/\\/g, '/');
      const chunkHit = chunkHitFiles.has(normalizedFile);
      let base = fuzzyBase;
      if (chunkHit) {
        // Doc/readme evidence carries the intent phrase — deterministic bridge
        // for Chinese intents that identifier matching cannot see.
        base = Math.max(base, 70);
      }
      if (base <= 0) continue;
      // v0.18 — provenance of the match so agents can weigh the evidence:
      // identifier fuzzy hit, doc-chunk bridge (weak/no identifier signal),
      // or pure graph-rank (base only exists because chunk evidence lifted it).
      const matchedBy: DomainRadarAnchor['matchedBy'] =
        chunkHit && fuzzyBase < 70 ? 'doc-chunk' : fuzzyBase > 0 ? 'identifier' : 'doc-chunk';
      const rankValue = pagerank.get(id) ?? 0;
      const rankBoost = rankValue >= 0.05 ? 10 : rankValue >= 0.02 ? 5 : 0;
      scored.push({ symbol, score: Math.min(100, base + rankBoost), matchedBy });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        a.symbol.filePath.localeCompare(b.symbol.filePath) ||
        (a.symbol.lineStart ?? 0) - (b.symbol.lineStart ?? 0)
    );
    for (const entry of scored.slice(0, 3)) {
      const id = symbolIdentity(entry.symbol);
      matchedAnchors.push({
        symbol: entry.symbol.parentType
          ? `${entry.symbol.parentType}.${entry.symbol.name}`
          : entry.symbol.name,
        type: anchorType(entry.symbol, index),
        relevanceScore: entry.score,
        filePath: entry.symbol.filePath,
        line: entry.symbol.lineStart ?? 1,
        matchedBy: entry.matchedBy,
        // v0.11 — expose graph degree on anchors so the Cmd+K palette can show
        // inbound/outbound call counts without a second graph traversal.
        inDegree: graph.inDegree.get(id) ?? 0,
        outDegree: graph.outDegree.get(id) ?? 0
      });
    }
  }

  return {
    schemaVersion: 1,
    repoId,
    matchedAnchors,
    hubNodes,
    topApis,
    persistenceEntities: persistenceEntityNames(symbols)
  };
}
