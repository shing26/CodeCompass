import type {
  ConventionAnchor,
  ConventionConflictDetail,
  ConventionProfile,
  EvolutionChecklistItem,
  EvolutionPlacement,
  EvolutionRisk,
  EvolutionScaffoldTemplate,
  ModuleEvolutionResult
} from '../../../packages/contracts/src/index';
import { buildFullCallersIndex, resolveCallEdge, symbolIdentity, type SymbolIndex } from './repoqa-callchain';
import type { RepoSymbol } from './repoqa-repos';
import {
  isStrictAxis,
  packageOfPath,
  runConventionScan
} from './repoqa-conventions';
import {
  cockpitLink,
  frontendCallersForRoute,
  isTestPath,
  stableTraceId,
  DEFAULT_COCKPIT_BASE
} from './diagnose-engine';

/**
 * v0.9.0 — Module evolution engine (deterministic, zero-LLM).
 *
 * DEPRECATE: cluster a module's symbols, compute external references through
 * the resolved call graph, then cascade orphaned public code with a
 * fixed-point loop (a helper only used by an already-orphaned helper dies
 * too) before emitting the teardown checklist.
 *
 * EXTEND: locate the attach point, surface declaration-level transaction
 * boundaries (method annotation → class annotation → interface annotation),
 * match a decoupling pattern with explainable deterministic rules and emit
 * code scaffolds. Scaffolds are recommended shapes, not patches — patches
 * belong to the LLM orchestration layer (ADR-0006).
 *
 * Issue 24.3 (ADR-0014): the EXTEND plan is convention-aware. Before any
 * scaffold is emitted the engine runs `runConventionScan` (neighbor-first,
 * zero LLM), shapes the placement/injection/handler signature after the
 * arbitrated axes, discloses weakly-covered conventions as soft risks —
 * and blocks with a structured {@link ConventionConflictError} when the
 * explicit intent fights a STRICT axis or the injection point sits on a
 * bean dependency cycle.
 */

export interface ModuleEvolutionInput {
  repoId: string;
  intentType: 'DEPRECATE' | 'EXTEND';
  targetSymbolOrModule: string;
  extensionGoal?: string;
  symbols: RepoSymbol[];
  index: SymbolIndex;
  baseUrl?: string;
  /** Physical commit of the sniffed tree (`hash`/`hash+dirty`/`unversioned`). */
  commit?: string;
  /** Issue 24.3 — explicit neighborhood override for the convention sniff. */
  nearPackages?: string[];
}

/** ADR-0014 §4 — a user intent colliding with a STRICT axis fails closed. */
export class ConventionConflictError extends Error {
  readonly conflict: ConventionConflictDetail;

  constructor(detail: ConventionConflictDetail) {
    super(
      `Convention conflict on ${detail.axis}: intent fights the STRICT convention "${detail.verdict}". Suggestion: ${detail.suggestion}`
    );
    this.name = 'ConventionConflictError';
    this.conflict = detail;
  }
}

function routePathOf(symbol: RepoSymbol, index: SymbolIndex): string | undefined {
  if (symbol.displayPath) return symbol.displayPath;
  const parent = symbol.parentType ? index.types.get(symbol.parentType)?.symbol : undefined;
  return parent?.displayPath;
}

/** Module scope: moduleName match, or a normalized directory prefix. */
function inModuleScope(symbol: RepoSymbol, module: string): boolean {
  if (symbol.moduleName && symbol.moduleName === module) return true;
  const file = symbol.filePath.replace(/\\/g, '/').toLowerCase();
  const prefix = module.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  if (!prefix) return false;
  return file === prefix || file.startsWith(`${prefix}/`);
}

function collectModuleSymbols(symbols: RepoSymbol[], target: string): RepoSymbol[] {
  // Explicit module name or directory prefix.
  const scoped = symbols.filter((symbol) => inModuleScope(symbol, target));
  if (scoped.length > 0) return scoped;
  // Symbol-name target: cluster the anchor's own FILE. Never widen to the
  // moduleName here — on single-root Maven repos the backfilled scope is a
  // directory fragment ("src/main"), which would sweep the whole backend.
  // Transitive exclusive helpers are handled by the orphan cascade instead.
  const name = target.toLowerCase();
  const anchor = symbols.find(
    (symbol) =>
      !isTestPath(symbol.filePath) &&
      (symbol.name.toLowerCase() === name || symbol.parentType?.toLowerCase() === name)
  );
  if (!anchor) return [];
  const normalized = anchor.filePath.replace(/\\/g, '/').toLowerCase();
  return symbols.filter((symbol) => symbol.filePath.replace(/\\/g, '/').toLowerCase() === normalized);
}

