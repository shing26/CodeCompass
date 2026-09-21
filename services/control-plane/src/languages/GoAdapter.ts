import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyntaxNode, Tree } from '@lezer/common';
import { parser } from '@lezer/go';
import type { RepoSymbol, RepoSymbolCall } from '../ingest/repoqa-repos';
import { joinRoutePath } from './JavaAdapter';
import { GO_EXTENSIONS } from './language-extensions';
import type { LanguageAdapter } from './LanguageAdapter';
import type { GoPackageDeclarations, ParseContext } from './parse-context';

/**
 * Issue 26 — Go adapter.
 *
 * Extracts struct/interface/function/method symbols plus package-level
 * constants and variables from `@lezer/go`, recognizes Gin/Fiber route
 * registration (`r.GET("/owners", handler)`, `group.POST(...)`), and records
 * method-call edges with the same receiver typing the Java adapter uses.
 */

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
  /**
   * V31-02 — every name this scope declares, including ones whose type could
   * not be proven. Shadowing must be decided on *declaration*, not on a
   * successful type: `f := GetHandler(); app := f()` is a local call even
   * though `f` never got a type, and resolving it as the package-level `f`
   * would be a guess.
   */
  declared: Set<string>;
  selfType?: string;
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

/**
 * V31-02 — the named type behind a Go type expression, or undefined when the
 * expression yields no usable receiver type.
 *
 * Only named types and pointers to them qualify. `x.M()` on a slice, map,
 * channel, anonymous struct or func value is a call on a value that may hold any
 * number of different types, so those stay untyped — "rather dynamic than
 * guess", ADR-0002. A qualified name (`io.Closer`, `*gui.Gui`) reduces to its
 * last segment, the convention the parameter collection and the Java adapter
 * already share.
 */
function receiverTypeFromTypeNode(
  node: SyntaxNode | null | undefined,
  source: string
): string | undefined {
  if (!node) return undefined;
  if (node.name === 'TypeName' || node.name === 'QualifiedType') {
    const name = simpleTypeName(textOf(node, source));
    return name.length > 0 ? name : undefined;
  }
  if (node.name === 'PointerType' || node.name === 'ParameterizedType') {
    // `*Map[K, V]` and `Map[K, V]` both name `Map`: the type arguments do not
    // change which method set the value exposes.
    let child = node.firstChild;
    while (child) {
      const inner = receiverTypeFromTypeNode(child, source);
      if (inner) return inner;
      child = child.nextSibling;
    }
  }
  return undefined;
}

/**
 * Type of a declaration node (`Parameter`, `FieldDecl`, `VarSpec`): the first
 * child that carries a named type. Annotations and initializers are told apart
 * by the caller, which only asks about the part it wants.
 */
function declTypeName(decl: SyntaxNode, source: string): string | undefined {
  let child = decl.firstChild;
  while (child) {
    const name = receiverTypeFromTypeNode(child, source);
    if (name) return name;
    child = child.nextSibling;
  }
  return undefined;
}

/**
 * The initializer of a `var x = v` / `x := v` statement, when one is written.
 * Anything before the assignment token is a name or a type annotation.
 */
function initializerOf(container: SyntaxNode): SyntaxNode | undefined {
  let child = container.firstChild;
  let sawAssign = false;
  while (child) {
    if (child.name === '=' || child.name === ':=') {
      sawAssign = true;
      child = child.nextSibling;
      continue;
    }
    if (sawAssign) return child;
    child = child.nextSibling;
  }
  return undefined;
}

/**
 * V31-02 — result types of a `FunctionDecl`/`MethodDecl`, in declaration order.
 *
 * The grammar wraps a parenthesised result list in its own `Parameters` node
 * (a third one for methods, after receiver and parameters) but leaves a single
 * unparenthesised result as a bare type node, so both shapes are handled. An
 * unmodellable result list yields nothing at all: positional binding needs the
 * whole list, and a partial one would bind the wrong slot.
 */
