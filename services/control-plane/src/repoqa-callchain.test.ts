import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoSymbol } from './repoqa-repos';
import { applyModuleScopes } from './repoqa-repos';
import { parseJavaFile } from './repoqa-parser';
import {
  buildCallIndex,
  CallResolver,
  STATIC_ANALYSIS_BREAK_DYNAMIC,
  STATIC_ANALYSIS_BREAK_UNRESOLVED,
  resolveCallChain,
  applyImplicitInterfaces
} from './repoqa-callchain';

async function parseTree(files: Record<string, string>): Promise<RepoSymbol[]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-chain-'));
  const symbols: RepoSymbol[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    symbols.push(...(await parseJavaFile(file, 'repo-test', root)));
  }
  return symbols;
}

const SAMPLE_JAVA: Record<string, string> = {
  'src/main/java/com/demo/App.java': `package com.demo;

public class App {
  public static void main(String[] args) {
    new OrdersController().listOrders();
  }
}
`,
  'src/main/java/com/demo/OrdersController.java': `package com.demo;

@RestController
public class OrdersController {
  private final OrderService orderService = new OrderService();

  public String listOrders() {
    return orderService.findOrders();
  }

  public String getOrder(long id) {
    return orderService.findById(id);
  }
}
`,
  'src/main/java/com/demo/OrderService.java': `package com.demo;

@Service
public class OrderService {
  private final OrderRepository orderRepository = new OrderRepository();

  public String findOrders() {
    return orderRepository.findAll();
  }

  public String findById(long id) {
    return orderRepository.findById(id);
  }
}
`,
  'src/main/java/com/demo/OrderRepository.java': `package com.demo;

@Repository
public class OrderRepository {
  public String findAll() {
    return "orders";
  }

  public String findById(long id) {
    return "order-" + id;
  }
}
`
};

const VERIFY_ROUTES: Record<string, string> = {
  'src/main/java/com/shop/api/OrderController.java': `package com.shop.api;

import com.shop.service.OrderService;

@RestController
public class OrderController {
  private final OrderService orderService = new OrderService();

  @GetMapping("/orders")
  public String listOrders() {
    return orderService.findOrders();
  }

  @GetMapping("/orders/{id}")
  public String getOrder() {
    return orderService.findOrderById();
  }
}
`,
  'src/main/java/com/shop/service/OrderService.java': `package com.shop.service;

import com.shop.repo.OrderRepository;

@Service
public class OrderService {
  private final OrderRepository orderRepository = new OrderRepository();

  public String findOrders() {
    return orderRepository.findAll();
  }

  public String findOrderById() {
    return orderRepository.findById();
  }
}
`,
  'src/main/java/com/shop/repo/OrderRepository.java': `package com.shop.repo;

@Repository
public class OrderRepository {
  public String findAll() {
    return "orders";
  }

  public String findById() {
    return "order";
  }
}
`
};

describe('parseJavaFile — receiver-aware calls (Issue 05)', () => {
  it('records receiver type and call-site line for cross-file calls', async () => {
    const symbols = await parseTree(VERIFY_ROUTES);
    const listOrders = symbols.find((s) => s.name === 'listOrders')!;
    expect(listOrders.parentType).toBe('OrderController');
    expect(listOrders.calls).toEqual([
      expect.objectContaining({
        method: 'findOrders',
        receiver: 'orderService',
        receiverType: 'OrderService',
        dynamic: false,
        line: 11
      })
    ]);
  });

  it('marks chained/external receivers as dynamic', async () => {
    const symbols = await parseTree({
      'src/main/java/com/demo/Chain.java': `package com.demo;

public class Chain {
  public String run() {
    return helper().value();
  }

  private Helper helper() {
    return new Helper();
  }
}
`,
      'src/main/java/com/demo/Helper.java': `package com.demo;

public class Helper {
  public String value() {
    return "v";
  }
}
`
    });
    const run = symbols.find((s) => s.name === 'run')!;
    expect(run.calls?.[0]).toEqual(
      expect.objectContaining({ method: 'value', dynamic: true, receiverType: undefined })
    );
  });
});

