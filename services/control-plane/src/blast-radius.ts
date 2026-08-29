import type { RefactorPlanParams, RefactorPlanResult } from '../../../packages/contracts/src/index';
import { symbolIdentity, buildFullCallersIndex, type SymbolIndex } from './repoqa-callchain';
import type { RepoSymbol } from './repoqa-repos';
import {
  cockpitLink,
  frontendCallersForRoute,
  isTestPath,
  stableTraceId,
  DEFAULT_COCKPIT_BASE
} from './diagnose-engine';

/**
 * v0.8.0 — Composite blast-radius engine (deterministic, zero-LLM).
 *
 * Recursively aggregates direct and indirect callers of a target symbol over
 * the statically bound call graph, lifts the ancestors that expose HTTP
 * routes, bridges those routes back to frontend components, and scores the
 * risk. Migration steps are deterministic templates; patch bodies belong to
 * the LLM orchestration layer.
 */

/** BFS depth cap so pathological hub symbols cannot explode the walk. */
const MAX_REVERSE_HOPS = 8;

export interface BlastRadiusInput {
  repoId: string;
  targetSymbol: string;
  changeType: 'SIGNATURE_CHANGE' | 'REMOVAL' | 'LOGIC_REFACTOR';
  symbols: RepoSymbol[];
  index: SymbolIndex;
  /** Cockpit base URL for the deep link (default http://localhost:43110). */
  baseUrl?: string;
}

function routePathOf(symbol: RepoSymbol, index: SymbolIndex): string | undefined {
  if (symbol.displayPath) return symbol.displayPath;
  const parent = symbol.parentType ? index.types.get(symbol.parentType)?.symbol : undefined;
  return parent?.displayPath;
}

function migrationSteps(
  changeType: RefactorPlanParams['changeType'],
  targetName: string,
  directCallersCount: number,
  impactedRoutes: string[],
  impactedFrontendComponents: string[]
): string[] {
  const steps: string[] = [];
  const routeNote =
    impactedRoutes.length > 0 ? ` (${impactedRoutes.slice(0, 8).join(', ')})` : '';
  const frontendNote =
    impactedFrontendComponents.length > 0
      ? ` (${impactedFrontendComponents.slice(0, 8).join(', ')})`
      : '';
  if (changeType === 'SIGNATURE_CHANGE') {
    steps.push(`Add the new parameter/return shape alongside the old one on ${targetName}; keep the old signature delegating to it.`);
    steps.push(`Migrate all ${directCallersCount} direct caller(s) to the new signature.`);
    if (impactedRoutes.length > 0) {
      steps.push(`Verify the impacted API route(s)${routeNote} still satisfy their request/response contract.`);
    }
    if (impactedFrontendComponents.length > 0) {
      steps.push(`Update the bridged frontend component(s)${frontendNote} if the API contract changed.`);
    }
    steps.push('Remove the deprecated signature once no caller references it.');
  } else if (changeType === 'REMOVAL') {
    steps.push(`Mark ${targetName} as deprecated and announce the removal window.`);
    steps.push(`Audit all ${directCallersCount} direct caller(s); migrate or delete each call site.`);
    if (impactedRoutes.length > 0) {
      steps.push(`Decide the API fate of the impacted route(s)${routeNote}: keep a facade, or remove with a version bump.`);
    }
    if (impactedFrontendComponents.length > 0) {
      steps.push(`Detach the bridged frontend component(s)${frontendNote} from the removed route before release.`);
    }
    steps.push('Delete the symbol and run the architecture gate to confirm zero broken edges.');
  } else {
    steps.push(`Pin the observable behavior of ${targetName} with characterization checks before refactoring.`);
    steps.push(`Keep all ${directCallersCount} direct caller(s) compiling: internal refactor only, no signature change.`);
    if (impactedRoutes.length > 0) {
      steps.push(`Re-verify the impacted route(s)${routeNote} after the refactor.`);
    }
    steps.push('Re-run the call-chain trace to confirm the chain shape is unchanged.');
  }
  return steps;
}

