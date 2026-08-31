import { describe, expect, it } from 'vitest';
import { PrismaAdapter, PRISMA_OPERATIONS } from './PrismaAdapter';
import { TypeScriptAdapter } from './TypeScriptAdapter';
import { buildCallIndex, resolveCallChain } from '../repoqa-callchain';
import type { RepoSymbol } from '../repoqa-repos';

/**
 * v0.15 — Prisma schema adapter + deterministic client bridge. A TS project
 * using `prisma.post.findMany()` must resolve the DATA_MAPPER hop exactly
 * like a Java/MyBatis project resolves a mapper statement.
 */

const SCHEMA = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  authorId  Int
  author    User     @relation(fields: [authorId], references: [id])
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}

enum Role {
  USER
  ADMIN
}
`;

const SERVICE_TS = `
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function publishPost(title: string) {
  return prisma.post.create({ data: { title } });
}

export async function listPosts() {
  return prisma.post.findMany();
}
`;

describe('PrismaAdapter', () => {
  it('emits entity and operation symbols from schema.prisma', () => {
    const symbols = PrismaAdapter.parseSource(SCHEMA, 'prisma/schema.prisma', 'r1');
    const models = symbols.filter((symbol) => symbol.kind === 'repository');
    expect(models.map((symbol) => symbol.name).sort()).toEqual(['Post', 'Role', 'User']);
    const sqls = symbols.filter((symbol) => symbol.kind === 'sql');
    expect(sqls.length).toBe(2 * PRISMA_OPERATIONS.size);
    expect(sqls.some((symbol) => symbol.parentType === 'Post' && symbol.name === 'findMany')).toBe(true);
  });

  it('bridges prisma.post.create() onto the schema operation (4th layer)', () => {
    const prismaSymbols = PrismaAdapter.parseSource(SCHEMA, 'prisma/schema.prisma', 'r1');
    const serviceSymbols = parseService(SERVICE_TS);
    const all = [...prismaSymbols, ...serviceSymbols];
    const index = buildCallIndex(all);

    const publish = serviceSymbols.find((symbol) => symbol.name === 'publishPost')!;
    const trace = resolveCallChain(all, publish, 4, index);
    const tail = trace[trace.length - 1];
    expect(tail.method).toBe('create');
    expect(tail.file).toBe('prisma/schema.prisma');
    expect(tail.break).not.toBe(true);
  });

  it('breaks deterministically when the receiver is not a declared model', () => {
    const prismaSymbols = PrismaAdapter.parseSource(SCHEMA, 'prisma/schema.prisma', 'r1');
    const symbols = [
      ...prismaSymbols,
      ...parseService(
        'export function nope() { return prisma.notAModel.create({}); }'
      )
    ];
    const index = buildCallIndex(symbols);
    const start = symbols.find((symbol) => symbol.name === 'nope')!;
    const trace = resolveCallChain(symbols, start, 4, index);
    expect(trace.some((hop) => hop.break === true)).toBe(true);
  });
});

function parseService(source: string): RepoSymbol[] {
  return TypeScriptAdapter.parseSource(source, 'src/service.ts', 'r1');
}
