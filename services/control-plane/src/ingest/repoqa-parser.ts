import fs from 'node:fs/promises';
import path from 'node:path';
import type { RepoSymbol } from './repoqa-repos';
import type { LanguageDeclarations, ParseContext } from '../languages/parse-context';
import { GoAdapter, buildGoPackageTable } from '../languages/GoAdapter';
import { TypeScriptAdapter, buildTypeScriptDeclarations } from '../languages/TypeScriptAdapter';
import { isTestPath } from '../engine/repoqa-callchain';
// Issue 09: the adapter list moved to languages/registry.ts (single wiring
// table); this module forwards the historical `adapterFor` API for callers
// that predate the registry.
import { adapterFor } from '../languages/registry';

/**
 * Language adapter dispatcher. The Java implementation moved to
 * `languages/JavaAdapter.ts`; this module keeps the historical `parseJava*`
 * API for callers that predate the adapter layer and routes new files through
 * the owning adapter.
 */
export * from '../languages/JavaAdapter';

export { adapterFor };

/** Parse any adapter-owned source file into symbols (empty for unknown types). */
export async function parseSourceFile(
  filePath: string,
  repoId: string,
  root: string,
  context?: ParseContext
): Promise<RepoSymbol[]> {
  const adapter = adapterFor(filePath);
  return adapter ? adapter.parseFile(filePath, repoId, root, context) : [];
}

/**
 * V31-02 / Issue 18(f)2 — the repo-level parse context, built once per index run
 * before any file is parsed.
 *
 * Go is the original consumer and the reason the mechanism exists: a Go package
 * spans files, so `pkg/app/entry_point.go` calling `NewApp` declared in
 * `pkg/app/app.go` could not type the value it received, and every later
 * `value.Method()` became a dynamic break that the Candidate Scan reported as
 * "zero static callers".
 *
 * TypeScript needs the same shape for a different reason (issue 18(f)2): a hook
 * declared in one file returns an interface declared in another, and the value a
 * third file destructures out of it is a receiver whose methods live in a fourth.
 * The TS table is scanned, not parsed a second time — see
 * `buildTypeScriptDeclarations` for why.
 *
 * The TS table is built from PRODUCTION files only (issue 20). A test file's
 * declarations are test doubles, not the type production code calls: a fixture
 * `class RepoQAClient { … }` in a `.test.ts` was measured twice (2026-09-24) to
 * shadow the real class in this very repo and silently drop its methods from the
 * table, which then showed up as "the binding does not work" in a re-measurement.
 * Go keeps its own scope unchanged — its table is package-scoped and a package's
 * `_test.go` files legitimately belong to it.
 *
 * Returns undefined when the repo has neither language, so other repos pay nothing.
 */
export async function buildParseContext(
  root: string,
  files: readonly string[]
): Promise<ParseContext | undefined> {
  const languages: LanguageDeclarations = {};
  const goFiles = files.filter((filePath) => GoAdapter.canParse(filePath));
  if (goFiles.length > 0) {
    const sources = await readSources(root, goFiles);
    if (sources.length > 0) languages.go = buildGoPackageTable(sources);
  }
  const tsFiles = files.filter(
    (filePath) => TypeScriptAdapter.canParse(filePath) && !isTestPath(filePath)
  );
  if (tsFiles.length > 0) {
    const sources = await readSources(root, tsFiles);
    if (sources.length > 0) {
      const typescript = buildTypeScriptDeclarations(sources);
      // An all-empty table is not worth carrying: it would make every TS file
      // pay a lookup that can never hit. ALL four maps count — a repo whose only
      // cross-file facts are method return types (issue 20's `methods`) or
      // function parameter types (issue 18(e)'s `params`) must still get its
      // table, or those two mechanisms silently die there.
      const nonEmpty =
        typescript.interfaces.size > 0 ||
        typescript.returns.size > 0 ||
        typescript.params.size > 0 ||
        typescript.methods.size > 0;
      if (nonEmpty) {
        languages.typescript = typescript;
      }
    }
  }
  return languages.go || languages.typescript ? { languages } : undefined;
}

/**
 * The same context for an incremental refresh: a Go package is exactly one
 * directory, so the changed file's siblings are the complete package table it
 * needs. Scoped this way rather than re-reading the repo on every file save.
 *
 * TypeScript deliberately gets nothing here. Its table is repo-wide (the hook and
 * the interface it returns routinely live in different directories), so an
 * honest incremental build would have to read every TS file in the repo on every
 * save; the changed path is all this call site has. A TS file re-parsed this way
 * therefore loses its cross-file edges until the next full index — which is
 * exactly what every TS file had before this table existed, so the state is never
 * worse than it was, only less complete than a full index.
 *
 * Returns undefined for any other file up front — a Python save must not pay for
 * a directory scan when the adapter will ignore the table anyway.
 */
export async function buildParseContextForFile(
  root: string,
  absolutePath: string
): Promise<ParseContext | undefined> {
  if (!GoAdapter.canParse(absolutePath)) return undefined;
  const directory = path.dirname(absolutePath);
  const entries = await fs.readdir(directory).catch(() => [] as string[]);
  const goFiles = entries
    .filter((entry) => GoAdapter.canParse(entry))
    .map((entry) => path.join(directory, entry));
  if (!goFiles.includes(absolutePath)) goFiles.push(absolutePath);
  const sources = await readSources(root, goFiles);
  if (sources.length === 0) return undefined;
  return { languages: { go: buildGoPackageTable(sources) } };
}

/**
 * Read the given files into repo-relative sources, skipping any that cannot be
 * read: a file that vanished mid-index must not fail the whole context.
 */
async function readSources(
  root: string,
  files: readonly string[]
): Promise<Array<{ relativePath: string; source: string }>> {
  const sources: Array<{ relativePath: string; source: string }> = [];
  for (const absolute of files) {
    try {
      const source = await fs.readFile(absolute, 'utf8');
      const relativePath = path.relative(root, absolute).split(path.sep).join('/');
      sources.push({ relativePath, source });
    } catch {
      // Unreadable file: leave it out, the declarations it would have
      // contributed simply stay unresolved.
    }
  }
  return sources;
}
