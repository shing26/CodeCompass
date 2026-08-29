import { describe, expect, it } from 'vitest';
import { buildCallIndex } from './repoqa-callchain';
import type { RepoSymbol } from './repoqa-repos';
import { runModuleEvolution, transactionBoundaryFor } from './module-evolution-engine';

/**
 * v0.9.0 — Module evolution: fixed-point orphan cascade (DEPRECATE) and
 * attach-point/pattern matching with declaration-level transaction lookup
 * (EXTEND). Deterministic, zero-LLM; patches never produced (ADR-0006).
 */

function moduleSymbol(overrides: Partial<RepoSymbol> & Pick<RepoSymbol, 'name' | 'filePath'>): RepoSymbol {
  return { repoId: 'r1', kind: 'method', lineStart: 1, ...overrides } as RepoSymbol;
}

/* Legacy check-in module being decommissioned. */
const LEGACY_ROUTE = moduleSymbol({
  kind: 'route',
  name: 'checkIn',
  filePath: 'src/main/java/com/shop/legacy/CheckInController.java',
  parentType: 'CheckInController',
  displayPath: '/api/v1/checkin',
  moduleName: 'legacy',
  calls: [
    { file: 'src/main/java/com/shop/legacy/CheckInController.java', method: 'doCheckIn', line: 10, receiver: 'checkInService', receiverType: 'CheckInService' }
  ]
});
const LEGACY_SERVICE = moduleSymbol({
  kind: 'service',
  name: 'CheckInService',
  filePath: 'src/main/java/com/shop/legacy/CheckInService.java',
  moduleName: 'legacy'
});
const LEGACY_METHOD = moduleSymbol({
  name: 'doCheckIn',
  filePath: 'src/main/java/com/shop/legacy/CheckInService.java',
  parentType: 'CheckInService',
  moduleName: 'legacy',
  calls: [
    { file: 'src/main/java/com/shop/legacy/CheckInService.java', method: 'recordCheckIn', line: 14, receiver: 'checkInMapper', receiverType: 'CheckInMapper' }
  ]
});
const LEGACY_MAPPER = moduleSymbol({
  kind: 'repository',
  name: 'CheckInMapper',
  filePath: 'src/main/java/com/shop/legacy/CheckInMapper.java',
  moduleName: 'legacy'
});
const LEGACY_CONFIG = moduleSymbol({
  kind: 'config',
  name: 'checkin.quota',
  filePath: 'src/main/resources/legacy.properties',
  moduleName: 'legacy'
});

/* Shared helper used ONLY by the legacy module → orphan candidate. */
const SHARED_DTO = moduleSymbol({
  kind: 'class',
  name: 'CheckInDto',
  filePath: 'src/main/java/com/shop/common/CheckInDto.java'
});
const SHARED_HELPER = moduleSymbol({
  name: 'formatCheckInDate',
  filePath: 'src/main/java/com/shop/common/DateUtil.java',
  parentType: 'DateUtil'
});
/* Helper used only by SHARED_HELPER → cascaded orphan (reminder #2). */
const CASCADED_HELPER = moduleSymbol({
  name: 'padDay',
  filePath: 'src/main/java/com/shop/common/DayMath.java',
  parentType: 'DayMath'
});

/* Live code that must NOT be orphaned: used by an active service. */
const ACTIVE_SERVICE = moduleSymbol({
  kind: 'service',
  name: 'OrderService',
  filePath: 'src/main/java/com/shop/service/OrderService.java'
});
const ACTIVE_METHOD = moduleSymbol({
  name: 'placeOrder',
  filePath: 'src/main/java/com/shop/service/OrderService.java',
  parentType: 'OrderService'
});
/* CheckInDto-style shared class actually used by live code. */
const LIVE_DTO = moduleSymbol({
  kind: 'class',
  name: 'MoneyDto',
  filePath: 'src/main/java/com/shop/common/MoneyDto.java'
});

const SYMBOLS: RepoSymbol[] = [
  LEGACY_ROUTE,
  LEGACY_SERVICE,
  LEGACY_METHOD,
  LEGACY_MAPPER,
  LEGACY_CONFIG,
  // The legacy service's method uses the shared helpers (module → common edges).
  { ...SHARED_DTO, calls: [] },
  {
    ...SHARED_HELPER,
    calls: [
      { file: SHARED_HELPER.filePath, method: 'padDay', line: 3, receiver: 'dayMath', receiverType: 'DayMath' }
    ]
  },
  CASCADED_HELPER,
  ACTIVE_SERVICE,
  ACTIVE_METHOD,
  LIVE_DTO
];

/* Wires: legacy method reads SHARED_HELPER; nothing but legacy uses it.
   ACTIVE_METHOD uses LIVE_DTO (live code keeps it alive). */
SYMBOLS.splice(
  SYMBOLS.indexOf(LEGACY_METHOD),
  1,
  {
    ...LEGACY_METHOD,
    calls: [
      ...LEGACY_METHOD.calls!,
      { file: LEGACY_METHOD.filePath, method: 'formatCheckInDate', line: 16, receiver: 'dateUtil', receiverType: 'DateUtil' }
    ]
  }
);
SYMBOLS.splice(
  SYMBOLS.indexOf(ACTIVE_METHOD),
  1,
  {
    ...ACTIVE_METHOD,
    calls: [
      { file: ACTIVE_METHOD.filePath, method: 'formatMoney', line: 8, receiver: 'moneyDto', receiverType: 'MoneyDto' }
    ]
  }
);

const INDEX = buildCallIndex(SYMBOLS);

