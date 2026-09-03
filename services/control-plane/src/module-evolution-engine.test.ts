import { describe, expect, it } from 'vitest';
import { buildCallIndex } from './repoqa-callchain';
import type { RepoSymbol } from './repoqa-repos';
import { ConventionConflictError, runModuleEvolution, transactionBoundaryFor } from './module-evolution-engine';

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
      annotations: []
    }),
    // Real adapters write `interfaces` on the CLASS declaration only — the
    // method symbol carries none. The lookup must read the impl's list.
    moduleSymbol({
      kind: 'service',
      name: 'TxServiceImpl',
      filePath: 'src/TxService.java',
      interfaces: ['TxService']
    }),
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

/* ------------------------------------------------------------------ */
/* Issue 24.3 (ADR-0014) — convention-aware EXTEND pipeline            */
/* ------------------------------------------------------------------ */

describe('runModuleEvolution EXTEND conventions (Issue 24.3)', () => {
  /**
   * Split + wrapped + constructor-injection repo (all axes 100% → STRICT):
   * UsersController returns ApiResult 5/5, UserService/UserServiceImpl split,
   * UserServiceImpl wires two beans via `private final` fields.
   */
  function conventionRepo(): RepoSymbol[] {
    const controller = moduleSymbol({
      kind: 'route',
      name: 'UsersController',
      filePath: 'src/main/java/com/shop/user/UsersController.java',
      parentType: 'UsersController',
      displayPath: '/api/users'
    });
    const routeMethods = ['listUsers', 'getUser', 'createUser', 'updateUser', 'deleteUser'].map(
      (name, i) =>
        moduleSymbol({
          name,
          filePath: controller.filePath,
          parentType: 'UsersController',
          returnType: 'ApiResult',
          lineStart: 12 + i * 4
        })
    );
    const userService = moduleSymbol({
      kind: 'service',
      name: 'UserService',
      filePath: 'src/main/java/com/shop/user/UserService.java'
    });
    const userServiceImpl = moduleSymbol({
      kind: 'service',
      name: 'UserServiceImpl',
      filePath: 'src/main/java/com/shop/user/UserServiceImpl.java',
      interfaces: ['UserService']
    });
    const userRepository = moduleSymbol({
      kind: 'repository',
      name: 'UserRepository',
      filePath: 'src/main/java/com/shop/user/UserRepository.java'
    });
    const userMapper = moduleSymbol({
      kind: 'mapper',
      name: 'UserMapper',
      filePath: 'src/main/java/com/shop/user/UserMapper.java'
    });
    const fields = [
      moduleSymbol({
        kind: 'field',
        name: 'userRepository',
        filePath: userServiceImpl.filePath,
        parentType: 'UserServiceImpl',
        type: 'UserRepository',
        signature: 'private final UserRepository userRepository',
        lineStart: 3
      }),
      moduleSymbol({
        kind: 'field',
        name: 'userMapper',
        filePath: userServiceImpl.filePath,
        parentType: 'UserServiceImpl',
        type: 'UserMapper',
        signature: 'private final UserMapper userMapper',
        lineStart: 5
      })
    ];
    const charge = moduleSymbol({
      name: 'charge',
      filePath: userServiceImpl.filePath,
      parentType: 'UserServiceImpl',
      lineStart: 20
    });
    return [controller, ...routeMethods, userService, userServiceImpl, userRepository, userMapper, ...fields, charge];
  }

  it('follows the split convention: interface + impl double-file placement', () => {
    const symbols = conventionRepo();
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'EXTEND',
      targetSymbolOrModule: 'charge',
      extensionGoal: '记录扩展指标',
      symbols,
      index: buildCallIndex(symbols)
    });
    // Placement plan mirrors the repo's own interface/impl split.
    expect(result.placement?.files).toEqual([
      { filePath: 'src/main/java/com/shop/user/UserServiceImplExtension.java', role: 'interface' },
      { filePath: 'src/main/java/com/shop/user/UserServiceImplExtensionImpl.java', role: 'impl' }
    ]);
    expect(result.placement?.packagePath).toBe('com.shop.user');
    // Handler signature mirrors the wrapped-return convention (no hardcoded name).
    expect(result.placement?.handlerSignature).toBe('public ApiResult<String> onUserServiceImpl(/* context */)');
    expect(result.placement?.injection.style).toBe('constructor');
    expect(result.placement?.injection.codeSnippet).toContain('private final UserServiceImplExtension');
    // Both scaffolds exist; the impl implements the interface and overrides the handler.
    expect(result.scaffoldTemplates).toHaveLength(2);
    expect(result.scaffoldTemplates?.[0].filePath).toBe('src/main/java/com/shop/user/UserServiceImplExtension.java');
    expect(result.scaffoldTemplates?.[1].filePath).toBe('src/main/java/com/shop/user/UserServiceImplExtensionImpl.java');
    expect(result.scaffoldTemplates?.[1].codeSnippet).toContain('@Override');
    expect(result.scaffoldTemplates?.[1].codeSnippet).toContain('implements UserServiceImplExtension');
    expect(result.scaffoldTemplates?.[1].codeSnippet).toContain('Wire the extension into UserServiceImpl (constructor injection)');
    // CREATE checklist follows the placement: one item per scaffold file.
    const creates = result.checklists.filter((item) => item.action === 'CREATE');
    expect(creates.map((item) => item.filePath)).toEqual([
      'src/main/java/com/shop/user/UserServiceImplExtension.java',
      'src/main/java/com/shop/user/UserServiceImplExtensionImpl.java'
    ]);
    // Every placement decision keeps its axis verdict for traceability.
    const basedOnAxes = result.placement?.basedOn.map((entry) => entry.axis);
    expect(basedOnAxes).toContain('interface_impl_style');
    expect(basedOnAxes).toContain('return_wrapping');
    expect(basedOnAxes).toContain('di_style');
  });

  it('plain-class repo: single file, bare handler, field injection', () => {
    const controller = moduleSymbol({
      kind: 'route',
      name: 'LegacyController',
      filePath: 'src/main/java/com/legacy/web/LegacyController.java',
      parentType: 'LegacyController',
      displayPath: '/api/legacy'
    });
    const bareMethods = ['a', 'b', 'c'].map((name, i) =>
      moduleSymbol({
        name,
        filePath: controller.filePath,
        parentType: 'LegacyController',
        returnType: 'String',
        lineStart: 10 + i * 3
      })
    );
    const legacyService = moduleSymbol({
      kind: 'service',
      name: 'LegacyService',
      filePath: 'src/main/java/com/legacy/web/LegacyService.java'
    });
    const auditRepository = moduleSymbol({
      kind: 'repository',
      name: 'AuditRepository',
      filePath: 'src/main/java/com/legacy/web/AuditRepository.java'
    });
    const field = moduleSymbol({
      kind: 'field',
      name: 'auditRepository',
      filePath: legacyService.filePath,
      parentType: 'LegacyService',
      type: 'AuditRepository',
      signature: 'private AuditRepository auditRepository',
      annotations: ['@Autowired'],
      lineStart: 3
    });
    const doLegacy = moduleSymbol({
      name: 'doLegacy',
      filePath: legacyService.filePath,
      parentType: 'LegacyService',
      lineStart: 10
    });
    const symbols = [controller, ...bareMethods, legacyService, auditRepository, field, doLegacy];
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'EXTEND',
      targetSymbolOrModule: 'doLegacy',
      extensionGoal: '记录扩展指标',
      symbols,
      index: buildCallIndex(symbols)
    });
    // Plain services (no ServiceImpl pair) → a single scaffold file.
    expect(result.placement?.files).toEqual([
      { filePath: 'src/main/java/com/legacy/web/LegacyServiceExtension.java', role: 'single' }
    ]);
    // Bare-return convention → void handler, no wrapper in the signature.
    expect(result.placement?.handlerSignature).toBe('public void onLegacyService(/* context */)');
    // Field-injection convention → @Autowired wiring in the snippet.
    expect(result.placement?.injection.style).toBe('field');
    expect(result.placement?.injection.codeSnippet).toContain('@Autowired');
    expect(result.scaffoldTemplates).toHaveLength(1);
    expect(result.scaffoldTemplates?.[0].codeSnippet).toContain('Wire the extension into LegacyService (field injection)');
  });

  it('warns when a heavy-I/O goal runs inside a @Transactional boundary', () => {
    const symbols = conventionRepo().map((symbol) =>
      symbol.name === 'charge' ? { ...symbol, annotations: ['@Transactional'] } : symbol
    );
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'EXTEND',
      targetSymbolOrModule: 'charge',
      extensionGoal: '导出对账单',
      symbols,
      index: buildCallIndex(symbols)
    });
    expect(result.transactionBoundaries).toHaveLength(1);
    expect(result.transactionBoundaries[0].scope).toBe('METHOD');
    const warning = result.risks?.find((risk) => risk.kind === 'transaction-warning');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('@Transactional boundary (METHOD');
    // The suggested fix is decoupling the I/O out of the transaction.
    expect(warning?.suggestion).toContain('SPRING_EVENT_ASYNC');
  });

  it('blocks with a structured error when intent fights a STRICT convention', () => {
    const symbols = conventionRepo();
    let caught: unknown;
    try {
      runModuleEvolution({
        repoId: 'r1',
        intentType: 'EXTEND',
        targetSymbolOrModule: 'charge',
        extensionGoal: '直接返回裸数据,不要包装',
        symbols,
        index: buildCallIndex(symbols)
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConventionConflictError);
    const conflict = (caught as ConventionConflictError).conflict;
    expect(conflict.axis).toBe('return_wrapping');
    expect(conflict.verdict).toContain('ApiResult');
    expect(conflict.coverage).toEqual({ match: 5, total: 5 });
    expect(conflict.suggestion).toContain('ApiResult');
    expect((caught as Error).message).toContain('Convention conflict on return_wrapping');
  });

  it('tolerates a weakly-covered convention: proceeds with a disclosed split risk', () => {
    const controller = moduleSymbol({
      kind: 'route',
      name: 'MixedController',
      filePath: 'src/main/java/com/shop/mixed/MixedController.java',
      parentType: 'MixedController',
      displayPath: '/api/mixed'
    });
    const mixedMethods = [
      { name: 'm1', ret: 'ApiResult' },
      { name: 'm2', ret: 'ApiResult' },
      { name: 'm3', ret: 'ApiResult' },
      { name: 'm4', ret: 'String' },
      { name: 'm5', ret: 'OrderDto' }
    ].map((entry, i) =>
      moduleSymbol({
        name: entry.name,
        filePath: controller.filePath,
        parentType: 'MixedController',
        returnType: entry.ret,
        lineStart: 10 + i * 3
      })
    );
    const mixedService = moduleSymbol({
      kind: 'service',
      name: 'MixedService',
      filePath: 'src/main/java/com/shop/mixed/MixedService.java'
    });
    const doMixed = moduleSymbol({
      name: 'doMixed',
      filePath: mixedService.filePath,
      parentType: 'MixedService',
      lineStart: 40
    });
    const symbols = [controller, ...mixedMethods, mixedService, doMixed];
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'EXTEND',
      targetSymbolOrModule: 'doMixed',
      extensionGoal: '记录扩展指标',
      symbols,
      index: buildCallIndex(symbols)
    });
    // 3/5 wrapped = 60% — below STRICT, so the plan proceeds…
    expect(result.placement).toBeDefined();
    expect(result.scaffoldTemplates?.length).toBeGreaterThan(0);
    // …with the divergence disclosed as a soft risk, samples included.
    const wrapRisk = result.risks?.find((risk) => risk.kind === 'convention-split' && risk.axis === 'return_wrapping');
    expect(wrapRisk).toBeDefined();
    expect(wrapRisk?.message).toContain('3/5');
    expect(wrapRisk?.divergentSamples?.length).toBe(2);
  });

  it('blocks DIRECT_INJECTION when the attach type sits on a bean field cycle', () => {
    const cycleA = moduleSymbol({
      kind: 'service',
      name: 'CycleA',
      filePath: 'src/main/java/com/shop/cycle/CycleA.java'
    });
    const cycleB = moduleSymbol({
      kind: 'service',
      name: 'CycleB',
      filePath: 'src/main/java/com/shop/cycle/CycleB.java'
    });
    const fields = [
      moduleSymbol({
        kind: 'field',
        name: 'b',
        filePath: cycleA.filePath,
        parentType: 'CycleA',
        type: 'CycleB',
        signature: 'private final CycleB b',
        lineStart: 3
      }),
      moduleSymbol({
        kind: 'field',
        name: 'a',
        filePath: cycleB.filePath,
        parentType: 'CycleB',
        type: 'CycleA',
        signature: 'private final CycleA a',
        lineStart: 3
      })
    ];
    const work = moduleSymbol({
      name: 'work',
      filePath: cycleA.filePath,
      parentType: 'CycleA',
      lineStart: 8
    });
    const symbols = [cycleA, cycleB, ...fields, work];
    let caught: unknown;
    try {
      runModuleEvolution({
        repoId: 'r1',
        intentType: 'EXTEND',
        targetSymbolOrModule: 'work',
        extensionGoal: '记录扩展指标',
        symbols,
        index: buildCallIndex(symbols)
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConventionConflictError);
    const conflict = (caught as ConventionConflictError).conflict;
    expect(conflict.axis).toBe('injection-cycle');
    expect(conflict.verdict).toContain('CycleA');
    expect(conflict.verdict).toContain('CycleB');
  });

  it('grounds placement in the real directory (repo-root prefix) and honors nearPackages', () => {
    const controller = moduleSymbol({
      kind: 'route',
      name: 'PayController',
      filePath: 'demo-shop/src/main/java/com/shop/pay/PayController.java',
      parentType: 'PayController',
      displayPath: '/api/pay'
    });
    const payMethods = [1, 2, 3, 4, 5].map((n, i) =>
      moduleSymbol({
        name: `p${n}`,
        filePath: controller.filePath,
        parentType: 'PayController',
        returnType: 'ApiResult',
        lineStart: 10 + i * 3
      })
    );
    const payService = moduleSymbol({
      kind: 'service',
      name: 'PayService',
      filePath: 'demo-shop/src/main/java/com/shop/pay/PayService.java'
    });
    const doPay = moduleSymbol({
      name: 'doPay',
      filePath: payService.filePath,
      parentType: 'PayService',
      lineStart: 30
    });
    const neighborRoute = moduleSymbol({
      kind: 'route',
      name: 'BillingController',
      filePath: 'demo-shop/src/main/java/com/shop/billing/BillingController.java',
      parentType: 'BillingController',
      displayPath: '/api/billing'
    });
    const neighborMethods = [1, 2, 3].map((n, i) =>
      moduleSymbol({
        name: `b${n}`,
        filePath: neighborRoute.filePath,
        parentType: 'BillingController',
        returnType: 'String',
        lineStart: 10 + i * 3
      })
    );
    const symbols = [controller, ...payMethods, payService, doPay, neighborRoute, ...neighborMethods];
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'EXTEND',
      targetSymbolOrModule: 'doPay',
      extensionGoal: '记录扩展指标',
      symbols,
      index: buildCallIndex(symbols),
      nearPackages: ['com.shop.billing']
    });
    // The explicit neighborhood moves the landing dir; the repo-root prefix
    // of the neighbor's REAL file path is kept (never rebuilt from dots).
    expect(result.placement?.packagePath).toBe('com.shop.billing');
    expect(result.placement?.files).toHaveLength(1);
    expect(result.placement?.files[0].filePath).toBe(
      'demo-shop/src/main/java/com/shop/billing/PayServiceExtension.java'
    );
  });

  it('cascades a private DTO helper whose only caller sits in the deprecated module', () => {
    // The DTO's used member (its payload mapper method) is the call-graph node
    // carrying in-degree; class symbols carry no call in-degree in this model.
    const dtoMapper = moduleSymbol({
      name: 'toCheckInPayload',
      filePath: 'src/main/java/com/shop/common/CheckInPayloads.java',
      parentType: 'CheckInPayloads'
    });
    const symbols = SYMBOLS.map((symbol) =>
      symbol.name === 'doCheckIn'
        ? {
            ...symbol,
            calls: [
              ...(symbol.calls ?? []),
              { file: symbol.filePath, method: 'toCheckInPayload', line: 18, receiver: 'checkInPayloads', receiverType: 'CheckInPayloads' }
            ]
          }
        : symbol
    );
    symbols.push(dtoMapper);
    const result = runModuleEvolution({
      repoId: 'r1',
      intentType: 'DEPRECATE',
      targetSymbolOrModule: 'legacy',
      symbols,
      index: buildCallIndex(symbols)
    });
    const names = result.blastRadius.orphanedSymbols.map((symbol) => symbol.name);
    // The legacy module dies → the DTO helper's in-degree drops to zero → cascade.
    expect(names).toContain('toCheckInPayload');
    // Live code still keeps its own DTO alive.
    expect(names).not.toContain('MoneyDto');
  });
});
