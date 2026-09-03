import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/java';
import type { RepoSymbol, RepoSymbolCall } from '../repoqa-repos';
import type { LanguageAdapter } from './LanguageAdapter';

export function lineAt(source: string, offset: number): number {
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

/* ------------------------------------------------------------------ */
/* Issue 21 — record declarations (Java 16+)                           */
/* ------------------------------------------------------------------ */

export interface RecordComponent {
  name: string;
  /** Declared component type (raw, generics kept), e.g. `List<OrderItem>`. */
  type: string;
  /** Offset of the component *name* inside the original source (unpatched). */
  nameOffset: number;
}

export interface RecordDeclarationPatch {
  name: string;
  /** Offset of the `record` keyword in the original source. */
  recordOffset: number;
  /** Offset of the opening `(` of the component list. */
  openOffset: number;
  /** Offset of the closing `)` of the component list. */
  closeOffset: number;
  components: RecordComponent[];
}

/** Split a string on `sep`, ignoring separators inside `(...)`, `<...>` and string literals. */
function splitTopLevel(text: string, sep: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === '"' && text[index - 1] !== '\\') inString = !inString;
    if (inString) continue;
    if (ch === '(' || ch === '<') depth += 1;
    else if (ch === ')' || ch === '>') depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Parse `type name` pairs from a record component list body (annotations stripped). */
export function parseRecordComponents(
  source: string,
  componentsText: string,
  baseOffset: number
): RecordComponent[] {
  const components: RecordComponent[] = [];
  const segments = splitTopLevel(componentsText, ',');
  let cursor = 0;
  for (const segment of segments) {
    const relStart = componentsText.indexOf(segment, cursor);
    cursor = relStart + segment.length;
    const nameMatch = /([A-Za-z_$][\w$]*)\s*$/.exec(segment);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const typeRaw = segment
      .slice(0, nameMatch.index)
      .replace(/@[A-Za-z_$][\w$]*(?:\s*\([^)]*\))?/g, ' ')
      .trim();
    if (!typeRaw) continue;
    components.push({
      name,
      type: typeRaw,
      nameOffset: baseOffset + relStart + nameMatch.index
    });
  }
  return components;
}

/**
 * Issue 21 — Java `record` declarations are not understood by @lezer/java; on a
 * real repo a single record DTO aborts parsing of the whole file (it is skipped
 * by the worker). Patch every top-level `record Name(components) { … }` into an
 * offset-stable, byte-equal `class` declaration:
 *
 *   `record`  → `class `           (6 chars, keeps every later offset stable)
 *   `(…)`     → same-length blanks (newlines preserved so line numbers survive)
 *
 * The rewritten tree yields a normal ClassDeclaration (methods inside the body
 * still parse), while `RecordDeclarationPatch` enables the caller to emit the
 * components as read-only field/accessor symbols from the *original* source.
 */