function resultTypesOf(
  decl: SyntaxNode,
  source: string,
  paramListCount: number
): string[] {
  const lists = decl.getChildren('Parameters');
  if (lists.length > paramListCount) {
    return resultTypes(lists[lists.length - 1], source);
  }
  const boundary = lists[lists.length - 1]?.to ?? decl.from;
  let child = decl.firstChild;
  while (child && child.from < boundary) child = child.nextSibling;
  while (child) {
    const name = receiverTypeFromTypeNode(child, source);
    if (name) return [name];
    child = child.nextSibling;
  }
  return [];
}

function resultTypes(results: SyntaxNode, source: string): string[] {
  const out: string[] = [];
  for (const parameter of results.getChildren('Parameter')) {
    const type = declTypeName(parameter, source);
    if (!type) return [];
    // `func f() (a, b int)` names two results of one type.
    const names = parameter.getChildren('DefName').length;
    const arity = names > 0 ? names : 1;
    for (let index = 0; index < arity; index += 1) out.push(type);
  }
  return out;
}

/**
 * V31-02 — declarations of one Go file, collected before symbol extraction so a
 * call site can be typed by a declaration that appears further down the file.
 *
 * Methods are keyed `Receiver.Method` because a method name may legitimately
 * repeat across types. Cross-file lookups go through the package table built by
 * `buildGoPackageTable`; without one, every lookup here stays file-local and the
 * call site keeps its `dynamic` marker.
 */
interface GoFileDeclarations {
  /** Named types, including `type RepoPath string` — a conversion target. */
  typeNames: Set<string>;
  /** Result types by `func` name, or `Receiver.Method` for methods. */
  results: Map<string, string[]>;
  /** type name → field name → declared type name. */
  fields: Map<string, Map<string, string>>;
  /** Keys declared more than once: an illegal file, so never resolved. */
  ambiguous: Set<string>;
}

function collectGoDeclarations(tree: Tree, source: string): GoFileDeclarations {
  const typeNames = new Set<string>();
  const results = new Map<string, string[]>();
  const fields = new Map<string, Map<string, string>>();
  const ambiguous = new Set<string>();

  tree.iterate({
    enter(ref) {
      const node = ref.node;
      if (node.name === 'TypeDecl') {
        const def = node.getChild('TypeSpec')?.getChild('DefName');
        if (def) typeNames.add(textOf(def, source));
        return;
      }
      if (node.name === 'FieldDecl' && node.parent?.name === 'StructBody') {
        const parentType = enclosingTypeName(node, source);
        const type = declTypeName(node, source);
        if (!parentType || !type) return;
        const record = fields.get(parentType) ?? new Map<string, string>();
        for (const fieldName of node.getChildren('FieldName')) {
          record.set(textOf(fieldName, source), type);
        }
        fields.set(parentType, record);
        return;
      }
      if (node.name !== 'FunctionDecl' && node.name !== 'MethodDecl') return;

      const isMethod = node.name === 'MethodDecl';
      const nameNode = node.getChild(isMethod ? 'FieldName' : 'DefName');
      if (!nameNode) return;
      const paramLists = node.getChildren('Parameters');
      const receiverType = isMethod
        ? [...collectParams(paramLists[0], source).values()][0]
        : undefined;
      const types = resultTypesOf(node, source, isMethod ? 2 : 1);
      if (types.length === 0) return;
      const key = receiverType
        ? `${receiverType}.${textOf(nameNode, source)}`
        : textOf(nameNode, source);
      if (results.has(key)) {
        results.delete(key);
        ambiguous.add(key);
        return;
      }
      if (!ambiguous.has(key)) results.set(key, types);
    }
  });

  return { typeNames, results, fields, ambiguous };
}

/** Package directory of a repo-relative path (`pkg/app/entry_point.go` → `pkg/app`). */
function packageDirOf(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? '' : normalized.slice(0, slash);
}