describe('resolveCallChain — sample-java (Controller → Service → Repository)', () => {
  it('resolves listOrders → findOrders → findAll with start/end lines', async () => {
    const symbols = await parseTree(SAMPLE_JAVA);
    const listOrders = symbols.find((s) => s.name === 'listOrders')!;

    const trace = resolveCallChain(symbols, listOrders);
    expect(trace.map((hop) => hop.method)).toEqual(['listOrders', 'findOrders', 'findAll']);
    expect(trace.some((hop) => hop.break)).toBe(false);
    expect(trace).toEqual([
      {
        file: 'src/main/java/com/demo/OrdersController.java',
        method: 'listOrders',
        line: 7,
        lineEnd: 9,
        callLine: 7
      },
      {
        file: 'src/main/java/com/demo/OrderService.java',
        method: 'findOrders',
        line: 7,
        lineEnd: 9,
        callLine: 8
      },
      {
        file: 'src/main/java/com/demo/OrderRepository.java',
        method: 'findAll',
        line: 5,
        lineEnd: 7,
        callLine: 8
      }
    ]);
  });

  it('resolves getOrder → OrderService.findById → OrderRepository.findById', async () => {
    const symbols = await parseTree(SAMPLE_JAVA);
    const getOrder = symbols.find((s) => s.name === 'getOrder')!;
    const trace = resolveCallChain(symbols, getOrder);
    expect(trace.map((hop) => hop.method)).toEqual([
      'getOrder',
      'findById',
      'findById'
    ]);
    expect(trace.map((hop) => hop.file)).toEqual([
      'src/main/java/com/demo/OrdersController.java',
      'src/main/java/com/demo/OrderService.java',
      'src/main/java/com/demo/OrderRepository.java'
    ]);
    expect(trace[2]).toEqual(
      expect.objectContaining({ line: 9, lineEnd: 11, callLine: 12 })
    );
  });
});

describe('resolveCallChain — verify-routes', () => {
  it('resolves OrderController.listOrders → OrderService.findOrders → OrderRepository.findAll', async () => {
    const symbols = await parseTree(VERIFY_ROUTES);
    const start = symbols.find((s) => s.name === 'listOrders')!;
    const trace = resolveCallChain(symbols, start);
    expect(trace.map((hop) => hop.method)).toEqual(['listOrders', 'findOrders', 'findAll']);
    expect(trace).toEqual([
      {
        file: 'src/main/java/com/shop/api/OrderController.java',
        method: 'listOrders',
        line: 10,
        lineEnd: 12,
        callLine: 10
      },
      {
        file: 'src/main/java/com/shop/service/OrderService.java',
        method: 'findOrders',
        line: 9,
        lineEnd: 11,
        callLine: 11
      },
      {
        file: 'src/main/java/com/shop/repo/OrderRepository.java',
        method: 'findAll',
        line: 5,
        lineEnd: 7,
        callLine: 10
      }
    ]);
  });

  it('traces from a route symbol by normalizing to its first method', async () => {
    const symbols = await parseTree(VERIFY_ROUTES);
    const route = symbols.find((s) => s.kind === 'route' && s.name === 'OrderController')!;
    const trace = resolveCallChain(symbols, route);
    expect(trace[0].method).toBe('listOrders');
    expect(trace.map((hop) => hop.method)).toEqual(['listOrders', 'findOrders', 'findAll']);
  });
});

