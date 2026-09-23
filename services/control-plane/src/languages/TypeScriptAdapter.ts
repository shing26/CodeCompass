import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/javascript';
import type { RepoSymbol, RepoSymbolCall } from '../ingest/repoqa-repos';
import { joinRoutePath } from './JavaAdapter';
import { TYPESCRIPT_EXTENSIONS } from './language-extensions';
import type { LanguageAdapter } from './LanguageAdapter';

/**
 * Issue 25 — TypeScript/JavaScript adapter.
 *
 * Uses `@lezer/javascript` for class/function/method and call-expression
 * extraction. V31-02 turned on the `jsx ts` dialects: the plain JS grammar
 * rejected annotations and JSX as syntax errors (probe: 9 error nodes in an
 * 8-token `.tsx` snippet), which truncated symbol extraction on exactly the
 * files this adapter exists for and hid React usage from the call graph.
 * `interface`/`type` declarations are still recovered from a
 * comment/string-masked view of the source — the AST path does not emit those
 * kinds, so the two never double-count.
 */

// Issue 09: extension list lives in language-extensions.ts (single source,
// shared with the registry and the scan-side SOURCE_EXTENSIONS).
const TYPESCRIPT_PARSER = parser.configure({ dialect: 'jsx ts' });
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
  params: Map<string, ReceiverType>;
  locals: Map<string, ReceiverType>;
  /** Issue 11 — every name bound in this scope, typed or not. The shadowing
   * fence: a receiver lookup stops at the nearest scope that DECLARES the
   * name, even when that binding carries no type, so an untyped inner
   * declaration can never be "revived" by a typed outer one (the same
   * fail-closed rule the Go adapter adopted in V31-02). */
  declared: Set<string>;
  /** Enclosing function scope (closure semantics). Nested arrows assigned to
   * consts get their own scope, so lookups must be able to walk outward. */
  parent?: MethodScope;
}

/**
 * Issue 18(g) — a resolved receiver type, optionally RESTRICTED to the members
 * an annotation actually exposes (`Pick<T, 'a' | 'b'>`).
 *
 * Why the restriction is not optional: expanding `Pick<T, K>` to plain `T`
 * would let a call to a member outside `K` resolve into a real edge — trading
 * a false positive for a false NEGATIVE, which is the worse failure (ADR-0002:
 * unresolved stays `dynamic`, never guessed). So the allowed set travels with
 * the type and a call outside it stays dynamic.
 */
