import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/python';
import type { RepoSymbol, RepoSymbolCall } from '../repoqa-repos';
import { joinRoutePath } from './JavaAdapter';
import type { LanguageAdapter } from './LanguageAdapter';

/**
 * Issue 27 — Python adapter.
 *
 * Extracts `class` / `def` / `async def` symbols with line numbers, recognizes
 * FastAPI (`@app.get`, `@router.post`) and Flask (`@app.route`) route
 * decorators, and records method-call edges with lightweight receiver typing
 * (`self.repo.find_by_id(...)`, `service.find_one(...)`).
 */

const PYTHON_EXTENSIONS = new Set(['.py']);
const HTTP_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);
const ROUTER_NAMES = new Set(['app', 'router', 'api', 'bp', 'blueprint', 'route']);

interface MethodScope {
  params: Map<string, string>;
  locals: Map<string, string>;
  selfType?: string;
}

interface ClassRecord {
  name: string;
  kind: RepoSymbol['kind'];
  fields: Map<string, string>;
}

interface RouteDecoratorInfo {
  base: string;
  method: string;
  path: string;
  displayPath: string;
  line: number;
  decoratorText: string;
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
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** `pkg.Repository` / `list[Owner]` → `Repository` / `list`. */
function simpleTypeName(raw: string): string {
  const last = raw.trim().split('.').pop() ?? raw.trim();
  return last.replace(/\[.*\]$/s, '').trim();
}

/** `self.repo.find_by_id` → `['self', 'repo', 'find_by_id']`. */
function memberParts(node: SyntaxNode, source: string): string[] {
  const parts: string[] = [];
  const visit = (current: SyntaxNode | undefined): void => {
    if (!current) return;
    if (current.name === 'MemberExpression') {
      let child = current.firstChild;
      while (child) {
        if (child.name === 'PropertyName') parts.push(textOf(child, source));
        else visit(child);
        child = child.nextSibling;
      }
    } else if (
      current.name === 'VariableName' ||
      current.name === 'PropertyName' ||
      current.name === 'self'
    ) {
      parts.push(textOf(current, source));
    }
  };
  visit(node);
  return parts;
}

function collectParams(
  paramList: SyntaxNode | null | undefined,
  source: string
): Map<string, string> {
  const params = new Map<string, string>();
  if (!paramList) return params;
  let child = paramList.firstChild;
  while (child) {
    if (child.name === 'VariableName') {
      const name = textOf(child, source);
      const typeDef = child.nextSibling?.name === 'TypeDef' ? child.nextSibling : undefined;
      const typeName = typeDef?.getChild('VariableName');
      if (typeName) params.set(name, simpleTypeName(textOf(typeName, source)));
    }
    child = child.nextSibling;
  }
  return params;
}

function isRouterBase(base: string): boolean {
  return ROUTER_NAMES.has(base) || /(?:app|router|blueprint|api)$/i.test(base);
}

/** First string literal in an argument list. */
function firstStringInArgList(argList: SyntaxNode | null | undefined, source: string): string | undefined {
  if (!argList) return undefined;
  let child = argList.firstChild;
  while (child) {
    if (child.name === 'String') return unquote(textOf(child, source));
    if (child.name === ',') return undefined;
    child = child.nextSibling;
  }
  return undefined;
}

/** Keyword string argument such as `prefix="/api"` / `url_prefix="/auth"`. */
function keywordStringArg(
  call: SyntaxNode | undefined,
  source: string,
  names: string[]
): string | undefined {
  const argList = call?.getChild('ArgList');
  if (!argList) return undefined;
  let child = argList.firstChild;
  while (child) {
    if (child.name === 'VariableName' && names.includes(textOf(child, source))) {
      let next = child.nextSibling;
      while (next) {
        if (next.name === 'String') return unquote(textOf(next, source));
        if (next.name === ',') break;
        next = next.nextSibling;
      }
    }
    child = child.nextSibling;
  }
  return undefined;
}

function routeDecoratorInfo(
  decorator: SyntaxNode,
  source: string
): { base: string; method: string; path?: string } | undefined {
  const names: string[] = [];
  let child = decorator.firstChild;
  while (child) {
    if (child.name === 'VariableName') names.push(textOf(child, source));
    child = child.nextSibling;
  }
  if (names.length < 2) return undefined;
  const base = names[0];
  const method = names[names.length - 1];
  if (!isRouterBase(base)) return undefined;
  if (!HTTP_VERBS.has(method.toLowerCase()) && method !== 'route') return undefined;
  return {
    base,
    method,
    path: firstStringInArgList(decorator.getChild('ArgList'), source)
  };
}

function receiverTypeOf(
  name: string,
  scope: MethodScope | undefined,
  classStack: ClassRecord[]
): string | undefined {
  if (scope) {
    const param = scope.params.get(name);
    if (param) return param;
    const local = scope.locals.get(name);
    if (local) return local;
  }
  const current = classStack[classStack.length - 1];
  return current?.fields.get(name);
}

/**
 * Parse Python source already in memory into the same symbol table as the
 * other language adapters. Recoverable constructs are kept even when a file
 * contains syntax the grammar marks as an error.
 */
export function parsePythonSource(
  source: string,
  relativePath: string,
  repoId: string
): RepoSymbol[] {
  const symbols: RepoSymbol[] = [];
  const classStack: ClassRecord[] = [];
  const methodStack: RepoSymbol[] = [];
  const scopeStack: MethodScope[] = [];
  const routerPrefixes = new Map<string, string | undefined>();
  const emittedFields = new Set<string>();
  let pendingRoute: RouteDecoratorInfo | undefined;

  const tree = parser.parse(source);
  tree.iterate({
    enter(ref) {
      const node = ref.node;

      if (node.name === 'AssignStatement') {
        const target = node.getChild('VariableName');
        const call = node.getChild('CallExpression');
        if (target && call) {
          const ctor = call.getChild('VariableName');
          const ctorName = ctor ? textOf(ctor, source) : undefined;
          if (ctorName === 'FastAPI' || ctorName === 'APIRouter' || ctorName === 'Blueprint') {
            const prefix =
              ctorName === 'FastAPI'
                ? undefined
                : keywordStringArg(call, source, ['prefix', 'url_prefix']);
            routerPrefixes.set(textOf(target, source), prefix);
          }
        }

        const scope = scopeStack[scopeStack.length - 1];
        const currentClass = classStack[classStack.length - 1];
        const member = node.getChild('MemberExpression');
        const memberPartsList = member ? memberParts(member, source) : [];
        if (scope && memberPartsList[0] === 'self' && memberPartsList.length >= 2) {
          const fieldName = memberPartsList[1];
          const type = inferredAssignmentType(node, source, scope, currentClass);
          if (currentClass && type) currentClass.fields.set(fieldName, type);
          const key = `${currentClass?.name ?? ''}:${fieldName}`;
          if (!emittedFields.has(key)) {
            emittedFields.add(key);
            symbols.push({
              repoId,
              kind: 'field',
              name: fieldName,
              filePath: relativePath,
              lineStart: lineAt(source, member?.from ?? node.from),
              lineEnd: lineAt(source, Math.max(member?.from ?? node.from, node.to - 1)),
              parentType: currentClass?.name,
              type
            });
          }
        } else if (scope && target) {
          const type = inferredAssignmentType(node, source, scope, currentClass);
          if (type) scope.locals.set(textOf(target, source), type);
        }
        return;
      }

      if (node.name === 'ClassDefinition') {
        const name = node.getChild('VariableName');
        if (!name) return;
        const className = textOf(name, source);
        const kind: RepoSymbol['kind'] = className.toLowerCase().endsWith('service')
          ? 'service'
          : className.toLowerCase().endsWith('repository')
            ? 'repository'
            : 'class';
        symbols.push({
          repoId,
          kind,
          name: className,
          filePath: relativePath,
          lineStart: lineAt(source, node.from),
          lineEnd: lineAt(source, Math.max(node.from, node.to - 1)),
          signature: textOf(node, source).split(/\r?\n/, 1)[0],
          calls: []
        });
        classStack.push({ name: className, kind, fields: new Map() });
        return;
      }

      if (node.name === 'DecoratedStatement') {
        const decorator = node.getChild('Decorator');
        pendingRoute = undefined;
        if (decorator) {
          const info = routeDecoratorInfo(decorator, source);
          if (info && info.path) {
            const prefix = routerPrefixes.get(info.base);
            pendingRoute = {
              base: info.base,
              method: info.method,
              path: info.path,
              displayPath: joinRoutePath(prefix, info.path),
              line: lineAt(source, decorator.from),
              decoratorText: textOf(decorator, source).trim()
            };
          }
        }
        return;
      }

      if (node.name === 'FunctionDefinition') {
        const name = node.getChild('VariableName');
        if (!name) return;
        const functionName = textOf(name, source);
        const parentType = classStack[classStack.length - 1]?.name;
        const symbol: RepoSymbol = {
          repoId,
          kind: 'method',
          name: functionName,
          filePath: relativePath,
          lineStart: lineAt(source, node.from),
          lineEnd: lineAt(source, Math.max(node.from, node.to - 1)),
          signature: textOf(node, source).split(/\r?\n/, 1)[0],
          parentType,
          calls: []
        };
        if (pendingRoute) {
          symbol.displayPath = pendingRoute.displayPath;
          symbol.annotations = [pendingRoute.decoratorText];
          const routeMethod =
            pendingRoute.method === 'route'
              ? 'route'
              : pendingRoute.method.toUpperCase();
          symbols.push({
            repoId,
            kind: 'route',
            name: `${routeMethod} ${pendingRoute.displayPath}`,
            filePath: relativePath,
            lineStart: pendingRoute.line,
            lineEnd: lineAt(source, Math.max(node.from, node.to - 1)),
            signature: `${pendingRoute.decoratorText} ${functionName}()`,
            displayPath: pendingRoute.displayPath,
            annotations: [pendingRoute.decoratorText],
            calls: [
              {
                file: relativePath,
                method: functionName,
                line: lineAt(source, name.from),
                dynamic: false
              }
            ]
          });
          pendingRoute = undefined;
        }
        symbols.push(symbol);
        methodStack.push(symbol);
        scopeStack.push({
          params: collectParams(node.getChild('ParamList'), source),
          locals: new Map(),
          selfType: parentType
        });
        return;
      }

      if (node.name === 'CallExpression' && methodStack.length > 0) {
        const first = node.firstChild;
        const current = methodStack[methodStack.length - 1];
        const scope = scopeStack[scopeStack.length - 1];
        const line = lineAt(source, node.from);
        let call: RepoSymbolCall | undefined;

        if (first?.name === 'VariableName') {
          const bareName = textOf(first, source);
          if (
            symbols.some(
              (symbol) =>
                symbol.name === bareName &&
                (symbol.kind === 'class' ||
                  symbol.kind === 'interface' ||
                  symbol.kind === 'service' ||
                  symbol.kind === 'repository')
            )
          ) {
            return;
          }
          call = {
            file: relativePath,
            method: bareName,
            line,
            receiver: scope?.selfType ? 'this' : undefined,
            receiverType: scope?.selfType,
            dynamic: !scope?.selfType
          };
        } else if (first?.name === 'MemberExpression') {
          const parts = memberParts(first, source);
          if (parts.length >= 2) {
            const method = parts[parts.length - 1];
            let receiver: string;
            let receiverType: string | undefined;
            if (parts[0] === 'self' && parts.length >= 3) {
              receiver = parts[1];
              receiverType = classStack[classStack.length - 1]?.fields.get(receiver);
            } else if (parts.length >= 3) {
              receiver = parts[1];
              const ownerType =
                scope?.params.get(parts[0]) ??
                scope?.locals.get(parts[0]) ??
                (scope?.selfType
                  ? classStack[classStack.length - 1]?.fields.get(parts[0])
                  : undefined);
              receiverType = ownerType
                ? (classStack.find((record) => record.name === ownerType)?.fields.get(receiver) ??
                  receiverTypeOf(receiver, scope, classStack))
                : undefined;
            } else {
              receiver = parts[0];
              receiverType = receiverTypeOf(receiver, scope, classStack);
            }
            call = {
              file: relativePath,
              method,
              line,
              receiver,
              receiverType,
              dynamic: receiverType === undefined
            };
          }
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
      if (node.name === 'ClassDefinition') {
        classStack.pop();
      } else if (node.name === 'FunctionDefinition') {
        methodStack.pop();
        scopeStack.pop();
      }
    }
  });

  return symbols;
}

function inferredAssignmentType(
  node: SyntaxNode,
  source: string,
  scope: MethodScope | undefined,
  currentClass: ClassRecord | undefined
): string | undefined {
  const typeDef = node.getChild('TypeDef');
  const typeName = typeDef?.getChild('VariableName');
  if (typeName) return simpleTypeName(textOf(typeName, source));

  const value = node.getChild('CallExpression') ?? node.getChild('VariableName');
  if (!value) return undefined;
  if (value.name === 'CallExpression') {
    const base = value.getChild('VariableName');
    return base ? simpleTypeName(textOf(base, source)) : undefined;
  }
  const valueName = textOf(value, source);
  if (scope) {
    const param = scope.params.get(valueName);
    if (param) return param;
    const local = scope.locals.get(valueName);
    if (local) return local;
  }
  if (currentClass) {
    const field = currentClass.fields.get(valueName);
    if (field) return field;
  }
  return undefined;
}

export async function parsePythonFile(
  filePath: string,
  repoId: string,
  root: string
): Promise<RepoSymbol[]> {
  const source = await fs.readFile(filePath, 'utf8');
  const relativePath = path.relative(root, filePath).split(path.sep).join('/');
  return parsePythonSource(source, relativePath, repoId);
}

/**
 * Issue 27 — Python family adapter. `.venv`, `venv` and `__pycache__` are
 * already excluded by `repoqa-scan.ts` before files reach here.
 */
export const PythonAdapter: LanguageAdapter = {
  canParse(filePath: string): boolean {
    return PYTHON_EXTENSIONS.has(path.extname(filePath.toLowerCase()));
  },
  parseFile(filePath: string, repoId: string, root: string): Promise<RepoSymbol[]> {
    return parsePythonFile(filePath, repoId, root);
  },
  parseSource(source: string, relativePath: string, repoId: string): RepoSymbol[] {
    return parsePythonSource(source, relativePath, repoId);
  }
};