describe('resolveCallChain — interface dispatch and dynamic breaks', () => {
  const GATEWAY = {
    'src/main/java/com/demo/PaymentGateway.java': `package com.demo;

public interface PaymentGateway {
  String pay(double amount);
}
`,
    'src/main/java/com/demo/PaymentController.java': `package com.demo;

@RestController
public class PaymentController {
  private final PaymentGateway gateway = new AlipayGateway();

  public String checkout() {
    return gateway.pay(10.0);
  }
}
`
  };

  it('resolves an interface with exactly one implementation to the impl', async () => {
    const symbols = await parseTree({
      ...GATEWAY,
      'src/main/java/com/demo/AlipayGateway.java': `package com.demo;

public class AlipayGateway implements PaymentGateway {
  public String pay(double amount) {
    return "alipay";
  }
}
`
    });
    const checkout = symbols.find((s) => s.name === 'checkout')!;
    const trace = resolveCallChain(symbols, checkout);
    expect(trace.some((hop) => hop.break)).toBe(false);
    expect(trace.map((hop) => hop.method)).toEqual(['checkout', 'pay']);
    expect(trace[1].file).toBe('src/main/java/com/demo/AlipayGateway.java');
  });

  it('resolves a Mapper interface with no Java impl to its XML SQL node', () => {
    const symbols: RepoSymbol[] = [
      {
        repoId: 'r',
        kind: 'method',
        name: 'findOrders',
        filePath: 'src/main/java/com/demo/OrderService.java',
        lineStart: 4,
        lineEnd: 6,
        parentType: 'OrderService',
        calls: [
          {
            file: 'src/main/java/com/demo/OrderService.java',
            method: 'findAll',
            line: 5,
            receiver: 'orderMapper',
            receiverType: 'OrderMapper'
          }
        ]
      },
      {
        repoId: 'r',
        kind: 'interface',
        name: 'OrderMapper',
        filePath: 'src/main/java/com/demo/OrderMapper.java',
        lineStart: 1,
        lineEnd: 3
      },
      {
        repoId: 'r',
        kind: 'mapper',
        name: 'OrderMapper',
        filePath: 'src/main/resources/mapper/OrderMapper.xml',
        lineStart: 1,
        lineEnd: 5,
        displayPath: 'com.demo.OrderMapper'
      },
      {
        repoId: 'r',
        kind: 'sql',
        name: 'findAll',
        parentType: 'OrderMapper',
        filePath: 'src/main/resources/mapper/OrderMapper.xml',
        lineStart: 2,
        lineEnd: 4,
        displayPath: 'com.demo.OrderMapper#findAll'
      }
    ];

    const start = symbols[0];
    const trace = resolveCallChain(symbols, start);

    expect(trace.some((hop) => hop.break)).toBe(false);
    expect(trace.map((hop) => hop.method)).toEqual(['findOrders', 'findAll']);
    expect(trace[1]).toMatchObject({
      file: 'src/main/resources/mapper/OrderMapper.xml',
      method: 'findAll',
      line: 2,
      callLine: 5
    });
  });

  it('marks interface multi-implementation as a Static Analysis Break: Dynamic/RPC Dispatch', async () => {
    const symbols = await parseTree({
      ...GATEWAY,
      'src/main/java/com/demo/AlipayGateway.java': `package com.demo;

public class AlipayGateway implements PaymentGateway {
  public String pay(double amount) {
    return "alipay";
  }
}
`,
      'src/main/java/com/demo/WechatGateway.java': `package com.demo;

public class WechatGateway implements PaymentGateway {
  public String pay(double amount) {
    return "wechat";
  }
}
`
    });
    const checkout = symbols.find((s) => s.name === 'checkout')!;
    const trace = resolveCallChain(symbols, checkout);
    expect(trace.map((hop) => hop.method)).toEqual(['checkout', 'pay']);
    expect(trace[1]).toEqual(
      expect.objectContaining({
        break: true,
        reason: STATIC_ANALYSIS_BREAK_DYNAMIC,
        callLine: 8
      })
    );
  });

  it('marks an untyped method-chain receiver as Dynamic/RPC Dispatch', async () => {
    const symbols = await parseTree({
      'src/main/java/com/demo/ChainController.java': `package com.demo;

@RestController
public class ChainController {
  public String run() {
    return helper().value();
  }

  private Helper helper() {
    return new Helper();
  }
}
`,
      'src/main/java/com/demo/Helper.java': `package com.demo;

public class Helper {
  public String value() {
    return "v";
  }
}
`
    });
    const run = symbols.find((s) => s.name === 'run')!;
    const trace = resolveCallChain(symbols, run);
    expect(trace[1]).toEqual(
      expect.objectContaining({
        method: 'value',
        break: true,
        reason: STATIC_ANALYSIS_BREAK_DYNAMIC
      })
    );
  });

  it('breaks with a distinct reason when the method is missing in a known type', async () => {
    const symbols = await parseTree({
      ...SAMPLE_JAVA,
      'src/main/java/com/demo/MissingController.java': `package com.demo;

@RestController
public class MissingController {
  private final OrderService orderService = new OrderService();

  public String go() {
    return orderService.notThere();
  }
}
`
    });
    const go = symbols.find((s) => s.name === 'go')!;
    const trace = resolveCallChain(symbols, go);
    expect(trace.map((hop) => hop.method)).toEqual(['go', 'notThere']);
    expect(trace[1]).toEqual(
      expect.objectContaining({
        break: true,
        reason: STATIC_ANALYSIS_BREAK_UNRESOLVED
      })
    );
  });
});

