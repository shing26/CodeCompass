import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/java';
import type { RepoSymbol, RepoSymbolCall } from './repoqa-repos';

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

/** A `<module>` child declared in a parent pom.xml `<modules>` block. */
export interface PomModule {
  name: string;
  /** 1-based line of the `<module>` tag in the pom source. */
  lineStart: number;
}

/**
 * Issue 15 — parse the `<modules>` declarations of a parent pom.xml.
 *
 * Only `<module>` entries inside a `<modules>...</modules>` block count (a bare
 * `<module>` tag in plugin configuration is not a Maven module child). Names are
 * trimmed of surrounding whitespace; entries are returned in declaration order
 * with their source line, mirroring scanPom's ScannedKey convention.
 */
export function parsePomModules(source: string): PomModule[] {
  const modules: PomModule[] = [];
  const blockRe = /<modules>([\s\S]*?)<\/modules>/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(source)) !== null) {
    const blockStart = block.index;
    const moduleRe = /<module>\s*([^<\s]+)\s*<\/module>/g;
    let match: RegExpExecArray | null;
    while ((match = moduleRe.exec(block[1])) !== null) {
      modules.push({
        name: match[1],
        // block[1] starts right after `<modules>`, so match.index is the offset
        // of the `<module>` tag within the whole pom source.
        lineStart: lineAt(source, blockStart + '<modules>'.length + match.index)
      });
    }
  }
  return modules;
}

function textOf(node: SyntaxNode, source: string): string {
  return source.slice(node.from, node.to);
}

/** Simple name of a declared type, e.g. `com.shop.service.OrderService<T>[]` → `OrderService`. */
function simpleTypeName(raw: string): string {
  const withoutGenerics = raw.replace(/<.*>/s, '');
  const withoutArray = withoutGenerics.replace(/\[\s*\]/g, '');
  const last = withoutArray.trim().split('.').pop() ?? withoutArray.trim();
  return last.trim();
}

/**
 * Dogfooding discovery (Issue 17): @lezer/java does not understand the widely
 * used `Type.class` class-literal expression (it is only valid in annotation
 * arguments for some grammars, and this parser rejects it everywhere). On a real
 * Spring Boot repo this aborts parsing for almost every file (`getLogger(Foo.class)`,
 * `Foo.class` in REST bodies...).
 *
 * Strategy: parse once, collect every error (`⚠`) span, and inside each span
 * rewrite `.class` → `.clazz` — a byte-equal rewrite that keeps every source
 * offset stable — then re-parse. Iterate until the tree is clean or no further
 * rewrites are possible. The rewritten identifiers are never emitted as symbols
 * (they are plain field accesses on the type), so the caller sees the same
 * symbol table as a hypothetical class-literal-aware grammar.
 */
export function recoverParseableSource(source: string, maxIterations = 5): { source: string; recovered: boolean } {
  let current = source;
  let recovered = false;
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const tree = parser.parse(current);
    const errorRanges: Array<{ from: number; to: number }> = [];
    tree.iterate({
      enter(ref) {
        if (ref.name === '⚠') errorRanges.push({ from: ref.from, to: ref.to });
      }
    });
    if (errorRanges.length === 0) return { source: current, recovered };

    // Merge overlapping/nested error spans (lezer may report an outer ⚠ plus
    // inner ⚠ nodes) into a sorted, disjoint list before rewriting.
    errorRanges.sort((a, b) => a.from - b.from);
    const merged: Array<{ from: number; to: number }> = [];
    for (const range of errorRanges) {
      const previous = merged[merged.length - 1];
      if (previous && range.from <= previous.to) {
        previous.to = Math.max(previous.to, range.to);
      } else {
        merged.push({ from: range.from, to: range.to });
      }
    }

    let rewritten = false;
    let next = '';
    let cursor = 0;
    for (const range of merged) {
      // A class-literal error span is often exactly the `class` keyword (the
      // dot belongs to the member-access before it), so widen the span by one
      // character to the left when that char is the literal's dot.
      const from = range.from > 0 && current[range.from - 1] === '.' ? range.from - 1 : range.from;
      next += current.slice(cursor, from);
      const slice = current.slice(from, range.to);
      const fixed = slice.replace(/\.class\b/g, '.clazz');
      if (fixed !== slice) rewritten = true;
      next += fixed;
      cursor = range.to;
    }
    next += current.slice(cursor);
    if (!rewritten) return { source: current, recovered: false };
    current = next;
    recovered = true;
  }
  return { source: current, recovered };
}

