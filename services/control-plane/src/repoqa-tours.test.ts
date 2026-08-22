import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoSymbol } from './repoqa-repos';
import { parseJavaFile } from './repoqa-parser';
import { buildTours, chainMermaid, type RepoQaTourStep } from './repoqa-tours';

async function parseTree(files: Record<string, string>): Promise<RepoSymbol[]> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-tours-'));
  const symbols: RepoSymbol[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    symbols.push(...(await parseJavaFile(file, 'repo-test', root)));
  }
  return symbols;
}

function stepsOf(
  tours: ReturnType<typeof buildTours>,
  id: 'auth-chain' | 'main-flow' | 'error-handling'
): RepoQaTourStep[] {
  const tour = tours.find((item) => item.id === id);
  if (!tour) throw new Error(`missing tour ${id}`);
  return tour.steps;
}

/** Extract `click Node "code://file#line"` bindings into a map. */
function clickBindings(mermaid: string): Map<string, string> {
  const bindings = new Map<string, string>();
  const re = /click\s+([A-Za-z_][\w]*)\s+"(code:\/\/[^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(mermaid)) !== null) {
    bindings.set(match[1], match[2]);
  }
  return bindings;
}

// —————————————————————————————————————————————————————————————————————
// Fixtures mirroring the on-disk sample projects
// (.scratch/phase2-gate/sample-java and .scratch/verify-routes), enriched
// with the Issue 11 security/advice files so all three tours are exercised.
// —————————————————————————————————————————————————————————————————————

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
`,
  'src/main/java/com/demo/AuthFilter.java': `package com.demo;

public class AuthFilter implements Filter {
  public void doFilter() {
  }
}
`,
  'src/main/java/com/demo/RequestInterceptor.java': `package com.demo;

public class RequestInterceptor implements HandlerInterceptor {
  public boolean preHandle() {
    return true;
  }
}
`,
  'src/main/java/com/demo/GlobalExceptionHandler.java': `package com.demo;

@RestControllerAdvice
public class GlobalExceptionHandler {
  public String handleIllegal(IllegalArgumentException ex) {
    return "bad";
  }