describe('resolveCallChain — Spring bean disambiguation (Issue 21)', () => {
  const PAY = {
    'src/main/java/com/demo/PaymentGateway.java': `package com.demo;

public interface PaymentGateway {
  String pay(String orderId);
}
`,
    'src/main/java/com/demo/WechatGateway.java': `package com.demo;

@Service
public class WechatGateway implements PaymentGateway {
  public String pay(String orderId) {
    return "wechat";
  }
}
`,
    'src/main/java/com/demo/AlipayGateway.java': `package com.demo;

@Service
public class AlipayGateway implements PaymentGateway {
  public String pay(String orderId) {
    return "alipay";
  }
}
`
  };

  it('resolves @Qualifier("wechatGateway") on an autowired field to the matching impl', async () => {
    const symbols = await parseTree({
      ...PAY,
      'src/main/java/com/demo/QualifierController.java': `package com.demo;

@RestController
public class QualifierController {
  @Autowired
  @Qualifier("wechatGateway")
  private PaymentGateway gateway;

  public String pay() {
    return gateway.pay("o1");
  }
}
`
    });
    const pay = symbols.find((s) => s.name === 'pay' && s.parentType === 'QualifierController')!;
    const trace = resolveCallChain(symbols, pay);
    expect(trace.map((hop) => hop.method)).toEqual(['pay', 'pay']);
    expect(trace[1].file).toBe('src/main/java/com/demo/WechatGateway.java');
    expect(trace.some((hop) => hop.break)).toBe(false);
  });

  it('resolves @Resource(name = "alipayGateway") on a field to the matching impl', async () => {
    const symbols = await parseTree({
      ...PAY,
      'src/main/java/com/demo/ResourceController.java': `package com.demo;

@RestController
public class ResourceController {
  @Resource(name = "alipayGateway")
  private PaymentGateway gateway;

  public String pay() {
    return gateway.pay("o2");
  }
}
`
    });
    const pay = symbols.find((s) => s.name === 'pay' && s.parentType === 'ResourceController')!;
    const trace = resolveCallChain(symbols, pay);
    expect(trace[1].file).toBe('src/main/java/com/demo/AlipayGateway.java');
    expect(trace.some((hop) => hop.break)).toBe(false);
  });

  it('resolves an @Autowired field by variable name when it matches a bean name', async () => {
    const symbols = await parseTree({
      ...PAY,
      'src/main/java/com/demo/NameController.java': `package com.demo;

@RestController
public class NameController {
  @Autowired
  private PaymentGateway wechatGateway;

  public String pay() {
    return wechatGateway.pay("o3");
  }
}
`
    });
    const pay = symbols.find((s) => s.name === 'pay' && s.parentType === 'NameController')!;
    const trace = resolveCallChain(symbols, pay);
    expect(trace[1].file).toBe('src/main/java/com/demo/WechatGateway.java');
    expect(trace.some((hop) => hop.break)).toBe(false);
  });

  it('resolves a single @Primary implementation even when the field name matches nothing', async () => {
    const symbols = await parseTree({
      ...PAY,
      'src/main/java/com/demo/AlipayGateway.java': `package com.demo;

@Service
@Primary
public class AlipayGateway implements PaymentGateway {
  public String pay(String orderId) {
    return "alipay";
  }
}
`,
      'src/main/java/com/demo/PrimaryController.java': `package com.demo;

@RestController
public class PrimaryController {
  @Autowired
  private PaymentGateway gateway;

  public String pay() {
    return gateway.pay("o4");
  }
}
`
    });
    const pay = symbols.find((s) => s.name === 'pay' && s.parentType === 'PrimaryController')!;
    const trace = resolveCallChain(symbols, pay);
    expect(trace[1].file).toBe('src/main/java/com/demo/AlipayGateway.java');
    expect(trace.some((hop) => hop.break)).toBe(false);
  });

  it('lets @Primary win over a non-matching autowired field name', async () => {
    const symbols = await parseTree({
      ...PAY,
      'src/main/java/com/demo/AlipayGateway.java': `package com.demo;

@Service
@Primary
public class AlipayGateway implements PaymentGateway {
  public String pay(String orderId) {
    return "alipay";
  }
}
`,
      'src/main/java/com/demo/PrimaryNameController.java': `package com.demo;

@RestController
public class PrimaryNameController {
  @Autowired
  private PaymentGateway otherGateway;

  public String pay() {
    return otherGateway.pay("o4b");
  }
}
`
    });
    const pay = symbols.find((s) => s.name === 'pay' && s.parentType === 'PrimaryNameController')!;
    const trace = resolveCallChain(symbols, pay);
    expect(trace[1].file).toBe('src/main/java/com/demo/AlipayGateway.java');
    expect(trace.some((hop) => hop.break)).toBe(false);
  });

  it('resolves @Qualifier on a method parameter for a direct in-body call', async () => {
    const symbols = await parseTree({
      ...PAY,
      'src/main/java/com/demo/ParamController.java': `package com.demo;

@RestController
public class ParamController {
  public String doPay(@Qualifier("wechatGateway") PaymentGateway gateway) {
    return gateway.pay("o5");
  }
}
`
    });
    const doPay = symbols.find((s) => s.name === 'doPay')!;
    const trace = resolveCallChain(symbols, doPay);
    expect(trace.map((hop) => hop.method)).toEqual(['doPay', 'pay']);
    expect(trace[1].file).toBe('src/main/java/com/demo/WechatGateway.java');
    expect(trace.some((hop) => hop.break)).toBe(false);
  });

  it('keeps the Static Analysis Break when multiple impls carry no hint', async () => {
    const symbols = await parseTree({
      ...PAY,
      'src/main/java/com/demo/PlainController.java': `package com.demo;

@RestController
public class PlainController {
  private PaymentGateway gateway = new WechatGateway();

  public String pay() {
    return gateway.pay("o6");
  }
}
`
    });
    const pay = symbols.find((s) => s.name === 'pay' && s.parentType === 'PlainController')!;
    const trace = resolveCallChain(symbols, pay);
    expect(trace[1]).toEqual(
      expect.objectContaining({
        break: true,
        reason: STATIC_ANALYSIS_BREAK_DYNAMIC
      })
    );
  });
});

