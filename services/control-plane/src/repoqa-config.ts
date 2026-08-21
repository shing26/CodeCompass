import fs from 'node:fs/promises';
import path from 'node:path';
import type { RepoSymbol } from './repoqa-repos';

function configNameFromLine(line: string): string | undefined {
  const match = line.match(/^\s*([A-Za-z0-9._-]+):/);
  if (!match) return undefined;
  return match[1];
}

function propertyKeyFromLine(line: string): string | undefined {
  const match = line.match(/^([A-Za-z0-9._-]+)\s*[=:]/);
  return match?.[1];
}

export async function extractConfigSymbols(
  repoId: string,
  root: string,
  files: string[]
): Promise<RepoSymbol[]> {
  const symbols: RepoSymbol[] = [];

  for (const filePath of files) {
    const fileName = path.basename(filePath).toLowerCase();
    const isApplication =
      fileName.startsWith('application') &&
      (/\.ya?ml$/.test(fileName) || fileName.endsWith('.properties'));
    const isPom = fileName === 'pom.xml';
    if (!isApplication && !isPom) continue;

    let source: string;
    try {
      source = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const relativePath = path.relative(root, filePath).split(path.sep).join('/');

    if (isPom) {
      for (const match of source.matchAll(/<(groupId|artifactId|version)>/g)) {
        symbols.push({
          repoId,
          kind: 'config',
          name: match[1],
          filePath: relativePath,
          lineStart: lineAt(source, match.index)
        });
      }
      continue;
    }

    if (/\.ya?ml$/.test(fileName)) {
      const lines = source.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (!line.trim() || line.trim().startsWith('#')) return;
        const name = configNameFromLine(line);
        if (name) {
          symbols.push({
            repoId,
            kind: 'config',
            name,
            filePath: relativePath,
            lineStart: index + 1
          });
        }
      });
      continue;
    }

    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      const name = propertyKeyFromLine(line);
      if (name) {
        symbols.push({
          repoId,
          kind: 'config',
          name,
          filePath: relativePath,
          lineStart: index + 1
        });
      }
    });
  }

  return symbols;
}

function lineAt(source: string, offset: number | undefined): number | undefined {
  if (offset === undefined) return undefined;
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}
