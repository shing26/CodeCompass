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

/**
 * Issue 18(f)2/(e) — TypeScript declarations a single file cannot see.
 *
 * Two observed shapes motivated it, both in this repo's own Web app:
 *   `const { client } = useRepo()`  — the hook is declared in another file and
 *     returns a named interface declared in a third one, so the receiver `client`
 *     stayed untyped and `client.getSubgraphContext(...)` read as a dead call;
 *   `useSymbolResource(client, repoId, name, (c, rid, n) => c.listReverseDeps(...))`
 *     — the callback parameter's type is decided by the callee's signature, which
 *     lives in another file.
 *
 * Every value here is the annotation's RAW text, not a resolved name: the
 * restriction of a utility type (`Pick<X, 'a'>`) has to survive to the call site
 * or the adapter would invent edges the type system does not have.
 */
export interface TypeScriptDeclarations {
  /** interface name → member name → RAW member type text. (`type X = { … }`
   * aliases contribute no members today: the per-file extractor records their
   * NAME as a symbol but not their body, and this table reuses that extractor so
   * the two cannot drift.) */
  interfaces: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** function name → RAW return-type annotation text. */
  returns: ReadonlyMap<string, string>;
  /** function name → per-position RAW parameter type text ('' = untyped). */
  params: ReadonlyMap<string, readonly string[]>;
  /** `Type.method` → RAW return-type annotation text (issue 20). A factory method
   * (`client.evolveStream(...)`) is how a stream object reaches its call site, and
   * without this the const holding it stays untyped — the interface-typed call on
   * it then never reaches the implementation table. */
  methods: ReadonlyMap<string, string>;
}

/**
 * Issue 09 (外部评审 C3) — per-language cross-file declarations. The context
 * used to expose a single language-shaped field (`goPackages`), which let one
 * language's detail name a domain interface; languages now namespace their own
 * payloads under their registry id, and adding one must not touch the others.
 */
export interface LanguageDeclarations {
  /** Go declarations by package directory basename (Go's package ≈ directory
   * convention, the same one the call-chain resolver uses). A basename shared
   * by two directories is dropped from the map at build time: resolving through
   * an ambiguous package name would be a guess. */
  go?: ReadonlyMap<string, GoPackageDeclarations>;
  /** TS/JS declarations repo-wide. A name declared twice with *different*
   * content is dropped at build time, for the same reason: picking one of two
   * conflicting declarations would be a guess (ADR-0002). */
  typescript?: TypeScriptDeclarations;
}

export interface ParseContext {
  /** Cross-file declarations a language adapter may consult. Optional per
   * language and optional as a whole: absent → the adapter degrades to
   * `dynamic` (never to a guess — ADR-0002). */
  languages?: LanguageDeclarations;
}
