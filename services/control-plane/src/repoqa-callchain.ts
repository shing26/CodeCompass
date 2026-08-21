import type { RepoSymbol } from './repoqa-repos';
import type { RepoQaTraceHop } from '../../../packages/contracts/src/index';

function identity(symbol: RepoSymbol): string {
  return `${symbol.filePath}:${symbol.lineStart ?? 0}:${symbol.name}`;
}

export function resolveCallChain(
  symbols: RepoSymbol[],
  start: RepoSymbol,
  depth = 4
): RepoQaTraceHop[] {
  const trace: RepoQaTraceHop[] = [
    { file: start.filePath, method: start.name, line: start.lineStart ?? 1 }
  ];
  const visited = new Set<string>([identity(start)]);
  let current = start;

  for (let step = 1; step <= depth; step += 1) {
    const calls = current.calls ?? [];
    if (calls.length === 0) return trace;

    let resolved = false;
    for (const call of calls) {
      const target =
        symbols.find(
          (symbol) =>
            symbol.kind === 'method' &&
            symbol.filePath === call.file &&
            symbol.name === call.method
        ) ??
        symbols.find(
          (symbol) => symbol.kind === 'method' && symbol.name === call.method
        );
      if (!target || visited.has(identity(target))) continue;

      trace.push({
        file: target.filePath,
        method: target.name,
        line: target.lineStart ?? 1
      });
      visited.add(identity(target));
      current = target;
      resolved = true;
      break;
    }

    if (!resolved) {
      const nextCall = calls[0];
      trace.push({
        file: nextCall.file,
        method: nextCall.method,
        break: true
      });
      return trace;
    }
  }

  return trace;
}
