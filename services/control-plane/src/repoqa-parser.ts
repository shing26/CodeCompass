import type { RepoSymbol } from './repoqa-repos';
import type { LanguageAdapter } from './languages/LanguageAdapter';
import { JavaAdapter } from './languages/JavaAdapter';
import { TypeScriptAdapter } from './languages/TypeScriptAdapter';

/**
 * Issue 25 — language adapter dispatcher. The Java implementation moved to
 * `languages/JavaAdapter.ts`; this module keeps the historical `parseJava*`
 * API for callers that predate the adapter layer and routes new files through
 * the owning adapter.
 */
export * from './languages/JavaAdapter';

const ADAPTERS: LanguageAdapter[] = [JavaAdapter, TypeScriptAdapter];

/** Return the language adapter owning `filePath`, or undefined. */
export function adapterFor(filePath: string): LanguageAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.canParse(filePath));
}

/** Parse any adapter-owned source file into symbols (empty for unknown types). */
export async function parseSourceFile(
  filePath: string,
  repoId: string,
  root: string
): Promise<RepoSymbol[]> {
  const adapter = adapterFor(filePath);
  return adapter ? adapter.parseFile(filePath, repoId, root) : [];
}