describe('resolveCallChain — Java records & text blocks (Issue 21)', () => {
  it('turns record components into read-only field and accessor method symbols', async () => {
    const symbols = await parseTree({
      'src/main/java/com/demo/OrderResult.java': `package com.demo;

import java.math.BigDecimal;
import java.util.List;

public record OrderResult(long orderId, String status, BigDecimal total, List<OrderItem> items) {
  public String describe() {
    return "order-" + orderId;
  }
}
`,
      'src/main/java/com/demo/OrderItem.java': `package com.demo;

public record OrderItem(long sku, int quantity) {}
`
    });
    const orderResult = symbols.find((s) => s.kind === 'class' && s.name === 'OrderResult');
    expect(orderResult).toBeDefined();
    const recordFields = symbols
      .filter((s) => s.kind === 'field' && s.parentType === 'OrderResult')
      .map((s) => s.name)
      .sort();
    expect(recordFields).toEqual(['items', 'orderId', 'status', 'total']);
    const recordMethods = symbols
      .filter((s) => s.kind === 'method' && s.parentType === 'OrderResult')
      .map((s) => s.name)
      .sort();
    expect(recordMethods).toEqual(['describe', 'items', 'orderId', 'status', 'total']);
    const orderId = symbols.find((s) => s.kind === 'method' && s.name === 'orderId')!;
    expect(orderId.signature).toBe('long orderId()');
  });

  it('resolves record accessor calls in a call chain', async () => {
    const symbols = await parseTree({
      'src/main/java/com/demo/OrderResult.java': `package com.demo;

public record OrderResult(long orderId, String status) {}
`,
      'src/main/java/com/demo/AccessorController.java': `package com.demo;

@RestController
public class AccessorController {
  public String show(OrderResult result) {
    return "id=" + result.orderId() + " status=" + result.status();
  }
}
`
    });
    const show = symbols.find((s) => s.name === 'show')!;
    const trace = resolveCallChain(symbols, show);
    expect(trace.map((hop) => hop.method)).toEqual(['show', 'orderId']);
    expect(trace[1].file).toBe('src/main/java/com/demo/OrderResult.java');
    expect(trace.some((hop) => hop.break)).toBe(false);
  });

  it('parses a file with a Java text block instead of skipping it', async () => {
    const symbols = await parseTree({
      'src/main/java/com/demo/GreetingService.java': `package com.demo;

@Service
public class GreetingService {
  public String greet(String name) {
    return """
      Hello, %s!
      Welcome to Demo.
      """.formatted(name).trim();
  }
}
`
    });
    const greet = symbols.find((s) => s.kind === 'method' && s.name === 'greet');
    expect(greet).toBeDefined();
    expect(greet?.filePath).toBe('src/main/java/com/demo/GreetingService.java');
    const service = symbols.find((s) => s.kind === 'service' && s.name === 'GreetingService');
    expect(service).toBeDefined();
  });
});