/** Transaction boundary lookup: METHOD → CLASS → INTERFACE declaration. */
export function transactionBoundaryFor(
  symbol: RepoSymbol,
  index: SymbolIndex
): ModuleEvolutionResult['transactionBoundaries'] {
  const hasTransactional = (annotations?: string[]) =>
    Boolean(annotations?.some((annotation => /@Transactional\b/.test(annotation))));
  const out: ModuleEvolutionResult['transactionBoundaries'] = [];
  const push = (scope: 'METHOD' | 'CLASS' | 'INTERFACE', owner: RepoSymbol) =>
    out.push({
      symbol: owner.parentType ? `${owner.parentType}.${owner.name}` : owner.name,
      filePath: owner.filePath,
      line: owner.lineStart ?? 1,
      scope
    });

  const isMethod = symbol.kind === 'method';
  if (isMethod && hasTransactional(symbol.annotations)) push('METHOD', symbol);

  // CLASS level: the enclosing type for methods, the symbol itself otherwise.
  const classSymbol = isMethod
    ? symbol.parentType
      ? index.types.get(symbol.parentType)?.symbol
      : undefined
    : symbol;
  if (classSymbol && hasTransactional(classSymbol.annotations)) push('CLASS', classSymbol);

  // INTERFACE level: Spring honors @Transactional declared on the interface
  // itself OR on the interface's method declaration (proxy-based lookup). The
  // implementing class only references the interface through its `interfaces`
  // list (adapters never write `interfaces` on method symbols), so resolve
  // both declaration sites from the impl's type info.
  const implSymbol = isMethod
    ? symbol.parentType
      ? index.types.get(symbol.parentType)?.symbol
      : undefined
    : symbol;
  const interfaceNames = symbol.interfaces ?? implSymbol?.interfaces ?? [];
  for (const ifaceName of interfaceNames) {
    const ifaceType = index.types.get(ifaceName);
    const iface = ifaceType?.symbol;
    if (!iface) continue;
    if (hasTransactional(iface.annotations)) push('INTERFACE', iface);
    const ifaceMethod = (ifaceType.methods.get(symbol.name) ?? [])[0];
    if (ifaceMethod && hasTransactional(ifaceMethod.annotations)) {
      push('INTERFACE', ifaceMethod);
    }
  }
  return out;
}

function matchPattern(
  goal: string | undefined,
  targetIsClass: boolean,
  serviceCalleeCount: number
): EvolutionScaffoldTemplate['suggestedPattern'] {
  const text = (goal ?? '').toLowerCase();
  if (/异步|async|事件|event/.test(text)) return 'SPRING_EVENT_ASYNC';
  if (targetIsClass || /每个|所有|切面|aop|日志|审计|监控/.test(text)) return 'AOP_ASPECT';
  if (serviceCalleeCount >= 2) return 'SPRING_EVENT_ASYNC';
  return 'DIRECT_INJECTION';
}

/* ------------------- Issue 24.3 — convention pipeline ------------------- */

/** Locality keywords that make a耗时-I/O/transaction decoupling warning fire. */
const HEAVY_IO_PATTERN = /导出|excel|下载|上传|rpc|远程|耗时|export|download|upload|remote/i;

/** Intent keyword sets per convention axis — deterministic, zero-LLM (ADR-0014). */
const INTENT_BARE_RETURN = /裸返回|不包装|直接返回|不(要|用)统一返回|不(要|用)封装|raw|no\s*wrapper/i;
const INTENT_WRAPPED_RETURN = /统一返回|包装|封装|ApiResult|wrap/i;
const INTENT_PLAIN_CLASS = /不(要|写)接口|无需接口|不用接口|直接类|普通类|plain(\s*class)?|no\s*interface/i;
const INTENT_INTERFACE_SPLIT = /(要|需要|写)接口|接口\s*\+\s*实现|interface(\s*\+\s*impl)?|拆接口/i;
const INTENT_FIELD_INJECTION = /字段注入|@Autowired\s*注入|字段装配|field\s*injection/i;
const INTENT_CONSTRUCTOR_INJECTION = /构造器注入|构造注入|constructor\s*injection/i;

/**
 * STRICT-gate: does the explicit intent contradict a decided axis? Returns
 * the conflict detail to throw, or undefined when the intent is silent or
 * aligned. Weak (non-STRICT) axes never land here — they surface as risks.
 */