export function runBlastRadius(input: BlastRadiusInput): RefactorPlanResult {
  const { repoId, symbols, index, changeType } = input;
  const target = input.targetSymbol.trim();
  if (!target) throw new Error('targetSymbol is required');
  const baseUrl = input.baseUrl ?? DEFAULT_COCKPIT_BASE;

  // Deterministic target resolution: production methods first, then any kind.
  const name = target.toLowerCase();
  const shortName = name.split('.').pop() ?? name;
  const methodMatches = symbols.filter(
    (symbol) =>
      symbol.kind === 'method' &&
      !isTestPath(symbol.filePath) &&
      (symbol.name.toLowerCase() === name ||
        `${symbol.parentType ?? ''}.${symbol.name}`.toLowerCase() === name)
  );
  const anyMatches = symbols.filter(
    (symbol) => symbol.name.toLowerCase() === shortName && !isTestPath(symbol.filePath)
  );
  const candidates = (methodMatches.length > 0 ? methodMatches : anyMatches).slice(0, 20);
  if (candidates.length === 0) {
    throw new Error(`Start symbol not found: ${target}`);
  }

  // Full reverse adjacency over every symbol with calls (routes included) —
  // shared implementation with the radar and evolution engines.
  const { identityMap, callersOf } = buildFullCallersIndex(symbols, index);
  const revCallers = (symbol: RepoSymbol) =>
    (callersOf.get(symbolIdentity(symbol)) ?? []).map((caller) => ({
      key: `${caller.filePath}:${caller.lineStart ?? 1}:${caller.name}`,
      symbol: caller
    }));

  // Direct callers: one edge away from any target twin.
  const directCallerIds = new Set<string>();
  const directCallerSymbols = new Map<string, RepoSymbol>();
  for (const candidate of candidates) {
    for (const caller of revCallers(candidate)) {
      directCallerIds.add(caller.key);
      if (caller.symbol) directCallerSymbols.set(caller.key, caller.symbol);
    }
  }

  // BFS over reverse edges beyond the direct hop for indirect ancestors.
  // Direct callers are expanded too — their own callers are indirect.
  const indirectIds = new Set<string>();
  let frontier: RepoSymbol[] = [...candidates];
  const visited = new Set(frontier.map((symbol) => symbolIdentity(symbol)));
  for (let hop = 0; hop < MAX_REVERSE_HOPS; hop++) {
    const next: RepoSymbol[] = [];
    for (const node of frontier) {
      for (const caller of revCallers(node)) {
        const key = caller.key;
        const callerSymbol = caller.symbol ?? identityMap.get(key);
        const pushable =
          callerSymbol && !visited.has(symbolIdentity(callerSymbol))
            ? callerSymbol
            : undefined;
        if (directCallerIds.has(key)) {
          if (pushable) {
            visited.add(symbolIdentity(pushable));
            next.push(pushable);
          }
          continue;
        }
        if (indirectIds.has(key)) continue;
        indirectIds.add(key);
        if (pushable) {
          visited.add(symbolIdentity(pushable));
          next.push(pushable);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  const ancestors = [...indirectIds]
    .map((id) => identityMap.get(id))
    .filter((symbol): symbol is RepoSymbol => Boolean(symbol));

  // Routes exposed by the ancestor set, the direct callers (typically the
  // controller routes themselves) and the target's own twins.
  const routePaths = new Set<string>();
  for (const symbol of [
    ...ancestors,
    ...directCallerSymbols.values(),
    ...candidates
  ]) {
    const routePath = routePathOf(symbol, index);
    if (routePath) routePaths.add(routePath);
  }
  const impactedRoutes = [...routePaths].sort();

  // Frontend components bridged to any impacted route.
  const frontend = new Set<string>();
  for (const routePath of impactedRoutes) {
    for (const bridge of frontendCallersForRoute(symbols, routePath)) {
      frontend.add(bridge.symbol.parentType ?? bridge.symbol.name);
    }
  }
  const impactedFrontendComponents = [...frontend].sort();

  // Deterministic risk score: route exposure and frontend breakage weigh most.
  let score =
    impactedRoutes.length * 2 +
    impactedFrontendComponents.length * 3 +
    directCallerIds.size +
    indirectIds.size * 0.5;
  if (changeType === 'REMOVAL') score += 1;
  else if (changeType === 'SIGNATURE_CHANGE') score += 0.5;
  const riskLevel: RefactorPlanResult['riskLevel'] =
    score >= 8 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';

  const primary = candidates[0];
  const traceId = stableTraceId('rf', repoId, target, changeType);

  return {
    schemaVersion: 1,
    repoId,
    targetSymbol: target,
    target: {
      name: primary.name,
      file: primary.filePath,
      line: primary.lineStart ?? 1
    },
    riskLevel,
    directCallersCount: directCallerIds.size,
    indirectCallersCount: indirectIds.size,
    impactedRoutes,
    impactedFrontendComponents,
    migrationSteps: migrationSteps(
      changeType,
      primary.parentType ? `${primary.parentType}.${primary.name}` : primary.name,
      directCallerIds.size,
      impactedRoutes,
      impactedFrontendComponents
    ),
    cockpitDeepLink: cockpitLink(baseUrl, repoId, target, traceId)
  };
}
