import type { RepoSymbol, RepoSymbolCall } from './repoqa-repos';
import type { RepoQaTraceHop } from '../../../packages/contracts/src/index';

/**
 * Issue 05 — Deterministic call-chain query.
 *
 * Resolves a cross-file method call chain (Controller → Service → Repository)
 * from the AST-derived symbol table. Resolutions are *deterministic*: a hop is
 * only emitted when the target method can be bound statically:
 * - receiver type comes from the parse-time scope (fields / locals / params),
 * - an interface with exactly one implementation resolves into that impl,
 * - an interface with zero or multiple implementations, an untyped receiver,
 *   a method chain, or any other dynamic/RPC-style dispatch is never guessed —
 *   the chain emits an explicit `break` hop carrying a marker instead.
 */

export const STATIC_ANALYSIS_BREAK_DYNAMIC =
  '[Static Analysis Break: Dynamic/RPC Dispatch]';
export const STATIC_ANALYSIS_BREAK_UNRESOLVED =
  '[Static Analysis Break: target method not found]';

const TYPE_KINDS = new Set<RepoSymbol['kind']>([
  'class',
  'interface',
  'route',
  'service',
  'repository'
]);

interface TypeInfo {
  symbol: RepoSymbol;
  /** method name → declared method symbols of this type. */
  methods: Map<string, RepoSymbol[]>;
  /** field name → declared type + injection annotations (Issue 21). */
  fields: Map<string, FieldInfo>;
  interfaces: string[];
  /** Issue 21: Spring bean name of this type (explicit annotation name or default). */
  beanName?: string;
  /** Issue 21: class-level @Primary marker. */
  isPrimary: boolean;
}

interface FieldInfo {
  type: string;
  /** Raw annotation texts of the field declaration, e.g. `@Autowired @Qualifier("x")`. */
  annotations: string[];
}

export interface SymbolIndex {
  types: Map<string, TypeInfo>;
  /** interface name → class type names that implement it. */
  implsOfInterface: Map<string, string[]>;
  /** Issue 24: `<simple-interface>.<statement-id>` → MyBatis XML SQL nodes. */
  mapperStatements: Map<string, RepoSymbol[]>;
  /** Issue 25: normalized route path → backend symbols with a displayPath. */
  routesByPath: Map<string, Array<{ symbol: RepoSymbol; priority: number }>>;
  /** file → method name → method symbols (legacy same-file resolution). */
  methodsByFile: Map<string, Map<string, RepoSymbol[]>>;
  /** method name → method symbols (legacy global resolution). */
  methodsByName: Map<string, RepoSymbol[]>;
}

function identity(symbol: RepoSymbol): string {
  return `${symbol.filePath}:${symbol.lineStart ?? 0}:${symbol.name}`;
}

/**
 * Issue 22 — public identity of a symbol for cross-module matching. Shared with
 * `codecompass diff` reverse reachability so a modified symbol can be matched
 * against the caller graph by the same key the chain resolver uses.
 */
export function symbolIdentity(symbol: RepoSymbol): string {
  return identity(symbol);
}

/**
 * Issue 25 — normalize a route URL for cross-language matching: strip query
 * string/hash, keep only the pathname of absolute URLs, and collapse trailing
 * slashes. `/api/owners?x=1` and `/api/owners/` resolve to the same key.
 */
export function normalizeRoutePath(raw: string): string {
  let pathname = raw.trim().split(/[?#]/, 1)[0];
  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      pathname = `/${pathname.split('/').slice(3).join('/')}`;
    }
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/+$/, '');
  // v0.5.1 (D8): collapse Spring `{id}` / Express `:id` segments so a
  // frontend template and a backend route pattern normalize to the same key.
  pathname = pathname.replace(/\/\{[^/}]+\}/g, '/{}').replace(/\/:[A-Za-z0-9_]+/g, '/{}');
  return pathname === '' ? '/' : pathname;
}

/* ------------------------------------------------------------------ */
/* Issue 21 — Spring bean descriptors derived from annotations         */
/* ------------------------------------------------------------------ */

/** Annotations that can carry an explicit bean name on a type declaration. */
const BEAN_NAME_ANNOTATIONS =
  'Service|Component|Repository|RestController|Controller|Configuration';

