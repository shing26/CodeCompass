/**
 * Issue 09 — the single source for "which file extensions does a language own".
 *
 * Pure data on purpose. Before this file the same fact lived in five
 * hand-maintained places — the scan-side SOURCE_EXTENSIONS (repoqa-scan.ts),
 * the adapter array (repoqa-parser.ts) and four adapter-private sets — and
 * both drift directions failed silently: an extension claimed by the scan but
 * by no adapter produced zero symbols, an extension claimed only by an adapter
 * meant the file was never scanned at all. Adapters and the registry
 * (languages/registry.ts) both read these arrays, so the tables cannot fork.
 *
 * Kept separate from registry.ts to avoid registry → adapter → registry
 * import cycles.
 */
export const JAVA_EXTENSIONS: readonly string[] = ['.java'];
export const TYPESCRIPT_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
export const GO_EXTENSIONS: readonly string[] = ['.go'];
export const PYTHON_EXTENSIONS: readonly string[] = ['.py'];
export const PRISMA_EXTENSIONS: readonly string[] = ['.prisma'];