/** Package name, Go's package ≈ directory convention. */
export function packageNameOf(relativePath: string): string {
  const segments = packageDirOf(relativePath).split('/');
  return segments[segments.length - 1] ?? '';
}

/**
 * V31-02 — merge every file's declarations into one table per Go package.
 *
 * Everything here refuses rather than resolves, because in a compilable package
 * none of these collisions can happen and a match would therefore be a coin
 * flip:
 * - a package directory basename claimed by two different directories (import
 *   paths are unique, basenames are not), which drops that name entirely;
 * - a name declared more than once inside one package, whether twice in one file
 *   or once in each of two files — the file-level `ambiguous` set is folded in
 *   here so a third declaration cannot resurrect a key the file pass dropped.
 */
export function buildGoPackageTable(
  files: ReadonlyArray<{ relativePath: string; source: string }>
): Map<string, GoPackageDeclarations> {
  const perDirectory = new Map<string, GoFileDeclarations[]>();
  const nameToDirectory = new Map<string, string | undefined>();

  for (const file of files) {
    const dir = packageDirOf(file.relativePath);
    const name = packageNameOf(file.relativePath);
    // A basename seen from two directories is not a package identity.
    if (nameToDirectory.has(name) && nameToDirectory.get(name) !== dir) {
      nameToDirectory.set(name, undefined);
    } else {
      nameToDirectory.set(name, dir);
    }
    const bucket = perDirectory.get(dir) ?? [];
    bucket.push(collectGoDeclarations(parser.parse(file.source), file.source));
    perDirectory.set(dir, bucket);
  }

  const collapsed = new Map<string, GoFileDeclarations[]>();
  for (const [dir, declarations] of perDirectory) {
    const name = dir.slice(dir.lastIndexOf('/') + 1);
    if (nameToDirectory.get(name) !== dir) continue;
    collapsed.set(name, declarations);
  }

  const table = new Map<string, GoPackageDeclarations>();
  for (const [name, declarations] of collapsed) {
    const fields = new Map<string, Map<string, string>>();
    const results = new Map<string, string[]>();
    const seenResults = new Set<string>();
    const droppedResults = new Set<string>();
    const seenTypes = new Set<string>();
    const droppedTypes = new Set<string>();

    for (const file of declarations) {
      // A name this file already declared twice is not a package-level fact.
      for (const key of file.ambiguous) droppedResults.add(key);
      for (const [key, types] of file.results) {
        if (file.ambiguous.has(key) || seenResults.has(key)) {
          results.delete(key);
          droppedResults.add(key);
          continue;
        }
        if (droppedResults.has(key)) continue;
        seenResults.add(key);
        results.set(key, [...types]);
      }
      for (const typeName of file.typeNames) {
        if (seenTypes.has(typeName)) {
          droppedTypes.add(typeName);
          continue;
        }
        if (droppedTypes.has(typeName)) continue;
        seenTypes.add(typeName);
      }
      for (const [typeName, record] of file.fields) {
        // One file declares a type; a second declaration means the file set is
        // not a compilable package, so the whole record is dropped.
        if (fields.has(typeName)) {
          fields.delete(typeName);
          droppedTypes.add(typeName);
          continue;
        }
        if (droppedTypes.has(typeName)) continue;
        fields.set(typeName, new Map(record));
      }
    }

    table.set(name, {
      typeNames: new Set([...seenTypes].filter((typeName) => !droppedTypes.has(typeName))),
      fields,
      results
    });
  }
  return table;
}

/**
 * Declaration facts available while reading one file: the package table when the
 * worker built one, otherwise just this file's own declarations. Both are plain
 * lookups — nothing here infers a name.
 *
 * The package table is authoritative whenever it exists, rather than being a
 * second chance after the file's own record: it already contains this file's
 * declarations, and its merge is where duplicate declarations get *dropped*.
 * Falling back to the file on a miss would hand back exactly the record the
 * merge refused.
 */
