import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCallIndex } from './repoqa-callchain';
import type { RepoSymbol } from './repoqa-repos';
import { runDiagnose, frontendCallersForRoute } from './diagnose-engine';
import { runBlastRadius } from './blast-radius';

/**
 * v0.8.0 — Composite agent engines. Deterministic, zero-LLM: every status and
 * count is derived from the statically bound call graph.
 */

const FRONTEND: RepoSymbol = {
  repoId: 'r1',
  kind: 'method',
  name: 'onLike',
  filePath: 'web/src/pages/PostList.tsx',
  lineStart: 30,
  lineEnd: 36,
  parentType: 'PostList',
  calls: [
    { file: 'web/src/pages/PostList.tsx', method: 'likePost', line: 33, http: { method: 'POST', url: '/api/v1/posts/1/like' } }
  ]
};

const ROUTE: RepoSymbol = {
  repoId: 'r1',
  kind: 'route',
  name: 'likePost',
  filePath: 'src/main/java/com/shop/web/PostController.java',
  lineStart: 12,
  lineEnd: 18,
  displayPath: '/api/v1/posts/{id}/like',
  parentType: 'PostController',
  calls: [
    { file: 'src/main/java/com/shop/web/PostController.java', method: 'doLike', line: 15, receiver: 'postService', receiverType: 'PostService' }
  ]
};

const SERVICE: RepoSymbol = {
  repoId: 'r1',
  kind: 'service',
  name: 'PostService',
  filePath: 'src/main/java/com/shop/service/PostService.java',
  lineStart: 8,
  lineEnd: 40
};

const DO_LIKE: RepoSymbol = {
  repoId: 'r1',
  kind: 'method',
  name: 'doLike',
  filePath: 'src/main/java/com/shop/service/PostService.java',
  lineStart: 20,
  lineEnd: 28,
  parentType: 'PostService',
  calls: [
    { file: 'src/main/java/com/shop/service/PostService.java', method: 'insertLike', line: 24, receiver: 'postMapper', receiverType: 'PostMapper' }
  ]
};

const MAPPER_IFACE: RepoSymbol = {
  repoId: 'r1',
  kind: 'interface',
  name: 'PostMapper',
  filePath: 'src/main/java/com/shop/dao/PostMapper.java',
  lineStart: 5,
  lineEnd: 9
};

const SQL: RepoSymbol = {
  repoId: 'r1',
  kind: 'sql',
  name: 'insertLike',
  filePath: 'src/main/resources/mapper/PostMapper.xml',
  lineStart: 5,
  lineEnd: 9,
  parentType: 'PostMapper'
};

const SYMBOLS = [FRONTEND, ROUTE, SERVICE, DO_LIKE, MAPPER_IFACE, SQL];
const INDEX = buildCallIndex(SYMBOLS);

