import { describe, expect, it } from 'vitest';
import type { RepoSymbol } from './ingest/repoqa-repos';
import { buildCallIndex, type SymbolIndex } from './engine/repoqa-callchain';
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
  // ADR-0018: the class above is no longer an orphan CANDIDATE (types have no
  // caller concept) — it now exercises ruling 1. This callable zero-caller
  // symbol is what keeps the bucket non-empty.
  const orphanMethod = symbol({
    kind: 'method',
    name: 'legacyCompute',
    parentType: 'LegacyHelper',
    lineStart: 110,
    lineEnd: 120
  });
  return [route, controller, service, repository, findAll, orphan, orphanMethod];
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
      // Issue 05: empty buckets get a neutral action — they must not point the
      // agent at a tool call with no candidate to run it on.
      if (bucket.total === 0) {
        expect(bucket.nextAction).not.toContain('codecompass_');
      } else {
        expect(bucket.nextAction).toContain('codecompass_');
      }
      expect(bucket.total).toBeGreaterThanOrEqual(0);
    }
    expect(result.cockpitDeepLink).toContain('?repo=r1');
  });

  it('places zero-caller non-route symbols in orphanedPublic and keeps routes out', () => {
    const result = runScan({ ...BASE, baseUrl: 'http://localhost:43110' });
    const orphans = result.buckets[0];
    expect(orphans.total).toBeGreaterThanOrEqual(1);
    const names = orphans.items.map((item) => item.symbol);
    expect(names).toContain('LegacyHelper.legacyCompute');
    // ADR-0018 ruling 1: the owning CLASS is out of scope — types have no caller.
    expect(names).not.toContain('LegacyHelper');
    for (const item of orphans.items) {
      expect(item.kind).not.toBe('route');
      expect(item.detail).toContain('0 static callers');
    }
    // The orphan note discloses the reflective false-positive boundary.
    expect(orphans.note).toContain('reflective');
  });

  it('narrows the orphan scope to callable symbols and counts what left (ADR-0018 ruling 1)', () => {
    const types = [
      symbol({ kind: 'class', name: 'PlainHelper', lineStart: 200, lineEnd: 210 }),
      symbol({ kind: 'interface', name: 'OrderPort', lineStart: 220, lineEnd: 230 }),
      symbol({ kind: 'service', name: 'AuditService', lineStart: 240, lineEnd: 250 }),
      symbol({ kind: 'repository', name: 'AuditRepo', lineStart: 260, lineEnd: 270 })
    ];
    const result = runScan({
      ...BASE,
      symbols: [...SYMBOLS, ...types],
      baseUrl: 'http://localhost:43110'
    });
    const orphans = result.buckets[0];
    const names = orphans.items.map((item) => item.symbol);
    for (const type of ['PlainHelper', 'OrderPort', 'AuditService', 'AuditRepo']) {
      expect(names).not.toContain(type);
    }
    const census = orphans.census!;
    // The fixture ships one class (LegacyHelper) + one repository (OrderRepository);
    // both were zero-caller candidates before the ruling.
    expect(census.excluded.find((e) => e.rule === 'type-declaration')?.count).toBe(6);
    expect(orphans.census!.excluded.find((e) => e.rule === 'type-declaration')?.deferred).toBeUndefined();
  });

  it('excludes interface members but declares the interface-implementation step as deferred (ADR-0018 ruling 2)', () => {
    const iface = symbol({ kind: 'interface', name: 'PaymentPort', lineStart: 300, lineEnd: 310 });
    const declared = symbol({
      kind: 'method',
      name: 'pay',
      parentType: 'PaymentPort',
      lineStart: 305,
      lineEnd: 306
    });
    // Same-name class + interface: the owner name cannot be disambiguated from
    // the symbol table alone, so it counts as a contract member (fail-closed).
    const ambiguousClass = symbol({ kind: 'class', name: 'AmbiguousPort', lineStart: 320, lineEnd: 325 });
    const ambiguousIface = symbol({ kind: 'interface', name: 'AmbiguousPort', lineStart: 330, lineEnd: 335 });
    const ambiguousMember = symbol({
      kind: 'method',
      name: 'handle',
      parentType: 'AmbiguousPort',
      lineStart: 332,
      lineEnd: 333
    });
    // A method whose owner is a plain class must stay a normal candidate.
    const plainClass = symbol({ kind: 'class', name: 'PlainOwner', lineStart: 340, lineEnd: 350 });
    const classMethod = symbol({
      kind: 'method',
      name: 'compute',
      parentType: 'PlainOwner',
      lineStart: 342,
      lineEnd: 347
    });
    const result = runScan({
      ...BASE,
      symbols: [
        ...SYMBOLS,
        iface,
        declared,
        ambiguousClass,
        ambiguousIface,
        ambiguousMember,
        plainClass,
        classMethod
      ],
      baseUrl: 'http://localhost:43110'
    });
    const orphans = result.buckets[0];
    const names = orphans.items.map((item) => item.symbol);
    expect(names).not.toContain('PaymentPort.pay');
    expect(names).not.toContain('AmbiguousPort.handle');
    expect(names).toContain('PlainOwner.compute');
    const census = orphans.census!;
    // pay + handle (the ambiguous owner is treated as a contract member).
    expect(census.excluded.find((e) => e.rule === 'interface-member')?.count).toBe(2);
    const deferred = census.excluded.find((e) => e.rule === 'interface-implementation');
    expect(deferred?.deferred).toBe(true);
    expect(deferred?.count).toBeUndefined();
  });

  it('marks test-only callers instead of excluding them and keeps the census conserved (ADR-0018 ruling 3)', () => {
    const testCaller = symbol({
      kind: 'method',
      name: 'onlyUsedByTests',
      parentType: 'LegacyHelper',
      lineStart: 150,
      lineEnd: 155
    });
    const harness = symbol({
      kind: 'method',
      name: 'testHarness',
      filePath: 'src/test/java/com/demo/LegacyHelperTest.java',
      lineStart: 20,
      lineEnd: 30,
      calls: [{ file: JAVA_FILE, method: 'onlyUsedByTests', line: 22, receiver: 'legacyHelper' }]
    });
    // The extended symbol set needs its own index: the shared INDEX is built
    // from the base fixture, so a caller added later would not resolve.
    const symbols = [...SYMBOLS, testCaller, harness];
    const result = runScan({
      ...BASE,
      symbols,
      index: buildCallIndex(symbols),
      baseUrl: 'http://localhost:43110'
    });
    const orphans = result.buckets[0];
    const marked = orphans.items.find((item) => item.symbol === 'LegacyHelper.onlyUsedByTests');
    expect(marked?.testOnly).toBe(true);
    // Marked, not excluded: the entry stays in the bucket and in the total.
    expect(orphans.census!.testOnly).toBe(1);
    const unmarked = orphans.items.find((item) => item.symbol === 'LegacyHelper.legacyCompute');
    expect(unmarked?.testOnly).toBeUndefined();
    // Conservation: the census accounts for every entry of the bucket.
    expect(orphans.census!.zeroCallers + orphans.census!.testOnly).toBe(orphans.total);
  });

  it('excludes externally wired symbols from orphanedPublic and counts them (issue 04)', () => {
    const wired = [
      symbol({
        kind: 'method',
        name: 'loadBalancedRestTemplate',
        parentType: 'ApiGatewayApplication',
        lineStart: 55,
        lineEnd: 57,
        annotations: ['@Bean']
      }),
      symbol({
        kind: 'interface',
        name: 'CustomersServiceClient',
        lineStart: 27,
        lineEnd: 41,
        annotations: ['@FeignClient("customers")']
      }),
      symbol({
        kind: 'method',
        name: 'main',
        filePath: 'src/main/java/com/demo/Application.java',
        lineStart: 20,
        lineEnd: 22
      }),
      symbol({
        kind: 'class',
        name: 'PetClinicApplication',
        lineStart: 26,
        lineEnd: 31,
        annotations: ['@SpringBootApplication']
      })
    ];
    const result = runScan({
      ...BASE,
      symbols: [...SYMBOLS, ...wired],
      baseUrl: 'http://localhost:43110'
    });
    const orphans = result.buckets[0];
    const names = orphans.items.map((item) => item.symbol);
    expect(names).not.toContain('loadBalancedRestTemplate');
    expect(names).not.toContain('CustomersServiceClient');
    expect(names).not.toContain('main');
    expect(names).not.toContain('PetClinicApplication');
    expect(orphans.total).toBe(1); // LegacyHelper.legacyCompute — the class itself is out of scope (ADR-0018)
    expect(orphans.wiredExcluded).toBe(4);
    expect(orphans.note).toContain('wiredExcluded');
  });

  it('inherits wired status from the parent type annotation (review fix)', () => {
    // A @Configuration class's own un-annotated zero-caller method must not
    // surface as a teardown candidate; a @FeignClient interface's methods too.
    const configClass = symbol({
      kind: 'config',
      name: 'BeansConfig',
      lineStart: 10,
      lineEnd: 40,
      annotations: ['@Configuration']
    });
    const plainHelper = symbol({
      kind: 'method',
      name: 'buildDefaults',
      parentType: 'BeansConfig',
      lineStart: 20,
      lineEnd: 30
    });
    const feignIface = symbol({
      kind: 'interface',
      name: 'VisitsServiceClient',
      lineStart: 50,
      lineEnd: 60,
      annotations: ['@FeignClient("visits")']
    });
    const feignMethod = symbol({
      kind: 'method',
      name: 'createVisit',
      parentType: 'VisitsServiceClient',
      lineStart: 55,
      lineEnd: 57
    });
    const result = runScan({
      ...BASE,
      symbols: [...SYMBOLS, configClass, plainHelper, feignIface, feignMethod],
      baseUrl: 'http://localhost:43110'
    });
    const orphans = result.buckets[0];
    const names = orphans.items.map((item) => item.symbol);
    expect(names).not.toContain('BeansConfig.buildDefaults');
    expect(names).not.toContain('VisitsServiceClient.createVisit');
    expect(orphans.wiredExcluded).toBe(3); // plainHelper + feignIface + feignMethod; the config class itself is not a graph node (PRODUCTION_KINDS), so never a candidate
  });

  it('keeps accessor methods with real bodies on the hubs board (issue 06)', () => {
    // Pure ≤5-line setter must NOT make the hubs board; a get* method with a
    // real body stays eligible.
    const setter = symbol({
      kind: 'method',
      name: 'setPetId',
      parentType: 'Visit',
      lineStart: 79,
      lineEnd: 81
    });
    const logicGetter = symbol({
      kind: 'method',
      name: 'getOrCreateOwner',
      parentType: 'OwnerService',
      lineStart: 90,
      lineEnd: 120,
      calls: [{ file: JAVA_FILE, method: 'findOrders', line: 100, receiver: 'orderService' }]
    });
    const result = runScan({
      ...BASE,
      symbols: [...SYMBOLS, setter, logicGetter],
      baseUrl: 'http://localhost:43110'
    });
    const hubs = result.buckets[1];
    const hubNames = hubs.items.map((item) => item.symbol);
    expect(hubNames).not.toContain('Visit.setPetId');
    expect(hubNames).toContain('OwnerService.getOrCreateOwner');
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

  it('keeps a route declared in a test file out of deepChains (M2)', () => {
    // V31-02: this bucket resolves chains straight over `symbols`, so it was the
    // one bucket with no test-path filter — a fixture route ranked as a
    // production entry point. Filtering candidates (not the input) must not
    // disturb the surviving entries' depths.
    const fixtureRoute = symbol({
      kind: 'route',
      name: 'GET /boom',
      filePath: 'src/http-error.test.ts',
      lineStart: 25,
      lineEnd: 26,
      calls: [{ file: 'src/http-error.test.ts', method: 'boom', line: 25, receiver: 'router' }]
    });
    const fixtureHandler = symbol({
      kind: 'method',
      name: 'boom',
      parentType: 'Router',
      filePath: 'src/http-error.test.ts',
      lineStart: 26,
      lineEnd: 30,
      calls: [{ file: 'src/http-error.test.ts', method: 'deepen', line: 28, receiver: 'router' }]
    });
    const fixtureTail = symbol({
      kind: 'method',
      name: 'deepen',
      parentType: 'Router',
      filePath: 'src/http-error.test.ts',
      lineStart: 31,
      lineEnd: 33
    });
    const symbols = [...SYMBOLS, fixtureRoute, fixtureHandler, fixtureTail];
    const result = runScan({
      ...BASE,
      symbols,
      index: buildCallIndex(symbols),
      baseUrl: 'http://localhost:43110'
    });
    const chains = result.buckets[3];
    // Deeper than the production fixture, so without the filter it would rank first.
    expect(chains.items.some((item) => item.filePath.includes('.test.'))).toBe(false);
    const production = runScan({ ...BASE, baseUrl: 'http://localhost:43110' }).buckets[3];
    expect(chains.total).toBe(production.total);
    expect(chains.items.map((item) => item.detail)).toEqual(
      production.items.map((item) => item.detail)
    );
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

  it('census conservation is a real cross-rule identity, not algebra (issue 08 P1)', () => {
    // 2026-09-21 review: the shipped assertion was `zeroCallers + testOnly === total`,
    // which is an ALGEBRAIC identity — zeroCallers is computed as `total − testOnly`
    // in the engine, so it could never fire. This pins the meaningful identity and
    // pins the absolute numbers so the test is able to fail:
    //   fixture (base) zero-caller population = LegacyHelper (class) +
    //   OrderRepository (repository) + LegacyHelper.legacyCompute (method) = 3,
    //   of which 2 are type declarations and 1 stays a candidate.
    const result = runScan({ ...BASE, baseUrl: 'http://localhost:43110' });
    const orphans = result.buckets[0];
    const census = orphans.census!;
    const excludedTotal = census.excluded.reduce((sum, rule) => sum + (rule.count ?? 0), 0);

    expect(census.candidatesBeforeRules).toBe(3);
    expect(orphans.total).toBe(1);
    expect(excludedTotal).toBe(2);
    expect(census.candidatesBeforeRules).toBe(orphans.total + excludedTotal);
    // …and the point of the fix in one line: the pre-rule counter must NOT equal
    // the post-rule total (if it did, it was derived from the summands).
    expect(census.candidatesBeforeRules).not.toBe(orphans.total);
  });

  it('truncates every bucket to the shared top limit', () => {
    const manyOrphans = Array.from({ length: SCAN_TOP_LIMIT + 5 }, (_, index) =>
      symbol({
        kind: 'method',
        name: `orphanCompute${index}`,
        parentType: 'LegacyHelper',
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
    // 15 synthetic callable orphans + the fixture's legacyCompute. (The class
    // symbols that used to pad this bucket are out of scope since ADR-0018.)
    expect(orphans.total).toBe(SCAN_TOP_LIMIT + 5 + 1);
  });

  it('gives empty buckets a neutral nextAction instead of a tool pointer (issue 05)', () => {
    // The fixture has no deep chains whose depth reaches a meaningful entry
    // flow beyond what pickTopApis reports — assert whatever bucket ends up
    // empty does not tell the agent to run a tool on a nonexistent candidate.
    const empty = runScan({ ...BASE, symbols: [], index: buildCallIndex([]), baseUrl: 'http://localhost:43110' });
    for (const bucket of empty.buckets) {
      if (bucket.total > 0) continue;
      expect(bucket.items).toHaveLength(0);
      expect(bucket.nextAction).not.toMatch(/Run codecompass_/);
      expect(bucket.nextAction).toMatch(/No candidates/);
    }
    expect(empty.buckets.some((bucket) => bucket.total === 0)).toBe(true);
  });
});