function collectAnnotations(node: SyntaxNode): SyntaxNode[] {
  const annotations: SyntaxNode[] = [];
  let child = node.firstChild;
  while (child) {
    if (child.name === 'Annotation' || child.name === 'MarkerAnnotation') {
      annotations.push(child);
    } else {
      annotations.push(...collectAnnotations(child));
    }
    child = child.nextSibling;
  }
  return annotations;
}

/**
 * Bug-09: direct annotations on a declaration (annotations attached to the
 * class itself, possibly nested under a `Modifiers` node) — unlike
 * `collectAnnotations` it never descends into method bodies, so a class-level
 * `@RequestMapping("/api")` is not polluted by its methods' route annotations.
 */
function directAnnotationTexts(node: SyntaxNode, source: string): string[] {
  const texts: string[] = [];
  const children = [node];
  while (children.length > 0) {
    const current = children.pop()!;
    let child = current.firstChild;
    while (child) {
      if (child.name === 'Annotation' || child.name === 'MarkerAnnotation') {
        texts.push(textOf(child, source));
      } else if (child.name === 'Modifiers') {
        children.push(child);
      }
      child = child.nextSibling;
    }
  }
  return texts;
}

/** Spring HTTP mapping annotations whose value holds a URL path. */
const MAPPING_ANNOTATIONS = [
  'RequestMapping',
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'DeleteMapping',
  'PatchMapping'
];

/**
 * Bug-09: extract URL path values from mapping annotations. Supports
 * `@GetMapping("/owners")`, `@GetMapping(value = "/owners")`, arrays like
 * `@RequestMapping({"/a", "/b"})` and path templates (`/owners/{id}`).
 * Annotations without a path (e.g. `@RequestMapping(method = GET)`) yield none.
 */
function mappingPathsFromAnnotations(annotationTexts: string[]): string[] {
  const paths: string[] = [];
  const annotationRe = new RegExp(
    `@(?:${MAPPING_ANNOTATIONS.join('|')})\\s*\\(`,
    'g'
  );
  for (const annotation of annotationTexts) {
    const starts = [...annotation.matchAll(annotationRe)];
    if (starts.length === 0) continue;
    // Scan from the first mapping annotation to the end of the annotation text
    // and collect every string literal inside it (array values included).
    const rest = annotation.slice(starts[0].index);
    const literalRe = /["']([^"']*)["']/g;
    let match: RegExpExecArray | null;
    while ((match = literalRe.exec(rest)) !== null) {
      const value = match[1].trim();
      if (value !== '') paths.push(value);
    }
  }
  return paths;
}

/** Combine a class-level prefix and a method-level path into one URL. */
function joinRoutePath(prefix: string | undefined, methodPath: string): string {
  if (!prefix || prefix === '/') return methodPath;
  const base = prefix.replace(/\/+$/, '');
  const tail = methodPath.replace(/^\/+/, '');
  return `${base}/${tail}`;
}

function declarationKind(
  node: SyntaxNode,
  source: string,
  name: string
): RepoSymbol['kind'] {
  const annotationTexts = collectAnnotations(node).map((annotation) =>
    textOf(annotation, source)
  );
  const annotations = annotationTexts.join(' ');
  const lowerName = name.toLowerCase();
  if (/\bRestControllerAdvice\b|\bControllerAdvice\b/.test(annotations)) return 'advice';
  if (/\bRestController\b|\bController\b/.test(annotations)) return 'route';
  if (/\bService\b/.test(annotations) || lowerName.endsWith('service')) return 'service';
  if (/\bRepository\b/.test(annotations) || lowerName.endsWith('repository')) return 'repository';
  return node.name === 'InterfaceDeclaration' ? 'interface' : 'class';
}

/** Interfaces implemented (or extended) by a class/interface declaration. */
function interfaceNames(node: SyntaxNode, source: string): string[] {
  const superInterfaces = node.getChild('SuperInterfaces');
  if (!superInterfaces) return [];
  const typeList = superInterfaces.getChild('InterfaceTypeList');
  const names: string[] = [];
  if (typeList) {
    let child = typeList.firstChild;
    while (child) {
      if (child.name === 'TypeName') names.push(simpleTypeName(textOf(child, source)));
      child = child.nextSibling;
    }
  }
  return names;
}

function methodCallName(node: SyntaxNode, source: string): string | undefined {
  const methodNames = node.getChildren('MethodName');
  if (methodNames.length > 0) {
    const last = methodNames[methodNames.length - 1];
    return textOf(last, source);
  }
  const identifiers = node.getChildren('Identifier');
  if (identifiers.length > 0) {
    const last = identifiers[identifiers.length - 1];
    return textOf(last, source);
  }
  return undefined;
}

