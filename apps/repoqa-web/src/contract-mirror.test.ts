/**
 * V27-26 (A3) — contract mirror sentinel.
 *
 * apps/repoqa-web/src/types.ts hand-mirrors a subset of packages/contracts
 * (src/repoqa.ts + v1.ts) with no compile-time link between them — the class
 * of drift that made this repo's Dockerfile rot silently (V27-24). This guard
 * pins the mirror scope: the set of exported type NAMES that both sides
 * declare must equal the declared watchlist below. Adding/removing a mirrored
 * type on either side goes red until the mirror decision is made explicit.
 *
 * Name-level scope only: field-level equality is deliberately deferred to the
 * single-source surgery (V27-29) — contracts is currently the `+nullable`
 * superset direction (e.g. optional filePath vs required web view), so a
 * field-set equality assertion would be red on arrival and teach nothing.
 *
 * Method follows copy-guard.test.ts (readFileSync of adjacent sources +
 * regex parse; runs in vitest node-land, hence the tsconfig exclude entry).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));
const CONTRACT_FILES = [
  join(SRC, '../../../packages/contracts/src/repoqa.ts'),
  join(SRC, '../../../packages/contracts/v1.ts'),
];
const WEB_TYPES = join(SRC, 'types.ts');

/** Types the web layer deliberately mirrors from contracts. Anything here
 * must exist on BOTH sides; anything in the two-sided intersection that is
 * not here means an undeclared mirror appeared — register it or unlink it. */
const WATCHLIST = [
  'ArchitectureDeltaReport',
  'ConventionAnchor',
  'ConventionConflictDetail',
  'DomainRadarAnchor',
  'DomainRadarResult',
  'EvolutionIntentEcho',
  'EvolutionPlacement',
  'EvolutionPlacementFile',
  'EvolutionRisk',
  'EvolutionStageId',
  'IndexingPhase',
  'ModuleEvolutionResult',
  'RepoQaEvolveDone',
  'RepoQaEvolveError',
  'RepoQaEvolveStage',
  'TokenUsage',
];

function exportedTypeNames(...files: string[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    for (const m of text.matchAll(/^export\s+(?:interface|type)\s+([A-Za-z0-9_]+)/gm)) {
      names.add(m[1]);
    }
  }
  return names;
}

function diff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort();
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  return new Set([...a].filter((x) => b.has(x)));
}

describe('contract mirror guard (v0.27-B A3, V27-26)', () => {
  const contracts = exportedTypeNames(...CONTRACT_FILES);
  const web = exportedTypeNames(WEB_TYPES);

  it('every watchlisted type is declared on both sides', () => {
    const missingContracts = WATCHLIST.filter((n) => !contracts.has(n));
    const missingWeb = WATCHLIST.filter((n) => !web.has(n));
    expect(
      { missingContracts, missingWeb },
      `mirror drift: dropped on contracts side=[${missingContracts}] web side=[${missingWeb}]`,
    ).toEqual({ missingContracts: [], missingWeb: [] });
  });

  it('the mirrored name-set equals the watchlist (no undeclared mirrors)', () => {
    const overlap = intersect(web, contracts);
    const undeclared = diff(overlap, new Set(WATCHLIST));
    const registeredButGone = diff(new Set(WATCHLIST), overlap);
    expect(
      { undeclared, registeredButGone },
      `mirror scope drift: new shared names=[${undeclared}] watchlist entries no longer shared=[${registeredButGone}]`,
    ).toEqual({ undeclared: [], registeredButGone: [] });
  });
});
