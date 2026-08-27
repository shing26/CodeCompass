import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/javascript';
import type { RepoSymbol, RepoSymbolCall } from '../repoqa-repos';
import { joinRoutePath } from './JavaAdapter';
import type { LanguageAdapter } from './LanguageAdapter';

/**
 * Issue 25 — TypeScript/JavaScript adapter.
 *
 * Uses the requested `@lezer/javascript` grammar for class/function/method and
 * call-expression extraction. The JS grammar does not understand TS-only
 * constructs (`interface`, `type` aliases, decorators, type annotations), so
 * those are handled conservatively: decorators are read from the tree where
 * present, and `interface`/`type` declarations are recovered from a
 * comment/string-masked view of the source with the same line numbers.
 */

const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const EXPRESS_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'all', 'use']);
const AXIOS_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);
const HTTP_VERB_ANNOTATIONS = new Set([
  'Get',
  'Post',
  'Put',
  'Delete',
  'Patch',
  'All',
  'Options',
  'Head'
]);

interface MethodScope {
  params: Map<string, string>;
  locals: Map<string, string>;
}

interface TypeRecord {
  name: string;
  kind: RepoSymbol['kind'];
  prefix?: string;
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
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\(["'\\])/g, '$1');
  }
  return trimmed;
}

/** First string argument of a call, e.g. the path in `app.get('/owners', fn)`. */
function firstStringArg(node: SyntaxNode, source: string): string | undefined {
  const argList = node.getChild('ArgList');
  if (!argList) return undefined;
  let child = argList.firstChild;
  while (child) {
    if (child.name === 'String') return unquote(textOf(child, source));
    if (child.name === ',') return undefined;
    child = child.nextSibling;
  }
  return undefined;
}

function firstArgumentNode(node: SyntaxNode): SyntaxNode | undefined {
  const argList = node.getChild('ArgList');
  if (!argList) return undefined;
  let child = argList.firstChild;
  while (child) {
    if (child.name !== '(' && child.name !== ')' && child.name !== ',') return child;
    child = child.nextSibling;
  }
  return undefined;
}

/** Turn a string/template/concatenation expression into a path pattern. */
function dynamicPathPattern(node: SyntaxNode | undefined, source: string): string | undefined {
  if (!node) return undefined;
  if (node.name === 'String') return unquote(textOf(node, source));
  const raw = textOf(node, source);
  const tokens =
    raw.match(
      /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|\d+|[A-Za-z_$][\w$]*/g
    ) ?? [];
  if (tokens.length === 0) return undefined;
  const joined = tokens
    .map((token) => {
      if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'"))
      ) {
        return unquote(token);
      }
      if (token.startsWith('`') && token.endsWith('`')) {
        return token
          .slice(1, -1)
          .replace(/\$\{([^}]*)\}/g, (_, expression: string) => {
            const name = /[A-Za-z_$][\w$]*/.exec(expression.trim())?.[0] ?? 'id';
            return `{${name}}`;
          });
      }
      if (/^\d+$/.test(token)) return '{id}';
      if (token.includes('.')) {
        const property = token.split('.').pop();
        return property ? `{${property}}` : '{id}';
      }
      return `{${token}}`;
    })
    .join('');
  return joined || undefined;
}

function requestMethod(node: SyntaxNode, source: string): string | undefined {
  const args = argumentNodes(node);
  const options = args[1];
  if (!options) return undefined;
  const match = /method\s*:\s*["']([A-Za-z]+)["']/.exec(textOf(options, source));
  return match?.[1].toUpperCase();
}

function joinHttpUrl(baseUrl: string | undefined, path: string): string {
  if (!baseUrl || /^https?:\/\//i.test(path)) return path;
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Non-punctuation arguments of a call expression. */
function argumentNodes(node: SyntaxNode): SyntaxNode[] {
  const argList = node.getChild('ArgList');
  if (!argList) return [];
  const out: SyntaxNode[] = [];
  let child = argList.firstChild;
  while (child) {
    if (child.name !== '(' && child.name !== ')' && child.name !== ',') {
      out.push(child);
    }
    child = child.nextSibling;
  }
  return out;
}

/** `this.service.findOne` → `['this', 'service', 'findOne']`. */
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
      current.name === 'this' ||
      current.name === 'super' ||
      current.name === 'PropertyName'
    ) {
      parts.push(textOf(current, source));
    }
  };
  visit(node);
  return parts;
}