/** `@Service("customName")` style explicit bean name, if present. */
function explicitBeanName(annotations: string[] | undefined): string | undefined {
  if (!annotations) return undefined;
  for (const annotation of annotations) {
    const match = new RegExp(
      `@(?:${BEAN_NAME_ANNOTATIONS})\\s*\\(\\s*["']([^"']+)["']\\s*\\)`
    ).exec(annotation);
    if (match && match[1].trim()) return match[1].trim();
  }
  return undefined;
}

/**
 * Spring's default bean name for a class: decapitalize the first character
 * unless the first *two* characters are both uppercase (URL-style names like
 * `URLConnection` keep their case).
 */
function defaultBeanName(className: string): string {
  if (className.length === 0) return className;
  const first = className[0];
  if (first >= 'A' && first <= 'Z') {
    const second = className[1];
    if (className.length === 1 || !(second >= 'A' && second <= 'Z')) {
      return first.toLowerCase() + className.slice(1);
    }
  }
  return className;
}

/** Explicit annotation name, falling back to the Spring default bean name. */
function beanNameOf(className: string, annotations: string[] | undefined): string {
  return explicitBeanName(annotations) ?? defaultBeanName(className);
}

function isPrimaryAnnotated(annotations: string[] | undefined): boolean {
  return Boolean(annotations?.some((annotation) => /\bPrimary\b/.test(annotation)));
}

/** `@Qualifier("x")` value or `@Resource(name="y")` value on an injection point. */
function explicitInjectionBean(annotations: string[] | undefined): string | undefined {
  if (!annotations) return undefined;
  for (const annotation of annotations) {
    const qualifier = /@Qualifier\s*\(\s*["']([^"']+)["']\s*\)/.exec(annotation);
    if (qualifier && qualifier[1].trim()) return qualifier[1].trim();
    const resource = /@Resource\s*\(\s*name\s*=\s*["']([^"']+)["']\s*\)/.exec(annotation);
    if (resource && resource[1].trim()) return resource[1].trim();
  }
  return undefined;
}

/** `@Autowired` / `@Resource` / `@Inject` family: injection by field/param name. */
function isAutowiredFamily(annotations: string[] | undefined): boolean {
  return Boolean(
    annotations?.some((annotation) => /@(?:Autowired|Resource|Inject)\b/.test(annotation))
  );
}

/**
 * Bean name requested by an *explicit* injection annotation on the receiver's
 * injection point: `@Qualifier("x")` / `@Resource(name="y")`. Matching follows
 * Spring's semantics: an explicit qualifier pins the exact bean and does not
 * fall back to @Primary.
 */
function explicitInjectionBeanName(
  index: SymbolIndex,
  caller: RepoSymbol,
  call: RepoSymbolCall
): string | undefined {
  const receiver = call.receiver;
  if (!receiver) return undefined;
  const paramAnnotations = (caller.paramAnnotations ?? {})[receiver];
  if (paramAnnotations) {
    const explicit = explicitInjectionBean(paramAnnotations);
    if (explicit) return explicit;
  }
  if (caller.parentType) {
    const field = index.types.get(caller.parentType)?.fields.get(receiver);
    if (field) {
      const explicit = explicitInjectionBean(field.annotations);
      if (explicit) return explicit;
    }
  }
  return undefined;
}

/**
 * Bean-name fallback for an autowired field/parameter (`@Autowired`, bare
 * `@Resource`, `@Inject`): Spring resolves byType and, when several candidates
 * remain after @Primary, by the variable name — `wechatGateway` → bean
 * `wechatGateway`.
 */
function autowiredNameBean(
  index: SymbolIndex,
  caller: RepoSymbol,
  call: RepoSymbolCall
): string | undefined {
  const receiver = call.receiver;
  if (!receiver) return undefined;
  if (isAutowiredFamily((caller.paramAnnotations ?? {})[receiver])) return receiver;
  if (caller.parentType) {
    const field = index.types.get(caller.parentType)?.fields.get(receiver);
    if (field && isAutowiredFamily(field.annotations)) return receiver;
  }
  return undefined;
}

/**
 * v0.7 — Go implicit interface satisfaction (duck typing): a struct whose
 * method set covers an interface's method set — with per-method normalized
 * signatures matching — gets `interfaces` backfilled, so the existing
 * `implsOfInterface`/`resolveCall` path resolves interface-typed calls.
 * Conservative by design: first-line signatures that don't compare equal
 * (multiline declarations, embedded promotions) are skipped, and the explicit
 * `var x Iface = &Impl{}` inference upstream always wins.
 */