function strictConflictFor(
  axisId: 'return_wrapping' | 'interface_impl_style' | 'di_style',
  primary: string,
  intent: string,
  verdict: string,
  anchors: ConventionAnchor[],
  coverage: { match: number; total: number }
): ConventionConflictDetail | undefined {
  const t = intent.trim();
  if (!t) return undefined;
  if (axisId === 'return_wrapping') {
    if (primary !== 'bare' && INTENT_BARE_RETURN.test(t)) {
      return {
        axis: 'return_wrapping',
        verdict,
        coverage,
        anchors,
        suggestion: `This package returns ${primary}<T> uniformly — return ${primary}<T> from the new handler (or negotiate a convention change with the repo owners first).`
      };
    }
    if (primary === 'bare' && INTENT_WRAPPED_RETURN.test(t)) {
      return {
        axis: 'return_wrapping',
        verdict,
        coverage,
        anchors,
        suggestion: 'This package returns bare payloads — drop the wrapper from the new handler (or negotiate a convention change with the repo owners first).'
      };
    }
  }
  if (axisId === 'interface_impl_style') {
    if (primary === 'split' && INTENT_PLAIN_CLASS.test(t)) {
      return {
        axis: 'interface_impl_style',
        verdict,
        coverage,
        anchors,
        suggestion: 'This package splits every service into an interface + ServiceImpl pair — provide both files (or negotiate a convention change with the repo owners first).'
      };
    }
    if (primary === 'plain' && INTENT_INTERFACE_SPLIT.test(t)) {
      return {
        axis: 'interface_impl_style',
        verdict,
        coverage,
        anchors,
        suggestion: 'This package writes services as plain classes — no interface split (or negotiate a convention change with the repo owners first).'
      };
    }
  }
  if (axisId === 'di_style') {
    if (primary === 'constructor' && INTENT_FIELD_INJECTION.test(t)) {
      return {
        axis: 'di_style',
        verdict,
        coverage,
        anchors,
        suggestion: 'This package constructor-injects dependencies (private final, no @Autowired) — wire the new dependency through the constructor.'
      };
    }
    if (primary === 'field' && INTENT_CONSTRUCTOR_INJECTION.test(t)) {
      return {
        axis: 'di_style',
        verdict,
        coverage,
        anchors,
        suggestion: 'This package uses field injection (@Autowired on fields) — match it instead of a constructor.'
      };
    }
  }
  return undefined;
}

/** All STRICT axes the explicit intent fights (empty = the plan may proceed). */
function strictConflicts(profile: ConventionProfile, intent: string): ConventionConflictDetail[] {
  const conflicts: ConventionConflictDetail[] = [];
  for (const axis of profile.axes) {
    if (!isStrictAxis(axis) || !axis.verdict) continue;
    const isContestedShape =
      axis.axis === 'return_wrapping' ||
      axis.axis === 'interface_impl_style' ||
      axis.axis === 'di_style';
    if (!isContestedShape) continue;
    const primary = axis.primary;
    if (!primary) continue;
    const conflict = strictConflictFor(
      axis.axis as 'return_wrapping' | 'interface_impl_style' | 'di_style',
      primary,
      intent,
      axis.verdict,
      axis.anchors ?? [],
      axis.coverage ?? { match: 0, total: 0 }
    );
    if (conflict) conflicts.push(conflict);
  }
  return conflicts;
}

/**
 * Bean-field dependency graph: type → bean-typed field types (service /
 * repository / mapper / interface symbols). Cycle-safe DFS over this graph
 * decides whether the injection target already sits on a bean cycle.
 */
function beanCycleContaining(
  symbols: RepoSymbol[],
  targetType: string
): string[] | undefined {
  const beanKinds = new Set(['service', 'repository', 'mapper', 'interface']);
  const beanNames = new Set(
    symbols.filter((s) => !isTestPath(s.filePath) && beanKinds.has(s.kind)).map((s) => s.name)
  );
  const fieldsOf = new Map<string, string[]>();
  for (const symbol of symbols) {
    if (isTestPath(symbol.filePath) || symbol.kind !== 'field') continue;
    if (!symbol.parentType || !symbol.type || !beanNames.has(symbol.type)) continue;
    const list = fieldsOf.get(symbol.parentType) ?? [];
    if (!list.includes(symbol.type)) list.push(symbol.type);
    fieldsOf.set(symbol.parentType, list);
  }
  if (!beanNames.has(targetType)) return undefined;

  const path: string[] = [];
  const onPath = new Set<string>();
  const done = new Set<string>();

  const dfs = (node: string): string[] | undefined => {
    if (onPath.has(node)) {
      // Cycle found — return the segment starting at its first occurrence.
      return path.slice(path.indexOf(node));
    }
    if (done.has(node)) return undefined;
    onPath.add(node);
    path.push(node);
    for (const next of fieldsOf.get(node) ?? []) {
      const cycle = dfs(next);
      if (cycle) return cycle;
    }
    path.pop();
    onPath.delete(node);
    done.add(node);
    return undefined;
  };

  return dfs(targetType);
}

/**
 * Issue 24.3 — the placement directory stays physically grounded: the attach
 * point's real directory (never reconstructed from the dotted package, which
 * would drop the repo-root prefix). An explicit `nearPackages` override moves
 * the landing to a sibling file of that package when one exists.
 */
