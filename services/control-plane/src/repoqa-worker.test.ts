import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { EventBus } from './events';
import type { RepoSymbol } from './repoqa-repos';
import { RepoQARepos } from './repoqa-repos';
import {
  annotateTraceHttpMethods,
  findFuzzyStartSymbol,
  fuzzyMatchScore,
  splitIdentifier,
  RepoQAWorker
} from './repoqa-worker';

const isTest = (filePath: string) => filePath.includes('/test/') || filePath.includes('Test.java');

function symbol(partial: Partial<RepoSymbol>): RepoSymbol {
  return {
    id: 0,
    repoId: 'r1',
    kind: 'method',
    name: 'noop',
    filePath: 'src/main/java/com/demo/App.java',
    lineStart: 1,
    lineEnd: 2,
    ...partial
  };
}

describe('splitIdentifier', () => {
  it('splits camelCase into words', () => {
    expect(splitIdentifier('createOwner')).toEqual(['create', 'owner']);
    expect(splitIdentifier('getPetTypes')).toEqual(['get', 'pet', 'types']);
  });

  it('splits snake_case, kebab-case and mixed', () => {
    expect(splitIdentifier('get_pet_types')).toEqual(['get', 'pet', 'types']);
    expect(splitIdentifier('find-owner-by-id')).toEqual(['find', 'owner', 'by', 'id']);
    expect(splitIdentifier('owner')).toEqual(['owner']);
  });
});

describe('fuzzyMatchScore', () => {
  it('scores exact question matches highest', () => {
    expect(fuzzyMatchScore('createOwner', 'createOwner')).toBe(100);
  });

  it('scores a sentence containing the exact symbol name', () => {
    expect(fuzzyMatchScore('how does createOwner work', 'createOwner')).toBe(90);
  });

  it('scores a camelCase word from the sentence', () => {
    expect(fuzzyMatchScore('what creates an owner?', 'createOwner')).toBe(80);
    expect(fuzzyMatchScore('owner flow', 'createOwner')).toBe(80);
  });

  it('scores prefixes and substrings lower', () => {
    expect(fuzzyMatchScore('creat', 'createOwner')).toBe(60);
    expect(fuzzyMatchScore('creates an owner in the app', 'createOwner')).toBe(80);
    expect(fuzzyMatchScore('petTypes', 'getPetTypes')).toBe(50); // word is a suffix of the symbol
    expect(fuzzyMatchScore('reat', 'createOwner')).toBe(40); // plain substring only ('create' → 'reat')
  });

  it('returns 0 when nothing matches', () => {
    expect(fuzzyMatchScore('database transaction', 'createOwner')).toBe(0);
    expect(fuzzyMatchScore('', 'createOwner')).toBe(0);
  });
});

describe('findFuzzyStartSymbol', () => {
  const createOwner = symbol({
    name: 'createOwner',
    filePath: 'src/main/java/com/demo/OwnerController.java',
    kind: 'method'
  });
  const testHelper = symbol({
    name: 'createOwner',
    filePath: 'src/test/java/com/demo/OwnerControllerTest.java',
    kind: 'method'
  });
  const listOwners = symbol({
    name: 'listOwners',
    filePath: 'src/main/java/com/demo/OwnerController.java',
    kind: 'method'
  });
  const ownerService = symbol({
    name: 'OwnerService',
    filePath: 'src/main/java/com/demo/OwnerService.java',
    kind: 'service'
  });

  it('picks the production method over a same-named test helper', () => {
    const picked = findFuzzyStartSymbol('which controller creates an owner?', [testHelper, createOwner], isTest);
    expect(picked).toBe(createOwner);
  });

  it('falls back to a type/route symbol when no method matches', () => {
    const picked = findFuzzyStartSymbol('tell me about the owner service', [ownerService, listOwners], isTest);
    // listOwners scores 0 ('owner' is part of 'owners' → substring length 5 ≥ 4? 'owner'.length=5, name.includes('owner') → 40)
    // OwnerService scores 80 via the 'owner' word → the type wins.
    expect(picked).toBe(ownerService);
  });

  it('returns undefined for an empty symbol list', () => {
    expect(findFuzzyStartSymbol('anything', [], isTest)).toBeUndefined();
  });

  it('prefers a method over a type within the 10-point score band', () => {
    // 'owner' is a whole word in the question → class Owner scores 90; the same
    // word inside createOwner (a camelCase part) scores 80. For a call-chain
    // start the method must win even though the type scores one tier higher —
    // otherwise the type normalizes to an arbitrary first method (getPetsInternal).
    const ownerClass = symbol({
      name: 'Owner',
      filePath: 'src/main/java/com/demo/Owner.java',
      kind: 'class'
    });
    const createOwner = symbol({
      name: 'createOwner',
      filePath: 'src/main/java/com/demo/OwnerController.java',
      kind: 'method'
    });
    const picked = findFuzzyStartSymbol('创建 owner 的方法', [ownerClass, createOwner], isTest);
    expect(picked).toBe(createOwner);
  });

  it('a weakly matching method still loses to a strongly matching type', () => {
    // Outside the band the score dominates: listOwners ('owner' is a prefix of
    // part 'owners' → 60) must not beat OwnerService (both 'owner' and 'service'
    // are parts → 80).
    const ownerService = symbol({
      name: 'OwnerService',
      filePath: 'src/main/java/com/demo/OwnerService.java',
      kind: 'service'
    });
    const listOwners = symbol({
      name: 'listOwners',
      filePath: 'src/main/java/com/demo/OwnerController.java',
      kind: 'method'
    });
    const picked = findFuzzyStartSymbol('tell me about the owner service', [listOwners, ownerService], isTest);
    expect(picked).toBe(ownerService);
  });
});

