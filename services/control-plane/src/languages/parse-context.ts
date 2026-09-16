/**
 * V31-02 — cross-file parse context.
 *
 * A language adapter must always be able to work from the single file it is
 * handed; this context is an *optional* extra that lets it resolve facts a
 * single file cannot see, and every lookup degrades to `dynamic` when the
 * context is absent (never to a guess — ADR-0002).
 *
 * Go is the reason it exists: `declaredTypes` was built per file, so a package
 * spread over several files (`pkg/app/entry_point.go` calling `NewApp` declared
 * in `pkg/app/app.go`) could not type the value it received, and every later
 * `value.Method()` fell back to a dynamic break — which the Candidate Scan then
 * reported as "zero static callers".
 */
export interface GoPackageDeclarations {
  /** Named types declared in the package, `type RepoPath string` included. */
  typeNames: ReadonlySet<string>;
  /** type name → field name → declared type name. */
  fields: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** `func` name → result types, and `Receiver.Method` → result types. */
  results: ReadonlyMap<string, readonly string[]>;
}

export interface ParseContext {
  /**
   * Go declarations by package directory basename (Go's package ≈ directory
   * convention, the same one the call-chain resolver uses). A basename shared
   * by two directories is dropped from the map at build time: resolving through
   * an ambiguous package name would be a guess.
   */
  goPackages?: ReadonlyMap<string, GoPackageDeclarations>;
}