describe('resolveCallChain — legacy format, cycles and depth', () => {
  const base: RepoSymbol[] = [
    { repoId: 'r', kind: 'route', name: 'Controller', filePath: 'Controller.java', lineStart: 1, lineEnd: 10 },
    { repoId: 'r', kind: 'method', name: 'hello', filePath: 'Controller.java', lineStart: 2, lineEnd: 4, parentType: 'Controller', calls: [{ file: 'Controller.java', method: 'greet' }] },
    { repoId: 'r', kind: 'service', name: 'Service', filePath: 'Service.java', lineStart: 1, lineEnd: 10 },
    { repoId: 'r', kind: 'method', name: 'greet', filePath: 'Service.java', lineStart: 3, lineEnd: 5, parentType: 'Service', calls: [] }
  ];

  it('resolves legacy calls (no receiver info) via same-file then global fallback', () => {
    const trace = resolveCallChain(base, base[1]);
    expect(trace.map((hop) => hop.method)).toEqual(['hello', 'greet']);
    expect(trace[1].file).toBe('Service.java');
    expect(trace[1].lineEnd).toBe(5);
  });

  it('keeps a break hop for a legacy unresolvable call', () => {
    const withMissing: RepoSymbol[] = [
      ...base,
      {
        repoId: 'r',
        kind: 'method',
        name: 'broken',
        filePath: 'Controller.java',
        lineStart: 9,
        lineEnd: 11,
        parentType: 'Controller',
        calls: [{ file: 'Controller.java', method: 'missingMethod' }]
      }
    ];
    const broken = withMissing.find((s) => s.name === 'broken')!;
    const trace = resolveCallChain(withMissing, broken);
    expect(trace.map((hop) => hop.method)).toEqual(['broken', 'missingMethod']);
    expect(trace[1]).toEqual(
      expect.objectContaining({ break: true, reason: STATIC_ANALYSIS_BREAK_UNRESOLVED })
    );
  });

  it('terminates quietly on a call cycle without infinite recursion', () => {
    const symbols: RepoSymbol[] = [
      { repoId: 'r', kind: 'class', name: 'A', filePath: 'A.java', lineStart: 1, lineEnd: 10 },
      {
        repoId: 'r',
        kind: 'method',
        name: 'a',
        filePath: 'A.java',
        lineStart: 2,
        lineEnd: 4,
        parentType: 'A',
        calls: [{ file: 'A.java', method: 'b', receiver: 'b', receiverType: 'B' }]
      },
      { repoId: 'r', kind: 'class', name: 'B', filePath: 'B.java', lineStart: 1, lineEnd: 10 },
      {
        repoId: 'r',
        kind: 'method',
        name: 'b',
        filePath: 'B.java',
        lineStart: 2,
        lineEnd: 4,
        parentType: 'B',
        calls: [{ file: 'B.java', method: 'a', receiver: 'a', receiverType: 'A' }]
      }
    ];
    const a = symbols.find((s) => s.name === 'a')!;
    const trace = resolveCallChain(symbols, a);
    expect(trace.map((hop) => hop.method)).toEqual(['a', 'b']);
    expect(trace.some((hop) => hop.break)).toBe(false);
  });

  it('respects the depth limit', () => {
    const symbols: RepoSymbol[] = [
      { repoId: 'r', kind: 'class', name: 'T1', filePath: 'T1.java', lineStart: 1, lineEnd: 10 },
      { repoId: 'r', kind: 'class', name: 'T2', filePath: 'T2.java', lineStart: 1, lineEnd: 10 },
      { repoId: 'r', kind: 'class', name: 'T3', filePath: 'T3.java', lineStart: 1, lineEnd: 10 },
      { repoId: 'r', kind: 'class', name: 'T4', filePath: 'T4.java', lineStart: 1, lineEnd: 10 }
    ];
    const names = ['m1', 'm2', 'm3', 'm4'];
    for (let i = 0; i < names.length; i += 1) {
      symbols.push({
        repoId: 'r',
        kind: 'method',
        name: names[i],
        filePath: `T${i + 1}.java`,
        lineStart: 2 + i,
        lineEnd: 4 + i,
        parentType: `T${i + 1}`,
        calls:
          i < names.length - 1
            ? [
                {
                  file: `T${i + 1}.java`,
                  method: names[i + 1],
                  receiver: 'next',
                  receiverType: `T${i + 2}`
                }
              ]
            : []
      });
    }
    const m1 = symbols.find((s) => s.name === 'm1')!;
    expect(resolveCallChain(symbols, m1, 2).map((hop) => hop.method)).toEqual(['m1', 'm2', 'm3']);
    expect(resolveCallChain(symbols, m1, 4).map((hop) => hop.method)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4'
    ]);
  });
});

