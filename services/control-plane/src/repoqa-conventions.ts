import type { RepoSymbol } from './repoqa-repos';
import { isTestPath } from './diagnose-engine';
import type {
  ConventionAnchor,
  ConventionAxis,
  ConventionAxisId,
  ConventionCoverage,
  ConventionProfile
} from '../../../packages/contracts/src/index';

// Issue 24.3 — the convention contract moved into @codecompass/contracts so
// ModuleEvolutionResult can embed a profile without contracts depending on
// the control-plane. Re-exported here to keep every existing import site
// (`from './repoqa-conventions'`) working unchanged.
export type {
  ConventionAnchor,
  ConventionAxis,
  ConventionAxisId,
  ConventionCoverage,
  ConventionProfile
};

/**
 * Issue 24 / ADR-0014 — Pattern Ingestion engine (deterministic, zero-LLM).
 *
 * `runConventionScan` sniffs the repo's coding conventions along fixed axes
 * and emits a ConventionProfile: every verdict is a factual claim backed by
 * physical anchors (file:line:symbol) with coverage, dissidents disclosed
 * verbatim. Arbitration is neighbor-first: when a target symbol is given,
 * conventions of its sibling package (same business domain) win over the
 * global vote; a split (or absent) neighborhood falls back to the global
 * majority — and the losing side is always disclosed, never silently
 * dropped. Nothing here is semantic: every number below is countable from
 * the symbol table.
 *
 * Java-first (the parser carries superClass/returnType). Non-Java repos
 * degrade to `unsupported` axes rather than guessed verdicts.
 */

/** STRICT axis (Issue 24.3): an intent that fights it is blocked, not absorbed. */
const STRICT_THRESHOLD = 0.85;

/**
 * ADR-0014 §4 (Issue 24.3): an axis is STRICT when its arbitrated coverage is
 * ≥ 85% — an explicit user intent contradicting it is a hard conflict, while
 * anything weaker is tolerated with disclosure. No minimum sample count: the
 * number is honest at any n, and coverage stays disclosed either way.
 */
export function isStrictAxis(axis: ConventionAxis): boolean {
  if (!axis.supported || !axis.coverage) return false;
  if (axis.coverage.total <= 0) return false;
  return axis.coverage.match / axis.coverage.total >= STRICT_THRESHOLD;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

// `Dto` is deliberately absent: an `OrderDto` suffix marks a payload type,
// not a response wrapper (ADR-0014 — a false "wrapped" verdict would flip
// the whole return_wrapping axis).
const WRAPPER_SUFFIXES = ['Result', 'Response', 'Vo', 'VO', 'R'];
const KNOWN_UNWRAPPED = new Set(['void', 'String', 'Integer', 'Long', 'Boolean', 'Object']);
/** Wrappers so generic they cannot distinguish a convention. */
const GENERIC_WRAPPERS = new Set(['List', 'Set', 'Collection', 'Map', 'Optional', 'Page', 'IPage']);

function isTestSymbol(symbol: RepoSymbol): boolean {
  return isTestPath(symbol.filePath);
}

/** Production Java markers; anything else degrades the axis to unsupported. */
function isJavaRepo(symbols: RepoSymbol[]): boolean {
  return symbols.some((symbol) => symbol.filePath.toLowerCase().endsWith('.java'));
}

/** `com/shop/order` → `com.shop.order` (package of the class's directory). */
export function packageOfPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const mainJava = 'src/main/java/';
  // Works for both `repo/src/main/java/...` and bare `src/main/java/...`.
  const at = normalized.indexOf(mainJava);
  if (at >= 0) {
    return normalized
      .slice(at + mainJava.length)
      .split('/')
      .slice(0, -1)
      .join('.');
  }
  return normalized.split('/').slice(0, -1).join('.');
}

/** 2nd-level package (the feature bucket under the root group). */
function featurePackageOf(packagePath: string): string {
  const parts = packagePath.split('.').filter(Boolean);
  return parts.slice(0, 2).join('.');
}

/**
 * Bean-typed field candidates for the DI axis: only fields whose declared
 * type names an actual bean (service/repository/mapper/interface) in this
 * repo count — `BigDecimal port` or `String name` must not leak in.
 */
function beanTypeNames(symbols: RepoSymbol[]): Set<string> {
  const beanKinds = new Set(['service', 'repository', 'mapper', 'interface']);
  return new Set(symbols.filter((s) => !isTestSymbol(s) && beanKinds.has(s.kind)).map((s) => s.name));
}