interface DeclarationScope {
  /** Named types, including `type RepoPath string` — a conversion target. */
  typeNames: ReadonlySet<string>;
  /** Field types of a type. */
  fieldsOf(typeName: string): ReadonlyMap<string, string> | undefined;
  /** Result types of `Func` or `Receiver.Method`. */
  resultsOf(key: string): readonly string[] | undefined;
  /** Result types of `alias.Func` when `alias` is an import qualifier. */
  importedResultsOf(alias: string, funcName: string): readonly string[] | undefined;
}

function createDeclarationScope(
  file: GoFileDeclarations,
  ownPackage: GoPackageDeclarations | undefined,
  importPaths: ReadonlyMap<string, string>,
  packageByName: (name: string) => GoPackageDeclarations | undefined
): DeclarationScope {
  return {
    typeNames: ownPackage?.typeNames ?? file.typeNames,
    fieldsOf(typeName) {
      return ownPackage ? ownPackage.fields.get(typeName) : file.fields.get(typeName);
    },
    resultsOf(key) {
      return ownPackage ? ownPackage.results.get(key) : file.results.get(key);
    },
    importedResultsOf(alias, funcName) {
      // The import path is written in the source, so its last segment is the
      // package directory — the same convention the call-chain resolver uses
      // for `pkg.Func` calls. No path, or no table for that package: untyped.
      const segments = importPaths.get(alias)?.split('/') ?? [];
      const name = segments[segments.length - 1];
      if (!name) return undefined;
      return packageByName(name)?.results.get(funcName);
    }
  };
}

/**
 * V31-02 — static types of an initializer, in result order, or undefined when
 * neither this file nor the package table proves them.
 *
 * Proven shapes: a composite literal (`App{}`), its address (`&App{}`),
 * `new(T)`, a type conversion (`OwnerService(v)`), and a call to a function or
 * method whose result types are declared in this package (or in a package this
 * file imports) — matched by result position. Anything else (a field read, a
 * slice literal, a call through an unknown package) stays untyped, so the call
 * site keeps its `dynamic` marker instead of acquiring a guessed receiver.
 */
function initializerTypes(
  value: SyntaxNode,
  source: string,
  scope: MethodScope | undefined,
  declarations: DeclarationScope
): string[] | undefined {
  const literal = typedLiteralOf(value, source);
  if (literal) return [literal];
  if (value.name !== 'CallExpr') return undefined;

  const callee = value.firstChild;
  if (!callee) return undefined;
  const shadowed = (name: string): boolean => scope?.declared.has(name) ?? false;

  // `F[T](...)` and `pkg.F[T](...)` reach the parser as a parameterized
  // expression; a value lookup is an IndexExpr, so only that node is unwrapped.
  const indexed = callee.name === 'ParameterizedExpr' ? callee.firstChild : undefined;
  const target =
    indexed?.name === 'VariableName' && declarations.resultsOf(textOf(indexed, source))
      ? indexed
      : callee;

  if (target.name === 'VariableName') {
    const name = textOf(target, source);
    if (name === 'new') {
      // Builtin `new(T)` yields *T. A local shadowing it would be a func value,
      // so the builtin reading is only taken when nothing shadows the name.
      if (shadowed(name)) return undefined;
      const args = value.getChild('Arguments');
      if (!args) return undefined;
      let arg = args.firstChild;
      while (arg && (arg.name === '(' || arg.name === ')' || arg.name === ',')) {
        arg = arg.nextSibling;
      }
      const typeName = arg ? declarationTypeName(arg, source, declarations) : undefined;
      return typeName ? [typeName] : undefined;
    }
    if (shadowed(name)) return undefined;
    const declared = declarations.resultsOf(name);
    if (declared) return [...declared];
    // `OwnerService(v)` is a conversion, not a call: the callee names a type.
    return declarations.typeNames.has(name) ? [name] : undefined;
  }

  if (target.name === 'SelectorExpr') {
    const parts = selectorParts(target, source);
    if (parts.length !== 2) return undefined;
    const qualifier = parts[0];
    // A receiver variable or parameter shadows an import of the same name, so
    // the receiver reading is tried first and the import reading is the
    // fallback — Go's own resolution order.
    const receiverType = receiverTypeOf(scope, declarations, qualifier);
    const viaReceiver = receiverType
      ? declarations.resultsOf(`${receiverType}.${parts[1]}`)
      : undefined;
    if (viaReceiver) return [...viaReceiver];
    const imported = declarations.importedResultsOf(qualifier, parts[1]);
    return imported ? [...imported] : undefined;
  }

  return undefined;
}