describe('CallResolver reverse callers (Sprint 1)', () => {
  it('returns deterministic who-uses callers for a target method', async () => {
    const symbols = await parseTree(SAMPLE_JAVA);
    const findAll = symbols.find((s) => s.name === 'findAll')!;
    const callers = new CallResolver(symbols).reverseCallers(findAll);

    expect(callers).toContainEqual(
      expect.objectContaining({
        file: 'src/main/java/com/demo/OrderService.java',
        method: 'findOrders'
      })
    );
    expect(callers).toHaveLength(1);
  });

  it('reuses a prebuilt call index for repeated resolution', async () => {
    const symbols = await parseTree(SAMPLE_JAVA);
    const index = buildCallIndex(symbols);
    const start = symbols.find((s) => s.name === 'listOrders')!;
    const findAll = symbols.find((s) => s.name === 'findAll')!;

    const first = resolveCallChain(symbols, start, 4, index);
    const second = resolveCallChain(symbols, start, 4, index);
    expect(first.map((hop) => hop.method)).toEqual(['listOrders', 'findOrders', 'findAll']);
    expect(second).toEqual(first);

    const resolver = new CallResolver(symbols, index);
    expect(resolver.reverseCallers(findAll).map((caller) => caller.method)).toEqual([
      'findOrders'
    ]);
  });
});


