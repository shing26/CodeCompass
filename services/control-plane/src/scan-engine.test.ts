import { describe, expect, it } from 'vitest';
import type { RepoSymbol } from './repoqa-repos';
import { buildCallIndex, type SymbolIndex } from './repoqa-callchain';
import { runScan, SCAN_TOP_LIMIT, OVERSIZED_METHOD_LINES } from './scan-engine';

const JAVA_FILE = 'src/main/java/com/demo/OrdersController.java';

function symbol(overrides: Partial<RepoSymbol> & Pick<RepoSymbol, 'kind' | 'name'>): RepoSymbol {
  return {
    repoId: 'r1',
    filePath: JAVA_FILE,
    ...overrides
  } as RepoSymbol;
}

/** Fixture: 1 route → 1 hub service → 2 repositories; 1 orphan class;
 *  1 oversized method; calls wired through symbol.calls. */
function buildSymbols(): RepoSymbol[] {
  const route = symbol({
    kind: 'route',
    name: 'GET /api/orders',
    lineStart: 10,
    lineEnd: 14,
    calls: [{ file: JAVA_FILE, method: 'listOrders', line: 12, receiver: 'ordersController' }]
  });
  const controller = symbol({
    kind: 'method',
    name: 'listOrders',
    parentType: 'OrdersController',
    lineStart: 12,
    lineEnd: 15,
    calls: [{ file: JAVA_FILE, method: 'findOrders', line: 14, receiver: 'orderService' }]
  });
  const service = symbol({
    kind: 'method',
    name: 'findOrders',
    parentType: 'OrderService',
    lineStart: 20,
    lineEnd: 25,
    calls: [{ file: JAVA_FILE, method: 'findAll', line: 23, receiver: 'orderRepository' }]
  });
  const repository = symbol({
    kind: 'repository',
    name: 'OrderRepository',
    lineStart: 30,
    lineEnd: 40,
    calls: [{ file: JAVA_FILE, method: 'findAll', line: 35, receiver: 'orderRepository' }]
  });
  const findAll = symbol({
    kind: 'method',
    name: 'findAll',
    parentType: 'OrderRepository',
    lineStart: 33,
    lineEnd: 36
  });
  const orphan = symbol({
    kind: 'class',
    name: 'LegacyHelper',
    lineStart: 100,
    lineEnd: 130
  });
  return [route, controller, service, repository, findAll, orphan];
}

const SYMBOLS = buildSymbols();
const INDEX: SymbolIndex = buildCallIndex(SYMBOLS);

const BASE = { repoId: 'r1', repoName: 'demo', symbols: SYMBOLS, index: INDEX };