function declarationName(node: SyntaxNode, source: string): string | undefined {
  let child = node.firstChild;
  while (child) {
    if (child.name === 'VariableDefinition' || child.name === 'PropertyDefinition') {
      return textOf(child, source);
    }
    child = child.nextSibling;
  }
  return undefined;
}

function typeAnnotationName(node: SyntaxNode, source: string): string | undefined {
  const annotation = node.getChild('TypeAnnotation');
  if (!annotation) return undefined;
  const typeNode = annotation.getChild('TypeName');
  const raw = typeNode ? textOf(typeNode, source) : textOf(annotation, source).replace(/^:\s*/, '');
  const simple = raw.split(/[<[(]/)[0].trim();
  return simple || undefined;
}

function decoratorNameAndValue(
  decorator: SyntaxNode,
  source: string
): { name: string; value?: string } | undefined {
  const call = decorator.getChild('CallExpression');
  const nameNode = call?.getChild('VariableName') ?? decorator.getChild('VariableName');
  const name = nameNode ? textOf(nameNode, source) : undefined;
  if (!name) return undefined;
  const argList = call?.getChild('ArgList');
  const firstString = argList?.getChildren('String')[0];
  return {
    name,
    value: firstString ? unquote(textOf(firstString, source)) : undefined
  };
}

function directDecoratorInfos(
  node: SyntaxNode,
  source: string
): Array<{ name: string; value?: string }> {
  const out: Array<{ name: string; value?: string }> = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === 'Decorator') {
      const info = decoratorNameAndValue(child, source);
      if (info) out.push(info);
    }
    child = child.nextSibling;
  }
  return out;
}

function decoratorTexts(node: SyntaxNode, source: string): string[] {
  const out: string[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === 'Decorator') out.push(textOf(child, source).trim());
    child = child.nextSibling;
  }
  return out;
}

function isRouterReceiver(receiver: string | undefined): boolean {
  if (!receiver) return false;
  return receiver === 'app' || receiver === 'router' || /^[A-Za-z_$][\w$]*Router$/.test(receiver);
}

function collectParams(node: SyntaxNode, source: string): MethodScope {
  const params = new Map<string, string>();
  const list = node.getChild('ParamList');
  if (!list) return { params, locals: new Map() };
  let child = list.firstChild;
  while (child) {
    if (child.name === 'VariableDefinition') {
      const name = textOf(child, source);
      const type = typeAnnotationName(child, source);
      if (type) params.set(name, type);
    }
    child = child.nextSibling;
  }
  return { params, locals: new Map() };
}

function receiverTypeOf(
  receiver: string | undefined,
  scope: MethodScope | undefined,
  typeStack: TypeRecord[]
): string | undefined {
  if (!receiver) return undefined;
  if (receiver === 'this') return typeStack[typeStack.length - 1]?.name;
  const local = scope?.locals.get(receiver);
  if (local) return local;
  const param = scope?.params.get(receiver);
  if (param) return param;
  for (let index = typeStack.length - 1; index >= 0; index -= 1) {
    const field = typeStack[index].fields.get(receiver);
    if (field) return field;
  }
  return undefined;
}

interface CallShape {
  parts?: string[];
  bareName?: string;
  base?: string;
  property?: string;
}

function callShape(node: SyntaxNode, source: string): CallShape {
  const first = node.firstChild;
  if (!first) return {};
  if (first.name === 'VariableName' || first.name === 'this') {
    return { bareName: textOf(first, source) };
  }
  if (first.name === 'MemberExpression') {
    const parts = memberParts(first, source);
    if (parts.length === 0) return {};
    return {
      parts,
      base: parts[0],
      property: parts[parts.length - 1]
    };
  }
  return {};
}

interface HttpClientRecord {
  baseURL?: string;
}

