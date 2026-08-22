import type { RepoSymbol } from './repoqa-repos';
import type { RepoQaTraceHop } from '../../../packages/contracts/src/index';
import { resolveCallChain } from './repoqa-callchain';

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

/**
 * 主业务流：对每个 @RestController 方法解析静态调用链，选出“深度最深”的
 * 接口。同深度时按 文件 → 行号 → 方法名 字典序取首个（确定性平局规则）。
 */
function pickMainFlow(
  symbols: RepoSymbol[],
  maxDepth: number
): { method: RepoSymbol; trace: RepoQaTraceHop[] } | undefined {
  let best: { method: RepoSymbol; trace: RepoQaTraceHop[] } | undefined;
  for (const method of routeMethods(symbols)) {
    const trace = resolveCallChain(symbols, method, maxDepth);
    const depth = resolvedDepth(trace);
    const better =
      !best ||
      depth > resolvedDepth(best.trace) ||
      (depth === resolvedDepth(best.trace) && byLocation(method, best.method) < 0);
    if (better) {
      best = { method, trace };
    }
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

function buildAuthChainTour(
  symbols: RepoSymbol[],
  main: { method: RepoSymbol; trace: RepoQaTraceHop[] } | undefined
): RepoQaTour {
  const filters = filterClasses(symbols);
  const interceptors = interceptorClasses(symbols);
  const endpoint = main?.method ?? routeMethods(symbols)[0];

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
  if (endpoint) {
    nodes.push({ label: endpoint.name, file: endpoint.filePath, line: endpoint.lineStart });
    steps.push(
      stepAt(steps.length, endpoint, `${endpoint.parentType}.${endpoint.name}（受保护端点）`)
    );
  }

  return {
    id: 'auth-chain',
    title: '鉴权与拦截链',
    description:
      '从 HTTP 过滤器到拦截器再到受保护业务端点，理解请求如何经过每一道鉴权关卡。',
    steps,
    mermaid: chainMermaid(nodes)
  };
}

function buildMainFlowTour(
  symbols: RepoSymbol[],
  maxDepth: number
): RepoQaTour {
  const main = pickMainFlow(symbols, maxDepth);

  const steps: RepoQaTourStep[] = [];
  const nodes: MermaidNode[] = [];
  let breakReason: string | undefined;

  if (main) {
    const start = main.method;
    nodes.push({ label: start.name, file: start.filePath, line: start.lineStart });
    steps.push(
      stepAt(steps.length, start, `${start.parentType}.${start.name}（入口接口）`)
    );
    for (const hop of main.trace.slice(1)) {
      const line = hop.break ? (hop.callLine ?? hop.line) : hop.line;
      if (hop.break) {
        breakReason = hop.reason ?? 'Static Analysis Break';
        steps.push(
          stepAt(steps.length, { ...start, filePath: hop.file, lineStart: line, name: hop.method }, `${hop.method}（${breakReason}）`),
        );
      } else {
        nodes.push({ label: hop.method, file: hop.file, line: hop.line });
        steps.push(stepAt(steps.length, symbolFromHop(symbols, hop), `${hop.method}`));
      }
    }
  }

  return {
    id: 'main-flow',
    title: '核心主业务流',
    description:
      '从调用深度最深的 REST 端点出发，沿静态可解析调用链逐层下钻到服务与数据层。',
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