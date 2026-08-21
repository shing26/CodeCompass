import fs from 'node:fs/promises';
import path from 'node:path';
import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/java';
import type { RepoSymbol } from './repoqa-repos';

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
  if (/\bRestController\b|\bController\b/.test(annotations)) return 'route';
  if (/\bService\b/.test(annotations) || lowerName.endsWith('service')) return 'service';
  if (/\bRepository\b/.test(annotations) || lowerName.endsWith('repository')) return 'repository';
  return node.name === 'InterfaceDeclaration' ? 'interface' : 'class';
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

export async function parseJavaFile(
  filePath: string,
  repoId: string,
  root: string
): Promise<RepoSymbol[]> {
  const source = await fs.readFile(filePath, 'utf8');
  const relativePath = path.relative(root, filePath).split(path.sep).join('/');
  const tree = parser.parse(source);
  const symbols: RepoSymbol[] = [];
  const methodStack: RepoSymbol[] = [];

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
          symbols.push({
            repoId,
            kind: declarationKind(node, source, name),
            name,
            filePath: relativePath,
            lineStart: lineAt(source, definition.from),
            lineEnd: lineAt(source, Math.max(definition.from, node.to - 1)),
            signature: textOf(node, source).split(/\r?\n/, 1)[0]
          });
          return;
        }

        if (node.name === 'MethodDeclaration') {
          const definition = node.getChild('Definition');
          if (!definition) return;
          const name = textOf(definition, source);
          const symbol: RepoSymbol = {
            repoId,
            kind: 'method',
            name,
            filePath: relativePath,
            lineStart: lineAt(source, definition.from),
            lineEnd: lineAt(source, Math.max(definition.from, node.to - 1)),
            signature: textOf(node, source).split(/\r?\n/, 1)[0],
            calls: []
          };
          symbols.push(symbol);
          methodStack.push(symbol);
          return;
        }

        if (node.name === 'FieldDeclaration') {
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
              lineEnd: lineAt(source, Math.max(definition.from, node.to - 1))
            });
          }
          return;
        }

        if (node.name === 'MethodInvocation' && methodStack.length > 0) {
          const calledMethod = methodCallName(node, source);
          if (!calledMethod) return;
          const current = methodStack[methodStack.length - 1];
          const calls = current.calls ?? [];
          if (!calls.some(
            (call) => call.file === relativePath && call.method === calledMethod
          )) {
            calls.push({ file: relativePath, method: calledMethod });
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
      }
    }
  });

  return symbols;
}
