import { describe, expect, it } from 'vitest';
import type { RepoSymbol } from './repoqa-repos';
import { JavaAdapter } from './languages/JavaAdapter';
import {
  runConventionScan,
  resolveTargetPackage,
  type ConventionProfile
} from './repoqa-conventions';

/* ------------------------------------------------------------------ */
/* Fixtures — hand-built symbol tables (deterministic golden data).    */
/* Kinds mirror JavaAdapter.declarationKind: an interface named        */
/* `UserService` parses as kind 'service' (name-suffix wins).          */
/* ------------------------------------------------------------------ */

function sym(partial: Partial<RepoSymbol> & { kind: RepoSymbol['kind']; name: string }): RepoSymbol {
  return { repoId: 'r1', filePath: 'src/main/java/com/shop/order/OrderService.java', ...partial };
}

function axisOf(profile: ConventionProfile, axis: string) {
  const hit = profile.axes.find((entry) => entry.axis === axis);
  if (!hit) throw new Error(`axis ${axis} missing from profile`);
  return hit;
}

const orderController = sym({
  kind: 'route',
  name: 'OrdersController',
  filePath: 'src/main/java/com/shop/order/OrdersController.java',
  lineStart: 10
});

/** Wrapped-dominant repo: ApiResult x3 (one of them per-line anchored), String + OrderDto bare. */
function wrappedRepo(): RepoSymbol[] {
  return [
    orderController,
    sym({ kind: 'method', name: 'getOrder', parentType: 'OrdersController', returnType: 'ApiResult', filePath: orderController.filePath, lineStart: 12 }),
    sym({ kind: 'method', name: 'listOrders', parentType: 'OrdersController', returnType: 'ApiResult', filePath: orderController.filePath, lineStart: 16 }),
    sym({ kind: 'method', name: 'createOrder', parentType: 'OrdersController', returnType: 'ApiResult', filePath: orderController.filePath, lineStart: 20 }),
    sym({ kind: 'method', name: 'deleteOrder', parentType: 'OrdersController', returnType: 'String', filePath: orderController.filePath, lineStart: 24 }),
    sym({ kind: 'method', name: 'exportOrder', parentType: 'OrdersController', returnType: 'OrderDto', filePath: orderController.filePath, lineStart: 28 })
  ];
}

/* ------------------------------------------------------------------ */
/* Parser facts (Issue 24 — superClass / returnType / field signature) */
/* ------------------------------------------------------------------ */

describe('JavaAdapter Issue 24 semantic fields', () => {
  it('extracts the direct superclass and method return types', () => {
    const symbols = JavaAdapter.parseSource(
      `package com.shop.order;

public class OrderService extends BaseService {
  public ApiResult<OrderDto> getOrder(long id) {
    return null;
  }

  void refresh() {
  }
}
`,
      'src/main/java/com/shop/order/OrderService.java',
      'r1'
    );
    const klass = symbols.find((s) => s.name === 'OrderService');
    expect(klass?.superClass).toBe('BaseService');
    expect(symbols.find((s) => s.name === 'getOrder')?.returnType).toBe('ApiResult');
    expect(symbols.find((s) => s.name === 'refresh')?.returnType).toBe('void');
  });

  it('records a field signature without annotations, keeping `private final` markers', () => {
    const symbols = JavaAdapter.parseSource(
      `package com.shop.payment;

public class PaymentClient {
  @Autowired
  @Qualifier("main")
  private OrderService orderService;

  private final OrderRepository orderRepository;
}
`,
      'src/main/java/com/shop/payment/PaymentClient.java',
      'r1'
    );
    const injected = symbols.find((s) => s.kind === 'field' && s.name === 'orderService');
    const finalField = symbols.find((s) => s.kind === 'field' && s.name === 'orderRepository');
    expect(injected?.signature).toBe('private OrderService orderService');
    expect(injected?.annotations).toEqual(['@Autowired', '@Qualifier("main")']);
    expect(finalField?.signature).toBe('private final OrderRepository orderRepository');
  });
});

