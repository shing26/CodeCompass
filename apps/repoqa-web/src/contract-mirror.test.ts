/**
 * V27-26 → V27-29 (B2) — contract mirror guard, single-source edition.
 *
 * The 16 shared types this test once name-pinned are no longer mirrored:
 * src/types.ts re-exports them from packages/contracts, and tsc is now the
 * compile-time guard. What remains here is the ratchet that keeps it that
 * way — a hand-written `export interface X` / `export type X {…}` in web
 * code whose NAME reappears from contracts is exactly how the Dockerfile rot
 * (V27-24) and five drift fields (V27-29 archaeology) were born. Any
 * re-mirrored name goes red until it becomes a re-export.
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
const WEB_FILES = [
  join(SRC, 'types.ts'),
  join(SRC, 'client/RepoQAClient.ts'),
  join(SRC, 'hooks/useChat.ts'),
  join(SRC, 'hooks/useEvolutionSession.ts'),
];

/** Names web is ALLOWED to spell on its own even though contracts shares
 * the concept — documented alias bridges, not mirrors. Adding to this list
 * is adding technical debt; prefer `export type { X } from '…contracts…'`. */
const ALLOWED_ALIASES: string[] = [
  'TokenUsage', // = contracts RepoQaTokenUsage (contracts.TokenUsage is a different concept)
];

function definedNames(file: string): string[] {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  // Definitions only: `export interface X` / `export type X =` / `export type X {`.
  // Re-exports (`export type { X } from`) are deliberately NOT matched — that's
  // the single-source form this guard endorses.
  return [...text.matchAll(/^export\s+(?:interface|type)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]!);
}

function contractExports(): Set<string> {
  const names = new Set<string>();
  for (const f of CONTRACT_FILES) for (const n of definedNames(f)) names.add(n);
  return names;
}

describe('contract mirror guard (V27-26/V27-29, single-source edition)', () => {
  const contracts = contractExports();

  it('contracts exports are reachable and non-empty (guard not silently dead)', () => {
    expect(contracts.size).toBeGreaterThan(10);
    for (const must of ['ModuleEvolutionResult', 'ArchitectureDeltaReport', 'RepoQaTokenUsage']) {
      expect(contracts.has(must), `contracts lost shared export ${must}`).toBe(true);
    }
  });

  for (const file of WEB_FILES) {
    it(`${file.slice(SRC.length + 1)} defines no contract-named types by hand`, () => {
      const offenders = definedNames(file).filter(
        (n) => contracts.has(n) && !ALLOWED_ALIASES.includes(n)
      );
      expect(
        offenders,
        `manual re-mirror of contracts type(s) [${offenders}] — re-export from '../../../packages/contracts/src/index' instead`
      ).toEqual([]);
    });
  }
});
