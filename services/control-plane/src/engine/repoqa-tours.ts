import type { RepoSymbol } from '../ingest/repoqa-repos';
import type { RepoQaTraceHop } from '../../../../packages/contracts/src/index';
import { buildCallIndex, isTestPath, resolveCallChain, resolveCallEdge } from './repoqa-callchain';
import type { SymbolIndex } from './repoqa-callchain';

/**
 * Issue 11 — AST 启发式 Onboarding Tours（Phase 2 方案 A：Onboarding 驾驶舱）。
 *
 * 基于已构建的 AST 符号表与调用关系，自动识别并生成三条标准 Onboarding 路线：
 * - `auth-chain`      鉴权与拦截链：Filter / HandlerInterceptor → 受保护 REST 端点
 * - `main-flow`       核心主业务流：调用深度最深的 @RestController 方法全链
 * - `error-handling`  全局异常拦截：@RestControllerAdvice + 其 @ExceptionHandler 方法
 *
 * 全部为确定性输出：不依赖 LLM；行号与文件路径直接取自解析期符号表
 * （lineStart / filePath），Mermaid 链路遵循全仓库统一的 code:// 绑定约定
 * （节点 ID == 标签，重复名称追加数字后缀以保持可点击性）。
 */

export type RepoQaTourId = 'auth-chain' | 'main-flow' | 'error-handling';

export interface RepoQaTourStep {
  /** Human-readable step name, e.g. `1. AuthFilter.doFilter（认证过滤器）`. */
  step: string;
  filePath: string;
  lineNumber: number;
  /** Symbol name the step jumps to (method or class). */
  symbol: string;
  kind: RepoSymbol['kind'];
  /** Optional contextual note, e.g. a static-analysis break reason. */
  note?: string;
}

export interface RepoQaTour {
  id: RepoQaTourId;
  title: string;
  description: string;
  /** Ordered steps, each with an exact source location. */
  steps: RepoQaTourStep[];
  /** Mermaid flowchart; every locatable node carries a code:// click binding. */
  mermaid: string;
}

export interface BuildToursOptions {
  repoId: string;
  repoName?: string;
  symbols: RepoSymbol[];
  /** Max hops for the main-flow call chain (default 5). */
  maxDepth?: number;
}

const TOUR_ORDER: RepoQaTourId[] = ['auth-chain', 'main-flow', 'error-handling'];

const FILTER_SUFFIX = /Filter$/;
const INTERCEPTOR_SUFFIX = /Interceptor$/;
const FILTER_INTERFACES = /Filter/;
const INTERCEPTOR_INTERFACES = /Interceptor/;
const FILTER_ENTRY_METHODS = ['doFilter'];
const INTERCEPTOR_ENTRY_METHODS = ['preHandle', 'preHandleAsync', 'afterCompletion'];