export interface MethodScope {
  params: Map<string, string>;
  locals: Map<string, string>;
}

export interface TypeRecord {
  name: string;
  kind: RepoSymbol['kind'];
  fields: Map<string, string>;
}

/**
 * Inspect a MethodInvocation and decide how the receiver is reached:
 * - no receiver / `this`     → implicit this (typed by the enclosing class)
 * - simple identifier        → variable, typed via scope/fields
 * - anything else            → chain/external → dynamic dispatch
 */
function receiverOf(
  node: SyntaxNode,
  source: string
): { receiver?: string; dynamic: boolean } {
  const methodName = node.getChild('MethodName');
  let child = node.firstChild;
  if (!child) return { dynamic: true };
  if (child === methodName) return { receiver: 'this', dynamic: false };
  if (child.name === 'Identifier') return { receiver: textOf(child, source), dynamic: false };
  // Explicit `this` / `super` keywords.
  if (child.name === 'this' || child.name === 'super') {
    return { receiver: child.name, dynamic: child.name === 'super' };
  }
  if (child.name === 'MethodInvocation' || child.name === 'MemberExpression') {
    return { receiver: textOf(child, source), dynamic: true };
  }
  return { receiver: textOf(child, source), dynamic: true };
}

/** Resolve a variable name to its declared type: locals → params → fields → enclosing class. */
function resolveReceiverType(
  receiver: string | undefined,
  scope: MethodScope | undefined,
  typeStack: TypeRecord[]
): string | undefined {
  if (!receiver) return undefined;
  if (receiver === 'this') return typeStack[typeStack.length - 1]?.name;
  if (scope) {
    const local = scope.locals.get(receiver);
    if (local) return local;
    const param = scope.params.get(receiver);
    if (param) return param;
  }
  for (let index = typeStack.length - 1; index >= 0; index -= 1) {
    const field = typeStack[index].fields.get(receiver);
    if (field) return field;
  }
  return undefined;
}

