import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DiagnoseChainStep,
  DiagnoseResult,
  DiagnoseLayer
} from '../../../packages/contracts/src/index';
import {
  normalizeRoutePath,
  resolveCallChain,
  symbolIdentity,
  type SymbolIndex
} from './repoqa-callchain';
import type { RepoSymbol } from './repoqa-repos';

/**
 * v0.8.0 — Composite diagnose engine (deterministic, zero-LLM).
 *
 * Cross-stack root-cause traversal over the AST-derived evidence plane:
 * frontend components (HTTP bridge) → HTTP router → service → data mapper.
 * Every hop is a statically bound graph edge; a hop that cannot be bound is
 * reported as BROKEN with the deterministic break reason — never guessed.
 * Narration and patch suggestions belong to the LLM orchestration layer.
 */

export const DEFAULT_COCKPIT_BASE = 'http://localhost:43110';

/** Mirrors RepoQAWorker.isTestPath: production symbols win over test helpers. */
function isTestPath(filePath: string): boolean {
  const p = filePath.replace(/\\/g, '/').toLowerCase();
  return p.includes('/test/') || p.includes('/src/test') || p.includes('test/java');
}

/** Route-entry form: "POST /api/v1/posts/:id/like". */
const ROUTE_ENTRY_RE = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S*)$/i;

/** Same variant expansion as the Issue 25 bridge resolver, plus deterministic
 * digit-segment collapsing so a concrete call URL ("…/posts/45/like") matches
 * a placeholder route ("…/posts/{id}/like"). */
export function routePathVariants(rawPath: string): Set<string> {
  const url = normalizeRoutePath(rawPath);
  const variants = new Set<string>([url]);
  if (url.startsWith('/api/')) variants.add(url.slice('/api'.length));
  if (url.startsWith('/api/v1')) variants.add(url.slice('/api/v1'.length));
  variants.add(`/api${url}`);
  variants.add(`/api/v1${url}`);
  // Numeric path segments are almost always resource ids, never literals.
  const digitFold = (value: string) => value.replace(/\/\d+(?=\/|$)/g, '/{}');
  for (const variant of [...variants]) variants.add(digitFold(variant));
  return variants;
}

/** Symbol identity lookup (matches repoqa-callchain's identity key). */
export function buildIdentityMap(symbols: RepoSymbol[]): Map<string, RepoSymbol> {
  const map = new Map<string, RepoSymbol>();
  for (const symbol of symbols) map.set(symbolIdentity(symbol), symbol);
  return map;
}

export function layerOf(symbol: RepoSymbol, index: SymbolIndex): DiagnoseLayer {
  if (symbol.kind === 'sql' || symbol.kind === 'mapper' || symbol.kind === 'repository') {
    return 'DATA_MAPPER';
  }
  if (symbol.kind === 'route' || symbol.displayPath) return 'HTTP_ROUTER';
  const parent = symbol.parentType ? index.types.get(symbol.parentType)?.symbol : undefined;
  if (parent?.kind === 'service') return 'SERVICE';
  if (parent?.kind === 'repository') return 'DATA_MAPPER';
  if (parent?.displayPath) return 'HTTP_ROUTER';
  return 'SERVICE';
}

/**
 * Frontend components bridged to a backend route: symbols carrying a browser
 * HTTP call (fetch/axios) whose normalized URL matches the route path.
 */
export function frontendCallersForRoute(
  symbols: RepoSymbol[],
  routePath: string
): Array<{ symbol: RepoSymbol; http: { method: string; url: string } }> {
  const targetVariants = routePathVariants(routePath);
  const seen = new Map<string, { symbol: RepoSymbol; http: { method: string; url: string } }>();
  for (const symbol of symbols) {
    for (const call of symbol.calls ?? []) {
      if (!call.http) continue;
      // Both sides expand the same variant set, so a concrete call URL
      // ("…/posts/1/like") matches a placeholder route ("…/posts/{id}/like").
      const callVariants = routePathVariants(call.http.url);
      if (![...callVariants].some((variant) => targetVariants.has(variant))) continue;
      const key = `${symbol.filePath}|${symbol.name}|${call.line ?? 0}`;
      seen.set(key, { symbol, http: call.http });
    }
  }
  return [...seen.values()].sort(
    (a, b) =>
      a.symbol.filePath.localeCompare(b.symbol.filePath) ||
      (a.symbol.lineStart ?? 0) - (b.symbol.lineStart ?? 0)
  );
}

