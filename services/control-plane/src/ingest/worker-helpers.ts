import type { RepoSymbol } from './repoqa-repos';
import type {
  RepoQaTraceHop,
  EvolutionIntentEcho,
  IndexingPhase
} from '../../../../packages/contracts/src/index';
import { frontendCallersForRoute } from '../diagnose-engine';

/**
 * V27-30 (B3 increment 1) — the pure module-level helpers that used to head
 * repoqa-worker.ts (its first ~280 lines). They never touched worker state:
 * this split turns the worker file's header from dead weight into an
 * independently unit-tested surface, and repoqa-worker.ts re-exports every
 * public name so consumers (domain-radar-engine, repoqa-eval, tests) keep
 * their import paths untouched.
 */

/**
 * Issue 24 / ADR-0013 — a physical hop harvested from this session's
 * deterministic tool results. Layer-instruction diagrams may only render
 * edges between such hops; anything else stays out of the geometry.
 */
export interface SessionGraphEdge {
  file: string;
  method: string;
  line: number;
}

/** Session-scoped provenance for layer-instruction rendering. */
export interface DiagramSession {
  edges: SessionGraphEdge[];
  /** Tool names whose result carried `{ error }` — a failed session voids call_chain rendering. */
  failedTools: Set<string>;
}

export type IndexProgressPayload = {
  repoId: string;
  phase: 'cloning' | 'parsing' | 'ready' | 'error' | IndexingPhase;
  detail?: string;
  parsedCount?: number;
  totalFiles?: number;
  phaseLabel?: string;
  currentFile?: string;
  processedFiles?: number;
  percent?: number;
};

/**
 * v0.10 — annotate trace hops that resolve to a route symbol with the browser
 * HTTP bridge method/url. Pure and deterministic: the method comes from the
 * AST-evidence bridge resolver (`frontendCallersForRoute`), never guessed
 * (ADR-0002). Hops without a displayPath or matching bridge stay untouched.
 *
 * Key is `${filePath}:${name}` (not `symbolIdentity`, which also carries
 * lineStart) because `resolveCallChain` emits `hop.file` = `symbol.filePath`
 * and `hop.method` = `symbol.name` without lineStart. Route symbols are
 * unique enough per file+name for this two-part key to be safe.
 */
export function annotateTraceHttpMethods(
  trace: RepoQaTraceHop[],
  symbols: RepoSymbol[]
): RepoQaTraceHop[] {
  const byFileAndName = new Map<string, RepoSymbol>();
  for (const symbol of symbols) {
    if (!symbol.displayPath) continue;
    byFileAndName.set(`${symbol.filePath}:${symbol.name}`, symbol);
  }
  return trace.map((hop) => {
    if (hop.http) return hop;
    const symbol = byFileAndName.get(`${hop.file}:${hop.method}`);
    if (!symbol?.displayPath) return hop;
    const bridges = frontendCallersForRoute(symbols, symbol.displayPath);
    const bridge = bridges[0];
    if (!bridge) return hop;
    return { ...hop, http: { method: bridge.http.method, url: bridge.http.url } };
  });
}

export type StartSymbolResolution = {
  symbol: RepoSymbol;
  fallback: boolean;
  confidence: number;
};

export type FileRefreshResult = {
  repoId: string;
  file: string;
  action: 'update' | 'remove';
};

export function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

/**
 * Issue 18 — split an identifier into its lowercase words so natural-language
 * questions can match camelCase / snake_case / kebab-case symbol names:
 * `createOwner` → `['create', 'owner']`, `get_pet_types` → `['get', 'pet', 'types']`.
 */
export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Issue 18 — score how strongly a natural-language sentence mentions a symbol.
 * 0 = no match; higher = stronger. Exact whole-question matches score highest;
 * the phrase containing the exact symbol name, a camelCase word, a prefix and a
 * plain substring rank below in that order. This is a pure helper so the
 * deterministic static path stays fully unit-testable without LLMs.
 */
/**
 * Ticket 04 — deterministic intent parser (the zero-LLM NLU fallback).
 *
 * Chinese intents have no spaces, so prose is split at intent marker words
 * (给/加/新增/模块/…) instead of token boundaries. The keyword is the first
 * symbol-like latin identifier (OrderService), else the first CJK segment
 * (订单); every other segment becomes the extension goal. Deprecation verbs
 * route the whole intent to DEPRECATE.
 * "给订单模块加 Excel 导出" -> { EXTEND, keyword "订单", goal "Excel 导出" }.
 */
const DEPRECATE_VERBS = [
  '下线',
  '废弃',
  '退役',
  '下架',
  '移除',
  '删除',
  '清除',
  'deprecat',
  'retire',
  'remove',
  'delete'
];

const INTENT_MARKERS = [
  '给我',
  '帮我',
  '我要',
  '我想',
  '请',
  '帮忙',
  '麻烦',
  '需要',
  '计划',
  '准备',
  '一下',
  '加上',
  '加个',
  '加',
  '添加',
  '新增',
  '增加',
  '做个',
  '做',
  '实现',
  '支持',
  '扩展',
  '模块',
  '功能',
  '里',
  '中',
  '上',
  '把',
  '对',
  '在',
  '给',
  '想',
  '要',
  '的',
  '个'
];