export async function parseJavaFile(
  filePath: string,
  repoId: string,
  root: string
): Promise<RepoSymbol[]> {
  const source = await fs.readFile(filePath, 'utf8');
  const relativePath = path.relative(root, filePath).split(path.sep).join('/');
  const { source: parseSource } = recoverParseableSource(source);
  const tree = parser.parse(parseSource);
  const symbols: RepoSymbol[] = [];
  const methodStack: RepoSymbol[] = [];
  const scopeStack: MethodScope[] = [];
  const typeStack: TypeRecord[] = [];
  // Bug-09: route-path bookkeeping for Spring controllers.
  const routeClassPrefix = new Map<string, string | undefined>();
  const routeFirstMethodPath = new Map<string, string>();
  const routeSymbolStack: number[] = [];

  tree.iterate({
    enter(ref) {
      const node = ref.node;
      try {
        if (node.name === '⚠') {
          throw new Error(`syntax error near line ${lineAt(source, node.from)}`);
        }
        if (node.name === 'ClassDeclaration' || node.name === 'InterfaceDeclaration') {
          const definition = node.getChild('Definition');
          if (!definition) return;
          const name = textOf(definition, source);
          const kind = declarationKind(node, source, name);
          const annotationTexts = directAnnotationTexts(node, source);
          const classPath =
            kind === 'route'
              ? mappingPathsFromAnnotations(annotationTexts)[0]
              : undefined;
          symbols.push({
            repoId,
            kind,
            name,
            filePath: relativePath,
            lineStart: lineAt(source, definition.from),
            lineEnd: lineAt(source, Math.max(definition.from, node.to - 1)),
            signature: textOf(node, source).split(/\r?\n/, 1)[0],
            interfaces: interfaceNames(node, source),
            displayPath: classPath
          });
          if (kind === 'route') {
            routeClassPrefix.set(name, classPath);
            routeSymbolStack.push(symbols.length - 1);
          }
          typeStack.push({ name, kind, fields: new Map() });
          return;
        }

        if (node.name === 'FieldDeclaration') {
          const typeNode = node.getChild('TypeName');
          const typeName = typeNode
            ? simpleTypeName(textOf(typeNode, source))
            : undefined;
          const parentType = typeStack[typeStack.length - 1]?.name;
          for (const declarator of node.getChildren('VariableDeclarator')) {
            const definition = declarator.getChild('Definition');
            if (!definition) continue;
            const name = textOf(definition, source);
            symbols.push({
              repoId,
              kind: 'field',
              name,
              filePath: relativePath,
              lineStart: lineAt(source, definition.from),
              lineEnd: lineAt(source, Math.max(definition.from, node.to - 1)),
              parentType,
              type: typeName
            });
            if (parentType && typeName) {
              const record = typeStack[typeStack.length - 1];
              record.fields.set(name, typeName);
            }
          }
          return;
        }

        if (node.name === 'MethodDeclaration') {
          const definition = node.getChild('Definition');
          if (!definition) return;
          const name = textOf(definition, source);
          const parentType = typeStack[typeStack.length - 1];
          const symbol: RepoSymbol = {
            repoId,
            kind: 'method',
            name,
            filePath: relativePath,
            lineStart: lineAt(source, definition.from),
            lineEnd: lineAt(source, Math.max(definition.from, node.to - 1)),
            signature: textOf(node, source).split(/\r?\n/, 1)[0],
            parentType: parentType?.name,
            calls: []
          };
          // Bug-09: methods inside a controller carry the full URL path
          // (class prefix + method mapping), e.g. `/api/owners/{id}`.
          if (parentType?.kind === 'route') {
            const methodPath =
              mappingPathsFromAnnotations(directAnnotationTexts(node, source))[0];
            if (methodPath) {
              const displayPath = joinRoutePath(
                routeClassPrefix.get(parentType.name),
                methodPath
              );
              symbol.displayPath = displayPath;
              if (!routeFirstMethodPath.has(parentType.name)) {
                routeFirstMethodPath.set(parentType.name, displayPath);
              }
            }
          }
          symbols.push(symbol);
          methodStack.push(symbol);
          const scope: MethodScope = { params: new Map(), locals: new Map() };
          const formalParameters = node.getChild('FormalParameters');
          if (formalParameters) {
            let child = formalParameters.firstChild;
            while (child) {
              if (child.name === 'FormalParameter') {
                const typeNode = child.getChild('TypeName');
                const paramDef = child.getChild('Definition');
                if (typeNode && paramDef) {
                  scope.params.set(
                    textOf(paramDef, source),
                    simpleTypeName(textOf(typeNode, source))
                  );
                }
              }
              child = child.nextSibling;
            }
          }
          scopeStack.push(scope);
          return;
        }

        if (node.name === 'LocalVariableDeclaration') {
          const scope = scopeStack[scopeStack.length - 1];
          if (!scope) return;
          const typeNode = node.getChild('TypeName');
          const typeName = typeNode
            ? simpleTypeName(textOf(typeNode, source))
            : undefined;
          if (!typeName) return;
          for (const declarator of node.getChildren('VariableDeclarator')) {
            const definition = declarator.getChild('Definition');
            if (!definition) continue;
            scope.locals.set(textOf(definition, source), typeName);
          }
          return;
        }

        if (node.name === 'MethodInvocation' && methodStack.length > 0) {
          const calledMethod = methodCallName(node, source);
          if (!calledMethod) return;
          const current = methodStack[methodStack.length - 1];
          const recv = receiverOf(node, source);
          const receiverType = recv.dynamic
            ? undefined
            : resolveReceiverType(recv.receiver, scopeStack[scopeStack.length - 1], typeStack);
          const call: RepoSymbolCall = {
            file: relativePath,
            method: calledMethod,
            line: lineAt(source, node.from),
            receiver: recv.receiver,
            receiverType: receiverType ?? undefined,
            dynamic: recv.dynamic || receiverType === undefined
          };
          const calls = current.calls ?? [];
          if (
            !calls.some(
              (existing) =>
                existing.file === call.file &&
                existing.method === call.method &&
                existing.receiver === call.receiver
            )
          ) {
            calls.push(call);
            current.calls = calls;
          }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`failed to parse ${relativePath}: ${detail}`);
      }
    },
    leave(ref) {
      if (ref.name === 'MethodDeclaration') {
        methodStack.pop();
        scopeStack.pop();
      }
      if (ref.name === 'ClassDeclaration' || ref.name === 'InterfaceDeclaration') {
        const record = typeStack.pop();
        // Bug-09: when a controller class has no class-level mapping, fall back
        // to the first method mapping so the Routes list still shows a URL.
        if (record?.kind === 'route') {
          const index = routeSymbolStack.pop();
          const routeSymbol = index !== undefined ? symbols[index] : undefined;
          if (routeSymbol && !routeSymbol.displayPath) {
            routeSymbol.displayPath = routeFirstMethodPath.get(record.name);
          }
        }
      }
    }
  });

  return symbols;
}