/** Best-effort code slice; empty string when the file cannot be read. */
export function readSnippet(root: string | undefined, file: string, line: number): string | undefined {
  if (!root || !file) return undefined;
  try {
    const absolute = path.resolve(root, file);
    const content = fs.readFileSync(absolute, 'utf8');
    const lines = content.split(/\r?\n/);
    const start = Math.max(0, line - 3);
    const end = Math.min(lines.length, line + 9);
    return lines
      .slice(start, end)
      .map((text, i) => `${start + i + 1}: ${text}`)
      .join('\n');
  } catch {
    return undefined;
  }
}

export function stableTraceId(prefix: string, ...parts: string[]): string {
  const hash = createHash('sha1').update(parts.join('|')).digest('hex');
  return `${prefix}-${hash.slice(0, 12)}`;
}

export function cockpitLink(baseUrl: string, repoId: string, focus: string, traceId: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/?repo=${encodeURIComponent(repoId)}&focus=${encodeURIComponent(focus)}&traceId=${encodeURIComponent(traceId)}`;
}

export interface DiagnoseEngineInput {
  repoId: string;
  entrySymbol: string;
  symptomDescription?: string;
  symbols: RepoSymbol[];
  index: SymbolIndex;
  /** Cockpit base URL for the deep link (default http://localhost:43110). */
  baseUrl?: string;
  /** Repo local path; enables code snippets in chain steps. */
  snippetRoot?: string;
}

function stepFromSymbol(
  symbol: RepoSymbol,
  layer: DiagnoseLayer,
  status: DiagnoseChainStep['status'],
  notes?: string,
  snippetRoot?: string
): DiagnoseChainStep {
  const line = symbol.lineStart ?? 1;
  return {
    layer,
    symbol: symbol.name,
    filePath: symbol.filePath,
    line,
    status,
    ...(notes ? { diagnosticNotes: notes } : {}),
    codeSnippet: readSnippet(snippetRoot, symbol.filePath, line)
  };
}

/** Deterministic 4-layer degrade traversal for one entry symbol. */
export function runDiagnose(input: DiagnoseEngineInput): DiagnoseResult {
  const { repoId, symbols, index } = input;
  const entry = input.entrySymbol.trim();
  if (!entry) throw new Error('entrySymbol is required');
  const baseUrl = input.baseUrl ?? DEFAULT_COCKPIT_BASE;
  const traceId = stableTraceId('dg', repoId, entry);
  const deepLink = cockpitLink(baseUrl, repoId, entry, traceId);

  const steps: DiagnoseChainStep[] = [];
  const routeMatch = ROUTE_ENTRY_RE.exec(entry);

  // 1. Resolve the entry deterministically: route path first, then symbol name.
  let entrySymbol: RepoSymbol | undefined;
  let entryRoutePath: string | undefined;
  if (routeMatch) {
    entryRoutePath = routeMatch[2];
    const variants = routePathVariants(entryRoutePath);
    const candidates: RepoSymbol[] = [];
    for (const variant of variants) {
      for (const candidate of index.routesByPath.get(variant) ?? []) candidates.push(candidate.symbol);
    }
    // Highest priority (method-level path > class route), then earliest line.
    const byPriority = new Map<RepoSymbol, number>();
    for (const variant of variants) {
      for (const candidate of index.routesByPath.get(variant) ?? []) {
        byPriority.set(candidate.symbol, candidate.priority);
      }
    }
    candidates.sort(
      (a, b) =>
        (byPriority.get(b) ?? 0) - (byPriority.get(a) ?? 0) ||
        (a.lineStart ?? 0) - (b.lineStart ?? 0)
    );
    entrySymbol = candidates[0];
    if (!entrySymbol) {
      steps.push({
        layer: 'HTTP_ROUTER',
        symbol: entry,
        filePath: '',
        line: 0,
        status: 'BROKEN',
        diagnosticNotes: `No indexed route matches ${entryRoutePath} (normalized match failed). The route may not exist, or the backend router file was not indexed.`
      });
      return {
        schemaVersion: 1,
        repoId,
        traceId,
        entrySymbol: entry,
        verifiedChain: steps,
        rootCauseSummary: `Entry route ${entryRoutePath} not found in the indexed routes — the chain cannot start.`,
        cockpitDeepLink: deepLink
      };
    }
  } else {
    const name = entry.toLowerCase();
    const prod = symbols.filter(
      (symbol) =>
        symbol.kind === 'method' &&
        symbol.name.toLowerCase() === name &&
        !isTestPath(symbol.filePath)
    );
    const anyKind = symbols.filter((symbol) => symbol.name.toLowerCase() === name);
    entrySymbol = prod[0] ?? anyKind[0];
    if (!entrySymbol) {
      steps.push({
        layer: 'SERVICE',
        symbol: entry,
        filePath: '',
        line: 0,
        status: 'BROKEN',
        diagnosticNotes: `Start symbol not found in the indexed symbols.`
      });
      return {
        schemaVersion: 1,
        repoId,
        traceId,
        entrySymbol: entry,
        verifiedChain: steps,
        rootCauseSummary: `Entry symbol "${entry}" not found in the indexed symbols — the chain cannot start.`,
        cockpitDeepLink: deepLink
      };
    }
  }

  // 2. FRONTEND_COMPONENT layer: components whose browser HTTP call lands here.
  if (entryRoutePath || entrySymbol.displayPath) {
    const routePath = entryRoutePath ?? entrySymbol.displayPath!;
    for (const bridge of frontendCallersForRoute(symbols, routePath)) {
      steps.push({
        layer: 'FRONTEND_COMPONENT',
        symbol: bridge.symbol.parentType ?? bridge.symbol.name,
        filePath: bridge.symbol.filePath,
        line: bridge.symbol.lineStart ?? 1,
        status: 'VERIFIED',
        diagnosticNotes: `Browser HTTP bridge ${bridge.http.method} ${bridge.http.url}`
      });
    }
  }

  // 3. Forward deterministic trace from the entry.
  const trace = resolveCallChain(symbols, entrySymbol, 6, index);
  const identityMap = buildIdentityMap(symbols);
  let previousLayer: DiagnoseLayer = layerOf(entrySymbol, index);

  trace.forEach((hop, i) => {
    const identity = `${hop.file}:${hop.line ?? 0}:${hop.method}`;
    const symbol = identityMap.get(identity);
    if (hop.break) {
      steps.push({
        layer: previousLayer,
        symbol: hop.method,
        filePath: hop.file,
        line: hop.line ?? 1,
        status: 'BROKEN',
        diagnosticNotes: hop.reason ?? 'Static analysis break'
      });
      return;
    }
    const layer = symbol ? layerOf(symbol, index) : previousLayer;
    previousLayer = layer;
    const isLast = i === trace.length - 1;
    const deadEnd = isLast && trace.length === 1 && (symbol?.calls?.length ?? 0) === 0;
    steps.push(
      stepFromSymbol(
        {
          ...symbol,
          name: hop.method,
          filePath: hop.file,
          lineStart: hop.line ?? 1,
          lineEnd: hop.lineEnd
        } as RepoSymbol,
        layer,
        deadEnd ? 'SUSPECT' : 'VERIFIED',
        deadEnd
          ? 'No statically resolvable downstream call — runtime dispatch or missing index edge.'
          : undefined,
        input.snippetRoot
      )
    );
  });

  // 4. Deterministic root-cause summary.
  const broken = steps.filter((step) => step.status === 'BROKEN');
  const firstBreak = broken[0];
  const symptomPrefix = input.symptomDescription
    ? `Symptom: ${input.symptomDescription} — `
    : '';
  const bridgeCount = steps.filter((step) => step.layer === 'FRONTEND_COMPONENT').length;
  const bridgeNote = bridgeCount > 0 ? ` Bridged from ${bridgeCount} frontend component(s) via the HTTP bridge.` : '';
  const rootCauseSummary = firstBreak
    ? `${symptomPrefix}Chain traces ${steps.length} step(s); first break at ${firstBreak.symbol} (${firstBreak.filePath}:${firstBreak.line}): ${firstBreak.diagnosticNotes ?? 'static analysis break'}.${bridgeNote}`
    : `${symptomPrefix}Chain of ${steps.length} step(s) fully verified against the static graph; no deterministic break found.${bridgeNote}`;

  return {
    schemaVersion: 1,
    repoId,
    traceId,
    entrySymbol: entry,
    verifiedChain: steps,
    rootCauseSummary,
    cockpitDeepLink: deepLink
  };
}