/* ------------------------------------------------------------------ */
/* Axis 1 — return_wrapping                                            */
/* ------------------------------------------------------------------ */

describe('return_wrapping axis', () => {
  it('reports the dominant wrapper with exact anchors and dissidents', () => {
    const profile = runConventionScan({ repoId: 'r1', symbols: wrappedRepo(), commit: 'h1' });
    const axis = axisOf(profile, 'return_wrapping');
    expect(axis.supported).toBe(true);
    expect(axis.verdict).toBe('Controller methods return unified wrapper ApiResult<T>');
    expect(axis.coverage).toEqual({ match: 3, total: 5 });
    expect(axis.anchors).toEqual([
      { file: 'src/main/java/com/shop/order/OrdersController.java', line: 12, symbol: 'OrdersController.getOrder' },
      { file: 'src/main/java/com/shop/order/OrdersController.java', line: 16, symbol: 'OrdersController.listOrders' },
      { file: 'src/main/java/com/shop/order/OrdersController.java', line: 20, symbol: 'OrdersController.createOrder' }
    ]);
    expect(axis.dissidents).toEqual([
      { file: 'src/main/java/com/shop/order/OrdersController.java', line: 24, symbol: 'OrdersController.deleteOrder' },
      { file: 'src/main/java/com/shop/order/OrdersController.java', line: 28, symbol: 'OrdersController.exportOrder' }
    ]);
  });

  it('does not mistake a Dto suffix for a response wrapper', () => {
    const symbols = [
      sym({ kind: 'route', name: 'OrderController', filePath: 'src/main/java/com/shop/order/OrderController.java' }),
      sym({ kind: 'method', name: 'get', parentType: 'OrderController', returnType: 'OrderDto', filePath: 'src/main/java/com/shop/order/OrderController.java', lineStart: 5 }),
      sym({ kind: 'method', name: 'find', parentType: 'OrderController', returnType: 'String', filePath: 'src/main/java/com/shop/order/OrderController.java', lineStart: 8 })
    ];
    const profile = runConventionScan({ repoId: 'r1', symbols, commit: 'h1' });
    const axis = axisOf(profile, 'return_wrapping');
    expect(axis.verdict).toBe('Controller methods return bare payloads (no unified wrapper)');
    expect(axis.coverage).toEqual({ match: 2, total: 2 });
    expect(axis.dissidents).toEqual([]);
  });

  it('is unsupported without controller methods', () => {
    const profile = runConventionScan({
      repoId: 'r1',
      symbols: [sym({ kind: 'class', name: 'Plain' })],
      commit: 'h1'
    });
    expect(axisOf(profile, 'return_wrapping')).toEqual({ axis: 'return_wrapping', supported: false });
  });
});

/* ------------------------------------------------------------------ */
/* Axis 2 — interface_impl_style                                       */
/* ------------------------------------------------------------------ */

describe('interface_impl_style axis', () => {
  it('recognizes the interface + ServiceImpl split and spares the interface from dissidents', () => {
    const symbols = [
      sym({ kind: 'service', name: 'UserService', filePath: 'src/main/java/com/shop/user/UserService.java', lineStart: 3 }),
      sym({ kind: 'service', name: 'UserServiceImpl', filePath: 'src/main/java/com/shop/user/UserServiceImpl.java', lineStart: 5, interfaces: ['UserService'] })
    ];
    const profile = runConventionScan({ repoId: 'r1', symbols, commit: 'h1' });
    const axis = axisOf(profile, 'interface_impl_style');
    expect(axis.verdict).toBe('Services follow interface + ServiceImpl split');
    expect(axis.coverage).toEqual({ match: 1, total: 1 });
    expect(axis.anchors).toEqual([
      { file: 'src/main/java/com/shop/user/UserServiceImpl.java', line: 5, symbol: 'UserServiceImpl' }
    ]);
    expect(axis.dissidents).toEqual([]);
  });

  it('reports plain service classes when no ServiceImpl exists', () => {
    const symbols = [
      sym({ kind: 'service', name: 'UserService', filePath: 'src/main/java/com/shop/user/UserService.java', lineStart: 3 }),
      sym({ kind: 'service', name: 'BillingService', filePath: 'src/main/java/com/shop/user/BillingService.java', lineStart: 3 })
    ];
    const profile = runConventionScan({ repoId: 'r1', symbols, commit: 'h1' });
    const axis = axisOf(profile, 'interface_impl_style');
    expect(axis.verdict).toBe('Services are plain classes (no interface split)');
    expect(axis.coverage).toEqual({ match: 2, total: 2 });
    expect(axis.dissidents).toEqual([]);
  });

  it('is unsupported without service-ish symbols', () => {
    const profile = runConventionScan({ repoId: 'r1', symbols: [orderController], commit: 'h1' });
    expect(axisOf(profile, 'interface_impl_style')).toEqual({ axis: 'interface_impl_style', supported: false });
  });
});

