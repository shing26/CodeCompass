import type {
  EvolutionChecklistItem,
  EvolutionScaffoldTemplate,
  ModuleEvolutionResult
} from '../../../packages/contracts/src/index';
import { buildFullCallersIndex, resolveCallEdge, symbolIdentity, type SymbolIndex } from './repoqa-callchain';
import type { RepoSymbol } from './repoqa-repos';
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
 */

export interface ModuleEvolutionInput {
  repoId: string;
  intentType: 'DEPRECATE' | 'EXTEND';
  targetSymbolOrModule: string;
  extensionGoal?: string;
  symbols: RepoSymbol[];
  index: SymbolIndex;
  baseUrl?: string;
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
  const injectFile = `${dir}/${baseName}Extension.java`;
  return [
    {
      suggestedPattern: 'DIRECT_INJECTION',
      filePath: injectFile,
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
  const scaffoldTemplates = scaffoldFor(pattern, primary, input.extensionGoal);

  const checklists: EvolutionChecklistItem[] = [
    {
      category: 'SERVICE',
      action: 'CREATE',
      filePath: scaffoldTemplates[0].filePath,
      description: `Create the ${pattern} scaffold beside ${primary.parentType ?? primary.name}.`
    },
    {
      category: 'SERVICE',
      action: 'MODIFY',
      filePath: primary.filePath,
      description:
        pattern === 'DIRECT_INJECTION'
          ? `Call the extension from ${primary.name} at the attach point (line ${primary.lineStart ?? 1}).`
          : `Publish the event / rely on the aspect — ${primary.name} itself stays untouched (transaction boundary${transactionBoundaries.length ? ' verified' : ' not annotated'}).`
    }
  ];

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
    cockpitDeepLink: cockpitLink(baseUrl, input.repoId, target, traceId)
  };
}