function byLocation(a: RepoSymbol, b: RepoSymbol): number {
  if (a.filePath !== b.filePath) return a.filePath < b.filePath ? -1 : 1;
  const lineDiff = (a.lineStart ?? 0) - (b.lineStart ?? 0);
  if (lineDiff !== 0) return lineDiff;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Methods declared inside a type (sorted by source location). */
function methodsOf(symbols: RepoSymbol[], parentType: string): RepoSymbol[] {
  return symbols
    .filter((symbol) => symbol.kind === 'method' && symbol.parentType === parentType)
    .sort(byLocation);
}

/** Pick the class entry method, preferring known lifecycle hooks. */
function entryMethod(
  symbols: RepoSymbol[],
  className: string,
  preferred: string[]
): RepoSymbol | undefined {
  const methods = methodsOf(symbols, className);
  for (const name of preferred) {
    const match = methods.find((method) => method.name === name);
    if (match) return match;
  }
  return methods[0];
}

/** Classes participating in the servlet filter chain. */
function filterClasses(symbols: RepoSymbol[]): RepoSymbol[] {
  return symbols
    .filter(
      (symbol) =>
        symbol.kind === 'class' &&
        (FILTER_SUFFIX.test(symbol.name) ||
          (symbol.interfaces ?? []).some((iface) => FILTER_INTERFACES.test(iface)))
    )
    .sort(byLocation);
}

/** Classes implementing Spring MVC handler interceptors. */
function interceptorClasses(symbols: RepoSymbol[]): RepoSymbol[] {
  return symbols
    .filter(
      (symbol) =>
        symbol.kind === 'class' &&
        (INTERCEPTOR_SUFFIX.test(symbol.name) ||
          (symbol.interfaces ?? []).some((iface) => INTERCEPTOR_INTERFACES.test(iface)))
    )
    .sort(byLocation);
}

/** @RestController / @Controller classes. */
function routeClasses(symbols: RepoSymbol[]): RepoSymbol[] {
  return symbols.filter((symbol) => symbol.kind === 'route').sort(byLocation);
}

/**
 * Issue 17 — the TS/JS anchor families, mirroring the Java ones.
 *
 * A TS repo has no Servlet Filter and no `@Controller` class: its request path is
 * a middleware chain registered with `app.use(…)`, and its entry point is the
 * module that mounts the root component. Both are facts the adapter records
 * (`USE *` route symbols for named middleware registrations, a `module` node for
 * module-level JSX edges), so these tours are built from physical anchors without
 * inventing anything.
 *
 * Test paths are filtered out of the TS families: a fixture that spins up an
 * Express app with `app.use(requestIdMiddleware)` is a test double, not this
 * repo's middleware chain (measured on this repo — the first version listed
 * `http-error.test.ts` registrations ahead of the real `http.ts` ones). The Java
 * families above keep their original behaviour, which is what keeps the Java
 * tours byte-identical.
 */
const MIDDLEWARE_PREFIX = 'USE ';

/** Middleware registrations, in source order. Registration order is execution
 * order *within a file*; across files it is file order, which the tour description
 * discloses rather than claims. */
function middlewareRegistrations(symbols: RepoSymbol[]): RepoSymbol[] {
  return symbols
    .filter(
      (symbol) =>
        symbol.kind === 'route' &&
        symbol.name.startsWith(MIDDLEWARE_PREFIX) &&
        !isTestPath(symbol.filePath)
    )
    .sort(byLocation);
}

/** HTTP routes a request can actually reach (`app.get('/x', …)`, NestJS routes) —
 * the middleware-chain counterpart of `routeMethods`, which is Java-only. */
function httpRouteSymbols(symbols: RepoSymbol[]): RepoSymbol[] {
  return symbols
    .filter(
      (symbol) =>
        symbol.kind === 'route' &&
        !symbol.name.startsWith(MIDDLEWARE_PREFIX) &&
        !isTestPath(symbol.filePath) &&
        (symbol.displayPath !== undefined || symbol.calls !== undefined)
    )
    .sort(byLocation);
}

/** Module nodes that carry module-level JSX edges (`main.tsx`'s `render(<App />)`).
 * The adapter emits one only when such an edge exists. */
function moduleNodes(symbols: RepoSymbol[]): RepoSymbol[] {
  return symbols
    .filter(
      (symbol) =>
        symbol.kind === 'module' &&
        (symbol.calls?.length ?? 0) > 0 &&
        !isTestPath(symbol.filePath)
    )
    .sort(byLocation);
}

/** Methods declared inside a route class. */
function routeMethods(symbols: RepoSymbol[]): RepoSymbol[] {
  const routeNames = new Set(routeClasses(symbols).map((symbol) => symbol.name));
  return symbols
    .filter(
      (symbol) => symbol.kind === 'method' && symbol.parentType && routeNames.has(symbol.parentType)
    )
    .sort(byLocation);
}

function resolvedDepth(trace: RepoQaTraceHop[]): number {
  return trace.filter((hop) => !hop.break).length;
}

/** Mermaid node IDs must be identifier-like; TS route symbols are named
 * `GET /owners` and `USE *`, so the label is sanitised while the physical
 * `file:line` anchor (and therefore the `code://` click binding) is unchanged. */
function nodeLabel(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(safe) ? `n${safe}` : safe;
}

interface MainFlowPick {
  symbol: RepoSymbol;
  /** Step-1 label. Java keeps `${parentType}.${name}（入口接口）` unchanged. */
  label: string;
  trace: RepoQaTraceHop[];
}

/**
 * 主业务流：对每个入口解析静态调用链，选出“深度最深”的那条。
 * 同深度时按 文件 → 行号 → 方法名 字典序取首个（确定性平局规则）。
 *
 * Issue 17 — Java entries are `@RestController` methods. A TS repo has no such
 * methods, so its entries are the module node that mounts the root component
 * (`main.tsx`) and the registered HTTP routes. Java wins when both exist: that is
 * the only ordering that keeps the Java output byte-identical.
 */
function pickMainFlow(symbols: RepoSymbol[], maxDepth: number): MainFlowPick | undefined {
  const javaMethods = routeMethods(symbols);
  const entries: MainFlowPick[] = javaMethods.map((method) => ({
    symbol: method,
    label: `${method.parentType}.${method.name}（入口接口）`,
    trace: []
  }));
  // Issue 17 — the TS/JS counterpart is the MOUNT chain: the module that renders
  // the root component. Registered routes are deliberately not used as a fallback
  // entry: a route whose chain does not resolve is a one-step "main flow", and a
  // tour that claims a flow it cannot show is worse than an honest empty state.
  if (entries.length === 0) {
    for (const node of moduleNodes(symbols)) {
      entries.push({
        symbol: node,
        label: `${node.name}（模块入口：挂载根组件）`,
        trace: []
      });
    }
  }

  let best: MainFlowPick | undefined;
  for (const entry of entries) {
    const trace = resolveCallChain(symbols, entry.symbol, maxDepth);
    const candidate: MainFlowPick = { ...entry, trace };
    const better =
      !best ||
      resolvedDepth(trace) > resolvedDepth(best.trace) ||
      (resolvedDepth(trace) === resolvedDepth(best.trace) && byLocation(entry.symbol, best.symbol) < 0);
    if (better) best = candidate;
  }
  return best;
}

/** @RestControllerAdvice / @ControllerAdvice classes. */
function adviceClasses(symbols: RepoSymbol[]): RepoSymbol[] {
  return symbols.filter((symbol) => symbol.kind === 'advice').sort(byLocation);
}

/* ------------------------------------------------------------------ */
/* Mermaid                                                             */
/* ------------------------------------------------------------------ */

interface MermaidNode {
  label: string;
  file?: string;
  line?: number;
}

/**
 * Build a `flowchart LR` with code:// click bindings. Node IDs equal their
 * labels so the frontend click delegation (label text → binding key) works;
 * duplicate labels get a numeric suffix (`findById`, `findById2`, ...).
 */
export function chainMermaid(nodes: MermaidNode[], breakReason?: string): string {
  if (nodes.length === 0) {
    return 'flowchart LR\n  none[暂无匹配代码]';
  }
  const lines = ['flowchart LR'];
  const used = new Map<string, number>();
  const ids: string[] = [];
  for (const node of nodes) {
    const count = used.get(node.label) ?? 0;
    used.set(node.label, count + 1);
    const id = count === 0 ? node.label : `${node.label}${count + 1}`;
    ids.push(id);
    lines.push(`  ${id}[${id}]`);
  }
  for (let index = 0; index < ids.length - 1; index += 1) {
    lines.push(`  ${ids[index]} --> ${ids[index + 1]}`);
  }
  if (breakReason && nodes.length > 0) {
    const label = breakReason.replace(/[\[\]]/g, '');
    lines.push(`  ${ids[ids.length - 1]} -->|${label}| stop[stop]`);
  }
  nodes.forEach((node, index) => {
    if (node.file && typeof node.line === 'number') {
      lines.push(`  click ${ids[index]} "code://${node.file}#${node.line}"`);
    }
  });
  return lines.join('\n');
}

function stepAt(
  index: number,
  symbol: RepoSymbol,
  label: string,
  note?: string
): RepoQaTourStep {
  return {
    step: `${index + 1}. ${label}`,
    filePath: symbol.filePath,
    lineNumber: symbol.lineStart ?? 1,
    symbol: symbol.name,
    kind: symbol.kind,
    note
  };
}

/* ------------------------------------------------------------------ */
/* Tour builders                                                       */
/* ------------------------------------------------------------------ */

function buildAuthChainTour(symbols: RepoSymbol[], main: MainFlowPick | undefined): RepoQaTour {
  const filters = filterClasses(symbols);
  const interceptors = interceptorClasses(symbols);
  // Issue 17 — the TS/JS counterpart of the filter chain is the middleware chain.
  // Only used when the Java families are absent, so Java repos are untouched.
  const middleware =
    filters.length === 0 && interceptors.length === 0 ? middlewareRegistrations(symbols) : [];
  // The endpoint is a Java route method when there is one; for a TS middleware
  // chain it is the first registered HTTP route. No fallback when neither exists:
  // a lone route is not an auth chain, and claiming one would be a fabricated step.
  const javaEndpoint = routeMethods(symbols)[0];
  const endpoint =
    javaEndpoint ??
    (middleware.length > 0 ? httpRouteSymbols(symbols)[0] : undefined);

  const nodes: MermaidNode[] = [];
  const steps: RepoQaTourStep[] = [];

  for (const filter of filters) {
    const method = entryMethod(symbols, filter.name, FILTER_ENTRY_METHODS);
    const entry = method ?? filter;
    nodes.push({ label: entry.name, file: entry.filePath, line: entry.lineStart });
    steps.push(
      stepAt(steps.length, entry, `${filter.name}.${entry.name}（认证过滤器）`)
    );
  }
  for (const interceptor of interceptors) {
    const method = entryMethod(symbols, interceptor.name, INTERCEPTOR_ENTRY_METHODS);
    const entry = method ?? interceptor;
    nodes.push({ label: entry.name, file: entry.filePath, line: entry.lineStart });
    steps.push(
      stepAt(steps.length, entry, `${interceptor.name}.${entry.name}（拦截器）`)
    );
  }
  for (const registration of middleware) {
    const handler = registration.calls?.[0]?.method;
    const label = `${registration.name}${handler ? ` → ${handler}` : ''}（中间件注册）`;
    nodes.push({ label: nodeLabel(registration.name), file: registration.filePath, line: registration.lineStart });
    steps.push(stepAt(steps.length, registration, label));
  }
  if (endpoint) {
    nodes.push({
      label: nodeLabel(endpoint.name),
      file: endpoint.filePath,
      line: endpoint.lineStart
    });
    steps.push(
      stepAt(
        steps.length,
        endpoint,
        endpoint.kind === 'route'
          ? `${endpoint.name}（${middleware.length > 0 ? '中间件后的首个路由' : '注册路由'}）`
          : `${endpoint.parentType}.${endpoint.name}（受保护端点）`
      )
    );
  }

  return {
    id: 'auth-chain',
    title: middleware.length > 0 ? '鉴权与中间件链' : '鉴权与拦截链',
    description:
      middleware.length > 0
        ? '按源码顺序列出注册的中间件——注册顺序即执行顺序（跨文件注册时顺序按文件路径排序，静态无法确定的部分不作宣称）——再指向其后的首个路由。'
        : '从 HTTP 过滤器到拦截器再到受保护业务端点，理解请求如何经过每一道鉴权关卡。',
    steps,
    mermaid: chainMermaid(nodes)
  };
}

/**
 * Issue 17 — the mount chain: walk module-level JSX edges down through the
 * component tree.
 *
 * `resolveCallChain` is not used here on purpose. A module's calls include library
 * wrappers (`render(<StrictMode><App /></StrictMode>)` lists `StrictMode` first),
 * and the shared chain resolver stops at the first hop it cannot bind — so the
 * mount chain died on `StrictMode` after two steps. This walk takes the first call
 * that RESOLVES, in source order, which is deterministic and skips the wrappers:
 * module(main.tsx) → App → RepoProvider → … up to `maxDepth`.
 */
function walkMountChain(
  symbols: RepoSymbol[],
  start: RepoSymbol,
  index: SymbolIndex,
  maxDepth: number
): RepoQaTraceHop[] {
  const hops: RepoQaTraceHop[] = [
    { file: start.filePath, method: start.name, line: start.lineStart ?? 1 }
  ];
  let current = start;
  const seen = new Set<string>([start.filePath + '#' + start.name]);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    let next: RepoSymbol | undefined;
    let nextLine: number | undefined;
    for (const call of current.calls ?? []) {
      if (call.dynamic) continue;
      const resolved = resolveCallEdge(index, current, call);
      if (!('target' in resolved)) continue;
      const key = resolved.target.filePath + '#' + resolved.target.name;
      if (seen.has(key)) continue;
      next = resolved.target;
      nextLine = call.line;
      break;
    }
    if (!next) break;
    seen.add(next.filePath + '#' + next.name);
    hops.push({ file: next.filePath, method: next.name, line: next.lineStart ?? 1, callLine: nextLine });
    current = next;
  }
  return hops;
}