describe('runModuleEvolution DEPRECATE', () => {
  it('clusters the module, counts external callers and emits teardown checklists', () => {
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'DEPRECATE',
      targetSymbolOrModule: 'legacy',
      symbols: SYMBOLS,
      index: INDEX
    });
    expect(result.intentType).toBe('DEPRECATE');
    expect(result.blastRadius.impactedRoutes).toEqual(['/api/v1/checkin']);
    const categories = new Set(result.checklists.map((item) => item.category));
    expect(categories.has('CONTROLLER')).toBe(true);
    expect(categories.has('SERVICE')).toBe(true);
    expect(categories.has('PERSISTENCE')).toBe(true);
    expect(categories.has('CONFIG')).toBe(true);
    expect(result.checklists.join(' ')).not.toContain('undefined');
    // suggestedPatch stays empty on the deterministic engine (ADR-0006).
    expect(result.suggestedPatch).toBeUndefined();
  });

  it('cascades orphaned public code to a fixed point (transitive orphans)', () => {
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'DEPRECATE',
      targetSymbolOrModule: 'legacy',
      symbols: SYMBOLS,
      index: INDEX
    });
    const names = result.blastRadius.orphanedSymbols.map((symbol) => symbol.name);
    // formatCheckInDate: only caller is the legacy method.
    expect(names).toContain('formatCheckInDate');
    // padDay: only caller is the now-orphaned helper — second wave (reminder #2).
    expect(names).toContain('padDay');
    // Live code keeps its DTO alive.
    expect(names).not.toContain('MoneyDto');
  });

  it('throws when the module does not exist', () => {
    expect(() =>
      runModuleEvolution({
        repoId: 'r1',
        intentType: 'DEPRECATE',
        targetSymbolOrModule: 'no-such-module',
        symbols: SYMBOLS,
        index: INDEX
      })
    ).toThrow(/Module not found/);
  });

  it('does not sweep sibling controllers in the same package (Nexus regression)', () => {
    // Two independent controllers in one directory; decommissioning one must
    // not cluster the other (regression: directory-level fallback).
    const demoRoute = moduleSymbol({
      kind: 'route',
      name: 'burstLike',
      filePath: 'src/main/java/com/shop/controller/DemoController.java',
      parentType: 'DemoController',
      displayPath: '/api/demo/burst-like'
    });
    const businessRoute = moduleSymbol({
      kind: 'route',
      name: 'listPosts',
      filePath: 'src/main/java/com/shop/controller/PostController.java',
      parentType: 'PostController',
      displayPath: '/api/v1/posts'
    });
    const symbols = [demoRoute, businessRoute];
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'DEPRECATE',
      targetSymbolOrModule: 'DemoController',
      symbols,
      index: buildCallIndex(symbols)
    });
    expect(result.blastRadius.impactedRoutes).toEqual(['/api/demo/burst-like']);
    expect(result.checklists.map((item) => item.filePath)).toEqual([
      'src/main/java/com/shop/controller/DemoController.java'
    ]);
  });
});

describe('runModuleEvolution EXTEND', () => {
  it('recommends async events when the goal asks for async and emits scaffolds', () => {
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'EXTEND',
      targetSymbolOrModule: 'placeOrder',
      extensionGoal: '增加异步敏感词审查',
      symbols: SYMBOLS,
      index: INDEX
    });
    expect(result.scaffoldTemplates?.[0].suggestedPattern).toBe('SPRING_EVENT_ASYNC');
    expect(result.scaffoldTemplates?.[0].codeSnippet).toContain('@EventListener');
    expect(result.suggestedPatch).toBeUndefined();
  });

  it('defaults to direct injection for a plain goal', () => {
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'EXTEND',
      targetSymbolOrModule: 'placeOrder',
      extensionGoal: '记录扩展指标',
      symbols: SYMBOLS,
      index: INDEX
    });
    expect(result.scaffoldTemplates?.[0].suggestedPattern).toBe('DIRECT_INJECTION');
  });

  it('recommends AOP for class-level cross-cutting attach points', () => {
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'EXTEND',
      targetSymbolOrModule: 'OrderService',
      symbols: SYMBOLS,
      index: INDEX
    });
    // OrderService resolves as a class target (not a method) → AOP.
    expect(result.scaffoldTemplates?.[0].suggestedPattern).toBe('AOP_ASPECT');
  });

  it('throws when the attach point cannot be resolved', () => {
    expect(() =>
      runModuleEvolution({
        repoId: 'r1',
        intentType: 'EXTEND',
        targetSymbolOrModule: 'nope',
        symbols: SYMBOLS,
        index: INDEX
      })
    ).toThrow(/not found/);
  });
});

describe('transactionBoundaryFor (reminder #4)', () => {
  const annotationsIndex = buildCallIndex([
    moduleSymbol({
      kind: 'method',
      name: 'transfer',
      filePath: 'src/TxService.java',
      parentType: 'TxServiceImpl',
      interfaces: ['TxService'],
      annotations: []
    }),
    moduleSymbol({ kind: 'service', name: 'TxServiceImpl', filePath: 'src/TxService.java' }),
    moduleSymbol({
      kind: 'interface',
      name: 'TxService',
      filePath: 'src/TxService.java',
      annotations: ['@Transactional(readOnly = true)']
    })
  ]);

  it('falls back to interface-level @Transactional when the method has none', () => {
    const transfer = annotationsIndex.methodsByName.get('transfer')![0];
    const boundaries = transactionBoundaryFor(transfer, annotationsIndex);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].scope).toBe('INTERFACE');
    expect(boundaries[0].symbol).toBe('TxService');
  });

  it('returns empty when no declaration carries the annotation', () => {
    const boundaries = transactionBoundaryFor(LEGACY_METHOD, INDEX);
    expect(boundaries).toEqual([]);
  });
});