describe('v0.7 — applyImplicitInterfaces (Go duck typing)', () => {
  it('backfills interfaces for structs whose method set matches signatures', () => {
    const symbols: RepoSymbol[] = [
      { repoId: 'r', kind: 'interface', name: 'Storage', filePath: 'store.go', lineStart: 1, lineEnd: 5 },
      {
        repoId: 'r', kind: 'method', name: 'Save', filePath: 'store.go', lineStart: 2, lineEnd: 3,
        signature: 'Save(path string) error', parentType: 'Storage', calls: []
      },
      { repoId: 'r', kind: 'class', name: 'FileStorage', filePath: 'fs.go', lineStart: 10, lineEnd: 30 },
      {
        repoId: 'r', kind: 'method', name: 'Save', filePath: 'fs.go', lineStart: 11, lineEnd: 13,
        signature: 'func (s *FileStorage) Save(path string) error', parentType: 'FileStorage', calls: []
      },
      { repoId: 'r', kind: 'class', name: 'MemStore', filePath: 'mem.go', lineStart: 40, lineEnd: 60 },
      {
        repoId: 'r', kind: 'method', name: 'SaveAll', filePath: 'mem.go', lineStart: 41, lineEnd: 43,
        signature: 'func (m *MemStore) SaveAll(paths []string) error', parentType: 'MemStore', calls: []
      }
    ];
    applyImplicitInterfaces(symbols);
    expect(symbols.find((s) => s.name === 'FileStorage')?.interfaces).toContain('Storage');
    expect(symbols.find((s) => s.name === 'MemStore')?.interfaces ?? []).not.toContain('Storage');
  });
});

describe('v0.7 — applyModuleScopes (Module Scope)', () => {
  it('annotates qualified names only for multi-module repos', () => {
    const multi: RepoSymbol[] = [
      { repoId: 'r', kind: 'class', name: 'ConfigService', filePath: 'order-service/src/main/java/com/demo/ConfigService.java', lineStart: 1, lineEnd: 2 },
      { repoId: 'r', kind: 'method', name: 'init', filePath: 'order-service/src/main/java/com/demo/ConfigService.java', lineStart: 2, lineEnd: 3, parentType: 'ConfigService' },
      { repoId: 'r', kind: 'class', name: 'ConfigService', filePath: 'user-service/src/main/java/com/demo/ConfigService.java', lineStart: 1, lineEnd: 2 }
    ];
    applyModuleScopes(multi);
    expect(multi[0].moduleName).toBe('order-service');
    expect(multi[0].qualifiedName).toBe('order-service::ConfigService');
    expect(multi[1].qualifiedName).toBe('order-service::ConfigService.init');
    expect(multi[2].moduleName).toBe('user-service');

    const single: RepoSymbol[] = [
      { repoId: 'r', kind: 'class', name: 'App', filePath: 'src/main/java/com/demo/App.java', lineStart: 1, lineEnd: 2 }
    ];
    applyModuleScopes(single);
    expect(single[0].moduleName).toBeUndefined();
    expect(single[0].qualifiedName).toBeUndefined();
  });
});
