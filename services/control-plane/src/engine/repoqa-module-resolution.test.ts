import { describe, expect, it } from 'vitest';
import {
  buildModuleImportTable,
  parseModuleDeclarations,
  pinnableTarget,
  resolveRelativeSpecifier
} from './repoqa-module-resolution';

/** 内存文件集——消解判据是「仓内有没有这个文件」，不需要真 FS。 */
function tableOf(sources: Record<string, string>) {
  const files = Object.keys(sources);
  return buildModuleImportTable({
    files,
    readFile: async (file) => sources[file] ?? ''
  });
}

describe('parseModuleDeclarations', () => {
  it('collects named, aliased, default and namespace imports', () => {
    const decl = parseModuleDeclarations([
      "import { a, b as c } from './a';",
      "import Foo from './foo';",
      "import Bar, { d } from './bar';",
      "import * as ns from './ns';"
    ].join('\n'));
    expect(decl.namedImports).toEqual([
      { specifier: './a', localName: 'a', importedName: 'a' },
      { specifier: './a', localName: 'c', importedName: 'b' },
      { specifier: './bar', localName: 'd', importedName: 'd' }
    ]);
    expect(decl.defaultImports).toEqual([
      { specifier: './foo', localName: 'Foo' },
      { specifier: './bar', localName: 'Bar' }
    ]);
    expect(decl.namespaceImports).toEqual([{ specifier: './ns', localName: 'ns' }]);
  });

  it('ignores type-only declarations — a type name is never a call target', () => {
    const decl = parseModuleDeclarations([
      "import type { T } from './types';",
      "import type { U as V } from './types';",
      "import { type W, x } from './mixed';"
    ].join('\n'));
    expect(decl.namedImports).toEqual([{ specifier: './mixed', localName: 'x', importedName: 'x' }]);
  });

  it('collects local exports, named re-exports and star re-exports', () => {
    const decl = parseModuleDeclarations([
      'export const a = 1;',
      'export function b() {}',
      'export class C {}',
      "export { d as e } from './d';",
      "export * from './star';"
    ].join('\n'));
    expect(decl.localExports.sort()).toEqual(['C', 'a', 'b']);
    expect(decl.reexportNamed).toEqual([
      { specifier: './d', names: [{ imported: 'd', exported: 'e' }] }
    ]);
    expect(decl.reexportStar).toEqual(['./star']);
  });

  it('does not read a bare require() as a relative import', () => {
    const decl = parseModuleDeclarations("const fs = require('node:fs');");
    expect(decl.namedImports).toEqual([]);
    expect(decl.defaultImports).toEqual([]);
  });
});

describe('resolveRelativeSpecifier', () => {
  const files = new Set([
    'src/a.ts',
    'src/b.tsx',
    'src/c.js',
    'src/dir/index.ts',
    'src/dup.ts',
    'src/dup.js'
  ]);

  it('resolves a sibling file and a parent path', () => {
    expect(resolveRelativeSpecifier('src/main.ts', './a', files)).toBe('src/a.ts');
    expect(resolveRelativeSpecifier('src/dir/x.ts', '../b', files)).toBe('src/b.tsx');
  });

  it('resolves a directory specifier to its index file', () => {
    expect(resolveRelativeSpecifier('src/main.ts', './dir', files)).toBe('src/dir/index.ts');
  });

  it('prefers .ts over .js — suffix order is the priority, not the file system', () => {
    expect(resolveRelativeSpecifier('src/main.ts', './dup', files)).toBe('src/dup.ts');
  });

  it('returns null for bare specifiers, aliases and paths outside the repo', () => {
    expect(resolveRelativeSpecifier('src/main.ts', 'react', files)).toBeNull();
    expect(resolveRelativeSpecifier('src/main.ts', '@/lib/a', files)).toBeNull();
    expect(resolveRelativeSpecifier('src/main.ts', '../../../etc/passwd', files)).toBeNull();
  });

  it('returns null when the target does not exist — no guessing', () => {
    expect(resolveRelativeSpecifier('src/main.ts', './missing', files)).toBeNull();
  });
});

describe('buildModuleImportTable', () => {
  it('binds a named import to the file that declares it', async () => {
    const table = await tableOf({
      'src/caller.ts': "import { run } from './impl';\nrun();",
      'src/impl.ts': 'export function run() {}'
    });
    expect(pinnableTarget(table, 'src/caller.ts', 'run')).toBe('src/impl.ts');
    expect(table.stats.files).toBe(2);
    expect(table.stats.bindings).toBe(1);
  });

  it('follows a star re-export to the declaring file (barrel files must not swallow the pin)', async () => {
    const table = await tableOf({
      'src/caller.ts': "import { run } from './barrel';",
      'src/barrel.ts': "export * from './impl';",
      'src/impl.ts': 'export function run() {}'
    });
    expect(pinnableTarget(table, 'src/caller.ts', 'run')).toBe('src/impl.ts');
  });

  it('follows a named re-export to the declaring file', async () => {
    const table = await tableOf({
      'src/caller.ts': "import { run } from './barrel';",
      'src/barrel.ts': "export { run as run } from './impl';",
      'src/impl.ts': 'export function run() {}'
    });
    expect(pinnableTarget(table, 'src/caller.ts', 'run')).toBe('src/impl.ts');
  });

  it('terminates on a re-export cycle instead of recursing forever', async () => {
    const table = await tableOf({
      'src/caller.ts': "import { run } from './a';",
      'src/a.ts': "export * from './b';",
      'src/b.ts': "export * from './a';"
    });
    expect(table.imports.get('src/caller.ts')?.get('run')?.target).toBeTruthy();
  });

  it('records a namespace import but refuses to pin a name through it', async () => {
    const table = await tableOf({
      'src/caller.ts': "import * as impl from './impl';",
      'src/impl.ts': 'export function run() {}'
    });
    expect(table.imports.get('src/caller.ts')?.get('impl')?.kind).toBe('namespace');
    expect(pinnableTarget(table, 'src/caller.ts', 'run')).toBeNull();
  });

  it('ignores non-TS/JS files entirely (Go/Java bind by package structure, not import tables)', async () => {
    const table = await tableOf({
      'cmd/main.go': 'package main',
      'src/a.ts': 'export const a = 1;'
    });
    expect(table.stats.files).toBe(1);
    expect(table.imports.has('cmd/main.go')).toBe(false);
  });

  it('skips a declaration whose specifier cannot be resolved, and counts it', async () => {
    const table = await tableOf({
      'src/caller.ts': "import { x } from './nope';\nimport { y } from 'lodash';"
    });
    expect(pinnableTarget(table, 'src/caller.ts', 'x')).toBeNull();
    expect(pinnableTarget(table, 'src/caller.ts', 'y')).toBeNull();
    expect(table.stats.unresolvedSpecifiers).toBeGreaterThanOrEqual(2);
  });
});