export function patchRecordDeclarations(source: string): {
  source: string;
  patches: RecordDeclarationPatch[];
} {
  const patches: RecordDeclarationPatch[] = [];
  const recordRe = /\brecord\s+([A-Za-z_$][\w$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = recordRe.exec(source)) !== null) {
    const recordOffset = match.index;
    const name = match[1];
    const openOffset = source.indexOf('(', match.index + match[0].length);
    if (openOffset === -1) continue;
    let depth = 0;
    let closeOffset = -1;
    let inString = false;
    for (let index = openOffset; index < source.length; index += 1) {
      const ch = source[index];
      if (ch === '"' && source[index - 1] !== '\\') inString = !inString;
      if (inString) continue;
      if (ch === '(') depth += 1;
      else if (ch === ')' && --depth === 0) {
        closeOffset = index;
        break;
      }
    }
    if (closeOffset === -1) continue;
    const components = parseRecordComponents(
      source,
      source.slice(openOffset + 1, closeOffset),
      openOffset + 1
    );
    patches.push({ name, recordOffset, openOffset, closeOffset, components });
  }

  let patched = source;
  for (const patch of patches) {
    const recordEnd = patch.recordOffset + 'record'.length;
    patched =
      patched.slice(0, patch.recordOffset) +
      'class ' +
      patched.slice(recordEnd);
    const body = patched.slice(patch.openOffset, patch.closeOffset + 1);
    const blanked = body
      .split('')
      .map((ch) => (ch === '\n' ? '\n' : ' '))
      .join('');
    patched =
      patched.slice(0, patch.openOffset) +
      blanked +
      patched.slice(patch.closeOffset + 1);
  }
  return { source: patched, patches };
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
export function joinRoutePath(prefix: string | undefined, methodPath: string): string {
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

/** Issue 24 / ADR-0014: simple name of the `extends` superclass, if any. */
function superclassOf(node: SyntaxNode, source: string): string | undefined {
  const superclass = node.getChild('Superclass');
  if (!superclass) return undefined;
  const typeName = superclass.getChild('TypeName');
  return typeName ? simpleTypeName(textOf(typeName, source)) : undefined;
}

/**
 * Issue 24 / ADR-0014: simple return type of a method declaration — the type
 * node preceding `Definition` (`ApiResult<OrderDto> getOrder(...)` →
 * `ApiResult`, `void run()` → `void`). Undefined for constructors.
 */
function methodReturnType(node: SyntaxNode, source: string): string | undefined {
  const definition = node.getChild('Definition');
  if (!definition) return undefined;
  let child = node.firstChild;
  let typeNode: SyntaxNode | undefined;
  while (child && child !== definition) {
    if (child.name === 'TypeName' || child.name === 'GenericType' || child.name === 'void') {
      typeNode = child;
    }
    child = child.nextSibling;
  }
  return typeNode ? simpleTypeName(textOf(typeNode, source)) : undefined;
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
  let child = node.firstChild;
  if (!child) return { dynamic: true };
  // Compare by node name, not identity: @lezer may hand back distinct wrapper
  // instances for the same tree position, so `child === methodName` is not
  // reliable and would mislabel bare calls (`findCached(id)`) as dynamic.
  if (child.name === 'MethodName') return { receiver: 'this', dynamic: false };
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
  return parseJavaSource(source, relativePath, repoId);
}

/**
 * Issue 22 — parse Java source already in memory (git objects read by the
 * `codecompass diff` impact analysis) into the same symbol table as
 * parseJavaFile. `relativePath` is the repo-root-relative path used for
 * cross-file call resolution.
 */
export function parseJavaSource(
  source: string,
  relativePath: string,
  repoId: string
): RepoSymbol[] {
  // Issue 21: Java 16+ records are not understood by @lezer/java — patch them
  // into offset-stable class declarations first, then run the existing
  // class-literal recovery. Both passes keep every source offset byte-equal, so
  // line numbers below stay exact.
  const { source: recordPatched, patches } = patchRecordDeclarations(source);
  const { source: parseSource } = recoverParseableSource(recordPatched);
  const tree = parser.parse(parseSource);
  const symbols: RepoSymbol[] = [];
  const methodStack: RepoSymbol[] = [];
  const scopeStack: MethodScope[] = [];
  const typeStack: TypeRecord[] = [];
  // Bug-09: route-path bookkeeping for Spring controllers.
  const routeClassPrefix = new Map<string, string | undefined>();
  const routeFirstMethodPath = new Map<string, string>();
  const routeSymbolStack: number[] = [];
  // Issue 21: record declarations consumed in source order as their patched
  // ClassDeclaration siblings are visited (both traversals are pre-order).
  const recordQueue = [...patches].sort((a, b) => a.recordOffset - b.recordOffset);

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
            // Issue 24 / ADR-0014: direct superclass for the base-class
            // convention axis (`extends BaseService` → `BaseService`).
            superClass: superclassOf(node, source),
            displayPath: classPath,
            // Issue 21: class-level annotations feed Spring bean disambiguation
            // (@Primary, @Service("name"), @Component("name"), …).
            annotations: annotationTexts
          });
          if (kind === 'route') {
            routeClassPrefix.set(name, classPath);
            routeSymbolStack.push(symbols.length - 1);
          }
          typeStack.push({ name, kind, fields: new Map() });

          // Issue 21: a record patched into a class carries its components —
          // emit each as a read-only field plus its canonical accessor method.
          const pendingRecord =
            recordQueue.length > 0 && recordQueue[0].name === name
              ? recordQueue[0]
              : undefined;
          if (pendingRecord) {
            recordQueue.shift();
            for (const component of pendingRecord.components) {
              const componentLine = lineAt(source, component.nameOffset);
              const componentType = simpleTypeName(component.type);
              symbols.push({
                repoId,
                kind: 'field',
                name: component.name,
                filePath: relativePath,
                lineStart: componentLine,
                lineEnd: componentLine,
                parentType: name,
                type: componentType
              });
              symbols.push({
                repoId,
                kind: 'method',
                name: component.name,
                filePath: relativePath,
                lineStart: componentLine,
                lineEnd: componentLine,
                parentType: name,
                signature: `${componentType} ${component.name}()`,
                calls: []
              });
              const record = typeStack[typeStack.length - 1];
              record?.fields.set(component.name, componentType);
            }
          }
          return;
        }

        if (node.name === 'FieldDeclaration') {
          const typeNode = node.getChild('TypeName');
          const typeName = typeNode
            ? simpleTypeName(textOf(typeNode, source))
            : undefined;
          const parentType = typeStack[typeStack.length - 1]?.name;
          // Issue 21: field-level annotations (@Autowired, @Qualifier("x"),
          // @Resource(name=…)) drive Spring bean disambiguation.
          const fieldAnnotations = directAnnotationTexts(node, source);
          // Issue 24 / ADR-0014: declaration line without annotations — the
          // `private final` markers feed the DI-style convention axis.
          const declarationLine = textOf(node, source)
            .replace(/@[\w.]+(\([^)]*\))?/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/;$/, '');
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
              type: typeName,
              ...(declarationLine ? { signature: declarationLine } : {}),
              annotations: fieldAnnotations
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
            // Issue 24 / ADR-0014: return type feeds the wrapping axis.
            returnType: methodReturnType(node, source),
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
          // Issue 21: method-level annotations (kept for completeness;
          // @Primary/bean-name annotations matter on classes, injection
          // annotations on fields/parameters).
          symbol.annotations = directAnnotationTexts(node, source);
          symbols.push(symbol);
          methodStack.push(symbol);
          const scope: MethodScope = { params: new Map(), locals: new Map() };
          const formalParameters = node.getChild('FormalParameters');
          let paramAnnotations: Record<string, string[]> | undefined;
          if (formalParameters) {
            let child = formalParameters.firstChild;
            while (child) {
              if (child.name === 'FormalParameter') {
                const typeNode = child.getChild('TypeName');
                const paramDef = child.getChild('Definition');
                if (typeNode && paramDef) {
                  const paramName = textOf(paramDef, source);
                  scope.params.set(
                    paramName,
                    simpleTypeName(textOf(typeNode, source))
                  );
                  // Issue 21: constructor/setter injection points — @Qualifier/
                  // @Resource on a parameter disambiguates interface targets.
                  const paramAnnos = directAnnotationTexts(child, source);
                  if (paramAnnos.length > 0) {
                    paramAnnotations ??= {};
                    paramAnnotations[paramName] = paramAnnos;
                  }
                }
              }
              child = child.nextSibling;
            }
          }
          if (paramAnnotations) symbol.paramAnnotations = paramAnnotations;
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

/**
 * Issue 25 — Java family adapter. Keeps the exact parse behavior the rest of
 * the codebase relies on (records, class-literal recovery, Spring route
 * annotations) behind the shared `LanguageAdapter` contract.
 */
export const JavaAdapter: LanguageAdapter = {
  canParse(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.java');
  },
  parseFile(filePath: string, repoId: string, root: string): Promise<RepoSymbol[]> {
    return parseJavaFile(filePath, repoId, root);
  },
  parseSource(source: string, relativePath: string, repoId: string): RepoSymbol[] {
    return parseJavaSource(source, relativePath, repoId);
  }
};