export function applyImplicitInterfaces(symbols: RepoSymbol[]): void {
  const goMethodKey = (signature: string | null | undefined, name: string): string | null => {
    if (!signature) return null;
    let body = signature.trim();
    if (body.startsWith('func')) {
      if (body.startsWith('func (')) {
        const close = body.indexOf(')');
        if (close < 0) return null;
        body = body.slice(close + 1);
      } else {
        body = body.slice('func'.length);
      }
    }
    // MethodDecl first lines carry the body's opening brace; interface
    // MethodElem signatures do not.
    body = body.replace(/\s*\{\s*$/, '').replace(/\s+/g, ' ').trim();
    return body.length > 0 ? `${name} ${body}` : null;
  };

  // Method name+key sets per declaring type (interface or struct receiver).
  const methodsByType = new Map<string, Map<string, Set<string>>>();
  for (const symbol of symbols) {
    if (symbol.kind !== 'method' || !symbol.parentType || !symbol.signature) continue;
    const key = goMethodKey(symbol.signature, symbol.name);
    if (!key) continue;
    let bucket = methodsByType.get(symbol.parentType);
    if (!bucket) {
      bucket = new Map();
      methodsByType.set(symbol.parentType, bucket);
    }
    const keys = bucket.get(symbol.name) ?? new Set<string>();
    keys.add(key);
    bucket.set(symbol.name, keys);
  }

  const typeKinds = new Set(['class', 'service', 'repository']);
  const structNames = new Set(
    symbols.filter((s) => typeKinds.has(s.kind)).map((s) => s.name)
  );
  if (structNames.size === 0) return;

  for (const iface of symbols) {
    if (iface.kind !== 'interface') continue;
    const required = methodsByType.get(iface.name);
    if (!required || required.size === 0) continue;

    // Candidate structs: those declaring every required method name.
    let candidates: Set<string> | undefined;
    for (const [methodName, keys] of required) {
      const owners = new Set<string>();
      for (const structName of structNames) {
        const bucket = methodsByType.get(structName);
        if (bucket?.has(methodName)) owners.add(structName);
      }
      if (owners.size === 0) {
        candidates = new Set();
        break;
      }
      candidates = candidates
        ? new Set([...candidates].filter((name) => owners.has(name)))
        : owners;
    }
    if (!candidates || candidates.size === 0) continue;

    for (const structName of candidates) {
      const bucket = methodsByType.get(structName)!;
      let satisfied = true;
      for (const [methodName, keys] of required) {
        const structKeys = bucket.get(methodName)!;
        if (![...keys].some((key) => structKeys.has(key))) {
          satisfied = false;
          break;
        }
      }
      if (!satisfied) continue;
      const impl = symbols.find(
        (symbol) =>
          symbol.name === structName &&
          (symbol.kind === 'class' || symbol.kind === 'service' || symbol.kind === 'repository')
      );
      if (!impl) continue;
      const interfaces = impl.interfaces ?? [];
      if (!interfaces.includes(iface.name)) {
        interfaces.push(iface.name);
        impl.interfaces = interfaces;
      }
    }
  }
}

export function buildCallIndex(symbols: RepoSymbol[]): SymbolIndex {
  const types = new Map<string, TypeInfo>();
  const implsOfInterface = new Map<string, string[]>();
  const mapperStatements = new Map<string, RepoSymbol[]>();
  const routesByPath = new Map<string, Array<{ symbol: RepoSymbol; priority: number }>>();
  const methodsByFile = new Map<string, Map<string, RepoSymbol[]>>();
  const methodsByName = new Map<string, RepoSymbol[]>();

  for (const symbol of symbols) {
    // Method-level paths win over the class-level route prefix when both match
    // (`@Controller("owners")` + `@GetMapping` both have displayPath `/owners`).
    if (symbol.displayPath) {
      const key = normalizeRoutePath(symbol.displayPath);
      const list = routesByPath.get(key) ?? [];
      list.push({
        symbol,
        priority: symbol.kind === 'method' ? 2 : symbol.kind === 'route' ? 1 : 0
      });
      routesByPath.set(key, list);
    }
    if (TYPE_KINDS.has(symbol.kind)) {
      const info: TypeInfo = {
        symbol,
        methods: new Map(),
        fields: new Map(),
        interfaces: symbol.interfaces ?? [],
        beanName: beanNameOf(symbol.name, symbol.annotations),
        isPrimary: isPrimaryAnnotated(symbol.annotations)
      };
      types.set(symbol.name, info);
      for (const iface of info.interfaces) {
        const impls = implsOfInterface.get(iface) ?? [];
        if (!impls.includes(symbol.name)) impls.push(symbol.name);
        implsOfInterface.set(iface, impls);
      }
    }
  }

  for (const symbol of symbols) {
    if (symbol.kind === 'method') {
      if (symbol.parentType) {
        const info = types.get(symbol.parentType);
        if (info) {
          const list = info.methods.get(symbol.name) ?? [];
          list.push(symbol);
          info.methods.set(symbol.name, list);
        }
      }
      const byFile = methodsByFile.get(symbol.filePath) ?? new Map<string, RepoSymbol[]>();
      const fileList = byFile.get(symbol.name) ?? [];
      fileList.push(symbol);
      byFile.set(symbol.name, fileList);
      methodsByFile.set(symbol.filePath, byFile);

      const globalList = methodsByName.get(symbol.name) ?? [];
      globalList.push(symbol);
      methodsByName.set(symbol.name, globalList);
    } else if (symbol.kind === 'field' && symbol.parentType && symbol.type) {
      const info = types.get(symbol.parentType);
      if (info) {
        info.fields.set(symbol.name, {
          type: symbol.type,
          annotations: symbol.annotations ?? []
        });
      }
    } else if (symbol.kind === 'sql' && symbol.parentType) {
      const key = `${symbol.parentType}.${symbol.name}`;
      const list = mapperStatements.get(key) ?? [];
      list.push(symbol);
      mapperStatements.set(key, list);
    }
  }

  return {
    types,
    implsOfInterface,
    mapperStatements,
    routesByPath,
    methodsByFile,
    methodsByName
  };
}

/** Return the method symbol the trace actually starts from. */
function effectiveStart(
  symbols: RepoSymbol[],
  start: RepoSymbol,
  index: SymbolIndex
): RepoSymbol | undefined {
  if (start.kind === 'method') return start;
  if (start.kind === 'route' && (start.calls?.length ?? 0) > 0) return start;
  if (TYPE_KINDS.has(start.kind)) {
    const info = index.types.get(start.name);
    if (info) {
      const methods = [...info.methods.values()]
        .flat()
        .sort((a, b) => (a.lineStart ?? 0) - (b.lineStart ?? 0));
      if (methods.length > 0) return methods[0];
    }
  }
  return symbols.find((symbol) => symbol.kind === 'method');
}

/** Candidate receiver types for a call, in priority order. */
function candidateTypes(
  index: SymbolIndex,
  caller: RepoSymbol,
  call: RepoSymbolCall
): string[] {
  const out: string[] = [];
  if (call.receiverType) {
    out.push(call.receiverType);
  } else if (call.receiver === 'this') {
    // New-format bare call: implicit this, typed by the enclosing class.
    if (caller.parentType) out.push(caller.parentType);
  } else if (call.receiver) {
    // Legacy calls without a parse-time receiverType: recover the field type
    // from the caller's enclosing type, and treat the receiver as a static type.
    if (caller.parentType) {
      const fieldType = index.types.get(caller.parentType)?.fields.get(call.receiver)?.type;
      if (fieldType) out.push(fieldType);
    }
    if (index.types.has(call.receiver)) out.push(call.receiver);
  }
  // `call.receiver === undefined` is a legacy row with no receiver info at all:
  // fall through to name-based same-file/global resolution.
  return [...new Set(out.filter(Boolean))];
}

function pickOverload(candidates: RepoSymbol[], callerFile: string): RepoSymbol {
  const sameFile = candidates.find((candidate) => candidate.filePath === callerFile);
  if (sameFile) return sameFile;
  return [...candidates].sort(
    (a, b) => (a.lineStart ?? 0) - (b.lineStart ?? 0)
  )[0];
}

type ResolveResult = { target: RepoSymbol } | { reason: string };

/** Resolve a call against an implementation type (interface dispatch target). */
function resolveImpl(
  index: SymbolIndex,
  implName: string,
  caller: RepoSymbol,
  call: RepoSymbolCall
): ResolveResult {
  const implInfo = index.types.get(implName);
  const methods = implInfo?.methods.get(call.method) ?? [];
  if (methods.length === 0) return { reason: STATIC_ANALYSIS_BREAK_UNRESOLVED };
  return { target: pickOverload(methods, caller.filePath) };
}

/**
 * Issue 25 — bridge a browser-side HTTP call (`fetch` / `axios`) to a backend
 * route. Matching is path-based and deterministic:
 * - exact normalized path first, then a `/api` context-prefix variant;
 * - method-level paths are preferred over class-level route prefixes;
 * - multiple candidates at the same priority are treated as ambiguous.
 */
function resolveHttpRoute(
  index: SymbolIndex,
  call: RepoSymbolCall
): ResolveResult | undefined {
  if (!call.http) return undefined;
  const url = normalizeRoutePath(call.http.url);
  const variants = new Set<string>([url]);
  if (url.startsWith('/api/')) variants.add(url.slice('/api'.length));
  if (url.startsWith('/api/v1')) variants.add(url.slice('/api/v1'.length));
  variants.add(`/api${url}`);
  variants.add(`/api/v1${url}`);
  const candidates: Array<{ symbol: RepoSymbol; priority: number }> = [];
  for (const variant of variants) {
    candidates.push(...(index.routesByPath.get(variant) ?? []));
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.priority - a.priority || (a.symbol.lineStart ?? 0) - (b.symbol.lineStart ?? 0));
  const topPriority = candidates[0].priority;
  const best = candidates.filter((candidate) => candidate.priority === topPriority);
  if (best.length !== 1) return { reason: STATIC_ANALYSIS_BREAK_DYNAMIC };
  return { target: best[0].symbol };
}

function resolveCall(
  index: SymbolIndex,
  caller: RepoSymbol,
  call: RepoSymbolCall
): ResolveResult {
  if (call.http) {
    const httpTarget = resolveHttpRoute(index, call);
    if (httpTarget) return httpTarget;
    return {
      reason: `${STATIC_ANALYSIS_BREAK_DYNAMIC} HTTP ${call.http.method} ${call.http.url}`
    };
  }
  const candidateTypesList = candidateTypes(index, caller, call);
  for (const typeName of candidateTypesList) {
    const info = index.types.get(typeName);
    if (!info) continue; // unresolved/external type name

    if (info.symbol.kind === 'interface') {
      const impls = index.implsOfInterface.get(typeName) ?? [];
      if (impls.length === 1) {
        return resolveImpl(index, impls[0], caller, call);
      }
      if (impls.length === 0) {
        // Issue 24: a Mapper interface without a Java impl is backed by XML.
        // A single namespace+id match is a deterministic data-layer hop.
        const mapper = index.mapperStatements.get(`${typeName}.${call.method}`) ?? [];
        if (mapper.length === 1) return { target: mapper[0] };
        // No impl and no/ambiguous XML mapper → cannot bind deterministically.
        return { reason: STATIC_ANALYSIS_BREAK_DYNAMIC };
      }
      // Issue 21 — Spring bean disambiguation for multiple implementations,
      // mirroring DefaultListableBeanFactory.determineAutowireCandidate:
      // 1. explicit injection-point hint (@Qualifier("x") / @Resource(name="y"))
      //    pins the bean — no fallback;
      // 2. a single @Primary candidate;
      // 3. the autowired field/parameter variable name matching a bean name;
      // only when all fail do we emit the Static Analysis Break.
      const explicit = explicitInjectionBeanName(index, caller, call);
      if (explicit) {
        const matched = impls.filter(
          (implName) => index.types.get(implName)?.beanName === explicit
        );
        if (matched.length === 1) return resolveImpl(index, matched[0], caller, call);
        // Explicit bean name matches none/several → too ambiguous to guess.
        return { reason: STATIC_ANALYSIS_BREAK_DYNAMIC };
      }
      const primaries = impls.filter(
        (implName) => index.types.get(implName)?.isPrimary === true
      );
      if (primaries.length === 1) return resolveImpl(index, primaries[0], caller, call);
      const nameBean = autowiredNameBean(index, caller, call);
      if (nameBean) {
        const matched = impls.filter(
          (implName) => index.types.get(implName)?.beanName === nameBean
        );
        if (matched.length === 1) return resolveImpl(index, matched[0], caller, call);
      }
      return { reason: STATIC_ANALYSIS_BREAK_DYNAMIC };
    }

    const methods = info.methods.get(call.method) ?? [];
    if (methods.length > 0) return { target: pickOverload(methods, caller.filePath) };
    return { reason: STATIC_ANALYSIS_BREAK_UNRESOLVED };
  }

  // No statically bound receiver type: dynamic / RPC / external dispatch, or a
  // legacy call without receiver info (fall back to name-based resolution).
  if (!call.dynamic) {
    const byFile = index.methodsByFile.get(call.file);
    const sameFile = byFile?.get(call.method);
    if (sameFile && sameFile.length > 0) {
      // Issue 15: deterministic overload pick — same file, smallest lineStart.
      return { target: pickOverload(sameFile, call.file) };
    }
    const global = index.methodsByName.get(call.method);
    if (global && global.length > 0) {
      // Issue 15: across modules a bare method name can collide; prefer the
      // caller's own file, otherwise the earliest declaration — never the
      // arbitrary index-0 of symbol insertion order.
      return { target: pickOverload(global, caller.filePath) };
    }
  }
  // Explicitly a dynamic/RPC-style dispatch (untyped receiver, chain, interface).
  return call.dynamic || call.receiver
    ? { reason: STATIC_ANALYSIS_BREAK_DYNAMIC }
    : { reason: STATIC_ANALYSIS_BREAK_UNRESOLVED };
}

export function resolveCallChain(
  symbols: RepoSymbol[],
  start: RepoSymbol,
  depth = 4,
  index?: SymbolIndex
): RepoQaTraceHop[] {
  const resolvedIndex = index ?? buildCallIndex(symbols);
  const started = effectiveStart(symbols, start, resolvedIndex);
  if (!started) return [];

  const trace: RepoQaTraceHop[] = [
    {
      file: started.filePath,
      method: started.name,
      line: started.lineStart ?? 1,
      lineEnd: started.lineEnd,
      callLine: started.lineStart ?? 1
    }
  ];
  const visited = new Set<string>([identity(started)]);
  let current = started;

  for (let step = 1; step <= depth; step += 1) {
    const calls = current.calls ?? [];
    if (calls.length === 0) return trace;

    let progressed = false;
    for (const call of calls) {
      const result = resolveCall(resolvedIndex, current, call);
      if ('reason' in result) {
        const reason = result.reason;
        trace.push({
          file: call.file,
          method: call.method,
          line: call.line ?? current.lineStart ?? 1,
          callLine: call.line,
          break: true,
          reason
        });
        return trace;
      }
      const target = result.target;
      if (visited.has(identity(target))) continue; // cycle → try next call
      trace.push({
        file: target.filePath,
        method: target.name,
        line: target.lineStart ?? 1,
        lineEnd: target.lineEnd,
        callLine: call.line,
        async: call.async || undefined
      });
      visited.add(identity(target));
      current = target;
      progressed = true;
      break;
    }

    if (!progressed) {
      // Every outgoing call is already on the trace (a cycle): terminate quietly.
      return trace;
    }
  }

  return trace;
}

export interface ReverseCaller {
  file: string;
  method: string;
  line: number;
  callLine: number | null;
}

/* ------------------------------------------------------------------ */
/* Issue 22 — single-edge resolution for reverse reachability          */
/* ------------------------------------------------------------------ */

/**
 * Deterministic single-edge call resolver used by `codecompass diff` reverse
 * reachability. Builds the same symbol index as resolveCallChain once and
 * reuses it, so resolving every call edge of a repo is O(symbols + edges)
 * instead of O(symbols × edges).
 */
export class CallResolver {
  private readonly index: SymbolIndex;
  private readonly callersById: Map<string, ReverseCaller[]>;

  constructor(symbols: RepoSymbol[], index?: SymbolIndex) {
    this.index = index ?? buildCallIndex(symbols);
    this.callersById = new Map();
    for (const caller of symbols) {
      if (caller.kind !== 'method') continue;
      for (const call of caller.calls ?? []) {
        const resolved = this.resolve(caller, call);
        if (!('target' in resolved) || !resolved.target) continue;
        const id = symbolIdentity(resolved.target);
        const list = this.callersById.get(id) ?? [];
        list.push({
          file: caller.filePath,
          method: caller.name,
          line: caller.lineStart ?? 1,
          callLine: call.line ?? null
        });
        this.callersById.set(id, list);
      }
    }
  }

  /** Resolve one call to its statically bound target, or a break reason. */
  resolve(
    caller: RepoSymbol,
    call: RepoSymbolCall
  ): { target: RepoSymbol } | { reason: string } {
    return resolveCall(this.index, caller, call);
  }

  /** Deterministic callers of a target symbol, sorted by file then line. */
  reverseCallers(target: RepoSymbol): ReverseCaller[] {
    const list = this.callersById.get(symbolIdentity(target)) ?? [];
    return [...list].sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.line - b.line ||
        a.method.localeCompare(b.method)
    );
  }
}
