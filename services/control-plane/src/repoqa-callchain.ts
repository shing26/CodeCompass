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
  /** field name → declared type name. */
  fields: Map<string, string>;
  interfaces: string[];
}

interface SymbolIndex {
  types: Map<string, TypeInfo>;
  /** interface name → class type names that implement it. */
  implsOfInterface: Map<string, string[]>;
  /** file → method name → method symbols (legacy same-file resolution). */
  methodsByFile: Map<string, Map<string, RepoSymbol[]>>;
  /** method name → method symbols (legacy global resolution). */
  methodsByName: Map<string, RepoSymbol[]>;
}

function identity(symbol: RepoSymbol): string {
  return `${symbol.filePath}:${symbol.lineStart ?? 0}:${symbol.name}`;
}

function buildIndex(symbols: RepoSymbol[]): SymbolIndex {
  const types = new Map<string, TypeInfo>();
  const implsOfInterface = new Map<string, string[]>();
  const methodsByFile = new Map<string, Map<string, RepoSymbol[]>>();
  const methodsByName = new Map<string, RepoSymbol[]>();

  for (const symbol of symbols) {
    if (TYPE_KINDS.has(symbol.kind)) {
      const info: TypeInfo = {
        symbol,
        methods: new Map(),
        fields: new Map(),
        interfaces: symbol.interfaces ?? []
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
      if (info) info.fields.set(symbol.name, symbol.type);
    }
  }

  return { types, implsOfInterface, methodsByFile, methodsByName };
}

/** Return the method symbol the trace actually starts from. */
function effectiveStart(
  symbols: RepoSymbol[],
  start: RepoSymbol,
  index: SymbolIndex
): RepoSymbol | undefined {
  if (start.kind === 'method') return start;
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
      const fieldType = index.types.get(caller.parentType)?.fields.get(call.receiver);
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

function resolveCall(
  index: SymbolIndex,
  caller: RepoSymbol,
  call: RepoSymbolCall
): ResolveResult {
  const candidateTypesList = candidateTypes(index, caller, call);
  for (const typeName of candidateTypesList) {
    const info = index.types.get(typeName);
    if (!info) continue; // unresolved/external type name

    if (info.symbol.kind === 'interface') {
      const impls = index.implsOfInterface.get(typeName) ?? [];
      if (impls.length !== 1) {
        // 0 impls (external/RPC) or multiple impls → cannot bind deterministically.
        return { reason: STATIC_ANALYSIS_BREAK_DYNAMIC };
      }
      const implInfo = index.types.get(impls[0]);
      const methods = implInfo?.methods.get(call.method) ?? [];
      if (methods.length === 0) return { reason: STATIC_ANALYSIS_BREAK_UNRESOLVED };
      return { target: pickOverload(methods, caller.filePath) };
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
  depth = 4
): RepoQaTraceHop[] {
  const index = buildIndex(symbols);
  const started = effectiveStart(symbols, start, index);
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
      const result = resolveCall(index, current, call);
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
        callLine: call.line
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