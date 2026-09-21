import type {
  ScanBucket,
  ScanCandidate,
  ScanCensus,
  ScanExclusion,
  ScanResult
} from '../../../packages/contracts/src/index';
import type { RepoSymbol } from './ingest/repoqa-repos';
import type { SymbolIndex } from './engine/repoqa-callchain';
import { symbolIdentity, buildFullCallersIndex } from './engine/repoqa-callchain';
import { buildRadarGraph, computePageRank } from './domain-radar-engine';
import { pickTopApis } from './engine/repoqa-dashboard';
import { cockpitLink, isTestPath } from './diagnose-engine';

/**
 * Candidate Scan (v0.19.0) — proactive "what should I touch in this repo?"
 * engine. Deterministic aggregation over the symbol graph, zero LLM
 * (ADR-0002/0005): every candidate carries a physical file:line anchor and
 * the deterministic evidence that put it in its bucket. Buckets answer
 * "where do I start", domain_radar answers "what does this repo look like".
 */

export const SCAN_TOP_LIMIT = 10;

/** A method spanning ≥150 lines is a deterministic complexity proxy. */
export const OVERSIZED_METHOD_LINES = 150;

/** A file whose symbol-covered span reaches ≥600 lines is a debt hotspot. */
export const OVERSIZED_FILE_LINES = 600;

/**
 * ADR-0018 (ruling 1) — the orphan bucket claims "zero-static-caller CALLABLE
 * symbols". A type declaration has no caller by definition, so it never
 * belonged in the candidate list; on lazygit those accounted for 623 of 2805
 * entries (22%) and dominated the top-10 (which is why M1 sat at 100%).
 */
const CALLABLE_KINDS: ReadonlySet<string> = new Set(['method']);

interface ScanInput {
  repoId: string;
  repoName: string;
  symbols: RepoSymbol[];
  index: SymbolIndex;
  baseUrl: string;
}

const ORPHAN_NOTE =
  'Scope (ADR-0018): zero-static-caller CALLABLE symbols only — type ' +
  'declarations and interface members have no caller by definition and are ' +
  'excluded (counted in census.excluded). Static zero-caller only: reflective ' +
  'lookups, dynamic proxies and MQ subscriptions are invisible to AST analysis ' +
  '— verify before removing. Externally wired symbols (Spring ' +
  '@Bean/@FeignClient/…, entry points) are excluded from candidates and counted ' +
  'in wiredExcluded; HTTP handlers (a route target) and serializer accessors are ' +
  'excluded the same way. Candidates flagged testOnly do have callers — all of ' +
  'them in test paths.';

const HUBS_NOTE =
  'Board only: accessor methods (get/set/is prefix, ≤5-line body) rank high ' +
  'on PageRank because every read/write routes through them, but carry no ' +
  'refactor signal — they are excluded from this board and its total.';

const OVERSIZED_NOTE =
  'Line span is a deterministic complexity proxy until method-body AST ' +
  'extraction lands; it measures size, not quality.';

/** Issue 05 (dogfooding): an empty bucket must not point the agent at a tool
 * call it cannot make — "run X on an entry" with zero entries dead-ends. */
const EMPTY_BUCKET_ACTION =
  "No candidates found by this bucket's deterministic rules — nothing to act on here.";

/**
 * Issue 04 (dogfooding) — annotations that wire a symbol into the runtime, so
 * zero STATIC callers is the normal, healthy form (Spring injects/proxies/
 * reflects them). Stored annotation texts carry the `@` (JavaAdapter emits
 * full annotation text, e.g. `@FeignClient("customers")`).
 */
const WIRED_ANNOTATIONS: ReadonlyArray<RegExp> = [
  /^@Bean\b/,
  /^@FeignClient\b/,
  /^@EventListener\b/,
  /^@Configuration\b/,
  /^@SpringBootApplication\b/,
  // V31-02 (precision baseline): the container or its lifecycle own these, so
  // zero static callers is their healthy shape. spring-petclinic-microservices
  // put @Component-injected clients and @PostConstruct hooks at the top of the
  // orphan sample precisely because this list stopped at @Bean/@FeignClient.
  /^@Component\b/,
  /^@Service\b/,
  /^@Repository\b/,
  /^@Controller\b/,
  /^@RestController\b/,
  /^@PostConstruct\b/,
  /^@PreDestroy\b/,
  /^@Scheduled\b/
];