/** Latin filler stripped word-wise (word boundaries, case-insensitive). */
const LATIN_FILLER = /\b(add|support|please|module|feature|the|and|for|to|with|of|a|an)\b/gi;

function escapeMarker(marker: string): string {
  return marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function deterministicIntentParse(question: string): EvolutionIntentEcho {
  const text = question.trim();
  const lowered = text.toLowerCase();
  const isDeprecate = DEPRECATE_VERBS.some((verb) => lowered.includes(verb));

  // 1) Strip the (first) deprecation verb, 2) cut the rest at marker words.
  let residue = text;
  for (const verb of DEPRECATE_VERBS) {
    const at = lowered.indexOf(verb);
    if (at >= 0) {
      residue = residue.slice(0, at) + residue.slice(at + verb.length);
    }
  }
  const markerPattern = new RegExp(
    `${INTENT_MARKERS.map(escapeMarker).join('|')}|[^\\u4e00-\\u9fffA-Za-z0-9_.]+|\\s+`,
    'g'
  );
  const segments = residue
    .replace(LATIN_FILLER, ' ')
    .split(markerPattern)
    .map((segment) => segment.trim())
    .filter(Boolean);

  // Keyword: symbol-like identifier > first CJK segment > longest segment.
  const symbolLike = segments.find(
    (segment) => segment.length >= 6 && /[A-Z]/.test(segment) && /[a-z]/.test(segment)
  );
  const cjk = segments.find((segment) => /[\u4e00-\u9fff]/.test(segment));
  const keyword =
    symbolLike ?? cjk ?? [...segments].sort((a, b) => b.length - a.length)[0] ?? text;
  const goal = segments
    .filter((segment) => segment !== keyword)
    .join(' ')
    .trim();
  return {
    intentType: isDeprecate ? 'DEPRECATE' : 'EXTEND',
    rawKeyword: keyword,
    ...(isDeprecate || !goal ? {} : { extensionGoal: goal }),
    alternatives: [],
    parsedBy: 'fallback'
  };
}

export function fuzzyMatchScore(question: string, symbolName: string): number {
  const q = question.toLowerCase();
  const name = symbolName.toLowerCase();
  if (!q || !name) return 0;
  if (q === name) return 100;
  if (name.length >= 3 && q.includes(name)) return 90;
  const words = q.match(/[a-z_$][\w$]*/g) ?? [];
  if (words.length === 0) return 0;
  const parts = splitIdentifier(symbolName);
  let best = 0;
  for (const word of words) {
    if (parts.includes(word)) {
      best = Math.max(best, 80);
      continue;
    }
    for (const part of parts) {
      if (word.length >= 3 && part.startsWith(word)) best = Math.max(best, 60);
      if (word.length >= 4 && word.startsWith(part)) best = Math.max(best, 50);
    }
    if (word.length >= 4 && name.includes(word)) best = Math.max(best, 40);
  }
  return best;
}

/**
 * Issue 18 — fuzzy start-symbol lookup used when exact matching fails. Scores
 * are relevance-led: the highest-scoring symbol wins, with production code and
 * method-kind used to break ties (a weak-scoring method never beats a strongly
 * matching route/service/class). Within a 10-point band a method is preferred
 * even over a slightly higher-scoring type, since call-chain traces start at
 * real methods while types normalize to an arbitrary first method.
 */
export function findFuzzyStartSymbol(
  question: string,
  symbols: RepoSymbol[],
  isTestPath: (filePath: string) => boolean
): RepoSymbol | undefined {
  const methodKinds = new Set(['method']);
  const typeKinds = new Set(['class', 'interface', 'route', 'service', 'repository']);
  const candidates: Array<{ symbol: RepoSymbol; prod: boolean }> = [];
  for (const symbol of symbols) {
    if (!methodKinds.has(symbol.kind) && !typeKinds.has(symbol.kind)) continue;
    candidates.push({ symbol, prod: !isTestPath(symbol.filePath) });
  }
  // Relevance-led ranking with a narrow method preference band: a method whose
  // score is within 10 points of a type/route symbol still wins, because
  // call-chain traces start at real methods while types normalize to an
  // arbitrary first method. Outside that band the higher score always wins
  // (a weak method never beats a strongly matching service/class).
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: fuzzyMatchScore(question, candidate.symbol.name)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      const prodDiff = (b.candidate.prod ? 1 : 0) - (a.candidate.prod ? 1 : 0);
      if (prodDiff !== 0) return prodDiff;
      const aIsMethod = methodKinds.has(a.candidate.symbol.kind);
      const bIsMethod = methodKinds.has(b.candidate.symbol.kind);
      if (aIsMethod && !bIsMethod && a.score >= b.score - 10) return -1;
      if (bIsMethod && !aIsMethod && b.score >= a.score - 10) return 1;
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return (bIsMethod ? 1 : 0) - (aIsMethod ? 1 : 0);
    });
  return ranked[0]?.candidate.symbol;
}