function placementDirOf(
  primary: RepoSymbol,
  symbols: RepoSymbol[],
  nearPackages: string[] | undefined
): { dir: string; packagePath: string } {
  const explicit = nearPackages?.map((entry) => entry.trim()).find(Boolean);
  if (explicit) {
    const neighbor = symbols.find(
      (s) => !isTestPath(s.filePath) && packageOfPath(s.filePath) === explicit
    );
    if (neighbor) {
      return {
        dir: neighbor.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/'),
        packagePath: explicit
      };
    }
  }
  return {
    dir: primary.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/'),
    packagePath: packageOfPath(primary.filePath)
  };
}

/**
 * Mirror the repo's real interface naming: an `I`-prefixed interface only
 * when existing sibling interfaces spell it that way (never hardcoded).
 */
function splitInterfaceNameFor(
  packagePath: string,
  symbols: RepoSymbol[],
  baseName: string
): string {
  const featurePrefix = packagePath.split('.').slice(0, 2).join('.');
  const siblingInterfaces = symbols.filter(
    (s) =>
      !isTestPath(s.filePath) &&
      s.kind === 'interface' &&
      packageOfPath(s.filePath).startsWith(featurePrefix)
  );
  const iPrefixed = siblingInterfaces.filter((s) => /^I[A-Z]/.test(s.name));
  const prefix =
    siblingInterfaces.length > 0 && iPrefixed.length * 2 >= siblingInterfaces.length ? 'I' : '';
  return `${prefix}${baseName}Extension`;
}

