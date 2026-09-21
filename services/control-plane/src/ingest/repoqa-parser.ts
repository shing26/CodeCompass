import fs from 'node:fs/promises';
import path from 'node:path';
import type { RepoSymbol } from './repoqa-repos';
import type { ParseContext } from '../languages/parse-context';
import { GoAdapter, buildGoPackageTable } from '../languages/GoAdapter';
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
 * V31-02 — the repo-level parse context, built once per index run before any
 * file is parsed.
 *
 * Go is the only consumer today and the reason the mechanism exists: a Go
 * package spans files, so `pkg/app/entry_point.go` calling `NewApp` declared in
 * `pkg/app/app.go` could not type the value it received, and every later
 * `value.Method()` became a dynamic break that the Candidate Scan reported as
 * "zero static callers". This pass reads the Go files and records declarations
 * only (no symbols), which is a fraction of the cost of the symbol pass.
 *
 * Returns undefined when the repo has no Go sources, so non-Go repos pay
 * nothing.
 */
export async function buildParseContext(
  root: string,
  files: readonly string[]
): Promise<ParseContext | undefined> {
  const goFiles = files.filter((filePath) => GoAdapter.canParse(filePath));
  if (goFiles.length === 0) return undefined;
  const sources = await readGoSources(root, goFiles);
  if (sources.length === 0) return undefined;
  return { languages: { go: buildGoPackageTable(sources) } };
}

/**
 * The same context for an incremental refresh: a Go package is exactly one
 * directory, so the changed file's siblings are the complete package table it
 * needs. Scoped this way rather than re-reading the repo on every file save.
 *
 * Returns undefined for a non-Go file up front — a TypeScript save must not pay
 * for a directory scan when the adapter will ignore the table anyway.
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
  const sources = await readGoSources(root, goFiles);
  if (sources.length === 0) return undefined;
  return { languages: { go: buildGoPackageTable(sources) } };
}

/**
 * Read the given Go files into repo-relative sources, skipping any that cannot
 * be read: a file that vanished mid-index must not fail the whole context.
 */
async function readGoSources(
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
