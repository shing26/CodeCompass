import type {
  ScanBucket,
  ScanCandidate,
  ScanResult
} from '../../../packages/contracts/src/index';
import type { RepoSymbol } from './repoqa-repos';
import type { SymbolIndex } from './repoqa-callchain';
import { symbolIdentity } from './repoqa-callchain';
import { buildRadarGraph, computePageRank } from './domain-radar-engine';
import { pickTopApis } from './repoqa-dashboard';
import { cockpitLink, isTestPath } from './diagnose-engine';

/**
 * Candidate Scan (v0.19.0) — proactive "what should I touch in this repo?"
 * engine. Deterministic aggregation over the symbol graph, zero LLM
 * (ADR-0002/0005): every candidate carries a physical file:line anchor and
 * the deterministic evidence that put it in its bucket. Buckets answer
 * "where do I start", domain_radar answers "what does this repo look like".
 */

export const SCAN_TOP_LIMIT = 10;

/** A method spanning ≥150 lines is a deterministic complexity proxy. */
export const OVERSIZED_METHOD_LINES = 150;

/** A file whose symbol-covered span reaches ≥600 lines is a debt hotspot. */
export const OVERSIZED_FILE_LINES = 600;

interface ScanInput {
  repoId: string;
  repoName: string;
  symbols: RepoSymbol[];
  index: SymbolIndex;
  baseUrl: string;
}

const ORPHAN_NOTE =
  'Static zero-caller only: reflective lookups, dynamic proxies and MQ ' +
  'subscriptions are invisible to AST analysis — verify before removing.';

const OVERSIZED_NOTE =
  'Line span is a deterministic complexity proxy until method-body AST ' +
  'extraction lands; it measures size, not quality.';

function candidateOf(
  symbol: RepoSymbol,
  detail: string,
  lineEnd?: number
): ScanCandidate {
  return {
    symbol: symbol.parentType ? `${symbol.parentType}.${symbol.name}` : symbol.name,
    kind: symbol.kind,
    filePath: symbol.filePath,
    line: symbol.lineStart ?? 1,
    ...(lineEnd !== undefined ? { lineEnd } : {}),
    detail
  };
}

/** filePath → lineStart, the repo-wide deterministic tiebreak convention. */
function byLocation(a: ScanCandidate, b: ScanCandidate): number {
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  return a.line - b.line;
}

function bucket(
  id: ScanBucket['id'],
  title: string,
  items: ScanCandidate[],
  total: number,
  nextAction: string,
  note?: string
): ScanBucket {
  return { id, title, items, total, nextAction, ...(note ? { note } : {}) };
}