/** `fetch('/api/x')` / `axios.get('/api/x')` / `apiClient.post(...)` → HTTP call descriptor. */
function httpCallDescriptor(
  shape: CallShape,
  node: SyntaxNode,
  source: string,
  scope: MethodScope | undefined,
  typeStack: TypeRecord[],
  httpClients: Map<string, HttpClientRecord>
): { method: string; url: string } | undefined {
  const path = dynamicPathPattern(firstArgumentNode(node), source);
  if (!path) return undefined;

  if (shape.bareName === 'fetch') {
    return { method: 'GET', url: path };
  }
  if (shape.property === 'fetch' && (shape.base === 'window' || shape.base === 'globalThis')) {
    return { method: 'GET', url: path };
  }
  if (!shape.property) return undefined;
  const property = shape.property.toLowerCase();
  const base = shape.base ?? '';
  const client = httpClients.get(base);
  const isAxiosClient =
    base === 'axios' ||
    client !== undefined ||
    /Axios/.test(receiverTypeOf(base, scope, typeStack) ?? '') ||
    /^(api|http|client|request|fetcher)/i.test(base) ||
    /(Client|Api|Http)$/i.test(base);
  if (!isAxiosClient) return undefined;
  if (property === 'request') {
    const method = requestMethod(node, source);
    if (!method) return undefined;
    return { method, url: joinHttpUrl(client?.baseURL, path) };
  }
  if (!AXIOS_METHODS.has(property)) return undefined;
  return { method: property.toUpperCase(), url: joinHttpUrl(client?.baseURL, path) };
}