function buildMainFlowTour(symbols: RepoSymbol[], maxDepth: number): RepoQaTour {
  const main = pickMainFlow(symbols, maxDepth);
  const isMountChain = main?.symbol.kind === 'module';

  const steps: RepoQaTourStep[] = [];
  const nodes: MermaidNode[] = [];
  let breakReason: string | undefined;

  if (main) {
    const start = main.symbol;
    nodes.push({ label: nodeLabel(start.name), file: start.filePath, line: start.lineStart });
    steps.push(stepAt(steps.length, start, main.label));
    const trace = isMountChain
      ? walkMountChain(symbols, start, buildCallIndex(symbols), maxDepth)
      : main.trace;
    for (const hop of trace.slice(1)) {
      const line = hop.break ? (hop.callLine ?? hop.line) : hop.line;
      if (hop.break) {
        breakReason = hop.reason ?? 'Static Analysis Break';
        steps.push(
          stepAt(steps.length, { ...start, filePath: hop.file, lineStart: line, name: hop.method }, `${hop.method}（${breakReason}）`),
        );
      } else {
        nodes.push({ label: nodeLabel(hop.method), file: hop.file, line: hop.line });
        steps.push(stepAt(steps.length, symbolFromHop(symbols, hop), `${hop.method}`));
      }
    }
  }

  return {
    id: 'main-flow',
    title: isMountChain ? '挂载链' : '核心主业务流',
    description: isMountChain
      ? '从挂载根组件的模块入口出发，沿静态可解析的调用与组件边逐层下钻（取每处首个可解析的边；库包装如 `<StrictMode>` 不参与，因为它在本仓没有声明）。'
      : '从调用深度最深的 REST 端点出发，沿静态可解析调用链逐层下钻到服务与数据层。',
    steps,
    mermaid: chainMermaid(nodes, breakReason)
  };
}