  public String handleNotFound(ResourceNotFoundException ex) {
    return "missing";
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
  'src/main/java/com/shop/api/UserController.java': `package com.shop.api;

import com.shop.service.UserService;

@RestController
public class UserController {
  private final UserService userService = new UserService();

  @GetMapping("/users")
  public String listUsers() {
    return userService.findAllUsers();
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
  'src/main/java/com/shop/service/UserService.java': `package com.shop.service;

@Service
public class UserService {
  public String findAllUsers() {
    return "users";
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
`,
  'src/main/java/com/shop/security/AuthFilter.java': `package com.shop.security;

public class AuthFilter implements Filter {
  public void doFilter() {
  }
}
`,
  'src/main/java/com/shop/security/UserInterceptor.java': `package com.shop.security;

public class UserInterceptor implements HandlerInterceptor {
  public boolean preHandle() {
    return true;
  }
}
`,
  'src/main/java/com/shop/api/GlobalExceptionHandler.java': `package com.shop.api;

@RestControllerAdvice
public class GlobalExceptionHandler {
  public String handleIllegal(IllegalArgumentException ex) {
    return "bad";
  }
}
`
};

describe('buildTours — sample-java（Controller → Service → Repository + 安全/异常）', () => {
  it('emits exactly the three standard tours in stable order', async () => {
    const symbols = await parseTree(SAMPLE_JAVA);
    const tours = buildTours({ repoId: 'repo-test', repoName: 'sample-java', symbols });
    expect(tours.map((tour) => tour.id)).toEqual([
      'auth-chain',
      'main-flow',
      'error-handling'
    ]);
    for (const tour of tours) {
      expect(tour.title).toBeTruthy();
      expect(tour.description).toBeTruthy();
      expect(tour.mermaid).toContain('flowchart LR');
    }
  });

  it('auth-chain: Filter → Interceptor → 受保护端点 with exact lines', async () => {
    const symbols = await parseTree(SAMPLE_JAVA);
    const tours = buildTours({ repoId: 'repo-test', repoName: 'sample-java', symbols });
    const steps = stepsOf(tours, 'auth-chain');
    expect(steps.map((step) => step.step)).toEqual([
      '1. AuthFilter.doFilter（认证过滤器）',
      '2. RequestInterceptor.preHandle（拦截器）',
      '3. OrdersController.listOrders（受保护端点）'
    ]);
    expect(steps.map((step) => step.filePath)).toEqual([
      'src/main/java/com/demo/AuthFilter.java',
      'src/main/java/com/demo/RequestInterceptor.java',
      'src/main/java/com/demo/OrdersController.java'
    ]);
    expect(steps.map((step) => step.lineNumber)).toEqual([4, 4, 7]);

    const mermaid = tours.find((item) => item.id === 'auth-chain')!.mermaid;
    expect(mermaid).toContain('doFilter --> preHandle');
    expect(mermaid).toContain('preHandle --> listOrders');
    const bindings = clickBindings(mermaid);
    expect(bindings.get('doFilter')).toBe('code://src/main/java/com/demo/AuthFilter.java#4');
    expect(bindings.get('preHandle')).toBe(
      'code://src/main/java/com/demo/RequestInterceptor.java#4'
    );
    expect(bindings.get('listOrders')).toBe(
      'code://src/main/java/com/demo/OrdersController.java#7'
    );
  });

  it('main-flow: picks the deepest @RestController chain (listOrders) with exact lines', async () => {
    const symbols = await parseTree(SAMPLE_JAVA);
    const tours = buildTours({ repoId: 'repo-test', repoName: 'sample-java', symbols });
    const steps = stepsOf(tours, 'main-flow');
    expect(steps.map((step) => step.step)).toEqual([
      '1. OrdersController.listOrders（入口接口）',
      '2. findOrders',
      '3. findAll'
    ]);
    expect(steps.map((step) => step.filePath)).toEqual([
      'src/main/java/com/demo/OrdersController.java',
      'src/main/java/com/demo/OrderService.java',
      'src/main/java/com/demo/OrderRepository.java'
    ]);
    // listOrders@7 → findOrders@7 → findAll@5 (same line numbers as the
    // deterministic call-chain tests).
    expect(steps.map((step) => step.lineNumber)).toEqual([7, 7, 5]);

    const mermaid = tours.find((item) => item.id === 'main-flow')!.mermaid;
    expect(mermaid).toContain('listOrders --> findOrders');
    expect(mermaid).toContain('findOrders --> findAll');
    const bindings = clickBindings(mermaid);
    expect(bindings.size).toBe(3);
    expect(bindings.get('findAll')).toBe(
      'code://src/main/java/com/demo/OrderRepository.java#5'
    );
  });

  it('error-handling: advice 入口 + 每个 @ExceptionHandler 方法', async () => {
    const symbols = await parseTree(SAMPLE_JAVA);
    const tours = buildTours({ repoId: 'repo-test', repoName: 'sample-java', symbols });
    const steps = stepsOf(tours, 'error-handling');
    expect(steps.map((step) => step.step)).toEqual([
      '1. GlobalExceptionHandler（全局异常入口）',
      '2. GlobalExceptionHandler.handleIllegal（异常处理器）',
      '3. GlobalExceptionHandler.handleNotFound（异常处理器）'
    ]);
    expect(steps.map((step) => step.lineNumber)).toEqual([4, 5, 9]);
    expect(steps.map((step) => step.filePath)).toEqual([
      'src/main/java/com/demo/GlobalExceptionHandler.java',
      'src/main/java/com/demo/GlobalExceptionHandler.java',
      'src/main/java/com/demo/GlobalExceptionHandler.java'
    ]);

    const mermaid = tours.find((item) => item.id === 'error-handling')!.mermaid;
    expect(mermaid).toContain('GlobalExceptionHandler --> handleIllegal');
    expect(mermaid).toContain('handleIllegal --> handleNotFound');
    const bindings = clickBindings(mermaid);
    expect(bindings.get('handleNotFound')).toBe(
      'code://src/main/java/com/demo/GlobalExceptionHandler.java#9'
    );
  });
});

describe('buildTours — verify-routes（多 Controller + 安全/异常）', () => {
  it('main-flow prefers the deepest chain and is deterministic across both controllers', async () => {
    const symbols = await parseTree(VERIFY_ROUTES);
    const toursA = buildTours({ repoId: 'repo-test', repoName: 'verify-routes', symbols });
    const toursB = buildTours({ repoId: 'repo-test', repoName: 'verify-routes', symbols });
    expect(toursA.map((tour) => tour.mermaid)).toEqual(toursB.map((tour) => tour.mermaid));

    const steps = stepsOf(toursA, 'main-flow');
    // listOrders (depth 3) beats listUsers (depth 2); tie with getOrder broken
    // by source order → listOrders.
    expect(steps.map((step) => step.step)).toEqual([
      '1. OrderController.listOrders（入口接口）',
      '2. findOrders',
      '3. findAll'
    ]);
    expect(steps.map((step) => step.lineNumber)).toEqual([10, 9, 5]);
  });

  it('auth-chain uses the security package classes with exact lines', async () => {
    const symbols = await parseTree(VERIFY_ROUTES);
    const tours = buildTours({ repoId: 'repo-test', repoName: 'verify-routes', symbols });
    const steps = stepsOf(tours, 'auth-chain');
    expect(steps.map((step) => step.filePath)).toEqual([
      'src/main/java/com/shop/security/AuthFilter.java',
      'src/main/java/com/shop/security/UserInterceptor.java',
      'src/main/java/com/shop/api/OrderController.java'
    ]);
    expect(steps.map((step) => step.lineNumber)).toEqual([4, 4, 10]);
    expect(steps[0].step).toContain('AuthFilter.doFilter');
    expect(steps[1].step).toContain('UserInterceptor.preHandle');
  });

  it('error-handling finds the advice in the api package', async () => {
    const symbols = await parseTree(VERIFY_ROUTES);
    const tours = buildTours({ repoId: 'repo-test', repoName: 'verify-routes', symbols });
    const steps = stepsOf(tours, 'error-handling');
    expect(steps.map((step) => step.symbol)).toEqual([
      'GlobalExceptionHandler',
      'handleIllegal'
    ]);
    expect(steps.map((step) => step.lineNumber)).toEqual([4, 5]);
  });
});

describe('buildTours — 边界与确定性', () => {
  it('classifies @RestControllerAdvice as kind advice', async () => {
    const symbols = await parseTree(SAMPLE_JAVA);
    const advice = symbols.find((symbol) => symbol.name === 'GlobalExceptionHandler')!;
    expect(advice.kind).toBe('advice');
  });

  it('filters/interceptors are detected via name suffix and implemented interfaces', async () => {
    const symbols = await parseTree(SAMPLE_JAVA);
    const authFilter = symbols.find((symbol) => symbol.name === 'AuthFilter')!;
    expect(authFilter.interfaces).toContain('Filter');
    expect(authFilter.kind).toBe('class');
    const interceptor = symbols.find((symbol) => symbol.name === 'RequestInterceptor')!;
    expect(interceptor.interfaces).toContain('HandlerInterceptor');
  });

  it('library repo without routes/advice still yields three tours with empty steps', async () => {
    const symbols = await parseTree({
      'src/main/java/com/lib/Calculator.java': `package com.lib;

public class Calculator {
  public int add(int a, int b) {
    return a + b;
  }
}
`
    });
    const tours = buildTours({ repoId: 'repo-test', repoName: 'lib', symbols });
    expect(tours).toHaveLength(3);
    for (const tour of tours) {
      expect(tour.steps).toEqual([]);
      expect(tour.mermaid).toContain('暂无匹配代码');
    }
  });

  it('uniquifies duplicated method names in the mermaid chain (ID == 标签)', async () => {
    const symbols = await parseTree({
      'src/main/java/com/demo/OnlyController.java': `package com.demo;

@RestController
public class OnlyController {
  private final OnlyService service = new OnlyService();

  public String only() {
    return service.find();
  }
}
`,
      'src/main/java/com/demo/OnlyService.java': `package com.demo;

@Service
public class OnlyService {
  private final OnlyRepo repo = new OnlyRepo();

  public String find() {
    return repo.find();
  }
}
`,
      'src/main/java/com/demo/OnlyRepo.java': `package com.demo;

@Repository
public class OnlyRepo {
  public String find() {
    return "x";
  }
}
`
    });
    const tours = buildTours({ repoId: 'repo-test', repoName: 'only', symbols });
    const mermaid = tours.find((item) => item.id === 'main-flow')!.mermaid;
    expect(mermaid).toContain('only --> find');
    expect(mermaid).toContain('find --> find2');
    expect(mermaid).not.toContain('stop[stop]');
    const bindings = clickBindings(mermaid);
    expect(bindings.get('find')).toBe('code://src/main/java/com/demo/OnlyService.java#7');
    expect(bindings.get('find2')).toBe('code://src/main/java/com/demo/OnlyRepo.java#5');
  });

  it('chainMermaid emits a placeholder when there are no nodes', () => {
    expect(chainMermaid([])).toBe('flowchart LR\n  none[暂无匹配代码]');
  });

  it('chainMermaid appends a break node with an edge label when a break reason exists', () => {
    const mermaid = chainMermaid(
      [{ label: 'listOrders', file: 'a.java', line: 1 }],
      '[Static Analysis Break: target method not found]'
    );
    expect(mermaid).toContain(
      'listOrders -->|Static Analysis Break: target method not found| stop[stop]'
    );
  });
});