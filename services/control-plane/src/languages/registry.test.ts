import { describe, expect, it } from 'vitest';
import {
  adapterFor,
  LANGUAGE_REGISTRY,
  SOURCE_EXTENSIONS
} from './registry';
import {
  GO_EXTENSIONS,
  JAVA_EXTENSIONS,
  PRISMA_EXTENSIONS,
  PYTHON_EXTENSIONS,
  TYPESCRIPT_EXTENSIONS
} from './language-extensions';
import { GoAdapter } from './GoAdapter';
import { JavaAdapter } from './JavaAdapter';
import { PrismaAdapter } from './PrismaAdapter';
import { PythonAdapter } from './PythonAdapter';
import { TypeScriptAdapter } from './TypeScriptAdapter';

/**
 * Issue 09 — the registry is the single wiring table for languages; the
 * extension data lives once in language-extensions.ts and is read by BOTH the
 * adapters' canParse and the scan-side SOURCE_EXTENSIONS (derived here). These
 * tests are the conservation proof: before the registry, the same fact lived in
 * five hand-maintained places and both drift directions failed silently.
 */

describe('language registry (issue 09)', () => {
  it('derives SOURCE_EXTENSIONS from the registry entries and nothing else', () => {
    const union = new Set(LANGUAGE_REGISTRY.flatMap((entry) => entry.extensions));
    expect([...SOURCE_EXTENSIONS].sort()).toEqual([...union].sort());
    // Pinned verbatim: this list IS the contract. If it ever needs to change,
    // that is a language-onboarding decision — not something a refactor may
    // alter silently on both sides (the assertion below would stay green).
    expect([...SOURCE_EXTENSIONS].sort()).toEqual(
      ['.go', '.java', '.js', '.jsx', '.mjs', '.prisma', '.py', '.ts', '.tsx']
    );
  });

  it('every registered extension is claimed by exactly one adapter (no gap, no overlap)', () => {
    const owners = new Map<string, string[]>();
    for (const extension of SOURCE_EXTENSIONS) {
      const claiming = LANGUAGE_REGISTRY.filter((entry) => entry.adapter.canParse(`src/file${extension}`));
      owners.set(extension, claiming.map((entry) => entry.id));
      expect(claiming).toHaveLength(1);
    }
    expect(owners.size).toBe(SOURCE_EXTENSIONS.size);
  });

  it('each adapter claims exactly its registry extensions (no private extras)', () => {
    const expected: Array<[string, readonly string[], (filePath: string) => boolean]> = [
      ['java', JAVA_EXTENSIONS, JavaAdapter.canParse],
      ['typescript', TYPESCRIPT_EXTENSIONS, TypeScriptAdapter.canParse],
      ['go', GO_EXTENSIONS, GoAdapter.canParse],
      ['python', PYTHON_EXTENSIONS, PythonAdapter.canParse],
      ['prisma', PRISMA_EXTENSIONS, PrismaAdapter.canParse]
    ];
    for (const [id, extensions, canParse] of expected) {
      for (const extension of extensions) {
        expect(canParse(`src/file${extension}`), `${id} must claim ${extension}`).toBe(true);
      }
      // An extension owned by another language must be rejected by this one.
      for (const extension of SOURCE_EXTENSIONS) {
        if (!extensions.includes(extension)) {
          expect(canParse(`src/file${extension}`), `${id} must not claim ${extension}`).toBe(false);
        }
      }
    }
  });

  it('resolves adapters deterministically through adapterFor', () => {
    expect(adapterFor('src/Main.java')).toBe(JavaAdapter);
    expect(adapterFor('src/app.tsx')).toBe(TypeScriptAdapter);
    expect(adapterFor('pkg/app/app.go')).toBe(GoAdapter);
    expect(adapterFor('server/main.py')).toBe(PythonAdapter);
    expect(adapterFor('schema.prisma')).toBe(PrismaAdapter);
    expect(adapterFor('README.md')).toBeUndefined();
  });
});