/** Issue 04 — why a zero-static-caller symbol is not an orphan candidate.
 * `wiredTypes` carries annotation-wired CLASS/INTERFACE names so members of a
 * `@Configuration` class or a `@FeignClient` interface count as wired even
 * without an own annotation (review fix: parent-annotation leak). */
export function wiredKindOf(
  symbol: RepoSymbol,
  wiredTypes?: ReadonlySet<string>
): 'di' | 'entry' | undefined {
  if (symbol.kind === 'method' && symbol.name === 'main') return 'entry';
  for (const annotation of symbol.annotations ?? []) {
    const text = annotation.trim();
    if (WIRED_ANNOTATIONS.some((re) => re.test(text))) return 'di';
  }
  if (symbol.parentType && wiredTypes?.has(symbol.parentType)) return 'di';
  return undefined;
}

/** Issue 06 (dogfooding) — a named accessor whose declaration span is ≤5
 * lines carries no real logic; it ranks as a PageRank hub only because every
 * read/write routes through it. Both conditions must hold so
 * `getOrCreateX`-style methods with real bodies stay on the board. (Span, not
 * body: signature + braces count — conservative by design, review note.) */
export function isAccessorLike(symbol: RepoSymbol): boolean {
  if (symbol.kind !== 'method' || !symbol.parentType) return false;
  if (!/^(get|set|is)[A-Z]/.test(symbol.name)) return false;
  if (symbol.lineStart === undefined || symbol.lineEnd === undefined) return false;
  return symbol.lineEnd - symbol.lineStart <= 5;
}

/** V31-02 — Java records and bean DTOs expose `owner.id()` rather than
 * `getId()`, so the get/set/is rule above misses them entirely and every
 * mapped DTO contributed its components to the orphan total. A short no-arg-ish
 * method whose name matches a field of its own type is the same accessor case. */
function isFieldAccessor(
  symbol: RepoSymbol,
  fieldNamesByType: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  if (symbol.kind !== 'method' || !symbol.parentType) return false;
  if (symbol.lineStart === undefined || symbol.lineEnd === undefined) return false;
  if (symbol.lineEnd - symbol.lineStart > 5) return false;
  return fieldNamesByType.get(symbol.parentType)?.has(symbol.name) ?? false;
}

function candidateOf(
  symbol: RepoSymbol,
  detail: string,
  lineEnd?: number
): ScanCandidate {
  return {
    symbol: symbol.parentType ? `${symbol.parentType}.${symbol.name}` : symbol.name,
    kind: symbol.kind,
    filePath: symbol.filePath,
    line: symbol.lineStart ?? 1,
    ...(lineEnd !== undefined ? { lineEnd } : {}),
    detail
  };
}

/** filePath → lineStart, the repo-wide deterministic tiebreak convention. */
function byLocation(a: ScanCandidate, b: ScanCandidate): number {
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  return a.line - b.line;
}

function bucket(
  id: ScanBucket['id'],
  title: string,
  items: ScanCandidate[],
  total: number,
  nextAction: string,
  note?: string,
  wiredExcluded?: number,
  census?: ScanCensus
): ScanBucket {
  return {
    id,
    title,
    items,
    total,
    nextAction: total === 0 ? EMPTY_BUCKET_ACTION : nextAction,
    ...(note ? { note } : {}),
    ...(wiredExcluded !== undefined ? { wiredExcluded } : {}),
    ...(census ? { census } : {})
  };
}