function isBeanFieldType(type: string | undefined, beanNames: Set<string>): boolean {
  if (!type) return false;
  return beanNames.has(type);
}

/** Majority with a deterministic tie-break (alphabetical, first wins). */
function majority<T extends string>(counts: Map<T, number>): { value: T; count: number } | undefined {
  let best: { value: T; count: number } | undefined;
  for (const [value, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Axis sniffer factories                                              */
/* ------------------------------------------------------------------ */

interface AxisSample {
  axis: ConventionAxisId;
  supported: boolean;
  verdict?: string;
  /** Machine-readable verdict mirror (see ConventionAxis.primary). */
  primary?: string;
  match?: number;
  total?: number;
  anchors?: ConventionAnchor[];
  dissidents?: ConventionAnchor[];
}

/**
 * Axis 1 — return wrapping: do production controller methods return a
 * unified wrapper (`ApiResult<T>`, `R<T>`, ...) instead of raw payloads?
 */
function sampleReturnWrapping(symbols: RepoSymbol[]): AxisSample {
  const routeClasses = new Set(
    symbols.filter((s) => s.kind === 'route' && !isTestSymbol(s)).map((s) => s.name)
  );
  const methods = symbols.filter(
    (s) =>
      s.kind === 'method' &&
      !isTestSymbol(s) &&
      s.parentType !== undefined &&
      routeClasses.has(s.parentType) &&
      s.returnType !== undefined
  );
  if (methods.length === 0) return { axis: 'return_wrapping', supported: false };

  const isWrapped = (type: string): boolean =>
    !KNOWN_UNWRAPPED.has(type) &&
    !GENERIC_WRAPPERS.has(type) &&
    WRAPPER_SUFFIXES.some((suffix) => type !== suffix && type.endsWith(suffix));

  const wrapped = methods.filter((m) => isWrapped(m.returnType!));
  const bare = methods.filter((m) => !isWrapped(m.returnType!));
  const wrapCount = new Map<string, number>();
  for (const method of wrapped) wrapCount.set(method.returnType!, (wrapCount.get(method.returnType!) ?? 0) + 1);
  const dominant = majority(wrapCount);
  const anchorable = (method: RepoSymbol): ConventionAnchor => ({
    file: method.filePath,
    line: method.lineStart ?? 1,
    symbol: `${method.parentType}.${method.name}`
  });

  if (wrapped.length >= bare.length && dominant) {
    return {
      axis: 'return_wrapping',
      supported: true,
      verdict: `Controller methods return unified wrapper ${dominant.value}<T>`,
      primary: dominant.value,
      match: wrapped.length,
      total: methods.length,
      anchors: wrapped.slice(0, 3).map(anchorable),
      dissidents: bare.slice(0, 5).map(anchorable)
    };
  }
  return {
    axis: 'return_wrapping',
    supported: true,
    verdict: 'Controller methods return bare payloads (no unified wrapper)',
    primary: 'bare',
    match: bare.length,
    total: methods.length,
    anchors: bare.slice(0, 3).map(anchorable),
    dissidents: wrapped.slice(0, 5).map(anchorable)
  };
}

/**
 * Axis 2 — interface/implementation style: do services follow the
 * `UserService` interface + `UserServiceImpl` class split, or plain classes?
 */
function sampleInterfaceImplStyle(symbols: RepoSymbol[]): AxisSample {
  const serviceClasses = symbols.filter(
    (s) =>
      !isTestSymbol(s) &&
      (s.kind === 'service' || (s.kind === 'class' && /Service$/.test(s.name))) &&
      !/ServiceImpl$/.test(s.name)
  );
  const impls = symbols.filter((s) => !isTestSymbol(s) && /ServiceImpl$/.test(s.name));
  if (serviceClasses.length === 0 && impls.length === 0) {
    return { axis: 'interface_impl_style', supported: false };
  }
  const anchorOf = (symbol: RepoSymbol): ConventionAnchor => ({
    file: symbol.filePath,
    line: symbol.lineStart ?? 1,
    symbol: symbol.name
  });
  // The split style needs both halves: a ServiceImpl plus the interface it
  // implements (recorded on the class via `implements`).
  const withInterface = impls.filter((impl) =>
    (impl.interfaces ?? []).some((name) => /Service$/.test(name))
  );
  // Interfaces consumed by a ServiceImpl are half of the convention, not a
  // dissident — only unclaimed services vote for the plain style.
  const splitInterfaces = new Set(
    withInterface.flatMap((impl) => (impl.interfaces ?? []).filter((name) => /Service$/.test(name)))
  );
  const plainServices = serviceClasses.filter((s) => !splitInterfaces.has(s.name));
  const total = withInterface.length + plainServices.length;
  if (withInterface.length >= plainServices.length) {
    return {
      axis: 'interface_impl_style',
      supported: true,
      verdict: 'Services follow interface + ServiceImpl split',
      primary: 'split',
      match: withInterface.length,
      total,
      anchors: withInterface.slice(0, 3).map(anchorOf),
      dissidents: plainServices.slice(0, 5).map(anchorOf)
    };
  }
  return {
    axis: 'interface_impl_style',
    supported: true,
    verdict: 'Services are plain classes (no interface split)',
    primary: 'plain',
    match: plainServices.length,
    total,
    anchors: plainServices.slice(0, 3).map(anchorOf),
    dissidents: withInterface.slice(0, 5).map(anchorOf)
  };
}

/**
 * Axis 3 — base classes: do controllers/services/DTOs share a base class
 * (BaseController / BaseService / BaseDTO)?
 */
function sampleBaseClass(symbols: RepoSymbol[]): AxisSample {
  const classes = symbols.filter(
    (s) => (s.kind === 'class' || s.kind === 'route' || s.kind === 'service') && !isTestSymbol(s)
  );
  const withBase = classes.filter((s) => /^Base\w*$/.test(s.superClass ?? ''));
  const withoutBase = classes.filter((s) => !/^Base\w*$/.test(s.superClass ?? ''));
  if (classes.length === 0) return { axis: 'base_class', supported: false };
  const anchorOf = (symbol: RepoSymbol): ConventionAnchor => ({
    file: symbol.filePath,
    line: symbol.lineStart ?? 1,
    symbol: symbol.name
  });
  if (withBase.length > 0 && withBase.length * 2 >= classes.length) {
    return {
      axis: 'base_class',
      supported: true,
      verdict: `Classes extend a shared Base class (${withBase.length}/${classes.length})`,
      primary: 'base',
      match: withBase.length,
      total: classes.length,
      anchors: withBase.slice(0, 3).map(anchorOf),
      dissidents: withoutBase.slice(0, 5).map(anchorOf)
    };
  }
  return {
    axis: 'base_class',
    supported: true,
    verdict: 'No shared Base-class hierarchy in production classes',
    primary: 'none',
    match: withoutBase.length,
    total: classes.length,
    anchors: withoutBase.slice(0, 3).map(anchorOf),
    dissidents: withBase.slice(0, 5).map(anchorOf)
  };
}

/**
 * Axis 4 — DI style: field `@Autowired` vs constructor injection. Constructor
 * declarations are not symbols, so constructor-style is inferred as the
 * complement: bean-typed `private final` fields without `@Autowired`.
 */
function sampleDiStyle(symbols: RepoSymbol[], beanNames: Set<string>): AxisSample {
  const fields = symbols.filter(
    (s) => s.kind === 'field' && !isTestSymbol(s) && isBeanFieldType(s.type, beanNames)
  );
  if (fields.length === 0) return { axis: 'di_style', supported: false };
  const hasAutowired = (annotations: string[] | undefined): boolean =>
    (annotations ?? []).some((annotation) => /@Autowired|@Resource|@Inject/.test(annotation));
  const finalFields = fields.filter((s) => /private\s+final\s/.test(s.signature ?? ''));
  const fieldInjected = fields.filter((s) => hasAutowired(s.annotations));
  const constructorInjected = finalFields.filter((s) => !hasAutowired(s.annotations));
  // Sampling frame: only fields that carry injection evidence. A plain
  // non-final un-annotated field (e.g. a cached value) is not a DI sample.
  const total = fieldInjected.length + constructorInjected.length;
  if (total === 0) return { axis: 'di_style', supported: false };
  const anchorOf = (symbol: RepoSymbol): ConventionAnchor => ({
    file: symbol.filePath,
    line: symbol.lineStart ?? 1,
    symbol: `${symbol.parentType}.${symbol.name}`
  });
  if (constructorInjected.length >= fieldInjected.length) {
    return {
      axis: 'di_style',
      supported: true,
      verdict: 'Dependencies are constructor-injected (private final, no @Autowired)',
      primary: 'constructor',
      match: constructorInjected.length,
      total,
      anchors: constructorInjected.slice(0, 3).map(anchorOf),
      dissidents: fieldInjected.slice(0, 5).map(anchorOf)
    };
  }
  return {
    axis: 'di_style',
    supported: true,
    verdict: 'Dependencies are field-injected (@Autowired on fields)',
    primary: 'field',
    match: fieldInjected.length,
    total,
    anchors: fieldInjected.slice(0, 3).map(anchorOf),
    dissidents: constructorInjected.slice(0, 5).map(anchorOf)
  };
}

/**
 * Axis 5 — package layout: the dominant 2nd-level package under the root
 * group (layered `com.shop.service` / feature `com.shop.order`).
 */
function samplePackageLayout(symbols: RepoSymbol[]): AxisSample {
  const classes = symbols.filter(
    (s) =>
      !isTestSymbol(s) &&
      (s.kind === 'class' || s.kind === 'route' || s.kind === 'service' || s.kind === 'repository')
  );
  if (classes.length === 0) return { axis: 'package_layout', supported: false };
  const counts = new Map<string, number>();
  for (const symbol of classes) {
    const feature = featurePackageOf(packageOfPath(symbol.filePath));
    if (feature) counts.set(feature, (counts.get(feature) ?? 0) + 1);
  }
  const dominant = majority(counts);
  if (!dominant) return { axis: 'package_layout', supported: false };
  const members = classes.filter(
    (s) => featurePackageOf(packageOfPath(s.filePath)) === dominant.value
  );
  const outsiders = classes.filter(
    (s) => featurePackageOf(packageOfPath(s.filePath)) !== dominant.value
  );
  const anchorOf = (symbol: RepoSymbol): ConventionAnchor => ({
    file: symbol.filePath,
    line: symbol.lineStart ?? 1,
    symbol: symbol.name
  });
  return {
    axis: 'package_layout',
    supported: true,
    verdict: `Production classes live under ${dominant.value}.* (${dominant.count} classes)`,
    primary: dominant.value,
    match: dominant.count,
    total: classes.length,
    anchors: members.slice(0, 3).map(anchorOf),
    dissidents: outsiders.slice(0, 5).map(anchorOf)
  };
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export interface ConventionScanInput {
  repoId: string;
  symbols: RepoSymbol[];
  /**
   * Optional placement target ("OrderService" or "OrderService.find").
   * Its package becomes the arbitration neighborhood: sibling conventions
   * win over the global vote (ADR-0014, neighbor-first).
   */
  targetSymbol?: string;
  /**
   * Explicit neighborhood override (dotted package names, e.g. the
   * destination packages of a planned move — Issue 24.3's placement hook).
   * The first entry wins over the `targetSymbol`-derived neighborhood.
   */
  nearPackages?: string[];
  /** Physical commit of the sniffed tree (`hash` or `hash+dirty`). */
  commit: string;
}

/** Resolve the target symbol to its package (class name or "Parent.method"). */
export function resolveTargetPackage(
  symbols: RepoSymbol[],
  targetSymbol: string | undefined
): string | undefined {
  if (!targetSymbol?.trim()) return undefined;
  const query = targetSymbol.trim();
  const shortName = query.split('.').pop() ?? query;
  const typeKinds = new Set(['class', 'route', 'service', 'repository', 'interface']);
  // Exact match first ("OrderService.find" resolves to the method's package,
  // "OrderService" to the class's), then a class-level short-name fallback.
  const hit =
    symbols.find(
      (s) =>
        !isTestSymbol(s) &&
        (s.name === query || `${s.parentType ?? ''}.${s.name}` === query)
    ) ??
    symbols.find(
      (s) => !isTestSymbol(s) && typeKinds.has(s.kind) && s.name === shortName
    );
  if (!hit) return undefined;
  return packageOfPath(hit.filePath);
}

/** Merge anchor lists, dedup by file:line:symbol, keep the disclosure cap. */
function mergeAnchors(
  primary: ConventionAnchor[] | undefined,
  secondary: ConventionAnchor[] | undefined
): ConventionAnchor[] | undefined {
  const merged: ConventionAnchor[] = [];
  const seen = new Set<string>();
  for (const anchor of [...(primary ?? []), ...(secondary ?? [])]) {
    const key = `${anchor.file}:${anchor.line}:${anchor.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(anchor);
  }
  return merged.length > 0 ? merged.slice(0, 5) : undefined;
}

/**
 * ADR-0014 arbitration: neighborhood (same 2nd-level feature package) first.
 * A decided neighborhood (≥2 samples, ≥2/3 agreement) overrides a conflicting
 * global majority — and the overridden global claim is disclosed in
 * `globalVerdict`. A split (or silent) neighborhood falls back to the global
 * verdict; the losing side stays disclosed either way.
 */
function arbitrate(axis: AxisSample, neighborSample: AxisSample | undefined): AxisSample & { globalVerdict?: { verdict: string; coverage: ConventionCoverage } } {
  if (!neighborSample || !neighborSample.supported) return axis;
  const neighborTotal = neighborSample.total ?? 0;
  const neighborMatch = neighborSample.match ?? 0;
  const neighborDecided = neighborTotal >= 2 && neighborMatch / neighborTotal >= 2 / 3;
  if (!neighborDecided) return axis; // neighbor split → global stands
  if (neighborSample.verdict === axis.verdict) return axis; // no conflict
  return {
    ...neighborSample,
    // Under the neighbor-first verdict the losing side is the neighborhood's
    // own minority plus the overridden global majority — whose supporting
    // anchors are exactly the global sample's `anchors` (its own dissidents
    // now agree with the final verdict and must not be re-listed).
    dissidents: mergeAnchors(neighborSample.dissidents, axis.anchors),
    // Neighbor-first overrule: keep the overridden global claim auditable.
    globalVerdict:
      axis.verdict !== undefined && axis.total !== undefined
        ? { verdict: axis.verdict, coverage: { match: axis.match ?? 0, total: axis.total } }
        : undefined
  };
}

/** Re-run one axis restricted to symbols of one feature package. */
function resampleForPackage(
  axis: ConventionAxisId,
  symbols: RepoSymbol[],
  featurePackage: string,
  beanNames: Set<string>
): AxisSample | undefined {
  const scoped = symbols.filter(
    (s) => !isTestSymbol(s) && featurePackageOf(packageOfPath(s.filePath)) === featurePackage
  );
  if (scoped.length === 0) return undefined;
  switch (axis) {
    case 'return_wrapping':
      return sampleReturnWrapping(scoped);
    case 'interface_impl_style':
      return sampleInterfaceImplStyle(scoped);
    case 'base_class':
      return sampleBaseClass(scoped);
    case 'di_style':
      // Bean names come from the whole repo: a neighborhood's controller may
      // inject a service defined in another package.
      return sampleDiStyle(scoped, beanNames);
    case 'package_layout':
      // Package layout is about the whole tree; scoping it to one package
      // would only re-report the neighborhood as the global answer.
      return undefined;
  }
}

export function runConventionScan(input: ConventionScanInput): ConventionProfile {
  const { repoId, symbols, commit } = input;
  const java = isJavaRepo(symbols);
  const beanNames = beanTypeNames(symbols);
  const globalSamples: AxisSample[] = [
    sampleReturnWrapping(symbols),
    sampleInterfaceImplStyle(symbols),
    sampleBaseClass(symbols),
    sampleDiStyle(symbols, beanNames),
    samplePackageLayout(symbols)
  ];

  const neighborPackage =
    input.nearPackages?.map((entry) => entry.trim()).find(Boolean) ??
    resolveTargetPackage(symbols, input.targetSymbol);
  const neighborFeature = neighborPackage ? featurePackageOf(neighborPackage) : undefined;

  const axes: ConventionAxis[] = globalSamples.map((sample) => {
    if (!java && sample.supported) {
      // Graceful degradation: without the Java facts an axis keys on, it
      // reports unsupported instead of a guessed verdict.
      return { axis: sample.axis, supported: false };
    }
    const neighborSample =
      neighborFeature && !neighborFeature.startsWith('..')
        ? resampleForPackage(sample.axis, symbols, neighborFeature, beanNames)
        : undefined;
    const decided = arbitrate(sample, neighborSample);
    return {
      axis: decided.axis,
      supported: decided.supported,
      ...(decided.verdict !== undefined ? { verdict: decided.verdict } : {}),
      ...(decided.primary !== undefined ? { primary: decided.primary } : {}),
      ...(decided.total !== undefined
        ? { coverage: { match: decided.match ?? 0, total: decided.total } }
        : {}),
      ...(decided.anchors !== undefined ? { anchors: decided.anchors } : {}),
      ...(decided.dissidents !== undefined ? { dissidents: decided.dissidents } : {}),
      ...(decided.globalVerdict !== undefined ? { globalVerdict: decided.globalVerdict } : {})
    };
  });

  return {
    repoId,
    ...(neighborPackage !== undefined ? { neighborPackage } : {}),
    axes,
    sampledAt: commit
  };
}
