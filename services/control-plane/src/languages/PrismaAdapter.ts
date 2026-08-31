import fs from 'node:fs/promises';
import path from 'node:path';
import type { RepoSymbol } from '../repoqa-repos';
import type { LanguageAdapter } from './LanguageAdapter';

/**
 * v0.15 — Prisma schema adapter.
 *
 * Turns `schema.prisma` into data-layer symbols so TypeScript/Node.js
 * projects get the same deterministic DATA_MAPPER hop Java/MyBatis projects
 * have:
 *
 *   model Post { ... }            → kind 'repository' (DATA_MAPPER, entity)
 *   prisma.post.findMany()        → resolved via prismaStatements
 *                                  (`prisma.Post.findMany` → sql symbol)
 *
 * The resolver bridge lives in `repoqa-callchain.ts`: any dynamic call whose
 * receiver tail is a known model name and whose method is a Prisma operation
 * resolves deterministically onto the schema's sql symbol.
 */

/** Every common PrismaClient operation — a finite, deterministic allowlist. */
export const PRISMA_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'aggregate',
  'groupBy',
  'count'
]);

const MODEL_RE = /\bmodel\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
const ENUM_RE = /\benum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1;
  }
  return line;
}

export const PrismaAdapter: LanguageAdapter = {
  canParse(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.prisma');
  },

  async parseFile(filePath: string, repoId: string, root: string): Promise<RepoSymbol[]> {
    const source = await fs.readFile(filePath, 'utf8');
    const relativePath = path.relative(root, filePath).split(path.sep).join('/');
    return this.parseSource(source, relativePath, repoId);
  },

  parseSource(source: string, relativePath: string, repoId: string): RepoSymbol[] {
    const symbols: RepoSymbol[] = [];

    const modelNames: string[] = [];
    let match: RegExpExecArray | null;
    MODEL_RE.lastIndex = 0;
    while ((match = MODEL_RE.exec(source)) !== null) {
      const name = match[1];
      const line = lineAt(source, match.index);
      modelNames.push(name);
      // Entity symbol: DATA_MAPPER layer + radar persistence list.
      symbols.push({
        repoId,
        kind: 'repository',
        name,
        filePath: relativePath,
        lineStart: line,
        lineEnd: line,
        signature: `model ${name}`,
        annotations: ['@PrismaModel']
      });
      // One sql statement per operation: `prisma.<Model>.<op>` bridge target.
      for (const operation of PRISMA_OPERATIONS) {
        symbols.push({
          repoId,
          kind: 'sql',
          name: operation,
          filePath: relativePath,
          lineStart: line,
          lineEnd: line,
          parentType: name,
          signature: `${name}.${operation}()`
        });
      }
    }

    ENUM_RE.lastIndex = 0;
    while ((match = ENUM_RE.exec(source)) !== null) {
      const name = match[1];
      symbols.push({
        repoId,
        kind: 'repository',
        name,
        filePath: relativePath,
        lineStart: lineAt(source, match.index),
        lineEnd: lineAt(source, match.index),
        signature: `enum ${name}`,
        annotations: ['@PrismaEnum']
      });
    }

    return symbols;
  }
};

export default PrismaAdapter;