interface ReceiverType {
  name: string;
  allowed?: ReadonlySet<string>;
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

/** Extract the type name out of a TypeAnnotation node. */
function typeNameFromAnnotation(annotation: SyntaxNode, source: string): string | undefined {
  const typeNode = annotation.getChild('TypeName');
  const raw = typeNode ? textOf(typeNode, source) : textOf(annotation, source).replace(/^:\s*/, '');
  const simple = raw.split(/[<[(]/)[0].trim();
  return simple || undefined;
}

function typeAnnotationName(node: SyntaxNode, source: string): string | undefined {
  const annotation = node.getChild('TypeAnnotation');
  return annotation ? typeNameFromAnnotation(annotation, source) : undefined;
}

/** Raw annotation text (`: Pick<X,'a'>` → `Pick<X,'a'>`) — issue 18(g) needs
 * the untruncated text so utility types keep their restriction. */
function rawTypeAnnotationText(node: SyntaxNode, source: string): string | undefined {
  const annotation = node.getChild('TypeAnnotation');
  return annotation ? textOf(annotation, source).replace(/^:\s*/, '').trim() : undefined;
}

/**
 * Issue 11 — member-wise bindings of an inline type-literal annotation, e.g.
 * `RepoProvider({ client, children }: { client: RepoQAClient; children: X })`.
 * Destructured props are the dominant React parameter shape; each member the
 * literal explicitly types is a deterministic binding. Only plain identifier
 * types are bound (fail-closed): inline object/function-typed members and
 * nested structures are skipped rather than guessed.
 */
function typeLiteralMembers(annotation: SyntaxNode, source: string): Array<[string, string]> {
  const raw = textOf(annotation, source).replace(/^:\s*/, '').trim();
  if (!raw.startsWith('{') || !raw.endsWith('}')) return [];
  const body = raw.slice(1, -1);
  const members: Array<[string, string]> = [];
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index];
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') depth -= 1;
    else if ((ch === ';' || ch === ',') && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  for (const part of parts) {
    // Raw member type text (not a pre-extracted name): the member may be a
    // utility type whose restriction must reach the call site — issue 18(g)
    // attribution showed `{ client?: Pick<X,'radar'> }` used to be dropped here
    // because the old regex only accepted plain identifier paths.
    const match = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:\s*(.+?)\s*$/.exec(part);
    if (match) members.push([match[1], match[2]]);
  }
  return members;
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

function collectParams(
  node: SyntaxNode,
  source: string,
  interfaceMembers: ReadonlyMap<string, ReadonlyMap<string, string>>
): MethodScope {
  const params = new Map<string, ReceiverType>();
  const declared = new Set<string>();
  const list = node.getChild('ParamList');
  if (!list) return { params, locals: new Map(), declared };
  // Issue 11 (dogfooding 2026-09-19): a parameter's `: Type` annotation is a
  // SIBLING of its VariableDefinition inside the ParamList (lezer shape), not
  // a child — typeAnnotationName on the definition itself never saw it, so
  // every typed parameter stayed untyped and every method call through it went
  // dynamic (the scan orphan top-10 was 8/10 RepoQAClient.*). Pair each
  // definition with the next annotation before the following definition.
  let pendingParam: string | undefined;
  let child = list.firstChild;
  while (child) {
    // A parameter definition is a VariableDefinition (plain) or an
    // ObjectPattern/ArrayPattern (destructured) — lezer keeps all of them as
    // siblings of their TypeAnnotation inside the ParamList.
    if (child.name === 'VariableDefinition' || child.name === 'ObjectPattern' || child.name === 'ArrayPattern') {
      pendingParam = textOf(child, source);
      // The fence must know the name even when no annotation follows.
      declared.add(pendingParam);
      if (child.name !== 'VariableDefinition') {
        // Destructured members are the real bindings — record each identifier
        // so an inner untyped redeclaration shadows them correctly.
        for (const match of pendingParam.matchAll(/[A-Za-z_$][\w$]*/g)) {
          declared.add(match[0]);
        }
      }
    } else if (child.name === 'TypeAnnotation' && pendingParam !== undefined) {
      const raw = textOf(child, source).replace(/^:\s*/, '').trim();
      if (raw.startsWith('{')) {
        // Destructured props (`{ client, children }: { client: X; … }`) bind
        // member-wise from the explicit literal — still deterministic, and
        // untyped/complex members stay unbound (fail-closed).
        for (const [member, memberType] of typeLiteralMembers(child, source)) {
          const resolved = resolveTypeRef(memberType, interfaceMembers);
          if (resolved) params.set(member, resolved);
        }
      } else if (/^[A-Za-z_$][\w$]*$/.test(raw) && interfaceMembers.has(raw)) {
        // Issue 18(g) — a NAMED props interface (`{ client }: EvolutionViewProps`):
        // the members live in the interface body, so bind each member the
        // annotation actually declares (attribution experiment showed this was
        // broken independently of the Pick<> case below).
        for (const [member, memberType] of interfaceMembers.get(raw)!) {
          const resolved = resolveTypeRef(memberType, interfaceMembers);
          if (resolved) params.set(member, resolved);
        }
      } else {
        // Plain / utility-typed parameter (`client: RepoQAClient`,
        // `client: Pick<RepoQAClient, 'radar'>`).
        const resolved = resolveTypeRef(raw, interfaceMembers);
        if (resolved) params.set(pendingParam, resolved);
      }
      pendingParam = undefined;
    }
    child = child.nextSibling;
  }
  return { params, locals: new Map(), declared };
}

/** All descendant nodes with the given name (depth-first, self excluded). */
function findDescendants(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const walk = (current: SyntaxNode): void => {
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (child.name === name) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

/** Issue 18(f) — the NARROW deep-`new` rule.
 *
 * `const client = useMemo(() => prop ?? new RepoQAClient(...), [prop])` really
 * is the instance, but the NewExpression sits inside the arrow, so the
 * direct-child lookup misses it. A blanket "find a NewExpression anywhere in
 * the initializer" is NOT acceptable: `const users = items.map(u => new User(u))`
 * is a COLLECTION of instances and would be mistyped as `User`.
 *
 * Accepted shapes only (whitelist, fail-closed):
 *   useMemo(() => new T(...))        → T
 *   useMemo(() => X ?? new T(...))   → T      (`??` / `||`)
 * Everything else — map/filter/reduce, ternary branches, nested arrows, more
 * than one `new` — returns undefined.
 */
function memoFactoryClass(node: SyntaxNode, source: string): string | undefined {
  const call = node.getChild('CallExpression');
  if (!call) return undefined;
  if (callShape(call, source).bareName !== 'useMemo') return undefined;
  const arrow = argumentNodes(call)[0];
  if (!arrow || arrow.name !== 'ArrowFunction') return undefined;
  // An expression-bodied arrow's value is its last child (a Block body has none).
  const body = arrow.lastChild;
  if (!body || body.name === 'Block') return undefined;
  let newExpr: SyntaxNode | undefined;
  if (body.name === 'NewExpression') {
    newExpr = body;
  } else if (body.name === 'BinaryExpression') {
    const logicOp = body.getChild('LogicOp');
    if (!logicOp || !/^(\?\?|\|\|)$/.test(textOf(logicOp, source).trim())) return undefined;
    const found = findDescendants(body, 'NewExpression');
    if (found.length !== 1) return undefined; // ambiguous → fail closed
    newExpr = found[0];
  } else {
    return undefined;
  }
  const callee = newExpr.getChild('MemberExpression') ?? newExpr.getChild('VariableName');
  if (!callee) return undefined;
  const name = textOf(callee, source).split('.').pop();
  return name || undefined;
}

/** Issue 11 — push a scope linked to the enclosing one (closure chain), so a
 * nested arrow's receiver lookups can reach the outer function's typed
 * parameters and locals. */
function pushScope(scopeStack: MethodScope[], scope: MethodScope): void {
  scope.parent = scopeStack[scopeStack.length - 1];
  scopeStack.push(scope);
}

function receiverTypeOf(
  receiver: string | undefined,
  scope: MethodScope | undefined,
  typeStack: TypeRecord[]
): ReceiverType | undefined {
  if (!receiver) return undefined;
  if (receiver === 'this') {
    const name = typeStack[typeStack.length - 1]?.name;
    return name ? { name } : undefined;
  }
  // Issue 11 — walk the closure chain outward. The nearest DECLARATION wins
  // (JS semantics): if that binding is untyped, stop — an untyped inner
  // declaration must not be revived by a typed outer one (fail-closed).
  for (let current = scope; current; current = current.parent) {
    if (current.declared.has(receiver)) {
      return current.locals.get(receiver) ?? current.params.get(receiver);
    }
  }
  for (let index = typeStack.length - 1; index >= 0; index -= 1) {
    const field = typeStack[index].fields.get(receiver);
    if (field) return { name: field };
  }
  return undefined;
}

/**
 * Issue 18(g) — does this receiver actually expose `method`?
 * A `Pick<T, K>` receiver may only resolve members inside K; anything else
 * stays dynamic, because resolving it into `T` would invent an edge that the
 * type system does not have (false negative > false positive, ADR-0002).
 */
function receiverExposes(receiverType: ReceiverType, method: string): boolean {
  return receiverType.allowed === undefined || receiverType.allowed.has(method);
}

/**
 * V31-02 — name of a JSX tag: `<Foo.Bar />` binds on `Bar`, same name-lookup
 * rule as a bare call. Lowercase tags (`div`, `span`) are `JSXBuiltin` HTML
 * elements with no repo symbol behind them, so they return undefined.
 */
function jsxTagName(node: SyntaxNode, source: string): string | undefined {
  const startTag = node.firstChild; // JSXStartTag
  const tagNode = startTag?.nextSibling;
  if (!tagNode) return undefined;
  if (tagNode.name === 'JSXIdentifier') return textOf(tagNode, source);
  if (tagNode.name === 'JSXMemberExpression') {
    const parts: string[] = [];
    let child = tagNode.firstChild;
    while (child) {
      if (child.name === 'JSXIdentifier') parts.push(textOf(child, source));
      child = child.nextSibling;
    }
    return parts[parts.length - 1];
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

  if (
    shape.bareName === 'fetch' ||
    shape.bareName === '$fetch' ||
    shape.bareName === 'ofetch'
  ) {
    if (shape.bareName === '$fetch' || shape.bareName === 'ofetch') {
      const method = requestMethod(node, source) ?? 'GET';
      return { method, url: path };
    }
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
    base === 'ky' ||
    base === 'ofetch' ||
    client !== undefined ||
    /Axios/.test(receiverTypeOf(base, scope, typeStack)?.name ?? '') ||
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

/** Issue 18(g) — member name → RAW type text, read from an interface body.
 * Raw text (not a resolved name) on purpose: the member type may itself be a
 * utility type (`Pick<X, 'a'>`) whose restriction must survive to the call
 * site. Method members (`radar(...): T`) have no `:` after the name and are
 * skipped — a method on a props object is not a receiver binding. */
function parseInterfaceMembers(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index];
    // `=>` is an arrow, not a generic close — counting it drives depth negative
    // and silently swallows every member AFTER a function-typed one (e.g.
    // `onNavigate?: () => void;` before `client?: Pick<…>`).
    if (ch === '>' && body[index - 1] === '=') continue;
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') depth -= 1;
    else if ((ch === ';' || ch === ',' || ch === '\n') && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  for (const part of parts) {
    const match = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:\s*([^\n]+?)\s*$/.exec(part);
    if (match) out.set(match[1], match[2]);
  }
  return out;
}

/** Split on a separator only at bracket depth 0 — the same discipline the
 * interface-member splitter uses. Type-annotation text is full of nested
 * `<…>`/`(…)`/`[…]`, so a naive `split('|')` tears `Pick<X, 'a' | 'b'>` apart
 * (2026-09-21: that is exactly how a two-name Pick silently failed while the
 * one-name form worked). */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === '>' && text[index - 1] === '=') continue; // `=>` is an arrow
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') depth -= 1;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Issue 18(g) — resolve an annotation's RAW text into a receiver type.
 * Deliberately narrow, and everything unrecognised fails closed (undefined =
 * the call stays dynamic):
 *   `RepoQAClient`            → { name }
 *   `Pick<RepoQAClient,'a'>`  → { name, allowed: {a} }   (K must be a plain
 *                                name list — nested generics are refused so a
 *                                mis-split can never widen the allowed set)
 *   `X | undefined`           → same as `X`  (optional members are common)
 *   anything else (unions of objects, arrays, functions, inline literals) → undefined
 */
function resolveTypeRef(
  raw: string,
  interfaceMembers: ReadonlyMap<string, ReadonlyMap<string, string>>,
  depth = 0
): ReceiverType | undefined {
  if (depth > 4) return undefined;
  let text = raw.trim();
  if (!text) return undefined;
  // `T | undefined` / `T | null` — an optional member still types the receiver.
  // Top-level split only: a `|` inside `Pick<…>` is part of K, not a union.
  const stripped = splitTopLevel(text, '|')
    .map((part) => part.trim())
    .filter((part) => part && part !== 'undefined' && part !== 'null');
  if (stripped.length === 1) text = stripped[0];
  else if (stripped.length > 1) return undefined; // real unions: fail closed
  if (/^[A-Za-z_$][\w$.]*$/.test(text)) return { name: text };
  const pick = /^Pick<\s*([A-Za-z_$][\w$.]*)\s*,\s*(.+?)>$/s.exec(text);
  if (pick) {
    const listText = pick[2].trim();
    // Only a plain name list is accepted (quoted or bare, separated by | or ,).
    if (
      !/^('[^']+'|"[^"]+"|[A-Za-z_$][\w$]*)(\s*[|,]\s*('[^']+'|"[^"]+"|[A-Za-z_$][\w$]*))*$/.test(
        listText
      )
    ) {
      return undefined;
    }
    const allowed = new Set<string>();
    for (const match of listText.matchAll(/'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*)/g)) {
      const name = match[1] ?? match[2] ?? match[3];
      if (name) allowed.add(name);
    }
    if (allowed.size === 0) return undefined;
    return { name: pick[1], allowed };
  }
  // A named interface/type alias used as a member type is an object shape, not
  // a receiver — callers that destructure it consult the member table instead.
  void interfaceMembers;
  return undefined;
}

function extractTypeOnlyDeclarations(
  source: string,
  relativePath: string,
  repoId: string,
  symbols: RepoSymbol[],
  interfaceMembers: Map<string, Map<string, string>>
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
    // Members come from the RAW body (the masked view blanks string-literal
    // types like `Pick<X, 'radar'>`); offsets are identical, so the brace span
    // found in `masked` is valid in `source`.
    if (close > open) {
      interfaceMembers.set(match[1], parseInterfaceMembers(source.slice(open + 1, close)));
    }
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
  // Issue 18(g) — interface member types, file-local. Same-file is enough for
  // the observed shapes (a component and its props interface live together);
  // cross-file interface members stay unbound (fail-closed, same rule as the
  // Go package table: no guess by name similarity).
  const interfaceMembers = new Map<string, Map<string, string>>();
  extractTypeOnlyDeclarations(source, relativePath, repoId, symbols, interfaceMembers);

  const typeStack: TypeRecord[] = [];
  const methodStack: RepoSymbol[] = [];
  const scopeStack: MethodScope[] = [];
  const moduleArrowPushed: boolean[] = [];
  const httpClients = new Map<string, HttpClientRecord>();
  // The JS grammar parses a leading decorator as a bogus nameless
  // ClassDeclaration; carry its decorators forward to the real declaration.
  let pendingClassDecorators: Array<{ name: string; value?: string }> = [];
  let pendingClassDecoratorTexts: string[] = [];

  const tree = TYPESCRIPT_PARSER.parse(source);
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
        pushScope(scopeStack, collectParams(node, source, interfaceMembers));
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
        pushScope(scopeStack, collectParams(node, source, interfaceMembers));
        return;
      }

      if (node.name === 'VariableDeclaration') {
        const fn =
          node.getChild('ArrowFunction') ?? node.getChild('FunctionExpression');
        const def = node.getChildren('VariableDefinition')[0];
        const initCall = node.getChild('CallExpression');
        // V31-02 — record the local's type so calls through it bind at parse
        // time. `const client = new RepoQAClient(...)` used to leave the
        // receiver untyped, so every method call on it stayed dynamic and the
        // whole class family read as dead code (self-repo orphan top-10).
        const scope = scopeStack[scopeStack.length - 1];
        if (def && scope) {
          const name = textOf(def, source);
          // The fence records every binding, typed or not (issue 11).
          scope.declared.add(name);
          for (const match of name.matchAll(/[A-Za-z_$][\w$]*/g)) {
            scope.declared.add(match[0]);
          }
          const newExpr = node.getChild('NewExpression');
          const newShape = newExpr ? callShape(newExpr, source) : undefined;
          const constructed = newShape?.bareName ?? newShape?.parts?.[0];
          // Issue 18(g): resolve the annotation text (so `Pick<X,'a'>` keeps its
          // restriction); issue 18(f): the memo-factory shape; then the plain
          // `new X()` direct-child case.
          const fromAnnotation = resolveTypeRef(rawTypeAnnotationText(node, source) ?? '', interfaceMembers);
          const fromMemo = memoFactoryClass(node, source);
          const resolved =
            fromAnnotation ??
            (fromMemo ? { name: fromMemo } : undefined) ??
            (constructed ? { name: constructed } : undefined);
          if (resolved) scope.locals.set(name, resolved);
        }
        if (def && initCall) {
          const initShape = callShape(initCall, source);
          if (initShape.base === 'axios' && initShape.property === 'create') {
            const baseURL = /baseURL\s*:\s*["']([^"']+)["']/.exec(
              textOf(initCall, source)
            )?.[1];
            httpClients.set(textOf(def, source), { baseURL });
          }
          if (initShape.base === 'ky' && initShape.property === 'create') {
            const prefixUrl = /prefixUrl\s*:\s*["']([^"']+)["']/.exec(
              textOf(initCall, source)
            )?.[1];
            httpClients.set(textOf(def, source), { baseURL: prefixUrl });
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
          pushScope(scopeStack, collectParams(fn, source, interfaceMembers));
          moduleArrowPushed.push(true);
        } else {
          moduleArrowPushed.push(false);
        }
        return;
      }

      // V31-02 — `<BrandMark />` is how a React component gets *used*; without
      // this edge every component (and every helper only referenced from JSX)
      // looked like dead code. Attributed to the enclosing function, exactly
      // like a call expression.
      if (node.name === 'JSXOpenTag' || node.name === 'JSXSelfClosingTag') {
        const tag = jsxTagName(node, source);
        if (!tag || methodStack.length === 0) return;
        const current = methodStack[methodStack.length - 1];
        const line = lineAt(source, node.from);
        const calls = current.calls ?? [];
        if (!calls.some((existing) => existing.method === tag && existing.line === line)) {
          calls.push({ file: relativePath, method: tag, line, dynamic: false });
          current.calls = calls;
        }
        return;
      }

      // Issue 11 — `new RepoQAClient(...)` is how a constructor is invoked;
      // without an edge the constructor always read as an orphan no matter how
      // alive the class was. Same attribution rules as a call expression.
      // (callShape cannot be used here: its firstChild read hits the `new`
      // keyword, not the callee.)
      if (node.name === 'NewExpression') {
        if (methodStack.length === 0) return;
        const member = node.getChild('MemberExpression');
        const callee = member
          ? memberParts(member, source).join('.')
          : node.getChild('VariableName')
            ? textOf(node.getChild('VariableName')!, source)
            : undefined;
        const className = callee?.split('.').pop();
        if (!className) return;
        const current = methodStack[methodStack.length - 1];
        const line = lineAt(source, node.from);
        const calls = current.calls ?? [];
        if (!calls.some((existing) => existing.method === 'constructor' && existing.receiver === className && existing.line === line)) {
          calls.push({
            file: relativePath,
            method: 'constructor',
            line,
            receiver: className,
            receiverType: className,
            dynamic: false
          });
          current.calls = calls;
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
        // V31-02 — a bare `foo(...)` is a plain function reference. The old
        // `parts.length < 2` guard dropped every receiver-less call, so a
        // module-level function used anywhere looked like dead code (the
        // self-repo orphan sample was 100% false positives, dominated by
        // exactly this). Mirrors the Python (v0.7) and Go (v0.22) rule:
        // statically resolvable by same-file-then-global name lookup.
        if (!parts && shape.bareName && shape.bareName !== 'require') {
          const call: RepoSymbolCall = {
            file: relativePath,
            method: shape.bareName,
            line,
            dynamic: false
          };
          const calls = current.calls ?? [];
          if (!calls.some((existing) => existing.method === call.method && existing.line === call.line)) {
            calls.push(call);
            current.calls = calls;
          }
          return;
        }
        if (!parts || parts.length < 2) return;
        const receiver =
          parts[0] === 'this' && parts.length >= 3
            ? parts[1]
            : parts.length === 2
              ? parts[0]
              : parts.slice(0, -1).join('.');
        const receiverType = receiverTypeOf(receiver, scope, typeStack);
        const method = parts[parts.length - 1];
        // Issue 18(g): a restricted receiver (`Pick<T, K>`) only exposes K.
        const exposes = receiverType !== undefined && receiverExposes(receiverType, method);
        const call: RepoSymbolCall = {
          file: relativePath,
          method,
          line,
          receiver,
          receiverType: exposes ? receiverType!.name : undefined,
          dynamic: !exposes
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
    return TYPESCRIPT_EXTENSIONS.includes(path.extname(lower));
  },
  parseFile(filePath: string, repoId: string, root: string): Promise<RepoSymbol[]> {
    return parseTypeScriptFile(filePath, repoId, root);
  },
  parseSource(source: string, relativePath: string, repoId: string): RepoSymbol[] {
    return parseTypeScriptSource(source, relativePath, repoId);
  }
};