/** Mask string literals and comments with same-length spaces (offsets stable). */
function maskLiteralsAndComments(source: string): string {
  return source.replace(
    /(["'`])(?:\\.|(?!\1)[^\\\n])*\1|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match) => match.replace(/[^\n]/g, ' ')
  );
}

function findClosingBrace(masked: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < masked.length; index += 1) {
    if (masked[index] === '{') depth += 1;
    else if (masked[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return openIndex;
}

function extractTypeOnlyDeclarations(
  source: string,
  relativePath: string,
  repoId: string,
  symbols: RepoSymbol[]
): void {
  const masked = maskLiteralsAndComments(source);
  const interfaceRe =
    /\binterface\s+([A-Za-z_$][\w$]*)(?:\s*<[^>]*>)?(?:\s+extends\s+[^{]*)?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = interfaceRe.exec(masked)) !== null) {
    const open = match.index + match[0].lastIndexOf('{');
    const close = findClosingBrace(masked, open);
    const extendsMatch = /\bextends\s+([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)/.exec(
      match[0]
    );
    symbols.push({
      repoId,
      kind: 'interface',
      name: match[1],
      filePath: relativePath,
      lineStart: lineAt(source, match.index),
      lineEnd: lineAt(source, close),
      signature: source.slice(match.index, source.indexOf('\n', match.index)).trim(),
      interfaces: extendsMatch
        ? extendsMatch[1].split(',').map((name) => name.trim())
        : undefined,
      calls: []
    });
  }

  const typeAliasRe = /\btype\s+([A-Za-z_$][\w$]*)(?:\s*<[^>]*>)?\s*=\s*[\s\S]*?;/g;
  while ((match = typeAliasRe.exec(masked)) !== null) {
    symbols.push({
      repoId,
      kind: 'interface',
      name: match[1],
      filePath: relativePath,
      lineStart: lineAt(source, match.index),
      lineEnd: lineAt(source, match.index + match[0].length - 1),
      signature: source.slice(match.index, source.indexOf('\n', match.index)).trim(),
      calls: []
    });
  }
}

/**
 * Parse TypeScript/JavaScript source already in memory into the same symbol
 * table as the Java adapter. Partial syntax (e.g. TS-only constructs the JS
 * grammar rejects) yields the symbols that could be recovered instead of
 * throwing, mirroring the worker's skip-on-error philosophy at file level.
 */
export function parseTypeScriptSource(
  source: string,
  relativePath: string,
  repoId: string
): RepoSymbol[] {
  const symbols: RepoSymbol[] = [];
  extractTypeOnlyDeclarations(source, relativePath, repoId, symbols);

  const typeStack: TypeRecord[] = [];
  const methodStack: RepoSymbol[] = [];
  const scopeStack: MethodScope[] = [];
  const moduleArrowPushed: boolean[] = [];
  const httpClients = new Map<string, HttpClientRecord>();
  // The JS grammar parses a leading decorator as a bogus nameless
  // ClassDeclaration; carry its decorators forward to the real declaration.
  let pendingClassDecorators: Array<{ name: string; value?: string }> = [];
  let pendingClassDecoratorTexts: string[] = [];

  const tree = parser.parse(source);
  tree.iterate({
    enter(ref) {
      const node = ref.node;

      if (node.name === 'ClassDeclaration') {
        const name = declarationName(node, source);
        const ownDecorators = directDecoratorInfos(node, source);
        if (!name) {
          if (ownDecorators.length > 0) {
            pendingClassDecorators = ownDecorators;
            pendingClassDecoratorTexts = decoratorTexts(node, source);
          }
          return;
        }
        const decorators =
          ownDecorators.length > 0 ? ownDecorators : pendingClassDecorators;
        const annotations =
          ownDecorators.length > 0
            ? decoratorTexts(node, source)
            : pendingClassDecoratorTexts;
        pendingClassDecorators = [];
        pendingClassDecoratorTexts = [];
        const controller = decorators.find((info) => info.name === 'Controller');
        const kind: RepoSymbol['kind'] = controller
          ? 'route'
          : name.toLowerCase().endsWith('service')
            ? 'service'
            : name.toLowerCase().endsWith('repository')
              ? 'repository'
              : 'class';
        const implementsMatch = /implements\s+([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)/.exec(
          textOf(node, source)
        );
        const prefix = controller?.value;
        symbols.push({
          repoId,
          kind,
          name,
          filePath: relativePath,
          lineStart: lineAt(source, node.from),
          lineEnd: lineAt(source, Math.max(node.from, node.to - 1)),
          signature: textOf(node, source).split(/\r?\n/, 1)[0],
          interfaces: implementsMatch
            ? implementsMatch[1].split(',').map((iface) => iface.trim())
            : undefined,
          displayPath: kind === 'route' ? prefix : undefined,
          annotations
        });
        typeStack.push({ name, kind, prefix, fields: new Map() });
        return;
      }

      if (node.name === 'PropertyDeclaration' && node.parent?.name === 'ClassBody') {
        const name = declarationName(node, source);
        const parentType = typeStack[typeStack.length - 1];
        if (!name || !parentType) return;
        const type = typeAnnotationName(node, source);
        if (type) parentType.fields.set(name, type);
        symbols.push({
          repoId,
          kind: 'field',
          name,
          filePath: relativePath,
          lineStart: lineAt(source, node.from),
          lineEnd: lineAt(source, Math.max(node.from, node.to - 1)),
          parentType: parentType.name,
          type
        });
        return;
      }

      if (node.name === 'MethodDeclaration') {
        const name = declarationName(node, source);
        const parentType = typeStack[typeStack.length - 1];
        if (!name) return;
        const decorators = directDecoratorInfos(node, source);
        const routeDecorator = decorators.find((info) =>
          HTTP_VERB_ANNOTATIONS.has(info.name)
        );
        const symbol: RepoSymbol = {
          repoId,
          kind: 'method',
          name,
          filePath: relativePath,
          lineStart: lineAt(source, node.from),
          lineEnd: lineAt(source, Math.max(node.from, node.to - 1)),
          signature: textOf(node, source).split(/\r?\n/, 1)[0],
          parentType: parentType?.name,
          annotations: decoratorTexts(node, source),
          calls: []
        };
        if (parentType?.kind === 'route' && routeDecorator) {
          symbol.displayPath =
            routeDecorator.value !== undefined
              ? joinRoutePath(parentType.prefix, routeDecorator.value)
              : parentType.prefix;
        }
        symbols.push(symbol);
        methodStack.push(symbol);
        scopeStack.push(collectParams(node, source));
        return;
      }

      if (node.name === 'FunctionDeclaration') {
        const name = declarationName(node, source);
        if (!name) return;
        const symbol: RepoSymbol = {
          repoId,
          kind: 'method',
          name,
          filePath: relativePath,
          lineStart: lineAt(source, node.from),
          lineEnd: lineAt(source, Math.max(node.from, node.to - 1)),
          signature: textOf(node, source).split(/\r?\n/, 1)[0],
          calls: []
        };
        symbols.push(symbol);
        methodStack.push(symbol);
        scopeStack.push(collectParams(node, source));
        return;
      }

      if (node.name === 'VariableDeclaration') {
        const fn =
          node.getChild('ArrowFunction') ?? node.getChild('FunctionExpression');
        const def = node.getChildren('VariableDefinition')[0];
        const initCall = node.getChild('CallExpression');
        if (def && initCall) {
          const initShape = callShape(initCall, source);
          if (initShape.base === 'axios' && initShape.property === 'create') {
            const baseURL = /baseURL\s*:\s*["']([^"']+)["']/.exec(
              textOf(initCall, source)
            )?.[1];
            httpClients.set(textOf(def, source), { baseURL });
          }
        }
        if (fn && def) {
          const name = textOf(def, source);
          const symbol: RepoSymbol = {
            repoId,
            kind: 'method',
            name,
            filePath: relativePath,
            lineStart: lineAt(source, node.from),
            lineEnd: lineAt(source, Math.max(node.from, node.to - 1)),
            signature: textOf(node, source).split(/\r?\n/, 1)[0],
            calls: []
          };
          symbols.push(symbol);
          methodStack.push(symbol);
          scopeStack.push(collectParams(fn, source));
          moduleArrowPushed.push(true);
        } else {
          moduleArrowPushed.push(false);
        }
        return;
      }

      if (node.name === 'CallExpression') {
        const shape = callShape(node, source);
        const line = lineAt(source, node.from);

        if (
          shape.property &&
          EXPRESS_METHODS.has(shape.property.toLowerCase()) &&
          isRouterReceiver(shape.base)
        ) {
          const routePath = firstStringArg(node, source);
          if (routePath) {
            const routeName = `${shape.property.toUpperCase()} ${routePath}`;
            const duplicate = symbols.some(
              (symbol) =>
                symbol.kind === 'route' &&
                symbol.name === routeName &&
                symbol.lineStart === line
            );
            if (!duplicate) {
              const handlerName = argumentNodes(node)[1]?.name === 'VariableName'
                ? textOf(argumentNodes(node)[1], source)
                : undefined;
              symbols.push({
                repoId,
                kind: 'route',
                name: routeName,
                filePath: relativePath,
                lineStart: line,
                lineEnd: line,
                signature: textOf(node, source).split(/\r?\n/, 1)[0],
                displayPath: routePath,
                annotations: [`@${shape.base}.${shape.property}("${routePath}")`],
                calls: handlerName
                  ? [{ file: relativePath, method: handlerName, line, dynamic: false }]
                  : []
              });
            }
          }
          return;
        }

        if (methodStack.length === 0) return;
        const current = methodStack[methodStack.length - 1];
        const scope = scopeStack[scopeStack.length - 1];
        const http = httpCallDescriptor(shape, node, source, scope, typeStack, httpClients);

        if (http) {
          const call: RepoSymbolCall = {
            file: relativePath,
            method: http.url,
            line,
            receiver: shape.bareName ?? shape.base,
            receiverType: 'http',
            dynamic: true,
            http
          };
          const calls = current.calls ?? [];
          if (!calls.some((existing) => existing.method === call.method && existing.receiver === call.receiver)) {
            calls.push(call);
            current.calls = calls;
          }
          return;
        }

        const parts = shape.parts;
        if (!parts || parts.length < 2) return;
        const receiver =
          parts[0] === 'this' && parts.length >= 3
            ? parts[1]
            : parts.length === 2
              ? parts[0]
              : parts.slice(0, -1).join('.');
        const receiverType = receiverTypeOf(receiver, scope, typeStack);
        const call: RepoSymbolCall = {
          file: relativePath,
          method: parts[parts.length - 1],
          line,
          receiver,
          receiverType,
          dynamic: receiverType === undefined
        };
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
      if (node.name === 'ClassDeclaration') {
        if (declarationName(node, source)) typeStack.pop();
        return;
      }
      if (node.name === 'MethodDeclaration' || node.name === 'FunctionDeclaration') {
        methodStack.pop();
        scopeStack.pop();
        return;
      }
      if (node.name === 'VariableDeclaration') {
        const pushed = moduleArrowPushed.pop();
        if (pushed) {
          methodStack.pop();
          scopeStack.pop();
        }
      }
    }
  });

  return symbols;
}

export async function parseTypeScriptFile(
  filePath: string,
  repoId: string,
  root: string
): Promise<RepoSymbol[]> {
  const source = await fs.readFile(filePath, 'utf8');
  const relativePath = path.relative(root, filePath).split(path.sep).join('/');
  return parseTypeScriptSource(source, relativePath, repoId);
}

/**
 * Issue 25 — TypeScript/JavaScript family adapter. `node_modules`, `dist` and
 * friends are already excluded by `repoqa-scan.ts` before files reach here.
 */
export const TypeScriptAdapter: LanguageAdapter = {
  canParse(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return TYPESCRIPT_EXTENSIONS.has(path.extname(lower));
  },
  parseFile(filePath: string, repoId: string, root: string): Promise<RepoSymbol[]> {
    return parseTypeScriptFile(filePath, repoId, root);
  },
  parseSource(source: string, relativePath: string, repoId: string): RepoSymbol[] {
    return parseTypeScriptSource(source, relativePath, repoId);
  }
};