describe('runScan', () => {
  it('fills all four buckets with deterministic ids and next actions', () => {
    const result = runScan({ ...BASE, baseUrl: 'http://localhost:43110' });
    expect(result.buckets.map((bucket) => bucket.id)).toEqual([
      'orphanedPublic',
      'hubs',
      'oversized',
      'deepChains',
      'oversizedFiles'
    ]);
    for (const bucket of result.buckets) {
      expect(bucket.nextAction).toContain('codecompass_');
      expect(bucket.total).toBeGreaterThanOrEqual(0);
    }
    expect(result.cockpitDeepLink).toContain('?repo=r1');
  });

  it('places zero-caller non-route symbols in orphanedPublic and keeps routes out', () => {
    const result = runScan({ ...BASE, baseUrl: 'http://localhost:43110' });
    const orphans = result.buckets[0];
    expect(orphans.total).toBeGreaterThanOrEqual(1);
    const names = orphans.items.map((item) => item.symbol);
    expect(names).toContain('LegacyHelper');
    for (const item of orphans.items) {
      expect(item.kind).not.toBe('route');
      expect(item.detail).toContain('0 static callers');
    }
    // The orphan note discloses the reflective false-positive boundary.
    expect(orphans.note).toContain('reflective');
  });

  it('ranks the fan-out service as a hub with pagerank and degree evidence', () => {
    const result = runScan({ ...BASE, baseUrl: 'http://localhost:43110' });
    const hubs = result.buckets[1];
    expect(hubs.items.length).toBeGreaterThan(0);
    const top = hubs.items[0];
    expect(top.detail).toMatch(/PageRank 0\.\d{4}; in \d+ \/ out \d+/);
    // Candidate display names carry the parent type when one exists.
    expect(hubs.items.map((item) => item.symbol)).toContain('OrderService.findOrders');
  });

  it('flags a ≥150-line method as oversized with its span as evidence', () => {
    const huge = symbol({
      kind: 'method',
      name: 'godMethod',
      parentType: 'God',
      lineStart: 200,
      lineEnd: 200 + OVERSIZED_METHOD_LINES
    });
    const result = runScan({
      ...BASE,
      symbols: [...SYMBOLS, huge],
      baseUrl: 'http://localhost:43110'
    });
    const oversized = result.buckets[2];
    expect(oversized.total).toBe(1);
    expect(oversized.items[0].symbol).toBe('God.godMethod');
    expect(oversized.items[0].detail).toBe(`spans ${OVERSIZED_METHOD_LINES} lines`);
    expect(oversized.items[0].lineEnd).toBe(huge.lineEnd);
    // The caveat about the line-span proxy is surfaced to the caller.
    expect(oversized.note).toContain('proxy');
  });

  it('returns the deepest route chain in deepChains with depth evidence', () => {
    const result = runScan({ ...BASE, baseUrl: 'http://localhost:43110' });
    const chains = result.buckets[3];
    expect(chains.items.length).toBeGreaterThan(0);
    const top = chains.items[0];
    expect(top.kind).toBe('route');
    expect(top.detail).toMatch(/chain depth \d+: .+ → .+/);
  });

  it('aggregates many medium methods into a file-level debt candidate', () => {
    // Three 200-line methods in one file: none crosses the method threshold
    // (that is the blind spot codex hit), but the file span is 600 lines.
    const piled = [1, 2, 3].map((part) =>
      symbol({
        kind: 'method',
        name: `mediumMethod${part}`,
        parentType: 'Db',
        filePath: 'src/db.py',
        lineStart: part * 210,
        lineEnd: part * 210 + 209
      })
    );
    const result = runScan({
      ...BASE,
      symbols: [...SYMBOLS, ...piled],
      baseUrl: 'http://localhost:43110'
    });
    const files = result.buckets[4];
    expect(files.id).toBe('oversizedFiles');
    expect(files.total).toBe(1);
    expect(files.items[0]).toMatchObject({
      symbol: 'db.py',
      kind: 'file',
      filePath: 'src/db.py',
      detail: expect.stringContaining('629 lines across 3 indexed symbols')
    });
    // Next action pushes the agent back to reading code with evidence.
    expect(files.nextAction).toContain('codecompass_reverse_deps');
  });

  it('is byte-for-byte deterministic across runs', () => {
    const first = JSON.stringify(runScan({ ...BASE, baseUrl: 'http://localhost:43110' }));
    const second = JSON.stringify(runScan({ ...BASE, baseUrl: 'http://localhost:43110' }));
    expect(second).toBe(first);
  });

  it('truncates every bucket to the shared top limit', () => {
    const manyOrphans = Array.from({ length: SCAN_TOP_LIMIT + 5 }, (_, index) =>
      symbol({
        kind: 'class',
        name: `Orphan${index}`,
        filePath: `src/Orphan${index}.java`,
        lineStart: 10,
        lineEnd: 20
      })
    );
    const result = runScan({
      ...BASE,
      symbols: [...SYMBOLS, ...manyOrphans],
      baseUrl: 'http://localhost:43110'
    });
    const orphans = result.buckets[0];
    expect(orphans.items).toHaveLength(SCAN_TOP_LIMIT);
    // 15 synthetic orphans + LegacyHelper + the OrderRepository class (a
    // 0-caller class symbol — its calls point outward, nothing points at it).
    expect(orphans.total).toBe(SCAN_TOP_LIMIT + 5 + 2);
  });
});