function decap(name: string): string {
  return name ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

function injectionSnippetFor(
  style: 'constructor' | 'field' | 'unsupported',
  baseName: string,
  interfaceName: string
): string {
  const field = decap(`${baseName}Extension`);
  if (style === 'field') {
    return [`@Autowired`, `private ${interfaceName} ${field};`].join('\n');
  }
  if (style === 'constructor') {
    return [
      `private final ${interfaceName} ${field};`,
      ``,
      `public ${baseName}(${interfaceName} ${field}) {`,
      `    this.${field} = ${field};`,
      `}`
    ].join('\n');
  }
  return `// di_style unsupported for this language — wire the dependency manually.`;
}

/**
 * Convention-driven placement plan (Issue 24.3): file set after the
 * interface/impl style, handler signature after the return-wrapping style
 * and dependency wiring after the DI style. Every decision keeps its axis
 * verdict in `basedOn` for traceability.
 */
function placementFor(
  profile: ConventionProfile,
  primary: RepoSymbol,
  baseName: string,
  symbols: RepoSymbol[],
  nearPackages: string[] | undefined
): EvolutionPlacement {
  const axisOf = (axis: string) => profile.axes.find((entry) => entry.axis === axis);
  const { dir, packagePath } = placementDirOf(primary, symbols, nearPackages);
  const styleAxis = axisOf('interface_impl_style');
  const split = styleAxis?.supported && styleAxis.primary === 'split';
  const returnAxis = axisOf('return_wrapping');
  const wrapperName =
    returnAxis?.supported && returnAxis.primary !== 'bare' ? returnAxis.primary : undefined;
  const handlerName = `on${baseName}`;
  const handlerSignature = wrapperName
    ? `public ${wrapperName}<String> ${handlerName}(/* context */)`
    : `public void ${handlerName}(/* context */)`;
  const diAxis = axisOf('di_style');
  const injectionStyle =
    diAxis?.supported && (diAxis.primary === 'constructor' || diAxis.primary === 'field')
      ? diAxis.primary
      : 'unsupported';

  const interfaceName = splitInterfaceNameFor(packagePath, symbols, baseName);
  const files: EvolutionPlacement['files'] = split
    ? [
        { filePath: `${dir}/${interfaceName}.java`, role: 'interface' },
        { filePath: `${dir}/${baseName}ExtensionImpl.java`, role: 'impl' }
      ]
    : [{ filePath: `${dir}/${baseName}Extension.java`, role: 'single' }];

  const basedOn: EvolutionPlacement['basedOn'] = [];
  for (const axis of [styleAxis, returnAxis, diAxis]) {
    if (axis?.supported && axis.verdict) basedOn.push({ axis: axis.axis, verdict: axis.verdict });
  }

  return {
    packagePath,
    files,
    injection: {
      style: injectionStyle,
      codeSnippet: injectionSnippetFor(injectionStyle, baseName, interfaceName)
    },
    handlerSignature,
    basedOn
  };
}

/**
 * Soft risks (ADR-0014 tolerance): weakly-covered conventions the plan still
 * follows (divergence disclosed, never blocking) plus the long-transaction /
 * heavy-I/O decoupling warning along the attach point's boundaries.
 */
function risksFor(
  profile: ConventionProfile,
  transactionBoundaries: ModuleEvolutionResult['transactionBoundaries'],
  goal: string | undefined
): EvolutionRisk[] {
  const risks: EvolutionRisk[] = [];
  for (const axis of profile.axes) {
    if (!axis.supported || !axis.coverage || !axis.verdict) continue;
    if (axis.coverage.total === 0) continue;
    if (axis.coverage.match / axis.coverage.total >= 0.85) continue;
    if (axis.axis === 'package_layout' || axis.axis === 'base_class') continue;
    risks.push({
      kind: 'convention-split',
      axis: axis.axis,
      message: `Convention "${axis.verdict}" covers only ${axis.coverage.match}/${axis.coverage.total} samples — the plan follows it, divergence disclosed.`,
      divergentSamples: axis.dissidents ?? []
    });
  }
  if (transactionBoundaries.length > 0 && goal && HEAVY_IO_PATTERN.test(goal)) {
    const boundary = transactionBoundaries[0];
    risks.push({
      kind: 'transaction-warning',
      message: `${boundary.symbol} runs inside a @Transactional boundary (${boundary.scope}, ${boundary.filePath}:${boundary.line}); the goal "${goal.trim()}" looks like heavy I/O that should not share the transaction.`,
      suggestion:
        'Move the heavy I/O out of the transactional boundary — e.g. publish a Spring event after commit (SPRING_EVENT_ASYNC) and let an @Async listener do the export/RPC.'
    });
  }
  return risks;
}

/**
 * Issue 24.3 — DIRECT_INJECTION scaffolds are placement-driven: the file set
 * mirrors the placement plan (interface+impl split or a plain single class)
 * and the handler method carries the return-wrapping-convention signature.
 */
function injectionScaffolds(
  placement: EvolutionPlacement,
  primary: RepoSymbol,
  goal: string | undefined
): EvolutionScaffoldTemplate[] {
  const header = '// Suggested scaffold — review before applying (not a patch).';
  const baseName = primary.parentType ?? primary.name;
  const stemOf = (filePath: string) => filePath.split('/').pop()!.replace(/\.java$/, '');
  const capability = goal ?? 'new capability';

  if (placement.files.length === 2) {
    const [interfaceFile, implFile] = placement.files;
    const interfaceName = stemOf(interfaceFile.filePath);
    const implName = stemOf(implFile.filePath);
    return [
      {
        suggestedPattern: 'DIRECT_INJECTION',
        filePath: interfaceFile.filePath,
        codeSnippet: [
          header,
          `public interface ${interfaceName} {`,
          `    ${placement.handlerSignature};`,
          `}`
        ].join('\n')
      },
      {
        suggestedPattern: 'DIRECT_INJECTION',
        filePath: implFile.filePath,
        codeSnippet: [
          header,
          `@Service`,
          `public class ${implName} implements ${interfaceName} {`,
          `    @Override`,
          `    ${placement.handlerSignature} {`,
          `        // ${capability} — call it from ${baseName} directly.`,
          `    }`,
          `}`,
          ``,
          `// Wire the extension into ${baseName} (${placement.injection.style} injection):`,
          ...placement.injection.codeSnippet.split('\n').map((line) => `// ${line}`)
        ].join('\n')
      }
    ];
  }

  const singleName = stemOf(placement.files[0].filePath);
  return [
    {
      suggestedPattern: 'DIRECT_INJECTION',
      filePath: placement.files[0].filePath,
      codeSnippet: [
        header,
        `@Service`,
        `class ${singleName} {`,
        `    ${placement.handlerSignature} {`,
        `        // ${capability} — call it from ${baseName} directly.`,
        `    }`,
        `}`,
        ``,
        `// Wire the extension into ${baseName} (${placement.injection.style} injection):`,
        ...placement.injection.codeSnippet.split('\n').map((line) => `// ${line}`)
      ].join('\n')
    }
  ];
}

function scaffoldFor(
  pattern: EvolutionScaffoldTemplate['suggestedPattern'],
  target: RepoSymbol,
  goal: string | undefined
): EvolutionScaffoldTemplate[] {
  const dir = target.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  const baseName = target.parentType ?? target.name;
  if (pattern === 'SPRING_EVENT_ASYNC') {
    const eventFile = `${dir}/event/${baseName}RequestedEvent.java`;
    return [
      {
        suggestedPattern: 'SPRING_EVENT_ASYNC',
        filePath: eventFile,
        codeSnippet: [
          `// Suggested scaffold — review before applying (not a patch).`,
          `public record ${baseName}RequestedEvent(/* carry the minimal context */) {}`,
          ``,
          `// Publish from ${baseName} after the transactional boundary:`,
          `//   eventPublisher.publishEvent(new ${baseName}RequestedEvent(...));`,
          ``,
          `@Component`,
          `class ${baseName}RequestedHandler {`,
          `    @Async @EventListener`,
          `    public void on(${baseName}RequestedEvent event) {`,
          `        // ${goal ?? 'new capability'} — fails soft, never blocks the main flow.`,
          `    }`,
          `}`
        ].join('\n')
      }
    ];
  }
  if (pattern === 'AOP_ASPECT') {
    const aspectFile = `${dir}/aspect/${baseName}Aspect.java`;
    return [
      {
        suggestedPattern: 'AOP_ASPECT',
        filePath: aspectFile,
        codeSnippet: [
          `// Suggested scaffold — review before applying (not a patch).`,
          `@Aspect @Component`,
          `class ${baseName}Aspect {`,
          `    @AfterReturning("execution(* ..${baseName}.*(..))")`,
          `    public void after(JoinPoint joinPoint) {`,
          `        // ${goal ?? 'cross-cutting capability'} over every ${baseName} method.`,
          `    }`,
          `}`
        ].join('\n')
      }
    ];
  }
  // Issue 24.3: the DIRECT_INJECTION scaffold is placement-driven — the
  // file set comes from the convention-driven placement plan (interface+impl
  // split vs plain class), not from a fixed Extension shape.
  return [
    {
      suggestedPattern: 'DIRECT_INJECTION',
      filePath: `${dir}/${baseName}Extension.java`,
      codeSnippet: [
        `// Suggested scaffold — review before applying (not a patch).`,
        `@Service`,
        `class ${baseName}Extension {`,
        `    public void on${baseName}(/* context */) {`,
        `        // ${goal ?? 'new capability'} — call it from ${baseName} directly.`,
        `    }`,
        `}`
      ].join('\n')
    }
  ];
}

export function runModuleEvolution(input: ModuleEvolutionInput): ModuleEvolutionResult {
  // Normalize so MCP/eval callers passing 'extend'/'deprecate' cannot silently
  // fall into the other pipeline.
  const intentType = input.intentType.toUpperCase() as 'DEPRECATE' | 'EXTEND';
  const { repoId, symbols, index } = input;
  const target = input.targetSymbolOrModule.trim();
  if (!target) throw new Error('targetSymbolOrModule is required');
  const baseUrl = input.baseUrl ?? DEFAULT_COCKPIT_BASE;
  const traceId = stableTraceId('ev', repoId, intentType, target);

  if (intentType === 'EXTEND') {
    return runExtend({ ...input, intentType }, target, traceId, baseUrl);
  }
  return runDeprecate({ ...input, intentType }, target, traceId, baseUrl);
}

/* ------------------------------ DEPRECATE ------------------------------ */

function runDeprecate(
  input: ModuleEvolutionInput,
  target: string,
  traceId: string,
  baseUrl: string
): ModuleEvolutionResult {
  const { symbols, index } = input;
  const moduleSymbols = collectModuleSymbols(symbols, target);
  if (moduleSymbols.length === 0) {
    throw new Error(`Module not found: ${target} (no symbols matched moduleName or directory)`);
  }
  const moduleIds = new Set(moduleSymbols.map((symbol) => symbolIdentity(symbol)));

  // Full reverse adjacency over every symbol (routes included) — shared
  // implementation with the radar and blast-radius engines.
  const { identityMap, callersOf } = buildFullCallersIndex(symbols, index);

  // External symbols that reference the module.
  const externalReferrers = new Set<string>();
  for (const [targetId, callers] of callersOf) {
    if (!moduleIds.has(targetId)) continue;
    for (const caller of callers) {
      if (!moduleIds.has(symbolIdentity(caller))) {
        externalReferrers.add(symbolIdentity(caller));
      }
    }
  }

  // Orphaned public code: fixed-point cascade (reminder #2). A symbol outside
  // the module dies when ALL of its callers are inside the module or already
  // orphaned, and it had at least one caller to begin with.
  const orphaned = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [targetId, callers] of callersOf) {
      if (moduleIds.has(targetId) || orphaned.has(targetId)) continue;
      if (callers.length === 0) continue;
      const allDead = callers.every(
        (caller) =>
          moduleIds.has(symbolIdentity(caller)) || orphaned.has(symbolIdentity(caller))
      );
      if (allDead) {
        orphaned.add(targetId);
        changed = true;
      }
    }
  }

  const orphanedSymbols = [...orphaned]
    .map((id) => identityMap.get(id)!)
    .filter(Boolean)
    .sort(
      (a, b) =>
        a.filePath.localeCompare(b.filePath) || (a.lineStart ?? 0) - (b.lineStart ?? 0)
    )
    .map((symbol) => ({
      name: symbol.name,
      filePath: symbol.filePath,
      line: symbol.lineStart ?? 1
    }));

  // Impacted routes: module-owned routes (they disappear) plus routes among
  // the external referrers (their chains break).
  const impactedRoutes = new Set<string>();
  for (const symbol of moduleSymbols) {
    const routePath = routePathOf(symbol, index);
    if (routePath) impactedRoutes.add(routePath);
  }
  for (const id of externalReferrers) {
    const symbol = identityMap.get(id)!;
    const routePath = routePathOf(symbol, index);
    if (routePath) impactedRoutes.add(routePath);
  }

  // Bridged frontend components over the module routes.
  const impactedComponents = new Set<string>();
  for (const routePath of impactedRoutes) {
    for (const bridge of frontendCallersForRoute(symbols, routePath)) {
      impactedComponents.add(bridge.symbol.parentType ?? bridge.symbol.name);
    }
  }

  const impactedCallersCount = externalReferrers.size;
  const riskLevel: ModuleEvolutionResult['riskLevel'] =
    impactedRoutes.size >= 3 || impactedCallersCount >= 5
      ? 'HIGH'
      : impactedRoutes.size + impactedCallersCount > 0
        ? 'MEDIUM'
        : 'LOW';

  // Four-plus-config teardown checklist, grouped by category from real symbols.
  const checklists: EvolutionChecklistItem[] = [];
  const seenFiles = new Set<string>();
  const push = (item: EvolutionChecklistItem) => {
    const key = `${item.category}|${item.filePath}|${item.action}`;
    if (seenFiles.has(key)) return;
    seenFiles.add(key);
    checklists.push(item);
  };
  for (const routePath of impactedRoutes) {
    for (const bridge of frontendCallersForRoute(symbols, routePath)) {
      push({
        category: 'FRONTEND',
        action: 'DELETE',
        filePath: bridge.symbol.filePath,
        description: `Remove the browser call to ${routePath} (component ${bridge.symbol.parentType ?? bridge.symbol.name}).`
      });
    }
  }
  for (const symbol of moduleSymbols) {
    if (symbol.displayPath || symbol.kind === 'route') {
      push({
        category: 'CONTROLLER',
        action: 'DELETE',
        filePath: symbol.filePath,
        description: `Remove route ${symbol.name} (${symbol.displayPath ?? 'route'}).`
      });
    } else if (symbol.kind === 'service' || (symbol.kind === 'method' && symbol.parentType && index.types.get(symbol.parentType)?.symbol.kind === 'service')) {
      push({
        category: 'SERVICE',
        action: 'DELETE',
        filePath: symbol.filePath,
        description: `Remove service member ${symbol.parentType ? `${symbol.parentType}.` : ''}${symbol.name}.`
      });
    } else if (symbol.kind === 'sql' || symbol.kind === 'mapper' || symbol.kind === 'repository') {
      push({
        category: 'PERSISTENCE',
        action: 'DELETE',
        filePath: symbol.filePath,
        description: `Remove mapper/SQL artifact ${symbol.name}; verify any database tables manually (schema not indexed).`
      });
    } else if (symbol.kind === 'config' || symbol.kind === 'dependency') {
      push({
        category: 'CONFIG',
        action: 'DELETE',
        filePath: symbol.filePath,
        description: `Remove configuration key/dependency ${symbol.name} (value never indexed).`
      });
    }
  }
  for (const symbol of symbols) {
    if (symbol.kind === 'config' && inModuleScope(symbol, target)) {
      push({
        category: 'CONFIG',
        action: 'DELETE',
        filePath: symbol.filePath,
        description: `Remove configuration key ${symbol.name} scoped to the module.`
      });
    }
  }

  return {
    schemaVersion: 1,
    repoId: input.repoId,
    intentType: 'DEPRECATE',
    target,
    riskLevel,
    blastRadius: {
      impactedCallersCount,
      impactedRoutes: [...impactedRoutes].sort(),
      impactedComponents: [...impactedComponents].sort(),
      orphanedSymbols
    },
    checklists: checklists.slice(0, 60),
    transactionBoundaries: [],
    cockpitDeepLink: cockpitLink(baseUrl, input.repoId, target, traceId)
  };
}

