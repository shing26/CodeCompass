import type { RepoSymbol } from '../repoqa-repos';

/**
 * Issue 25 — one parser per language family. Each adapter owns a set of file
 * extensions and returns the same `RepoSymbol` table the call-chain resolver
 * and dashboard consume, so adding a language never touches the worker's
 * parse/skip bookkeeping.
 */
export interface LanguageAdapter {
  /** True when this adapter owns `filePath` (case-insensitive). */
  canParse(filePath: string): boolean;
  /** Read and parse a file on disk into symbols. */
  parseFile(filePath: string, repoId: string, root: string): Promise<RepoSymbol[]>;
  /** Parse source already in memory (git objects, tests) into symbols. */
  parseSource(source: string, relativePath: string, repoId: string): RepoSymbol[];
}
