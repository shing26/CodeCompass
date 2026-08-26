import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/go';
import type { RepoSymbol, RepoSymbolCall } from '../repoqa-repos';
import { joinRoutePath } from './JavaAdapter';
import type { LanguageAdapter } from './LanguageAdapter';

/**
 * Issue 26 — Go adapter.
 *
 * Extracts struct/interface/function/method symbols plus package-level
 * constants and variables from `@lezer/go`, recognizes Gin/Fiber route
 * registration (`r.GET("/owners", handler)`, `group.POST(...)`), and records
 * method-call edges with the same receiver typing the Java adapter uses.
 */

const GO_EXTENSIONS = new Set(['.go']);
const ROUTE_VERBS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'ANY',
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'Head',
  'Options',
  'Static'
]);
const ROUTER_NAMES = new Set(['r', 'router', 'engine', 'app', 'group', 'api', 'v1', 'v2']);

interface MethodScope {
  params: Map<string, string>;
  locals: Map<string, string>;
  selfType?: string;
}

interface TypeRecord {
  name: string;
  kind: RepoSymbol['kind'];
  fields: Map<string, string>;
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function textOf(node: SyntaxNode, source: string): string {
  return source.slice(node.from, node.to);
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** `com.pkg.OwnerService` / `*ownerServiceImpl` → `OwnerService` / `ownerServiceImpl`. */
function simpleTypeName(raw: string): string {
  let current = raw.trim();
  while (current.startsWith('*')) current = current.slice(1).trim();
  const last = current.split('.').pop() ?? current;
  return last.split('[')[0].trim();
}

/** `s.repo.FindOne` → `['s', 'repo', 'FindOne']`. */
function selectorParts(node: SyntaxNode | null | undefined, source: string): string[] {
  const parts: string[] = [];
  const visit = (current: SyntaxNode | null | undefined): void => {
    if (!current) return;
    if (current.name === 'SelectorExpr') {
      let child = current.firstChild;
      while (child) {
        if (child.name === 'FieldName') parts.push(textOf(child, source));
        else visit(child);
        child = child.nextSibling;
      }
    } else if (current.name === 'VariableName' || current.name === 'FieldName') {
      parts.push(textOf(current, source));
    }
  };
  visit(node);
  return parts;
}

/** Non-punctuation arguments of a Go call. */
function argumentNodes(node: SyntaxNode): SyntaxNode[] {
  const args = node.getChild('Arguments');
  if (!args) return [];
  const out: SyntaxNode[] = [];
  let child = args.firstChild;
  while (child) {
    if (child.name !== '(' && child.name !== ')' && child.name !== ',') out.push(child);
    child = child.nextSibling;
  }
  return out;
}

/** First string argument of a call, e.g. the path in `r.GET("/owners", fn)`. */
function firstStringArg(node: SyntaxNode, source: string): string | undefined {
  const args = node.getChild('Arguments');
  if (!args) return undefined;
  let child = args.firstChild;
  while (child) {
    if (child.name === 'String') return unquote(textOf(child, source));
    if (child.name === ',') return undefined;
    child = child.nextSibling;
  }
  return undefined;
}

function collectParams(
  parameters: SyntaxNode | null | undefined,
  source: string
): Map<string, string> {
  const params = new Map<string, string>();
  if (!parameters) return params;
  let child = parameters.firstChild;
  while (child) {
    if (child.name === 'Parameter') {
      const def = child.getChild('DefName');
      const type =
        child.getChild('TypeName') ??
        child.getChild('PointerType') ??
        child.getChild('QualifiedType');
      if (def && type) params.set(textOf(def, source), simpleTypeName(textOf(type, source)));
    }
    child = child.nextSibling;
  }
  return params;
}

function isRouterBase(name: string): boolean {
  return ROUTER_NAMES.has(name) || /(?:Router|Group|Engine|App)$/.test(name);
}

function receiverTypeOf(
  scope: MethodScope | undefined,
  declaredTypes: Map<string, TypeRecord>,
  name: string
): string | undefined {
  if (scope) {
    const param = scope.params.get(name);
    if (param) return param;
    const local = scope.locals.get(name);
    if (local) return local;
  }
  if (scope?.selfType) {
    const field = declaredTypes.get(scope.selfType)?.fields.get(name);
    if (field) return field;
  }
  return undefined;
}

/** Extract the implementation type from `&ownerServiceImpl{}` style values. */
function implementationNameFromValue(
  value: SyntaxNode | null | undefined,
  source: string
): string | undefined {
  if (!value) return undefined;
  let literal: SyntaxNode | undefined;
  if (value.name === 'UnaryExp') literal = value.getChild('TypedLiteral') ?? undefined;
  else if (value.name === 'TypedLiteral') literal = value;
  if (!literal) return undefined;
  const typeNode = literal.getChild('TypeName');
  return typeNode ? simpleTypeName(textOf(typeNode, source)) : undefined;
}

/**
 * Parse Go source already in memory into the same symbol table as the Java and
 * TypeScript adapters. A single malformed construct does not abort the whole
 * file; recoverable declarations still surface.
 */
export function parseGoSource(
  source: string,
  relativePath: string,
  repoId: string
): RepoSymbol[] {
  const symbols: RepoSymbol[] = [];
  const declaredTypes = new Map<string, TypeRecord>();
  const methodStack: RepoSymbol[] = [];
  const scopeStack: MethodScope[] = [];
  const routerScopes: Array<Map<string, string | undefined>> = [];
  const moduleRouters = new Map<string, string | undefined>();
  const inferredImpls: Array<{ iface: string; impl: string }> = [];
  let functionDepth = 0;

  const tree = parser.parse(source);
  tree.iterate({
    enter(ref) {
      const node = ref.node;

      if (node.name === 'TypeDecl') {
        const spec = node.getChild('TypeSpec');
        const def = spec?.getChild('DefName');
        if (!spec || !def) return;
        const name = textOf(def, source);
        const struct = spec.getChild('StructType');
        const iface = spec.getChild('InterfaceType');
        if (!struct && !iface) return; // type alias / named primitive
        const kind: RepoSymbol['kind'] = iface
          ? 'interface'
          : name.toLowerCase().endsWith('service')
            ? 'service'
            : name.toLowerCase().endsWith('repository')
              ? 'repository'
              : 'class';
        symbols.push({
          repoId,
          kind,
          name,
          filePath: relativePath,
          lineStart: lineAt(source, spec.from),
          lineEnd: lineAt(source, Math.max(spec.from, spec.to - 1)),
          signature: textOf(node, source).split(/\r?\n/, 1)[0],
          calls: []
        });
        declaredTypes.set(name, { name, kind, fields: new Map() });
        return;
      }

      if (node.name === 'FieldDecl' && node.parent?.name === 'StructBody') {
        const parentType = enclosingTypeName(node, source);
        if (!parentType) return;
        const record = declaredTypes.get(parentType);
        const typeNode = node.getChild('TypeName');
        const type = typeNode ? simpleTypeName(textOf(typeNode, source)) : undefined;
        for (const fieldName of node.getChildren('FieldName')) {
          const fieldNameText = textOf(fieldName, source);
          if (type) record?.fields.set(fieldNameText, type);
          symbols.push({
            repoId,
            kind: 'field',
            name: fieldNameText,
            filePath: relativePath,
            lineStart: lineAt(source, fieldName.from),
            lineEnd: lineAt(source, Math.max(fieldName.from, node.to - 1)),
            parentType,
            type
          });
        }
        return;
      }

      if (node.name === 'MethodElem' && node.parent?.name === 'InterfaceBody') {
        const parentType = enclosingTypeName(node, source);
        const fieldName = node.getChild('FieldName');
        if (!parentType || !fieldName) return;
        const name = textOf(fieldName, source);
        symbols.push({
          repoId,
          kind: 'method',
          name,
          filePath: relativePath,
          lineStart: lineAt(source, fieldName.from),
          lineEnd: lineAt(source, Math.max(fieldName.from, node.to - 1)),
          signature: textOf(node, source).split(/\r?\n/, 1)[0],
          parentType,
          calls: []
        });
        return;
      }

      if (node.name === 'MethodDecl') {
        const fieldName = node.getChild('FieldName');
        if (!fieldName) return;
        const name = textOf(fieldName, source);
        const parameterLists = node.getChildren('Parameters');
        const receiver = collectParams(parameterLists[0], source);
        const receiverType = [...receiver.values()][0];
        const params = collectParams(parameterLists[1], source);
        const symbol: RepoSymbol = {
          repoId,
          kind: 'method',
          name,
          filePath: relativePath,
          lineStart: lineAt(source, fieldName.from),
          lineEnd: lineAt(source, Math.max(fieldName.from, node.to - 1)),
          signature: textOf(node, source).split(/\r?\n/, 1)[0],
          parentType: receiverType,
          calls: []
        };
        symbols.push(symbol);
        methodStack.push(symbol);
        scopeStack.push({
          params: new Map([...receiver, ...params]),
          locals: new Map(),
          selfType: receiverType
        });
        routerScopes.push(new Map());
        functionDepth += 1;
        return;
      }

      if (node.name === 'FunctionDecl') {
        const def = node.getChild('DefName');
        if (!def) return;
        const name = textOf(def, source);
        const symbol: RepoSymbol = {
          repoId,
          kind: 'method',
          name,
          filePath: relativePath,
          lineStart: lineAt(source, def.from),
          lineEnd: lineAt(source, Math.max(def.from, node.to - 1)),
          signature: textOf(node, source).split(/\r?\n/, 1)[0],
          calls: []
        };
        symbols.push(symbol);
        methodStack.push(symbol);
        scopeStack.push({
          params: collectParams(node.getChild('Parameters'), source),
          locals: new Map()
        });
        routerScopes.push(new Map());
        functionDepth += 1;
        return;
      }

      if (node.name === 'ConstDecl') {
        if (functionDepth > 0) return;
        for (const spec of node.getChildren('ConstSpec')) {
          const typeNode = spec.getChild('TypeName');
          const type = typeNode ? simpleTypeName(textOf(typeNode, source)) : undefined;
          for (const def of spec.getChildren('DefName')) {
            symbols.push({
              repoId,
              kind: 'field',
              name: textOf(def, source),
              filePath: relativePath,
              lineStart: lineAt(source, def.from),
              lineEnd: lineAt(source, Math.max(def.from, spec.to - 1)),
              type,
              signature: textOf(spec, source).split(/\r?\n/, 1)[0]
            });
          }
        }
        return;
      }

      if (node.name === 'VarDecl') {
        const spec = node.getChild('VarSpec');
        const typeNode = spec?.getChild('TypeName') ?? node.getChild('TypeName');
        const type = typeNode ? simpleTypeName(textOf(typeNode, source)) : undefined;
        if (functionDepth === 0 && spec) {
          for (const def of spec.getChildren('DefName')) {
            symbols.push({
              repoId,
              kind: 'field',
              name: textOf(def, source),
              filePath: relativePath,
              lineStart: lineAt(source, def.from),
              lineEnd: lineAt(source, Math.max(def.from, spec.to - 1)),
              type,
              signature: textOf(spec, source).split(/\r?\n/, 1)[0]
            });
          }
        }

        const scope = scopeStack[scopeStack.length - 1];
        if (scope && typeNode) {
          const resolvedType = simpleTypeName(textOf(typeNode, source));
          for (const def of node.getChildren('DefName')) {
            scope.locals.set(textOf(def, source), resolvedType);
          }
        }

        const initializer =
          spec?.getChild('CallExpr') ??
          spec?.getChild('UnaryExp') ??
          node.getChild('CallExpr') ??
          node.getChild('UnaryExp');
        if (initializer?.name === 'UnaryExp') {
          const call = initializer.getChild('CallExpr');
          if (call) registerRouterVar(node, call, source, functionDepth, routerScopes, moduleRouters);
        } else if (initializer?.name === 'CallExpr') {
          registerRouterVar(node, initializer, source, functionDepth, routerScopes, moduleRouters);
        }

        if (spec) {
          const value =
            spec.getChild('UnaryExp') ?? spec.getChild('TypedLiteral') ?? spec.getChild('CallExpr');
          const impl = implementationNameFromValue(value, source);
          const ifaceType = spec.getChild('TypeName');
          if (impl && ifaceType) {
            inferredImpls.push({
              iface: simpleTypeName(textOf(ifaceType, source)),
              impl
            });
          }
        }
        return;
      }

      if (node.name === 'CallExpr') {
        const first = node.firstChild;
        const parts = first?.name === 'SelectorExpr' ? selectorParts(first, source) : [];
        if (parts.length >= 2) {
          const base = parts[0];
          const verb = parts[parts.length - 1];
          if (ROUTE_VERBS.has(verb) && isRouterBase(base)) {
            const routePath = firstStringArg(node, source);
            if (routePath) {
              const prefix = lookupRouter(base, routerScopes, moduleRouters);
              const displayPath = joinRoutePath(prefix, routePath);
              const routeName = `${verb} ${displayPath}`;
              const handler = argumentNodes(node)[1];
              const handlerName =
                handler?.name === 'VariableName'
                  ? textOf(handler, source)
                  : handler?.name === 'SelectorExpr'
                    ? selectorParts(handler, source).pop()
                    : undefined;
              symbols.push({
                repoId,
                kind: 'route',
                name: routeName,
                filePath: relativePath,
                lineStart: lineAt(source, node.from),
                lineEnd: lineAt(source, Math.max(node.from, node.to - 1)),
                signature: textOf(node, source).split(/\r?\n/, 1)[0],
                displayPath,
                annotations: [`${base}.${verb}("${routePath}")`],
                calls: handlerName
                  ? [{ file: relativePath, method: handlerName, line: lineAt(source, node.from), dynamic: false }]
                  : []
              });
            }
            return;
          }
        }

        if (methodStack.length === 0) return;
        const current = methodStack[methodStack.length - 1];
        const scope = scopeStack[scopeStack.length - 1];
        const line = lineAt(source, node.from);
        let call: RepoSymbolCall | undefined;

        if (parts.length >= 2) {
          const receiver =
            parts.length >= 3 ? parts[1] : parts[0];
          const method = parts[parts.length - 1];
          let receiverType: string | undefined;
          if (parts.length >= 3) {
            const ownerType =
              scope?.params.get(parts[0]) ??
              scope?.locals.get(parts[0]) ??
              (scope?.selfType
                ? declaredTypes.get(scope.selfType)?.fields.get(parts[0])
                : undefined);
            receiverType = ownerType
              ? declaredTypes.get(ownerType)?.fields.get(receiver)
              : undefined;
          } else {
            receiverType = receiverTypeOf(scope, declaredTypes, receiver);
          }
          call = {
            file: relativePath,
            method,
            line,
            receiver,
            receiverType,
            dynamic: receiverType === undefined
          };
        } else if (first?.name === 'VariableName') {
          call = {
            file: relativePath,
            method: textOf(first, source),
            line,
            receiver: scope?.selfType ? 'this' : undefined,
            receiverType: scope?.selfType,
            dynamic: !scope?.selfType
          };
        }

        if (!call) return;
        const calls = current.calls ?? [];
        if (
          !calls.some(
            (existing) =>
              existing.method === call.method &&
              existing.receiver === call.receiver &&
              existing.line === call.line
          )
        ) {
          calls.push(call);
          current.calls = calls;
        }
      }
    },
    leave(ref) {
      const node = ref.node;
      if (node.name === 'MethodDecl' || node.name === 'FunctionDecl') {
        methodStack.pop();
        scopeStack.pop();
        routerScopes.pop();
        functionDepth -= 1;
      }
    }
  });

  for (const inference of inferredImpls) {
    const impl = symbols.find(
      (symbol) =>
        symbol.name === inference.impl &&
        (symbol.kind === 'class' || symbol.kind === 'service' || symbol.kind === 'repository')
    );
    if (!impl) continue;
    const interfaces = impl.interfaces ?? [];
    if (!interfaces.includes(inference.iface)) interfaces.push(inference.iface);
    impl.interfaces = interfaces;
  }

  return symbols;
}

function enclosingTypeName(node: SyntaxNode, source: string): string | undefined {
  let current = node.parent;
  while (current) {
    if (current.name === 'TypeSpec') {
      const def = current.getChild('DefName');
      return def ? textOf(def, source) : undefined;
    }
    current = current.parent;
  }
  return undefined;
}

function lookupRouter(
  name: string,
  routerScopes: Array<Map<string, string | undefined>>,
  moduleRouters: Map<string, string | undefined>
): string | undefined {
  for (let index = routerScopes.length - 1; index >= 0; index -= 1) {
    if (routerScopes[index].has(name)) return routerScopes[index].get(name);
  }
  return moduleRouters.get(name);
}

function registerRouterVar(
  varDecl: SyntaxNode,
  call: SyntaxNode,
  source: string,
  functionDepth: number,
  routerScopes: Array<Map<string, string | undefined>>,
  moduleRouters: Map<string, string | undefined>
): void {
  const spec = varDecl.getChild('VarSpec');
  const def = spec?.getChild('DefName') ?? varDecl.getChild('DefName');
  if (!def) return;
  const name = textOf(def, source);
  const parts = selectorParts(call.firstChild, source);
  if (parts.length < 2) return;
  const base = parts[0];
  const verb = parts[parts.length - 1];
  let prefix: string | undefined;
  if ((base === 'gin' && (verb === 'Default' || verb === 'New')) || (base === 'fiber' && verb === 'New')) {
    prefix = undefined;
  } else if (verb === 'Group' && isRouterBase(base)) {
    const parentPrefix = lookupRouter(base, routerScopes, moduleRouters);
    const groupPath = firstStringArg(call, source);
    prefix = groupPath ? joinRoutePath(parentPrefix, groupPath) : parentPrefix;
  } else {
    return;
  }
  const target =
    functionDepth > 0 && routerScopes.length > 0
      ? routerScopes[routerScopes.length - 1]
      : moduleRouters;
  target.set(name, prefix);
}

export async function parseGoFile(
  filePath: string,
  repoId: string,
  root: string
): Promise<RepoSymbol[]> {
  const source = await fs.readFile(filePath, 'utf8');
  const relativePath = path.relative(root, filePath).split(path.sep).join('/');
  return parseGoSource(source, relativePath, repoId);
}

/**
 * Issue 26 — Go family adapter. `vendor`, `.git` and build output directories
 * are already excluded by `repoqa-scan.ts` before files reach here.
 */
export const GoAdapter: LanguageAdapter = {
  canParse(filePath: string): boolean {
    return GO_EXTENSIONS.has(path.extname(filePath.toLowerCase()));
  },
  parseFile(filePath: string, repoId: string, root: string): Promise<RepoSymbol[]> {
    return parseGoFile(filePath, repoId, root);
  },
  parseSource(source: string, relativePath: string, repoId: string): RepoSymbol[] {
    return parseGoSource(source, relativePath, repoId);
  }
};