/* ------------------------------- EXTEND -------------------------------- */

function runExtend(
  input: ModuleEvolutionInput,
  target: string,
  traceId: string,
  baseUrl: string
): ModuleEvolutionResult {
  const { symbols, index } = input;
  const name = target.toLowerCase();
  const methodCandidates = symbols.filter(
    (symbol) =>
      symbol.kind === 'method' &&
      !isTestPath(symbol.filePath) &&
      (symbol.name.toLowerCase() === name ||
        `${symbol.parentType ?? ''}.${symbol.name}`.toLowerCase() === name)
  );
  // Class-level attach points (cross-cutting / AOP shapes) resolve too.
  const classCandidates =
    methodCandidates.length > 0
      ? []
      : symbols.filter(
          (symbol) =>
            (symbol.kind === 'service' || symbol.kind === 'class') &&
            !isTestPath(symbol.filePath) &&
            symbol.name.toLowerCase() === name
        );
  const candidates = (methodCandidates.length > 0 ? methodCandidates : classCandidates).slice(0, 20);
  if (candidates.length === 0) {
    throw new Error(`Attach point not found: ${target}`);
  }
  const primary = candidates[0];
  // METHOD/CLASS/INTERFACE lookup is unified in transactionBoundaryFor, which
  // now also handles class-level attach points (scope CLASS via own
  // annotations, INTERFACE via the class's implements list).
  const transactionBoundaries = candidates.flatMap((candidate) =>
    transactionBoundaryFor(candidate, index)
  );

  // Fan-out evidence: resolved service callees of the attach point.
  const serviceCallees = new Set<string>();
  for (const candidate of candidates) {
    for (const call of candidate.calls ?? []) {
      const resolved = resolveCallEdge(index, candidate, call);
      if (!('target' in resolved)) continue;
      if (resolved.target.kind === 'service') {
        serviceCallees.add(symbolIdentity(resolved.target));
      }
    }
  }
  const pattern = matchPattern(
    input.extensionGoal,
    primary.kind !== 'method',
    serviceCallees.size
  );

  // Real direct callers of the attach point (field name promises callers,
  // not the candidate count).
  const candidateIds = new Set(candidates.map((candidate) => symbolIdentity(candidate)));
  const directCallers = new Set<string>();
  for (const [targetId, callers] of buildFullCallersIndex(symbols, index).callersOf) {
    if (!candidateIds.has(targetId)) continue;
    for (const caller of callers) directCallers.add(symbolIdentity(caller));
  }
  // Issue 24.3 (ADR-0014): conventions first. The neighborhood is the
  // target's own package (or the explicit nearPackages override), so the
  // plan obeys the conventions it will live next to — neighbor-first.
  const profile = runConventionScan({
    repoId: input.repoId,
    symbols,
    targetSymbol: primary.parentType ? `${primary.parentType}.${primary.name}` : primary.name,
    ...(input.nearPackages && input.nearPackages.length > 0
      ? { nearPackages: input.nearPackages }
      : {}),
    commit: input.commit ?? 'unversioned'
  });

  // Fail closed: an explicit intent that fights a STRICT axis is a hard
  // conflict, structured for the caller (agent tool / MCP / CLI).
  const conflicts = strictConflicts(profile, input.extensionGoal ?? '');
  if (conflicts.length > 0) {
    throw new ConventionConflictError(conflicts[0]);
  }

  // Fail closed: an injection point already sitting on a bean-field cycle
  // cannot take another constructor-injected dependency safely.
  if (pattern === 'DIRECT_INJECTION') {
    const attachType = primary.parentType ?? primary.name;
    const cycle = beanCycleContaining(symbols, attachType);
    if (cycle) {
      throw new ConventionConflictError({
        axis: 'injection-cycle',
        verdict: `${attachType} sits on a bean field-dependency cycle: ${cycle.join(' → ')} → ${cycle[0]}`,
        anchors: [],
        suggestion: `Break the cycle around ${attachType} (e.g. introduce an event or a shared collaborator) before constructor-injecting a new extension.`
      });
    }
  }

  const baseName = primary.parentType ?? primary.name;
  // Placement only for the injection shape: event/aspect scaffolds are
  // framework-fixed, not convention-governed (Ticket 24.3 scope).
  const placement =
    pattern === 'DIRECT_INJECTION'
      ? placementFor(profile, primary, baseName, symbols, input.nearPackages)
      : undefined;
  const scaffoldTemplates =
    pattern === 'DIRECT_INJECTION' && placement
      ? injectionScaffolds(placement, primary, input.extensionGoal)
      : scaffoldFor(pattern, primary, input.extensionGoal);

  // CREATE items follow the placement plan: one per scaffold file (interface
  // + impl on split conventions, single file otherwise).
  const checklists: EvolutionChecklistItem[] = scaffoldTemplates.map((template) => ({
    category: 'SERVICE',
    action: 'CREATE',
    filePath: template.filePath,
    description: `Create the ${template.suggestedPattern} scaffold beside ${primary.parentType ?? primary.name}.`
  }));
  checklists.push({
    category: 'SERVICE',
    action: 'MODIFY',
    filePath: primary.filePath,
    description:
      pattern === 'DIRECT_INJECTION'
        ? `Call the extension from ${primary.name} at the attach point (line ${primary.lineStart ?? 1}).`
        : `Publish the event / rely on the aspect — ${primary.name} itself stays untouched (transaction boundary${transactionBoundaries.length ? ' verified' : ' not annotated'}).`
  });

  const risks = risksFor(profile, transactionBoundaries, input.extensionGoal);

  return {
    schemaVersion: 1,
    repoId: input.repoId,
    intentType: 'EXTEND',
    target,
    riskLevel: transactionBoundaries.length > 0 ? 'MEDIUM' : 'LOW',
    blastRadius: {
      impactedCallersCount: directCallers.size,
      impactedRoutes: [],
      impactedComponents: [],
      orphanedSymbols: []
    },
    checklists,
    scaffoldTemplates,
    transactionBoundaries,
    conventions: profile,
    ...(placement ? { placement } : {}),
    ...(risks.length > 0 ? { risks } : {}),
    cockpitDeepLink: cockpitLink(baseUrl, input.repoId, target, traceId)
  };
}
