import { describe, expect, it } from 'vitest';
import { buildCallIndex } from './repoqa-callchain';
import type { RepoSymbol } from './repoqa-repos';
import {
  buildRadarGraph,
  computePageRank,
  runDomainRadar
} from './domain-radar-engine';

/**
 * v0.9.0 — Domain radar: degree/pageank aggregation and deterministic intent
 * anchors. Zero LLM, zero embeddings; Chinese intents rely on chunk hits.
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
    {
      file: 'web/src/pages/PostList.tsx',
      method: 'likePost',
      line: 33,
      http: { method: 'POST', url: '/api/v1/posts/1/like' }
    }
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
    {
      file: 'src/main/java/com/shop/web/PostController.java',
      method: 'doLike',
      line: 15,
      receiver: 'postService',
      receiverType: 'PostService'
    }
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
  signature: 'public void doLike(Post post)',
  calls: [
    {
      file: 'src/main/java/com/shop/service/PostService.java',
      method: 'insertLike',
      line: 24,
      receiver: 'postMapper',
      receiverType: 'PostMapper'
    }
  ]
};

const MAPPER_IFACE: RepoSymbol = {
  repoId: 'r1',
  kind: 'interface',
  name: 'PostMapper',
  filePath: 'src/main/java/com/shop/dao/PostMapper.java',
  lineStart: 5,
  lineEnd: 9,
  signature: 'interface PostMapper { List<Post> selectPosts(); }'
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

const POST_MODEL: RepoSymbol = {
  repoId: 'r1',
  kind: 'class',
  name: 'Post',
  filePath: 'src/main/java/com/shop/model/Post.java',
  lineStart: 3,
  lineEnd: 10
};

const SYMBOLS = [FRONTEND, ROUTE, SERVICE, DO_LIKE, MAPPER_IFACE, SQL, POST_MODEL];
const INDEX = buildCallIndex(SYMBOLS);

describe('buildRadarGraph', () => {
  it('counts bridge edges into controller in-degree and excludes sinks from out-degree', () => {
    const graph = buildRadarGraph(SYMBOLS, INDEX);
    const routeId = [...graph.symbolsById.entries()].find(
      ([, symbol]) => symbol.name === 'likePost'
    )![0];
    const sqlId = [...graph.symbolsById.entries()].find(
      ([, symbol]) => symbol.kind === 'sql'
    )![0];
    // The TS fetch call bridges into the Java route (reminder #1b).
    expect(graph.inDegree.get(routeId)).toBeGreaterThanOrEqual(1);
    // SQL leaf has no outgoing edges (sink).
    expect(graph.outDegree.get(sqlId)).toBe(0);
  });
});

describe('computePageRank', () => {
  it('is a probability distribution and keeps sink mass in the graph', () => {
    const graph = buildRadarGraph(SYMBOLS, INDEX);
    const rank = computePageRank([...graph.symbolsById.keys()], graph.edges);
    const total = [...rank.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 5);
    expect(rank.size).toBe(graph.symbolsById.size);
  });

  it('is deterministic across runs', () => {
    const graph = buildRadarGraph(SYMBOLS, INDEX);
    const ids = [...graph.symbolsById.keys()];
    const a = computePageRank(ids, graph.edges);
    const b = computePageRank(ids, graph.edges);
    for (const id of ids) expect(a.get(id)).toBe(b.get(id));
  });
});

describe('runDomainRadar', () => {
  it('ranks the route as top API and surfaces mapper/entity persistence layer', () => {
    const result = runDomainRadar({ repoId: 'r1', symbols: SYMBOLS, index: INDEX });
    expect(result.topApis[0]).toContain('/api/v1/posts/{id}/like');
    expect(result.persistenceEntities).toContain('PostMapper');
    // Post is declared in doLike's signature, reachable through the mapper.
    expect(result.persistenceEntities).toContain('Post');
    expect(result.hubNodes.length).toBeGreaterThan(0);
    expect(result.hubNodes[0].pagerank).toBeGreaterThan(0);
  });

  it('matches a latin intent through the fuzzy chain', () => {
    const result = runDomainRadar({
      repoId: 'r1',
      query: 'doLike',
      symbols: SYMBOLS,
      index: INDEX
    });
    expect(result.matchedAnchors.length).toBeGreaterThan(0);
    expect(result.matchedAnchors[0].symbol).toContain('doLike');
    expect(result.matchedAnchors[0].type).toBe('SERVICE');
    expect(result.matchedAnchors[0].relevanceScore).toBeGreaterThan(40);
    // v0.18 — provenance: a direct identifier hit is labeled as such.
    expect(result.matchedAnchors[0].matchedBy).toBe('identifier');
    for (const anchor of result.matchedAnchors) {
      expect(['identifier', 'doc-chunk', 'graph-rank']).toContain(anchor.matchedBy);
    }
  });

  it('matches a Chinese intent through doc-chunk evidence', () => {
    const result = runDomainRadar({
      repoId: 'r1',
      query: '点赞',
      symbols: SYMBOLS,
      index: INDEX,
      chunkHitFiles: ['src/main/java/com/shop/service/PostService.java']
    });
    expect(result.matchedAnchors.length).toBeGreaterThan(0);
    expect(result.matchedAnchors[0].symbol).toContain('doLike');
    expect(result.matchedAnchors[0].relevanceScore).toBeGreaterThanOrEqual(70);
    // v0.18 — provenance: no identifier overlap with the Chinese intent, the
    // doc-chunk bridge is what lifted this anchor.
    expect(result.matchedAnchors[0].matchedBy).toBe('doc-chunk');
  });

  it('returns empty anchors for an unmatched intent without evidence', () => {
    const result = runDomainRadar({
      repoId: 'r1',
      query: '点赞',
      symbols: SYMBOLS,
      index: INDEX
    });
    expect(result.matchedAnchors).toEqual([]);
  });
});