/* ------------------------------------------------------------------ */
/* Axis 3 — base_class                                                 */
/* ------------------------------------------------------------------ */

describe('base_class axis', () => {
  it('detects a Base-class majority with coverage and dissidents', () => {
    const symbols = [
      sym({ kind: 'class', name: 'AController', superClass: 'BaseController', filePath: 'src/main/java/com/shop/web/AController.java', lineStart: 2 }),
      sym({ kind: 'class', name: 'BService', superClass: 'BaseService', filePath: 'src/main/java/com/shop/web/BService.java', lineStart: 2 }),
      sym({ kind: 'class', name: 'CHelper', filePath: 'src/main/java/com/shop/web/CHelper.java', lineStart: 2 })
    ];
    const profile = runConventionScan({ repoId: 'r1', symbols, commit: 'h1' });
    const axis = axisOf(profile, 'base_class');
    expect(axis.verdict).toBe('Classes extend a shared Base class (2/3)');
    expect(axis.coverage).toEqual({ match: 2, total: 3 });
    expect(axis.anchors).toEqual([
      { file: 'src/main/java/com/shop/web/AController.java', line: 2, symbol: 'AController' },
      { file: 'src/main/java/com/shop/web/BService.java', line: 2, symbol: 'BService' }
    ]);
    expect(axis.dissidents).toEqual([
      { file: 'src/main/java/com/shop/web/CHelper.java', line: 2, symbol: 'CHelper' }
    ]);
  });

  it('reports no shared hierarchy when nothing extends a Base class', () => {
    const symbols = [
      sym({ kind: 'class', name: 'A', filePath: 'src/main/java/com/shop/A.java', lineStart: 2 }),
      sym({ kind: 'class', name: 'B', filePath: 'src/main/java/com/shop/B.java', lineStart: 2 })
    ];
    const profile = runConventionScan({ repoId: 'r1', symbols, commit: 'h1' });
    const axis = axisOf(profile, 'base_class');
    expect(axis.verdict).toBe('No shared Base-class hierarchy in production classes');
    expect(axis.coverage).toEqual({ match: 2, total: 2 });
    expect(axis.dissidents).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Axis 4 — di_style                                                   */
/* ------------------------------------------------------------------ */

describe('di_style axis', () => {
  const beanDeclarations = (): RepoSymbol[] => [
    sym({ kind: 'service', name: 'OrderService', filePath: 'src/main/java/com/shop/order/OrderService.java' }),
    sym({ kind: 'repository', name: 'OrderRepository', filePath: 'src/main/java/com/shop/order/OrderRepository.java' }),
    sym({ kind: 'mapper', name: 'UserMapper', filePath: 'src/main/java/com/shop/user/UserMapper.java' }),
    sym({ kind: 'service', name: 'CacheService', filePath: 'src/main/java/com/shop/user/CacheService.java' }),
    sym({ kind: 'class', name: 'PaymentClient', filePath: 'src/main/java/com/shop/payment/PaymentClient.java' })
  ];

  it('counts only bean-typed fields with injection evidence, non-beans excluded', () => {
    const symbols = [
      ...beanDeclarations(),
      sym({ kind: 'field', name: 'orderService', parentType: 'PaymentClient', type: 'OrderService', signature: 'private final OrderService orderService', lineStart: 3 }),
      sym({ kind: 'field', name: 'orderRepository', parentType: 'PaymentClient', type: 'OrderRepository', signature: 'private final OrderRepository orderRepository', annotations: ['@Autowired'], lineStart: 5 }),
      sym({ kind: 'field', name: 'userMapper', parentType: 'PaymentClient', type: 'UserMapper', signature: 'private UserMapper userMapper', annotations: ['@Autowired'], lineStart: 7 }),
      // Not a bean type → no sample.
      sym({ kind: 'field', name: 'amount', parentType: 'PaymentClient', type: 'BigDecimal', signature: 'private BigDecimal amount', lineStart: 9 }),
      // Bean type but no injection evidence (plain mutable field) → no sample.
      sym({ kind: 'field', name: 'cache', parentType: 'PaymentClient', type: 'CacheService', signature: 'private CacheService cache', lineStart: 11 })
    ];
    const profile = runConventionScan({ repoId: 'r1', symbols, commit: 'h1' });
    const axis = axisOf(profile, 'di_style');
    expect(axis.verdict).toBe('Dependencies are field-injected (@Autowired on fields)');
    expect(axis.coverage).toEqual({ match: 2, total: 3 });
    expect(axis.anchors).toEqual([
      { file: 'src/main/java/com/shop/order/OrderService.java', line: 5, symbol: 'PaymentClient.orderRepository' },
      { file: 'src/main/java/com/shop/order/OrderService.java', line: 7, symbol: 'PaymentClient.userMapper' }
    ]);
    expect(axis.dissidents).toEqual([
      { file: 'src/main/java/com/shop/order/OrderService.java', line: 3, symbol: 'PaymentClient.orderService' }
    ]);
  });

  it('prefers constructor injection on a tie (deterministic >=)', () => {
    const symbols = [
      ...beanDeclarations(),
      sym({ kind: 'field', name: 'orderService', parentType: 'PaymentClient', type: 'OrderService', signature: 'private final OrderService orderService', lineStart: 3 }),
      sym({ kind: 'field', name: 'userMapper', parentType: 'PaymentClient', type: 'UserMapper', signature: 'private UserMapper userMapper', annotations: ['@Autowired'], lineStart: 5 })
    ];
    const profile = runConventionScan({ repoId: 'r1', symbols, commit: 'h1' });
    const axis = axisOf(profile, 'di_style');
    expect(axis.verdict).toBe('Dependencies are constructor-injected (private final, no @Autowired)');
    expect(axis.coverage).toEqual({ match: 1, total: 2 });
  });

  it('is unsupported when no field carries injection evidence', () => {
    const symbols = [
      ...beanDeclarations(),
      sym({ kind: 'field', name: 'cache', parentType: 'PaymentClient', type: 'CacheService', signature: 'private CacheService cache', lineStart: 3 }),
      sym({ kind: 'field', name: 'amount', parentType: 'PaymentClient', type: 'BigDecimal', signature: 'private BigDecimal amount', lineStart: 5 })
    ];
    const profile = runConventionScan({ repoId: 'r1', symbols, commit: 'h1' });
    expect(axisOf(profile, 'di_style')).toEqual({ axis: 'di_style', supported: false });
  });
});

/* ------------------------------------------------------------------ */
/* Axis 5 — package_layout                                             */
/* ------------------------------------------------------------------ */

describe('package_layout axis', () => {
  it('reports the dominant 2nd-level package with outsiders as dissidents', () => {
    const symbols = [
      sym({ kind: 'class', name: 'OrderService', filePath: 'src/main/java/com/shop/order/OrderService.java', lineStart: 2 }),
      sym({ kind: 'route', name: 'OrderController', filePath: 'src/main/java/com/shop/order/OrderController.java', lineStart: 2 }),
      sym({ kind: 'service', name: 'UserService', filePath: 'src/main/java/com/shop/user/UserService.java', lineStart: 2 }),
      sym({ kind: 'class', name: 'LegacyHelper', filePath: 'src/main/java/com/legacy/util/LegacyHelper.java', lineStart: 2 })
    ];
    const profile = runConventionScan({ repoId: 'r1', symbols, commit: 'h1' });
    const axis = axisOf(profile, 'package_layout');
    // The 2nd-level bucket merges com.shop.order and com.shop.user into com.shop.
    expect(axis.verdict).toBe('Production classes live under com.shop.* (3 classes)');
    expect(axis.coverage).toEqual({ match: 3, total: 4 });
    expect(axis.dissidents).toEqual([
      { file: 'src/main/java/com/legacy/util/LegacyHelper.java', line: 2, symbol: 'LegacyHelper' }
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Neighbor-first arbitration (ADR-0014)                               */
/* ------------------------------------------------------------------ */

describe('neighbor-first arbitration', () => {
  /** Ticket scenario: com.shop.* 3/3 wrapped vs global 7/12 bare. */
  function ticketScenario(): RepoSymbol[] {
    return [
      orderController,
      sym({ kind: 'method', name: 'getOrder', parentType: 'OrdersController', returnType: 'ApiResult', filePath: orderController.filePath, lineStart: 12 }),
      sym({ kind: 'method', name: 'listOrders', parentType: 'OrdersController', returnType: 'ApiResult', filePath: orderController.filePath, lineStart: 16 }),
      sym({ kind: 'method', name: 'createOrder', parentType: 'OrdersController', returnType: 'ApiResult', filePath: orderController.filePath, lineStart: 20 }),
      sym({ kind: 'route', name: 'LegacyController', filePath: 'src/main/java/com/legacy/web/LegacyController.java', lineStart: 5 }),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) =>
        sym({ kind: 'method', name: `bare${n}`, parentType: 'LegacyController', returnType: 'String', filePath: 'src/main/java/com/legacy/web/LegacyController.java', lineStart: 10 + n })
      ),
      ...[1, 2].map((n) =>
        sym({ kind: 'method', name: `wrapped${n}`, parentType: 'LegacyController', returnType: 'LegacyResult', filePath: 'src/main/java/com/legacy/web/LegacyController.java', lineStart: 30 + n })
      )
    ];
  }

  it('a decided neighborhood overrides a conflicting global majority and discloses both', () => {
    const profile = runConventionScan({
      repoId: 'r1',
      symbols: ticketScenario(),
      targetSymbol: 'OrdersController',
      commit: 'abc123'
    });
    expect(profile.neighborPackage).toBe('com.shop.order');
    expect(profile.sampledAt).toBe('abc123');
    const axis = axisOf(profile, 'return_wrapping');
    // Neighbor verdict wins over the global bare majority…
    expect(axis.verdict).toBe('Controller methods return unified wrapper ApiResult<T>');
    expect(axis.coverage).toEqual({ match: 3, total: 3 });
    // …while the overridden global claim stays machine-readable.
    expect(axis.globalVerdict).toEqual({
      verdict: 'Controller methods return bare payloads (no unified wrapper)',
      coverage: { match: 7, total: 12 }
    });
    // Dissidents = the losing side: out-of-neighborhood bare controllers.
    expect(axis.dissidents).toEqual([
      { file: 'src/main/java/com/legacy/web/LegacyController.java', line: 11, symbol: 'LegacyController.bare1' },
      { file: 'src/main/java/com/legacy/web/LegacyController.java', line: 12, symbol: 'LegacyController.bare2' },
      { file: 'src/main/java/com/legacy/web/LegacyController.java', line: 13, symbol: 'LegacyController.bare3' }
    ]);
  });

  it('a split neighborhood falls back to the global verdict with no overrule marker', () => {
    const symbols = [
      orderController,
      sym({ kind: 'method', name: 'getOrder', parentType: 'OrdersController', returnType: 'ApiResult', filePath: orderController.filePath, lineStart: 12 }),
      sym({ kind: 'method', name: 'deleteOrder', parentType: 'OrdersController', returnType: 'String', filePath: orderController.filePath, lineStart: 14 }),
      sym({ kind: 'route', name: 'LegacyController', filePath: 'src/main/java/com/legacy/web/LegacyController.java', lineStart: 5 }),
      ...[1, 2, 3].map((n) =>
        sym({ kind: 'method', name: `bare${n}`, parentType: 'LegacyController', returnType: 'String', filePath: 'src/main/java/com/legacy/web/LegacyController.java', lineStart: 10 + n })
      )
    ];
    const profile = runConventionScan({ repoId: 'r1', symbols, targetSymbol: 'OrdersController', commit: 'h1' });
    const axis = axisOf(profile, 'return_wrapping');
    // Global: 1 wrapped vs 4 bare (deleteOrder + 3 legacy) → bare wins;
    // neighborhood 1/2 is split (≥2 samples but <2/3) → global stands.
    expect(axis.verdict).toBe('Controller methods return bare payloads (no unified wrapper)');
    expect(axis.coverage).toEqual({ match: 4, total: 5 });
    expect(axis.globalVerdict).toBeUndefined();
  });

  it('keeps the global coverage when neighbor and global agree (no conflict)', () => {
    const profile = runConventionScan({ repoId: 'r1', symbols: wrappedRepo(), targetSymbol: 'OrdersController', commit: 'h1' });
    const axis = axisOf(profile, 'return_wrapping');
    expect(axis.verdict).toBe('Controller methods return unified wrapper ApiResult<T>');
    expect(axis.coverage).toEqual({ match: 3, total: 5 });
    expect(axis.globalVerdict).toBeUndefined();
  });

  it('samples globally when no (or an unknown) target is given', () => {
    const noTarget = runConventionScan({ repoId: 'r1', symbols: wrappedRepo(), commit: 'h1' });
    expect(noTarget.neighborPackage).toBeUndefined();
    const unknownTarget = runConventionScan({
      repoId: 'r1',
      symbols: wrappedRepo(),
      targetSymbol: 'NoSuchService',
      commit: 'h1'
    });
    expect(unknownTarget.neighborPackage).toBeUndefined();
    expect(unknownTarget.axes).toEqual(noTarget.axes);
  });

  it('nearPackages overrides the target-derived neighborhood (24.3 placement hook)', () => {
    // Global vote is wrapped-majority (7/10), but the explicit neighborhood
    // is a bare island: the placement target must follow its new package.
    const symbols = [
      orderController,
      sym({ kind: 'method', name: 'getOrder', parentType: 'OrdersController', returnType: 'ApiResult', filePath: orderController.filePath, lineStart: 12 }),
      sym({ kind: 'method', name: 'listOrders', parentType: 'OrdersController', returnType: 'ApiResult', filePath: orderController.filePath, lineStart: 16 }),
      sym({ kind: 'method', name: 'createOrder', parentType: 'OrdersController', returnType: 'ApiResult', filePath: orderController.filePath, lineStart: 20 }),
      sym({ kind: 'route', name: 'LegacyController', filePath: 'src/main/java/com/legacy/web/LegacyController.java', lineStart: 5 }),
      ...[1, 2, 3].map((n) =>
        sym({ kind: 'method', name: `bare${n}`, parentType: 'LegacyController', returnType: 'String', filePath: 'src/main/java/com/legacy/web/LegacyController.java', lineStart: 10 + n })
      ),
      sym({ kind: 'route', name: 'ExtraController', filePath: 'src/main/java/com/extra/web/ExtraController.java', lineStart: 5 }),
      ...[1, 2, 3, 4].map((n) =>
        sym({ kind: 'method', name: `extra${n}`, parentType: 'ExtraController', returnType: 'ExtraResult', filePath: 'src/main/java/com/extra/web/ExtraController.java', lineStart: 20 + n })
      )
    ];
    const profile = runConventionScan({
      repoId: 'r1',
      symbols,
      targetSymbol: 'OrdersController',
      nearPackages: ['com.legacy.web'],
      commit: 'h1'
    });
    expect(profile.neighborPackage).toBe('com.legacy.web');
    const axis = axisOf(profile, 'return_wrapping');
    expect(axis.verdict).toBe('Controller methods return bare payloads (no unified wrapper)');
    expect(axis.coverage).toEqual({ match: 3, total: 3 });
    // The overridden global wrapped-majority stays disclosed…
    expect(axis.globalVerdict).toEqual({
      verdict: 'Controller methods return unified wrapper ExtraResult<T>',
      coverage: { match: 7, total: 10 }
    });
    // …and the losing side is the global wrapped anchors (cap 3).
    expect(axis.dissidents).toEqual([
      { file: 'src/main/java/com/shop/order/OrdersController.java', line: 12, symbol: 'OrdersController.getOrder' },
      { file: 'src/main/java/com/shop/order/OrdersController.java', line: 16, symbol: 'OrdersController.listOrders' },
      { file: 'src/main/java/com/shop/order/OrdersController.java', line: 20, symbol: 'OrdersController.createOrder' }
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Graceful degradation & target resolution                            */
/* ------------------------------------------------------------------ */

describe('graceful degradation', () => {
  it('degrades every axis to unsupported on a non-Java repo', () => {
    const symbols = [
      sym({ kind: 'route', name: 'ordersRouter', filePath: 'src/routes/ordersRouter.ts', parentType: undefined }),
      sym({ kind: 'method', name: 'getOrder', parentType: 'ordersRouter', returnType: 'ApiResult', filePath: 'src/routes/ordersRouter.ts' }),
      sym({ kind: 'field', name: 'orderService', parentType: 'ordersRouter', type: 'OrderService', signature: 'private orderService', annotations: ['@Autowired'], filePath: 'src/services/orderService.ts' }),
      sym({ kind: 'service', name: 'OrderService', filePath: 'src/services/orderService.ts' })
    ];
    const profile = runConventionScan({ repoId: 'r1', symbols, targetSymbol: 'OrderService', commit: 'h1' });
    expect(profile.axes).toHaveLength(5);
    for (const axis of profile.axes) {
      expect(axis.supported).toBe(false);
      expect(axis.verdict).toBeUndefined();
      expect(axis.coverage).toBeUndefined();
    }
  });
});

describe('resolveTargetPackage', () => {
  const symbols = [
    sym({ kind: 'route', name: 'OrdersController', filePath: 'src/main/java/com/shop/order/OrdersController.java' }),
    sym({ kind: 'method', name: 'getOrder', parentType: 'OrdersController', filePath: 'src/main/java/com/shop/order/OrdersController.java' }),
    sym({ kind: 'service', name: 'UserService', filePath: 'src/main/java/com/shop/user/UserService.java' })
  ];

  it('resolves a class name, a Parent.method form, and a short-name fallback', () => {
    expect(resolveTargetPackage(symbols, 'OrdersController')).toBe('com.shop.order');
    expect(resolveTargetPackage(symbols, 'OrdersController.getOrder')).toBe('com.shop.order');
    expect(resolveTargetPackage(symbols, 'UserService')).toBe('com.shop.user');
  });

  it('returns undefined for blank or unknown queries', () => {
    expect(resolveTargetPackage(symbols, undefined)).toBeUndefined();
    expect(resolveTargetPackage(symbols, '  ')).toBeUndefined();
    expect(resolveTargetPackage(symbols, 'Missing')).toBeUndefined();
  });

  it('ignores test-path symbols when resolving the neighborhood', () => {
    const withTest = [
      ...symbols,
      sym({ kind: 'class', name: 'OrdersController', filePath: 'src/test/java/com/shop/order/OrdersControllerTest.java' })
    ];
    // Only production symbols resolve; the test double must not win.
    expect(resolveTargetPackage(withTest, 'OrdersController')).toBe('com.shop.order');
    expect(resolveTargetPackage(withTest.filter((s) => !s.filePath.includes('src/main')), 'OrdersController')).toBeUndefined();
  });
});
