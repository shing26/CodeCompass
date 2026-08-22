import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoSymbol } from './repoqa-repos';
import { parseJavaFile } from './repoqa-parser';
import {
  STATIC_ANALYSIS_BREAK_DYNAMIC,
  STATIC_ANALYSIS_BREAK_UNRESOLVED,
  resolveCallChain
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