export function runScan(input: ScanInput): ScanResult {
  const { repoId, repoName, symbols, index, baseUrl } = input;
  // One graph pass serves both the orphan bucket (in-degree) and the hub
  // bucket (PageRank); it already filters to production kinds and drops
  // test paths.
  const graph = buildRadarGraph(symbols, index);
  const rank = computePageRank([...graph.symbolsById.keys()], graph.edges);

  /* Bucket 1 — orphaned public code: production symbols with zero callers.
     Routes are external HTTP entry points, so a missing caller is normal for
     them and they are excluded. */
  const orphanItems: ScanCandidate[] = [];
  for (const [id, symbol] of graph.symbolsById) {
    if (symbol.kind === 'route') continue;
    if ((graph.inDegree.get(id) ?? 0) !== 0) continue;
    const span =
      symbol.lineEnd !== undefined && symbol.lineStart !== undefined
        ? symbol.lineEnd - symbol.lineStart
        : undefined;
    orphanItems.push(
      candidateOf(
        symbol,
        span !== undefined ? `0 static callers; spans ${span} lines` : '0 static callers',
        span !== undefined ? symbol.lineEnd : undefined
      )
    );
  }
  orphanItems.sort(byLocation);

  /* Bucket 2 — hubs: PageRank top; the blast-radius heavyweights. */
  const hubRanked = [...graph.symbolsById.keys()]
    .map((id) => {
      const symbol = graph.symbolsById.get(id)!;
      const rankValue = rank.get(id) ?? 0;
      return { symbol, rankValue };
    })
    .sort(
      (a, b) =>
        b.rankValue - a.rankValue ||
        (a.symbol.filePath < b.symbol.filePath ? -1 : a.symbol.filePath > b.symbol.filePath ? 1 : 0) ||
        (a.symbol.lineStart ?? 0) - (b.symbol.lineStart ?? 0)
    );
  const hubTotal = hubRanked.length;
  const hubItems: ScanCandidate[] = hubRanked
    .slice(0, SCAN_TOP_LIMIT)
    .map(({ symbol, rankValue }) => {
      const id = symbolIdentity(symbol);
      return candidateOf(
        symbol,
        `PageRank ${rankValue.toFixed(4)}; in ${graph.inDegree.get(id) ?? 0} / out ${graph.outDegree.get(id) ?? 0}`
      );
    });

  /* Bucket 3 — oversized methods: line-span proxy for complexity. */
  const oversizedItems: ScanCandidate[] = symbols
    .filter(
      (symbol) =>
        symbol.kind === 'method' &&
        !isTestPath(symbol.filePath) &&
        symbol.lineEnd !== undefined &&
        symbol.lineStart !== undefined &&
        symbol.lineEnd - symbol.lineStart >= OVERSIZED_METHOD_LINES
    )
    .sort(
      (a, b) =>
        b.lineEnd! - b.lineStart! - (a.lineEnd! - a.lineStart!) ||
        (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0) ||
        a.lineStart! - b.lineStart!
    )
    .slice(0, SCAN_TOP_LIMIT)
    .map((symbol) =>
      candidateOf(
        symbol,
        `spans ${symbol.lineEnd! - symbol.lineStart!} lines`,
        symbol.lineEnd
      )
    );

  /* Bucket 4 — deep call chains: longest statically-resolvable entry flows.
     maxDepth 6 mirrors pickTopApis' cockpit default; the total needs an
     uncapped pass so it reports every entry chain, not just the top N. */
  const DEEP_CHAIN_MAX_DEPTH = 6;
  const deepChains = pickTopApis(symbols, DEEP_CHAIN_MAX_DEPTH, SCAN_TOP_LIMIT);
  const deepChainTotal = pickTopApis(symbols, DEEP_CHAIN_MAX_DEPTH, 100).length;
  const deepChainItems: ScanCandidate[] = deepChains.map((entry) => ({
    symbol: entry.controller ? `${entry.controller}.${entry.name}` : entry.name,
    kind: 'route',
    filePath: entry.filePath,
    line: entry.lineStart,
    detail: `chain depth ${entry.depth}: ${entry.hops.join(' → ')}`
  }));

  /* Bucket 5 — oversized files: per-file span of the indexed symbols.
     Aggregating symbol spans per file surfaces "many medium methods piled
     into one big file" — the debt a method-level bucket cannot see. The
     span is the index's own byproduct, a pure fact about size. */
  const fileSpans = new Map<string, { start: number; end: number; symbolCount: number }>();
  for (const symbol of symbols) {
    if (!symbol.lineStart || isTestPath(symbol.filePath)) continue;
    const span = fileSpans.get(symbol.filePath);
    if (!span) {
      fileSpans.set(symbol.filePath, {
        start: symbol.lineStart,
        end: symbol.lineEnd ?? symbol.lineStart,
        symbolCount: 1
      });
      continue;
    }
    span.start = Math.min(span.start, symbol.lineStart);
    span.end = Math.max(span.end, symbol.lineEnd ?? symbol.lineStart);
    span.symbolCount += 1;
  }
  const oversizedFileItems: ScanCandidate[] = [...fileSpans.entries()]
    .map(([filePath, span]) => ({
      filePath,
      span,
      size: span.end - span.start
    }))
    .filter((entry) => entry.size >= OVERSIZED_FILE_LINES)
    .sort((a, b) => b.size - a.size || (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0))
    .slice(0, SCAN_TOP_LIMIT)
    .map((entry) => ({
      symbol: entry.filePath.split('/').pop() ?? entry.filePath,
      kind: 'file',
      filePath: entry.filePath,
      line: entry.span.start,
      lineEnd: entry.span.end,
      detail: `${entry.size} lines across ${entry.span.symbolCount} indexed symbols`
    }));

  return {
    schemaVersion: 1,
    repoId,
    repoName,
    buckets: [
      bucket(
        'orphanedPublic',
        'Orphaned public code (zero static callers)',
        orphanItems.slice(0, SCAN_TOP_LIMIT),
        orphanItems.length,
        'Plan a safe teardown with codecompass_module_evolution (DEPRECATE) before deleting anything.',
        ORPHAN_NOTE
      ),
      bucket(
        'hubs',
        'Change-impact hubs (highest PageRank)',
        hubItems,
        hubTotal,
        'Run codecompass_refactor_plan on any of these before touching them.'
      ),
      bucket(
        'oversized',
        `Oversized methods (≥${OVERSIZED_METHOD_LINES} lines)`,
        oversizedItems,
        oversizedItems.length,
        'Extract cohesive units, then verify with codecompass_trace_call_chain.',
        OVERSIZED_NOTE
      ),
      bucket(
        'deepChains',
        'Deep call chains (longest entry flows)',
        deepChainItems,
        deepChainTotal,
        'Run codecompass_diagnose on an entry to see the layered chain.'
      ),
      bucket(
        'oversizedFiles',
        `Oversized files (≥${OVERSIZED_FILE_LINES} lines of indexed span)`,
        oversizedFileItems,
        oversizedFileItems.length,
        'Read the file and assess cohesion — split or extract only with evidence from codecompass_reverse_deps.'
      )
    ],
    cockpitDeepLink: cockpitLink(baseUrl, repoId, repoName, '')
  };
}