function symbolFromHop(symbols: RepoSymbol[], hop: RepoQaTraceHop): RepoSymbol {
  const found = symbols.find(
    (symbol) =>
      symbol.kind === 'method' && symbol.filePath === hop.file && symbol.name === hop.method
  );
  return (
    found ?? {
      repoId: '',
      kind: 'method',
      name: hop.method,
      filePath: hop.file,
      lineStart: hop.line ?? 1
    }
  );
}

function buildErrorHandlingTour(symbols: RepoSymbol[]): RepoQaTour {
  const adviceClassesList = adviceClasses(symbols);

  const steps: RepoQaTourStep[] = [];
  const nodes: MermaidNode[] = [];

  for (const advice of adviceClassesList) {
    nodes.push({ label: advice.name, file: advice.filePath, line: advice.lineStart });
    steps.push(
      stepAt(steps.length, advice, `${advice.name}（全局异常入口）`)
    );
    for (const method of methodsOf(symbols, advice.name)) {
      nodes.push({ label: method.name, file: method.filePath, line: method.lineStart });
      steps.push(stepAt(steps.length, method, `${advice.name}.${method.name}（异常处理器）`));
    }
  }

  return {
    id: 'error-handling',
    title: '全局异常拦截',
    description: '从 @RestControllerAdvice 入口到每个 @ExceptionHandler，了解异常的统一出口。',
    steps,
    mermaid: chainMermaid(nodes)
  };
}

export function buildTours(options: BuildToursOptions): RepoQaTour[] {
  const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 5, 20));
  const main = pickMainFlow(options.symbols, maxDepth);
  const byId: Record<RepoQaTourId, RepoQaTour> = {
    'auth-chain': buildAuthChainTour(options.symbols, main),
    'main-flow': buildMainFlowTour(options.symbols, maxDepth),
    'error-handling': buildErrorHandlingTour(options.symbols)
  };
  return TOUR_ORDER.map((id) => byId[id]);
}