export function runScan(input: ScanInput): ScanResult {
  const { repoId, repoName, symbols, index, baseUrl } = input;
  // One graph pass serves both the orphan bucket (in-degree) and the hub
  // bucket (PageRank); it already filters to production kinds and drops
  // test paths.
  const graph = buildRadarGraph(symbols, index);
  const rank = computePageRank([...graph.symbolsById.keys()], graph.edges);
  // ADR-0018 (ruling 3) — the full callers index (test callers included) is what
  // makes "called only from tests" decidable: buildRadarGraph drops test nodes
  // AND their edges, so such a symbol shows in-degree 0 in the graph and would
  // otherwise be indistinguishable from genuinely unreferenced code.
  const { callersOf } = buildFullCallersIndex(symbols, index);

  /* Bucket 1 — orphaned public code: production symbols with zero callers.
     Routes are external HTTP entry points, so a missing caller is normal for
     them and they are excluded. Issue 04 (dogfooding): symbols wired through
     annotations or program entry points are not dead code either — Spring
     injects/proxies them, the runtime calls main(). They leave the candidate
     list and are counted in wiredExcluded. */
  const orphanItems: ScanCandidate[] = [];
  let wiredExcluded = 0;
  // ADR-0018 rulings 1 & 2 — the bucket's claim is narrowed to callable
  // symbols, so the classes that leave the candidate list are counted instead
  // of silently shrinking `total` (necessary condition ② of the ruling).
  let typeDeclarations = 0;
  let interfaceMembers = 0;
  // Owner names of interface declarations. `parentType` is a bare name, not an
  // id, so a name shared by an interface and a class cannot be disambiguated
  // from the symbol table alone — fail-closed: such an owner counts as an
  // interface member and leaves the list. The bucket must not claim a contract
  // member is dead just because two declarations share a name.
  const interfaceNames = new Set<string>();
  for (const symbol of symbols) {
    if (symbol.kind === 'interface') interfaceNames.add(symbol.name);
  }
  // Annotation-wired type names, so members of a @Configuration class or a
  // @FeignClient interface inherit the wired status without an own annotation.
  // Built from the raw symbol input: PRODUCTION_KINDS gates the graph node
  // set and does not carry 'config'/'advice', which is exactly where
  // @Configuration classes land (review fix: parent-annotation leak).
  const TYPE_KINDS = new Set(['class', 'interface', 'service', 'repository', 'route', 'config', 'advice', 'mapper']);
  const wiredTypes = new Set<string>();
  for (const symbol of symbols) {
    if (!TYPE_KINDS.has(symbol.kind) || isTestPath(symbol.filePath)) continue;
    if ((symbol.annotations ?? []).some((a) => WIRED_ANNOTATIONS.some((re) => re.test(a.trim())))) {
      wiredTypes.add(symbol.name);
    }
  }
  // V31-02 — field names per owning type: record components and bean fields
  // emit a 'field' symbol, which is what makes `owner.id()` recognisable as an
  // accessor next to the get/set/is rule (see isFieldAccessor).
  const fieldNamesByType = new Map<string, Set<string>>();
  for (const symbol of symbols) {
    if (symbol.kind !== 'field' || !symbol.parentType) continue;
    const names = fieldNamesByType.get(symbol.parentType) ?? new Set<string>();
    names.add(symbol.name);
    fieldNamesByType.set(symbol.parentType, names);
  }
  for (const [id, symbol] of graph.symbolsById) {
    if (symbol.kind === 'route') continue;
    if ((graph.inDegree.get(id) ?? 0) !== 0) continue;
    // V31-02: an HTTP handler is a route target — the framework dispatches to
    // it, so zero static callers is its normal shape (Java/FastAPI record the
    // handler as a method carrying displayPath, unlike the TS/Express route
    // symbols skipped above). Same rationale as the route skip.
    if (symbol.kind === 'method' && symbol.displayPath) continue;
    // V31-02: a DTO accessor is invoked by the serializer/reflection layer; the
    // rule that keeps accessors off the hubs board (issue 06) applies here too,
    // otherwise every mapped DTO contributes its getters to the orphan total.
    if (isAccessorLike(symbol) || isFieldAccessor(symbol, fieldNamesByType)) continue;
    // Deliberately BEFORE the ADR-0018 scope narrowing below: external wiring is
    // the more specific deterministic reason, so an annotated type is reported
    // as wired (where it has always been counted) rather than as a plain type
    // declaration. Both paths exclude — only the attribution differs.
    const wired = wiredKindOf(symbol, wiredTypes);
    if (wired !== undefined) {
      wiredExcluded += 1;
      continue;
    }
    // ADR-0018 (rulings 1 & 2) — scope narrowing sits AFTER the zero-caller test
    // on purpose: the census must describe the zero-caller population (that is
    // exactly what the report's 623 / 375 classify).
    if (!CALLABLE_KINDS.has(symbol.kind)) {
      typeDeclarations += 1;
      continue;
    }
    if (symbol.parentType !== undefined && interfaceNames.has(symbol.parentType)) {
      interfaceMembers += 1;
      continue;
    }
    const span =
      symbol.lineEnd !== undefined && symbol.lineStart !== undefined
        ? symbol.lineEnd - symbol.lineStart
        : undefined;
    const candidate = candidateOf(
      symbol,
      span !== undefined ? `0 static callers; spans ${span} lines` : '0 static callers',
      span !== undefined ? symbol.lineEnd : undefined
    );
    // Ruling 3: marked, never excluded — production code reachable only from
    // tests is a real signal, so it stays in the bucket with the reason visible.
    const callers = callersOf.get(id) ?? [];
    if (callers.length > 0 && callers.every((caller) => isTestPath(caller.filePath))) {
      candidate.testOnly = true;
    }
    orphanItems.push(candidate);
  }
  orphanItems.sort(byLocation);

  // ADR-0018 (necessary condition ②): what left the list is counted, and the
  // census conserves on `total`. The deferred entry is a recorded TARGET
  // (ruling 2's second step) — declared so a reader knows those symbols are
  // still inside `total`, rather than silently absent.
  const testOnlyCount = orphanItems.filter((item) => item.testOnly === true).length;
  const orphanExcluded: ScanExclusion[] = [
    {
      rule: 'type-declaration',
      count: typeDeclarations,
      detail: 'types have no caller by definition; the bucket claims callable symbols only'
    },
    {
      rule: 'interface-member',
      count: interfaceMembers,
      detail: 'contract members; zero static callers is their normal shape (ADR-0002 keeps dispatch dynamic)'
    },
    {
      rule: 'interface-implementation',
      deferred: true,
      detail: 'needs an interface→implementation relation (A′ step 2); these symbols are still counted in total'
    }
  ];
  const orphanCensus: ScanCensus = {
    zeroCallers: orphanItems.length - testOnlyCount,
    testOnly: testOnlyCount,
    excluded: orphanExcluded
  };

  /* Bucket 2 — hubs: PageRank top; the blast-radius heavyweights.
     Issue 06 (dogfooding): ≤5-line named accessors rank high only because
     every read/write routes through them — no refactor signal, so they leave
     the board (the graph itself still ranks them for other consumers). */
  const hubRanked = [...graph.symbolsById.keys()]
    .map((id) => {
      const symbol = graph.symbolsById.get(id)!;
      const rankValue = rank.get(id) ?? 0;
      return { symbol, rankValue };
    })
    .sort(
      (a, b) =>
        b.rankValue - a.rankValue ||
        (a.symbol.filePath < b.symbol.filePath ? -1 : a.symbol.filePath > b.symbol.filePath ? 1 : 0) ||
        (a.symbol.lineStart ?? 0) - (b.symbol.lineStart ?? 0)
    )
    .filter(({ symbol }) => !isAccessorLike(symbol));
  const hubTotal = hubRanked.length;
  const hubItems: ScanCandidate[] = hubRanked
    .slice(0, SCAN_TOP_LIMIT)
    .map(({ symbol, rankValue }) => {
      const id = symbolIdentity(symbol);
      return candidateOf(
        symbol,
        `PageRank ${rankValue.toFixed(4)}; in ${graph.inDegree.get(id) ?? 0} / out ${graph.outDegree.get(id) ?? 0}`
      );
    });

  /* Bucket 3 — oversized methods: line-span proxy for complexity. */
  const oversizedItems: ScanCandidate[] = symbols
    .filter(
      (symbol) =>
        symbol.kind === 'method' &&
        !isTestPath(symbol.filePath) &&
        symbol.lineEnd !== undefined &&
        symbol.lineStart !== undefined &&
        symbol.lineEnd - symbol.lineStart >= OVERSIZED_METHOD_LINES
    )
    .sort(
      (a, b) =>
        b.lineEnd! - b.lineStart! - (a.lineEnd! - a.lineStart!) ||
        (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0) ||
        a.lineStart! - b.lineStart!
    )
    .slice(0, SCAN_TOP_LIMIT)
    .map((symbol) =>
      candidateOf(
        symbol,
        `spans ${symbol.lineEnd! - symbol.lineStart!} lines`,
        symbol.lineEnd
      )
    );

  /* Bucket 4 — deep call chains: longest statically-resolvable entry flows.
     maxDepth 6 mirrors pickTopApis' cockpit default. `total` is counted over a
     100-entry pass (pickTopApis clamps its own limit there) while the list shows
     the top 10 — one sorted pass now serves both, so the two cannot disagree.

     V31-02 (M2): this bucket resolves chains straight over `symbols`, so unlike
     the other four it had no test-path filter at all and a fixture route
     declared in a `*.test.ts` ranked as a production entry point (the only M2
     violation left in the three samples). The candidate list is filtered rather
     than the input, so every chain is still resolved over the whole symbol table
     and no depth changes — only test-file entry points leave the board.
     `pickTopApis` itself is untouched: the cockpit's top-APIs panel is a
     different surface with its own semantics. */
  const DEEP_CHAIN_MAX_DEPTH = 6;
  const deepChainEntries = pickTopApis(symbols, DEEP_CHAIN_MAX_DEPTH, 100).filter(
    (entry) => !isTestPath(entry.filePath)
  );
  const deepChains = deepChainEntries.slice(0, SCAN_TOP_LIMIT);
  const deepChainTotal = deepChainEntries.length;
  const deepChainItems: ScanCandidate[] = deepChains.map((entry) => ({
    symbol: entry.controller ? `${entry.controller}.${entry.name}` : entry.name,
    kind: 'route',
    filePath: entry.filePath,
    line: entry.lineStart,
    detail: `chain depth ${entry.depth}: ${entry.hops.join(' → ')}`
  }));

  /* Bucket 5 — oversized files: per-file span of the indexed symbols.
     Aggregating symbol spans per file surfaces "many medium methods piled
     into one big file" — the debt a method-level bucket cannot see. The
     span is the index's own byproduct, a pure fact about size. */
  const fileSpans = new Map<string, { start: number; end: number; symbolCount: number }>();
  for (const symbol of symbols) {
    if (!symbol.lineStart || isTestPath(symbol.filePath)) continue;
    const span = fileSpans.get(symbol.filePath);
    if (!span) {
      fileSpans.set(symbol.filePath, {
        start: symbol.lineStart,
        end: symbol.lineEnd ?? symbol.lineStart,
        symbolCount: 1
      });
      continue;
    }
    span.start = Math.min(span.start, symbol.lineStart);
    span.end = Math.max(span.end, symbol.lineEnd ?? symbol.lineStart);
    span.symbolCount += 1;
  }
  const oversizedFileItems: ScanCandidate[] = [...fileSpans.entries()]
    .map(([filePath, span]) => ({
      filePath,
      span,
      size: span.end - span.start
    }))
    .filter((entry) => entry.size >= OVERSIZED_FILE_LINES)
    .sort((a, b) => b.size - a.size || (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0))
    .slice(0, SCAN_TOP_LIMIT)
    .map((entry) => ({
      symbol: entry.filePath.split('/').pop() ?? entry.filePath,
      kind: 'file',
      filePath: entry.filePath,
      line: entry.span.start,
      lineEnd: entry.span.end,
      detail: `${entry.size} lines across ${entry.span.symbolCount} indexed symbols`
    }));

  return {
    schemaVersion: 1,
    repoId,
    repoName,
    buckets: [
      bucket(
        'orphanedPublic',
        'Orphaned public code (zero static callers)',
        orphanItems.slice(0, SCAN_TOP_LIMIT),
        orphanItems.length,
        'Plan a safe teardown with codecompass_module_evolution (DEPRECATE) before deleting anything.',
        ORPHAN_NOTE,
        wiredExcluded,
        orphanCensus
      ),
      bucket(
        'hubs',
        'Change-impact hubs (highest PageRank)',
        hubItems,
        hubTotal,
        'Run codecompass_refactor_plan on any of these before touching them.',
        HUBS_NOTE
      ),
      bucket(
        'oversized',
        `Oversized methods (≥${OVERSIZED_METHOD_LINES} lines)`,
        oversizedItems,
        oversizedItems.length,
        'Extract cohesive units, then verify with codecompass_trace_call_chain.',
        OVERSIZED_NOTE
      ),
      bucket(
        'deepChains',
        'Deep call chains (longest entry flows)',
        deepChainItems,
        deepChainTotal,
        'Run codecompass_diagnose on an entry to see the layered chain.'
      ),
      bucket(
        'oversizedFiles',
        `Oversized files (≥${OVERSIZED_FILE_LINES} lines of indexed span)`,
        oversizedFileItems,
        oversizedFileItems.length,
        'Read the file and assess cohesion — split or extract only with evidence from codecompass_reverse_deps.'
      )
    ],
    cockpitDeepLink: cockpitLink(baseUrl, repoId, repoName, '')
  };
}