/** `App{}` / `&App{}` → `App`; `&x` and every other unary form → undefined. */
function typedLiteralOf(value: SyntaxNode, source: string): string | undefined {
  let literal: SyntaxNode | undefined;
  if (value.name === 'TypedLiteral') literal = value;
  else if (value.name === 'UnaryExp') literal = value.getChild('TypedLiteral') ?? undefined;
  return literal ? declTypeName(literal, source) : undefined;
}

/** `new(T)`: the argument names a type declared in this file, or nothing. */
function declarationTypeName(
  arg: SyntaxNode,
  source: string,
  declarations: DeclarationScope
): string | undefined {
  if (arg.name !== 'VariableName') return undefined;
  const name = textOf(arg, source);
  return declarations.typeNames.has(name) ? name : undefined;
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

/**
 * Names bound by a parameter list, whether or not their type is resolvable.
 * Shadowing is a fact about declaration, so it must not depend on `collectParams`
 * having found a usable type (see `MethodScope.declared`).
 */
function collectParamNames(
  parameters: SyntaxNode | null | undefined,
  source: string
): Set<string> {
  const names = new Set<string>();
  if (!parameters) return names;
  for (const parameter of parameters.getChildren('Parameter')) {
    for (const def of parameter.getChildren('DefName')) names.add(textOf(def, source));
  }
  return names;
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
      const type = declTypeName(child, source);
      if (def && type) params.set(textOf(def, source), type);
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
  declarations: DeclarationScope,
  name: string
): string | undefined {
  if (scope) {
    const param = scope.params.get(name);
    if (param) return param;
    const local = scope.locals.get(name);
    if (local) return local;
  }
  if (scope?.selfType) {
    const field = declarations.fieldsOf(scope.selfType)?.get(name);
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

/** Type annotation of a `VarSpec`, i.e. the type written before `=`. */
function annotationTypeOf(spec: SyntaxNode, source: string): string | undefined {
  let child = spec.firstChild;
  while (child) {
    if (child.name === '=' || child.name === ':=') return undefined;
    const name = receiverTypeFromTypeNode(child, source);
    if (name) return name;
    child = child.nextSibling;
  }
  return undefined;
}

/**
 * V31-02 — record the static types of a `var`/`:=` statement's new variables.
 *
 * A short declaration carries no annotation, which is why `app := &App{}` and
 * `app, err := NewApp(...)` used to leave every later `app.Method()` call
 * dynamic and pushed the callee into the orphan bucket. A written annotation
 * always wins; otherwise the initializer is read positionally, and a name count
 * that does not match the number of proven result types binds nothing at all.
 */
function assignLocalTypes(
  decl: SyntaxNode,
  spec: SyntaxNode | null | undefined,
  source: string,
  scope: MethodScope,
  declarations: DeclarationScope
): void {
  const defs = (spec ?? decl).getChildren('DefName');
  if (defs.length === 0) return;
  // Declaration first: a name whose type stays unproven must still shadow a
  // package-level function or an import of the same name.
  for (const def of defs) scope.declared.add(textOf(def, source));

  if (spec) {
    const annotated = annotationTypeOf(spec, source);
    if (annotated) {
      for (const def of defs) scope.locals.set(textOf(def, source), annotated);
      return;
    }
  }

  const value = initializerOf(spec ?? decl);
  if (!value) return;
  const types = initializerTypes(value, source, scope, declarations);
  if (!types || types.length !== defs.length) return;
  defs.forEach((def, index) => scope.locals.set(textOf(def, source), types[index]));
}

/**
 * Parse Go source already in memory into the same symbol table as the Java and
 * TypeScript adapters. A single malformed construct does not abort the whole
 * file; recoverable declarations still surface.
 *
 * V31-02 — `context` carries the rest of the package's declarations. It is
 * optional: without it every lookup is file-local and the calls that need more
 * keep their `dynamic` marker (ADR-0002), which is why the adapter stays usable
 * for a single file in isolation.
 */
export function parseGoSource(
  source: string,
  relativePath: string,
  repoId: string,
  context?: ParseContext
): RepoSymbol[] {
  const symbols: RepoSymbol[] = [];
  const methodStack: RepoSymbol[] = [];
  const scopeStack: MethodScope[] = [];
  const routerScopes: Array<Map<string, string | undefined>> = [];
  const moduleRouters = new Map<string, string | undefined>();
  const inferredImpls: Array<{ iface: string; impl: string }> = [];
  let functionDepth = 0;
  // v0.7 — nesting depth inside `go ...` statements; calls made here are
  // concurrent branches and get the async marker on their edge.
  let goDepth = 0;
  // Issue 02 (dogfooding) — local names this file binds imports to (alias or
  // last path segment) and the path each came from. A selector whose qualifier
  // is here is a package-qualified call, not a variable receiver.
  const importPaths = new Map<string, string>();

  const tree = parser.parse(source);
  // V31-02 — declarations of the whole file first: Go call sites routinely name
  // a function declared further down the file (`Run` calls `NewApp`), so the
  // local type table cannot be built in the same pass that reads the calls.
  // `context` widens the same lookups to the rest of the package (this file's
  // own declarations still win), because a Go package spans files.
  const declarations = createDeclarationScope(
    collectGoDeclarations(tree, source),
    context?.languages?.go?.get(packageNameOf(relativePath)),
    importPaths,
    (name) => context?.languages?.go?.get(name)
  );
  tree.iterate({
    enter(ref) {
      const node = ref.node;

      if (node.name === 'GoStatement') {
        goDepth += 1;
        return;
      }

      if (node.name === 'ImportSpec') {
        // `import alias "path"` binds `alias`; `"a/b/leaf"` binds `leaf`.
        // Blank (`_`) and dot (`.`) imports bind nothing callable.
        const pathNode = node.getChild('String');
        const aliasNode = node.getChild('PackageName');
        const importPath = pathNode ? unquote(textOf(pathNode, source)) : undefined;
        const alias = aliasNode ? textOf(aliasNode, source) : undefined;
        const localName = alias ?? importPath?.split('/').pop();
        if (localName && localName !== '_' && localName !== '.' && importPath) {
          importPaths.set(localName, importPath);
        }
        return;
      }

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
        return;
      }

      if (node.name === 'FieldDecl' && node.parent?.name === 'StructBody') {
        const parentType = enclosingTypeName(node, source);
        if (!parentType) return;
        // V31-02: a field declared `*svc.Repo` / `io.Closer` used to record no
        // type at all, so `owner.repo.FindOne()` and `app.closer.Close()` had no
        // receiver type to bind to. Collections still record none (see
        // receiverTypeFromTypeNode).
        const type = declTypeName(node, source);
        for (const fieldName of node.getChildren('FieldName')) {
          const fieldNameText = textOf(fieldName, source);
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
          declared: new Set([
            ...collectParamNames(parameterLists[0], source),
            ...collectParamNames(parameterLists[1], source)
          ]),
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
          locals: new Map(),
          declared: collectParamNames(node.getChild('Parameters'), source)
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
        if (scope) {
          assignLocalTypes(node, spec, source, scope, declarations);
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
        // V31-02: `F[T](...)` wraps the callee in a parameterized expression.
        // The grammar emits that node only for type arguments — a value lookup
        // (`handlers[0]()`) is an IndexExpr — so unwrapping it cannot turn an
        // indexed value into a call target.
        const callee = first?.name === 'ParameterizedExpr' ? first.firstChild : first;
        const parts = callee?.name === 'SelectorExpr' ? selectorParts(callee, source) : [];
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
          const base = parts[0];
          const verb = parts[parts.length - 1];
          // Issue 02 — `pkg.Func(...)` where the qualifier is an import: a
          // package-qualified call, statically resolvable via the pkg stamp
          // (see resolvePkgQualifiedCall). `pkg.Type.Method` stays dynamic:
          // the type lives in another package and cannot be bound here.
          // V31-02: a parameter or local of the same name shadows the import,
          // and the receiver reading then wins — Go's own resolution order.
          if (parts.length === 2 && importPaths.has(base) && !scope?.declared.has(base)) {
            call = {
              file: relativePath,
              method: verb,
              line,
              dynamic: false,
              pkg: base
            };
          } else {
            const receiver = parts.length >= 3 ? parts[1] : parts[0];
            const method = parts[parts.length - 1];
            let receiverType: string | undefined;
            if (parts.length >= 3) {
              const ownerType = receiverTypeOf(scope, declarations, parts[0]);
              receiverType = ownerType
                ? declarations.fieldsOf(ownerType)?.get(receiver)
                : undefined;
            } else {
              receiverType = receiverTypeOf(scope, declarations, receiver);
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
        } else if (callee?.name === 'VariableName') {
          // Issue 02 — a bare identifier call is a package-level function, a
          // local func value or a builtin.
          // V31-02: it can never be a method of the enclosing type. Go has no
          // implicit receiver, so stamping `receiverType` with the enclosing
          // type sent resolution down the type path, where no such method
          // exists — every package-level helper called from a method body
          // (`minGitVersionErrorMessage(tr)` in lazygit's App) lost its edge.
          // Package-level functions resolve by name, and the Go rule in
          // resolveCall prefers the caller's own directory.
          call = {
            file: relativePath,
            method: textOf(callee, source),
            line,
            dynamic: false
          };
        }

        if (!call) return;
        // v0.7 — a call inside `go ...` is a concurrent branch: keep the edge
        // (the chain does NOT break) and mark it async for display.
        if (goDepth > 0) call.async = true;
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
      if (node.name === 'GoStatement') {
        goDepth -= 1;
        return;
      }
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
  root: string,
  context?: ParseContext
): Promise<RepoSymbol[]> {
  const source = await fs.readFile(filePath, 'utf8');
  const relativePath = path.relative(root, filePath).split(path.sep).join('/');
  return parseGoSource(source, relativePath, repoId, context);
}

/**
 * Issue 26 — Go family adapter. `vendor`, `.git` and build output directories
 * are already excluded by `repoqa-scan.ts` before files reach here.
 */
export const GoAdapter: LanguageAdapter = {
  canParse(filePath: string): boolean {
    return GO_EXTENSIONS.includes(path.extname(filePath.toLowerCase()));
  },
  parseFile(
    filePath: string,
    repoId: string,
    root: string,
    context?: ParseContext
  ): Promise<RepoSymbol[]> {
    return parseGoFile(filePath, repoId, root, context);
  },
  parseSource(
    source: string,
    relativePath: string,
    repoId: string,
    context?: ParseContext
  ): RepoSymbol[] {
    return parseGoSource(source, relativePath, repoId, context);
  }
};