describe('runDiagnose', () => {
  it('traverses the full 4-layer Java chain from a route entry', () => {
    const result = runDiagnose({
      repoId: 'r1',
      entrySymbol: 'POST /api/v1/posts/45/like',
      symbols: SYMBOLS,
      index: INDEX
    });

    expect(result.verifiedChain.map((step) => step.layer)).toEqual([
      'FRONTEND_COMPONENT',
      'HTTP_ROUTER',
      'SERVICE',
      'DATA_MAPPER'
    ]);
    expect(result.verifiedChain.every((step) => step.status === 'VERIFIED')).toBe(true);
    expect(result.verifiedChain[3].filePath).toContain('PostMapper.xml');
    expect(result.rootCauseSummary).toContain('fully verified');
  });

  it('degrades to the indexed layers for a name entry (no invented layers)', () => {
    const result = runDiagnose({
      repoId: 'r1',
      entrySymbol: 'doLike',
      symbols: SYMBOLS,
      index: INDEX
    });
    expect(result.verifiedChain.map((step) => step.layer)).toEqual(['SERVICE', 'DATA_MAPPER']);
    expect(result.entrySymbol).toBe('doLike');
  });

  it('marks a statically unresolvable hop as BROKEN with the reason', () => {
    const brokenService: RepoSymbol = {
      ...DO_LIKE,
      calls: [
        { file: DO_LIKE.filePath, method: 'unknownMethod', line: 24, receiver: 'ghost', dynamic: true }
      ]
    };
    const symbols = [ROUTE, SERVICE, brokenService, MAPPER_IFACE];
    const index = buildCallIndex(symbols);
    const result = runDiagnose({ repoId: 'r1', entrySymbol: 'likePost', symbols, index });
    const broken = result.verifiedChain.find((step) => step.status === 'BROKEN');
    expect(broken).toBeDefined();
    expect(result.rootCauseSummary).toContain('first break');
  });

  it('reports a BROKEN chain when the entry route does not exist', () => {
    const result = runDiagnose({
      repoId: 'r1',
      entrySymbol: 'POST /api/v1/missing',
      symbols: SYMBOLS,
      index: INDEX
    });
    expect(result.verifiedChain).toHaveLength(1);
    expect(result.verifiedChain[0].status).toBe('BROKEN');
  });

  it('omits the frontend layer when no component bridges the route', () => {
    const backendOnly = [ROUTE, SERVICE, DO_LIKE, MAPPER_IFACE, SQL];
    const index = buildCallIndex(backendOnly);
    const result = runDiagnose({
      repoId: 'r1',
      entrySymbol: 'POST /api/v1/posts/1/like',
      symbols: backendOnly,
      index
    });
    expect(result.verifiedChain.map((step) => step.layer)).not.toContain('FRONTEND_COMPONENT');
  });

  it('builds a stable deep link and trace id', () => {
    const a = runDiagnose({ repoId: 'r1', entrySymbol: 'doLike', symbols: SYMBOLS, index: INDEX });
    const b = runDiagnose({ repoId: 'r1', entrySymbol: 'doLike', symbols: SYMBOLS, index: INDEX });
    expect(a.traceId).toBe(b.traceId);
    expect(a.cockpitDeepLink).toContain('repo=r1');
    expect(a.cockpitDeepLink).toContain('focus=doLike');
    expect(a.cockpitDeepLink).toContain(`traceId=${a.traceId}`);
  });

  it('masks sensitive content in code snippets (ADR-0003)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-snippet-'));
    try {
      const serviceFile = path.join(dir, 'PostService.java');
      await fs.writeFile(
        serviceFile,
        'public void doLike() {\n  String password = "super-secret-123";\n}\n',
        'utf8'
      );
      const symbols = SYMBOLS.map((symbol) =>
        symbol === DO_LIKE ? { ...symbol, filePath: 'PostService.java' } : symbol
      );
      const index = buildCallIndex(symbols);
      const result = runDiagnose({
        repoId: 'r1',
        entrySymbol: 'doLike',
        symbols,
        index,
        snippetRoot: dir
      });
      const snippet = result.verifiedChain.find((step) => step.symbol === 'doLike')?.codeSnippet;
      expect(snippet).toBeDefined();
      expect(snippet).not.toContain('super-secret-123');
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('frontendCallersForRoute', () => {
  it('matches bridged fetch calls across path param placeholders', () => {
    const bridges = frontendCallersForRoute(SYMBOLS, '/api/v1/posts/{id}/like');
    expect(bridges).toHaveLength(1);
    expect(bridges[0].symbol.parentType).toBe('PostList');
  });
});

describe('runBlastRadius', () => {
  it('aggregates direct callers, upstream routes and bridged frontend components', () => {
    const result = runBlastRadius({
      repoId: 'r1',
      targetSymbol: 'PostService.doLike',
      changeType: 'SIGNATURE_CHANGE',
      symbols: SYMBOLS,
      index: INDEX
    });
    expect(result.directCallersCount).toBe(1);
    expect(result.indirectCallersCount).toBe(1);
    expect(result.impactedRoutes).toEqual(['/api/v1/posts/{id}/like']);
    expect(result.impactedFrontendComponents).toEqual(['PostList']);
    expect(result.migrationSteps.length).toBeGreaterThan(2);
    expect(result.migrationSteps.join(' ')).toContain('PostList');
  });

  it('scores a leaf symbol with no callers as LOW risk', () => {
    const result = runBlastRadius({
      repoId: 'r1',
      targetSymbol: 'doLike',
      changeType: 'LOGIC_REFACTOR',
      symbols: [SERVICE, DO_LIKE, MAPPER_IFACE, SQL],
      index: buildCallIndex([SERVICE, DO_LIKE, MAPPER_IFACE, SQL])
    });
    expect(result.directCallersCount).toBe(0);
    expect(result.riskLevel).toBe('LOW');
  });

  it('escalates a hub exposing multiple routes to HIGH risk', () => {
    const routeA: RepoSymbol = {
      ...ROUTE,
      name: 'likePost',
      displayPath: '/api/v1/posts/{id}/like'
    };
    const routeB: RepoSymbol = {
      ...ROUTE,
      name: 'unlikePost',
      filePath: 'src/main/java/com/shop/web/PostAdmin.java',
      displayPath: '/api/v1/admin/posts/{id}/like'
    };
    const hub: RepoSymbol = {
      ...DO_LIKE,
      name: 'updateLikes'
    };
    const callerA: RepoSymbol = {
      ...routeA,
      calls: [{ file: routeA.filePath, method: 'updateLikes', line: 15, receiver: 'postService', receiverType: 'PostService' }]
    };
    const callerB: RepoSymbol = {
      ...routeB,
      calls: [{ file: routeB.filePath, method: 'updateLikes', line: 15, receiver: 'postService', receiverType: 'PostService' }]
    };
    const symbols = [FRONTEND, callerA, callerB, SERVICE, hub, MAPPER_IFACE, SQL];
    const index = buildCallIndex(symbols);
    const result = runBlastRadius({
      repoId: 'r1',
      targetSymbol: 'updateLikes',
      changeType: 'REMOVAL',
      symbols,
      index
    });
    expect(result.riskLevel).toBe('HIGH');
    expect(result.impactedRoutes).toHaveLength(2);
  });

  it('throws when the target cannot be resolved', () => {
    expect(() =>
      runBlastRadius({
        repoId: 'r1',
        targetSymbol: 'nope',
        changeType: 'REMOVAL',
        symbols: SYMBOLS,
        index: INDEX
      })
    ).toThrow(/not found/);
  });
});
