import type { RepoSymbol } from './repoqa-repos';

/**
 * v0.6.0 (D-BE-1) — Tier 3 extractor for LARGE_GENERATED_FILE sources.
 *
 * Full Lezer/tree parsing of 3000+ line generated files (Swagger clients,
 * protobuf stubs) can stall the event loop. This pass only recovers top-level
 * declarations and route registrations via one line-oriented scan, so a file
 * stays well under the 30ms budget and the repo keeps locatable entry points.
 */

interface Tier3Decl {
  lineStart: number;
  kind: RepoSymbol['kind'];
  name: string;
  signature: string;
  parentType?: string;
  displayPath?: string;
}

function javaMethodName(line: string): string | undefined {
  return /([A-Za-z_$][\w$]*)\s*\(/.exec(line)?.[1];
}

function pythonFunctionName(line: string): string | undefined {
  return /^(?:async\s+)?def\s+([A-Za-z_][\w]*)/.exec(line.trim())?.[1];
}

/**
 * Extract only what is needed to keep a huge generated file navigable: class/
 * interface/function signatures and route registrations with physical ranges.
 */
export function parseLargeFileTier3(
  source: string,
  relativePath: string,
  repoId: string
): RepoSymbol[] {
  const lines = source.split(/\r?\n/);
  const decls: Tier3Decl[] = [];

  const javaRouteRe =
    /@(Get|Post|Put|Delete|Patch)Mapping\(\s*"([^"]+)"\s*\)/;
  const tsRouteRe =
    /(app|router)\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/;
  const pyRouteRe =
    /@(app|router)\.(get|post|put|delete|patch)\(\s*["']([^"']+)["']/;

  let pendingJavaRoute: { method: string; path: string; line: number } | undefined;
  let pendingPyRoute: { method: string; path: string; line: number } | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }

    const javaRoute = javaRouteRe.exec(trimmed);
    if (javaRoute) {
      pendingJavaRoute = {
        method: javaRoute[1].toUpperCase(),
        path: javaRoute[2],
        line: index + 1
      };
      continue;
    }

    const pyRoute = pyRouteRe.exec(trimmed);
    if (pyRoute) {
      pendingPyRoute = {
        method: pyRoute[2].toUpperCase(),
        path: pyRoute[3],
        line: index + 1
      };
      continue;
    }

    const tsRoute = tsRouteRe.exec(trimmed);
    if (tsRoute) {
      decls.push({
        lineStart: index + 1,
        kind: 'route',
        name: `${tsRoute[2].toUpperCase()} ${tsRoute[3]}`,
        signature: trimmed.slice(0, 120),
        displayPath: tsRoute[3]
      });
      pendingJavaRoute = undefined;
      pendingPyRoute = undefined;
      continue;
    }

    const javaType =
      /^(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+|static\s+)*(class|interface|enum)\s+([A-Za-z_$][\w$]*)/.exec(
        trimmed
      );
    if (javaType) {
      decls.push({
        lineStart: index + 1,
        kind: javaType[1] === 'interface' ? 'interface' : 'class',
        name: javaType[2],
        signature: trimmed.slice(0, 120)
      });
      pendingJavaRoute = undefined;
      pendingPyRoute = undefined;
      continue;
    }

    if (pendingJavaRoute) {
      const name = javaMethodName(trimmed);
      if (name) {
        decls.push({
          lineStart: pendingJavaRoute.line,
          kind: 'route',
          name: `${pendingJavaRoute.method} ${pendingJavaRoute.path}`,
          signature: trimmed.slice(0, 120),
          displayPath: pendingJavaRoute.path
        });
        pendingJavaRoute = undefined;
        continue;
      }
    }

    const tsDecl =
      /^(?:export\s+default\s+|export\s+)?(?:abstract\s+)?(?:class|interface)\s+([A-Za-z_$][\w$]*)/.exec(
        trimmed
      ) ??
      /^(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(
        trimmed
      );
    if (tsDecl) {
      const isInterface = /^export\s+default\s+|^export\s+|^abstract\s+/.test(
        trimmed
      )
        ? /interface\s+[A-Za-z_$][\w$]*/.test(trimmed)
        : trimmed.startsWith('interface');
      decls.push({
        lineStart: index + 1,
        kind: isInterface ? 'interface' : /function/.test(trimmed) ? 'method' : 'class',
        name: tsDecl[1],
        signature: trimmed.slice(0, 120)
      });
      pendingJavaRoute = undefined;
      pendingPyRoute = undefined;
      continue;
    }

    const pyName = pythonFunctionName(trimmed);
    if (pyName) {
      if (pendingPyRoute) {
        decls.push({
          lineStart: pendingPyRoute.line,
          kind: 'route',
          name: `${pendingPyRoute.method} ${pendingPyRoute.path}`,
          signature: trimmed.slice(0, 120),
          displayPath: pendingPyRoute.path,
          parentType: pyName
        });
      } else {
        decls.push({
          lineStart: index + 1,
          kind: 'method',
          name: pyName,
          signature: trimmed.slice(0, 120)
        });
      }
      pendingJavaRoute = undefined;
      pendingPyRoute = undefined;
      continue;
    }

    const pyClass = /^class\s+([A-Za-z_][\w]*)/.exec(trimmed);
    if (pyClass) {
      decls.push({
        lineStart: index + 1,
        kind: 'class',
        name: pyClass[1],
        signature: trimmed.slice(0, 120)
      });
      pendingJavaRoute = undefined;
      pendingPyRoute = undefined;
      continue;
    }

    const goType = /^type\s+([A-Za-z_][\w]*)\s+(struct|interface)\b/.exec(trimmed);
    if (goType) {
      decls.push({
        lineStart: index + 1,
        kind: goType[2] === 'interface' ? 'interface' : 'class',
        name: goType[1],
        signature: trimmed.slice(0, 120)
      });
      pendingJavaRoute = undefined;
      pendingPyRoute = undefined;
      continue;
    }

    const goFunc =
      /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_][\w]*)/.exec(trimmed);
    if (goFunc) {
      decls.push({
        lineStart: index + 1,
        kind: 'method',
        name: goFunc[1],
        signature: trimmed.slice(0, 120)
      });
      pendingJavaRoute = undefined;
      pendingPyRoute = undefined;
    }
  }

  decls.sort((a, b) => a.lineStart - b.lineStart);
  return decls.map((decl, index) => {
    const lineEnd =
      index + 1 < decls.length
        ? Math.max(decl.lineStart, decls[index + 1].lineStart - 1)
        : Math.max(decl.lineStart, lines.length);
    return {
      repoId,
      kind: decl.kind,
      name: decl.name,
      filePath: relativePath,
      lineStart: decl.lineStart,
      lineEnd,
      signature: decl.signature,
      parentType: decl.parentType,
      displayPath: decl.displayPath,
      calls: []
    };
  });
}