describe('RepoQAWorker index progress (Bug-R2-04)', () => {
  it('broadcasts live parsed-file counts while parsing many Java files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-worker-progress-'));
    const pkg = path.join(root, 'src', 'main', 'java', 'com', 'demo');
    await fs.mkdir(pkg, { recursive: true });
    for (let index = 0; index < 60; index += 1) {
      await fs.writeFile(
        path.join(pkg, `A${index}.java`),
        `package com.demo;\npublic class A${index} {}\n`
      );
    }

    const db = openDb(':memory:');
    const repoqa = new RepoQARepos(db);
    const eventBus = new EventBus();
    const details: string[] = [];
    const progressPayloads: Array<{ parsedCount?: number; totalFiles?: number }> = [];
    eventBus.on((event) => {
      if (event.type === 'repoqa.index.progress') {
        const payload = event.payload as { detail?: string };
        if (payload.detail) details.push(payload.detail);
        progressPayloads.push(event.payload as { parsedCount?: number; totalFiles?: number });
      }
    });
    const worker = new RepoQAWorker(repoqa, eventBus);
    try {
      const result = await worker.indexRepo({ localPath: root, name: 'many' });
      if (!result.repo) throw new Error('repo row lost');
      expect(result.repo.status).toBe('ready');
      expect(result.repo.fileCount).toBe(60);
      expect(details.some((detail) => detail.includes('Parsing AST... 50 files'))).toBe(true);
      expect(details.some((detail) => detail.includes('Parsing AST... 60 files'))).toBe(true);
      expect(
        progressPayloads.some(
          (payload) => payload.parsedCount === 50 && payload.totalFiles === 60
        )
      ).toBe(true);
      expect(
        progressPayloads.some(
          (payload) => payload.parsedCount === 60 && payload.totalFiles === 60
        )
      ).toBe(true);
    } finally {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('broadcasts staged DISCOVERY/AST/CROSS_LANG_BRIDGE/FINALIZING phases (v0.6.0)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-worker-stages-'));
    const pkg = path.join(root, 'src', 'main', 'java', 'com', 'demo');
    await fs.mkdir(pkg, { recursive: true });
    for (let index = 0; index < 30; index += 1) {
      await fs.writeFile(
        path.join(pkg, `A${index}.java`),
        `package com.demo;\npublic class A${index} {}\n`
      );
    }

    const db = openDb(':memory:');
    const repoqa = new RepoQARepos(db);
    const eventBus = new EventBus();
    const phases: string[] = [];
    const percents: number[] = [];
    eventBus.on((event) => {
      if (event.type === 'repoqa.index.progress') {
        const payload = event.payload as { phase?: string; percent?: number };
        if (payload.phase) phases.push(payload.phase);
        if (typeof payload.percent === 'number') percents.push(payload.percent);
      }
    });
    const worker = new RepoQAWorker(repoqa, eventBus);
    try {
      const result = await worker.indexRepo({ localPath: root, name: 'stages' });
      if (!result.repo) throw new Error('repo row lost');
      expect(result.repo.status).toBe('ready');
      expect(phases).toContain('DISCOVERY');
      expect(phases).toContain('AST_EXTRACTION');
      expect(phases).toContain('CROSS_LANG_BRIDGE');
      expect(phases).toContain('FINALIZING');
      expect(percents).toContain(5);
      expect(percents).toContain(85);
      expect(percents).toContain(95);
      expect(percents).toContain(100);
    } finally {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('returns exact-symbol confidence 1 and default-entry fallback 0.2', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-worker-confidence-'));
    const pkg = path.join(root, 'src', 'main', 'java', 'com', 'demo');
    await fs.mkdir(pkg, { recursive: true });
    await fs.writeFile(
      path.join(pkg, 'App.java'),
      'package com.demo;\npublic class App {\n  public static void main(String[] args) { new Controller().hello(); }\n}\n'
    );
    await fs.writeFile(
      path.join(pkg, 'Controller.java'),
      'package com.demo;\npublic class Controller {\n  public String hello() { return "hi"; }\n}\n'
    );

    const db = openDb(':memory:');
    const repoqa = new RepoQARepos(db);
    const worker = new RepoQAWorker(repoqa, new EventBus());
    try {
      const result = await worker.indexRepo({ localPath: root, name: 'conf' });
      if (!result.repo) throw new Error('repo row lost');
      expect(result.repo.status).toBe('ready');

      const exact = worker.resolveStartSymbolForQuery(result.repo.id, 'hello');
      expect(exact?.symbol.name).toBe('hello');
      expect(exact?.fallback).toBe(false);
      expect(exact?.confidence).toBe(1);

      const fallback = worker.resolveStartSymbolForQuery(result.repo.id, 'zzzz不存在符号');
      expect(fallback?.fallback).toBe(true);
      expect(fallback?.confidence).toBe(0.2);
      expect(fallback?.symbol.kind).toBe('method');

      // Compatibility wrapper still resolves the same symbol.
      expect(worker.findStartSymbolForQuery(result.repo.id, 'hello')?.name).toBe('hello');
    } finally {
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('annotateTraceHttpMethods (v0.10 Stage 1)', () => {
  it('leaves hops without a route displayPath untouched', () => {
    const trace = [
      {
        file: 'src/main/java/com/demo/Service.java',
        method: 'save',
        line: 10,
        lineEnd: 12
      }
    ];
    const symbols = [symbol({ name: 'save', kind: 'method' })];
    expect(annotateTraceHttpMethods(trace, symbols)).toEqual(trace);
  });

  it('attaches HTTP bridge evidence to a matching route hop', () => {
    const route = symbol({
      name: 'likePost',
      kind: 'route',
      filePath: 'src/main/java/com/demo/PostController.java',
      displayPath: '/api/v1/posts/:id/like',
      annotations: ['@PostMapping("/api/v1/posts/{id}/like")']
    });
    const bridge = symbol({
      name: 'likePost',
      kind: 'method',
      filePath: 'src/components/PostCard.tsx',
      lineStart: 30,
      lineEnd: 42,
      parentType: 'PostCard',
      calls: [
        {
          file: 'src/components/PostCard.tsx',
          method: 'likePost',
          line: 41,
          http: { method: 'POST', url: '/api/v1/posts/45/like' }
        }
      ]
    });
    const trace = [
      {
        file: route.filePath,
        method: route.name,
        line: 12,
        lineEnd: 20
      }
    ];
    const annotated = annotateTraceHttpMethods(trace, [route, bridge]);
    expect(annotated).toHaveLength(1);
    expect(annotated[0].http).toEqual({ method: 'POST', url: '/api/v1/posts/45/like' });
  });

  it('preserves an existing http field without re-annotating', () => {
    const trace = [
      {
        file: 'src/main/java/com/demo/PostController.java',
        method: 'likePost',
        http: { method: 'GET', url: '/api/v1/posts/1' }
      }
    ];
    const symbols = [symbol({ name: 'likePost', kind: 'route', displayPath: '/api/v1/posts/:id' })];
    expect(annotateTraceHttpMethods(trace, symbols)).toEqual(trace);
  });

  it('keeps the hop unchanged when no frontend bridge matches', () => {
    const route = symbol({
      name: 'likePost',
      kind: 'route',
      filePath: 'src/main/java/com/demo/PostController.java',
      displayPath: '/api/v1/posts/:id/like'
    });
    const trace = [{ file: route.filePath, method: route.name, line: 12 }];
    const annotated = annotateTraceHttpMethods(trace, [route]);
    expect(annotated[0].http).toBeUndefined();
  });
});
