import type { RepoSymbol } from '../ingest/repoqa-repos';
import type { ParseContext } from './parse-context';

/**
 * Issue 25 — one parser per language family. Each adapter owns a set of file
 * extensions and returns the same `RepoSymbol` table the call-chain resolver
 * and dashboard consume, so adding a language never touches the worker's
 * parse/skip bookkeeping.
 *
 * V31-02 — `context` is optional on purpose: an adapter must stay correct from
 * the single file it is handed, and only uses the context to resolve what one
 * file cannot see. Callers that have no repo-wide view (git diffs, unit tests)
 * simply omit it.
 */
export interface LanguageAdapter {
  /** True when this adapter owns `filePath` (case-insensitive). */
  canParse(filePath: string): boolean;
  /** Read and parse a file on disk into symbols. */
  parseFile(
    filePath: string,
    repoId: string,
    root: string,
    context?: ParseContext
  ): Promise<RepoSymbol[]>;
  /** Parse source already in memory (git objects, tests) into symbols. */
  parseSource(
    source: string,
    relativePath: string,
    repoId: string,
    context?: ParseContext
  ): RepoSymbol[];
}
