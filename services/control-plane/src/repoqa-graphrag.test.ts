import { describe, expect, it } from 'vitest';
import { extractSubgraphContext } from './repoqa-graphrag';
import { buildCallIndex } from './repoqa-callchain';
import { parseJavaSource } from './repoqa-parser';
import { parseTypeScriptSource } from './languages/TypeScriptAdapter';
import { parseGoSource } from './languages/GoAdapter';
import type { RepoSymbol } from './repoqa-repos';

const sourceMap = new Map<string, string>();
const readFixture = (filePath: string) => Promise.resolve(sourceMap.get(filePath) ?? '');

function store(source: string, filePath: string): void {
  sourceMap.set(filePath, source);
}

function methodSymbol(
  name: string,
  filePath: string,
  calls: RepoSymbol['calls'] = []
): RepoSymbol {
  return {
    repoId: 'repo',
    kind: 'method',
    name,
    filePath,
    lineStart: 1,
    lineEnd: 30,
    signature: `${name}()`,
    parentType: 'Demo',
    calls
  };
}

describe('Issue 28 AST Graph RAG subgraph extractor', () => {
  it('extracts 1-hop callers and 1-3 hop callees across Java/TS/Go symbols', async () => {
    const java = [
      parseJavaSource(
        [
          '@RestController',
          'class OrdersController {',
          '  private final OrderService orderService = new OrderService();',
          '  @GetMapping("/orders")',
          '  public String listOrders() {',
          '    return orderService.findOrders();',
          '  }',
          '}'
        ].join('\n'),
        'backend/OrdersController.java',
        'repo'
      ),
      parseJavaSource(
        [
          '@Service',
          'class OrderService {',
          '  private final OrderRepository orderRepository = new OrderRepository();',
          '  public String findOrders() {',
          '    return orderRepository.findAll();',
          '  }',
          '}'
        ].join('\n'),
        'backend/OrderService.java',
        'repo'
      ),
      parseJavaSource(
        [
          '@Repository',
          'class OrderRepository {',
          '  public String findAll() {',
          '    return "orders";',
          '  }',
          '}'
        ].join('\n'),
        'backend/OrderRepository.java',
        'repo'
      )
    ].flat();
    const ts = parseTypeScriptSource(
      "export async function loadOrders() { return fetch('/api/orders'); }",
      'web/orders.ts',
      'repo'
    );
    const go = parseGoSource(
      'package api\n\ntype OrderHandler struct{}\n\nfunc (h *OrderHandler) Handle() string {\n  return "orders"\n}\n',
      'go/handler.go',
      'repo'
    );
    const symbols = [...java, ...ts, ...go];
    const index = buildCallIndex(symbols);
    for (const symbol of symbols) store(sourceFor(symbol), symbol.filePath);

    const start = symbols.find((symbol) => symbol.name === 'loadOrders')!;
    const context = await extractSubgraphContext(symbols, start, {
      index,
      readFile: readFixture
    });

    expect(context.start.name).toBe('loadOrders');
    expect(context.nodes.filter((node) => node.direction === 'callee')).toHaveLength(3);
    expect(context.nodes.map((node) => node.name)).toEqual(
      expect.arrayContaining(['listOrders', 'findOrders', 'findAll'])
    );
    expect(context.text).toContain('OrdersController');
    expect(context.text).toContain('listOrders');
    expect(context.text).toContain('findAll');

    const goStart = symbols.find((symbol) => symbol.name === 'Handle')!;
    const goContext = await extractSubgraphContext(symbols, goStart, {
      index,
      readFile: readFixture
    });
    expect(goContext.start.name).toBe('Handle');
    expect(goContext.text).toContain('OrderHandler');
  });

  it('resolves reverse callers for a data-layer terminal symbol', async () => {
    const java = parseJavaSource(
      [
        '@Service',
        'class OrderService {',
        '  private final OrderRepository orderRepository = new OrderRepository();',
        '  public String findOrders() {',
        '    return orderRepository.findAll();',
        '  }',
        '}'
      ].join('\n'),
      'backend/OrderService.java',
      'repo'
    );
    const repo = parseJavaSource(
      [
        '@Repository',
        'class OrderRepository {',
        '  public String findAll() {',
        '    return "orders";',
        '  }',
        '}'
      ].join('\n'),
      'backend/OrderRepository.java',
      'repo'
    );
    const symbols = [...java, ...repo];
    for (const symbol of symbols) store(sourceFor(symbol), symbol.filePath);
    const start = symbols.find((symbol) => symbol.name === 'findAll')!;

    const context = await extractSubgraphContext(symbols, start, {
      index: buildCallIndex(symbols),
      readFile: readFixture
    });

    expect(context.nodes.map((node) => node.name)).toEqual(
      expect.arrayContaining(['findOrders'])
    );
    expect(context.nodes.find((node) => node.name === 'findOrders')?.direction).toBe('caller');
    expect(context.text).toContain('## Callers (1 hop)');
    expect(context.text).toContain('findOrders');
  });

  it('includes cross-language callers through callerRoots (v0.5.1 D8)', async () => {
    const backend = [
      ...parseJavaSource(
        [
          '@RestController',
          '@RequestMapping("/api/v1/posts")',
          'class PostController {',
          '  @PostMapping("/{id}/like")',
          '  public void likePost(long id) {}',
          '}'
        ].join('\n'),
        'backend/PostController.java',
        'repo'
      ),
      ...parseJavaSource(
        [
          'class LikeCounterService {',
          '  public void likePost(long id) {}',
          '}'
        ].join('\n'),
        'backend/LikeCounterService.java',
        'repo'
      )
    ];
    const frontend = parseTypeScriptSource(
      [
        'export default function PostDetailPage() {',
        '  const handleLike = async () => {',
        "    await apiClient.post('/posts/' + id + '/like');",
        '  };',
        '}'
      ].join('\n'),
      'web/PostDetailPage.tsx',
      'repo'
    );
    const symbols = [...backend, ...frontend];
    for (const symbol of symbols) store(sourceFor(symbol), symbol.filePath);
    const index = buildCallIndex(symbols);
    const service = symbols.find(
      (symbol) => symbol.name === 'likePost' && symbol.filePath.includes('LikeCounterService')
    )!;
    const controller = symbols.find(
      (symbol) => symbol.name === 'likePost' && symbol.filePath.includes('PostController')
    )!;

    const context = await extractSubgraphContext(symbols, service, {
      index,
      callerRoots: [controller],
      readFile: readFixture
    });

    const tsCaller = context.nodes.find(
      (node) => node.name === 'handleLike' && node.file.endsWith('.tsx')
    );
    expect(tsCaller).toBeDefined();
    expect(tsCaller?.direction).toBe('caller');
  });

  it('folds class skeletons and prunes against a hard token budget', async () => {
    const classSymbol: RepoSymbol = {
      repoId: 'repo',
      kind: 'class',
      name: 'Demo',
      filePath: 'Demo.java',
      lineStart: 1,
      lineEnd: 90,
      signature: 'class Demo',
      calls: []
    };
    const a = methodSymbol('A', 'Demo.java', [
      { file: 'Demo.java', method: 'B' }
    ]);
    const b = methodSymbol('B', 'Demo.java', [
      { file: 'Demo.java', method: 'C' }
    ]);
    const c = methodSymbol('C', 'Demo.java');
    const symbols = [classSymbol, a, b, c];
    store('x'.repeat(2000), 'Demo.java');

    const context = await extractSubgraphContext(symbols, a, {
      maxTokens: 200,
      readFile: readFixture
    });

    expect(context.truncated).toBe(true);
    expect(context.prunedCount).toBeGreaterThan(0);
    expect(context.nodes.length).toBeLessThan(symbols.filter((symbol) => symbol.kind === 'method').length);
    expect(context.text).toContain('+ A()  // @ Demo.java:1');
    expect(context.text.length).toBeLessThanOrEqual(200 * 4);
  });

  it('masks credentials with the shared 13-pattern engine before emitting text', async () => {
    const start = methodSymbol('connect', 'Secrets.java');
    store(
      [
        'const password = "hunter2";',
        'const apiKey = "sk-proj-abc123DEF456ghi789";',
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEpA==',
        '-----END RSA PRIVATE KEY-----'
      ].join('\n'),
      'Secrets.java'
    );

    const context = await extractSubgraphContext([start], start, {
      readFile: readFixture
    });

    expect(context.text).not.toContain('hunter2');
    expect(context.text).not.toContain('sk-proj-abc123DEF456ghi789');
    expect(context.text).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(context.text).toContain('const apiKey = "***"');
    expect(context.text).toContain('[REDACTED PRIVATE KEY]');
  });
});

function sourceFor(symbol: RepoSymbol): string {
  if (symbol.filePath === 'backend/OrdersController.java') {
    return [
      '@RestController',
      'class OrdersController {',
      '  private final OrderService orderService = new OrderService();',
      '  @GetMapping("/orders")',
      '  public String listOrders() {',
      '    return orderService.findOrders();',
      '  }',
      '}'
    ].join('\n');
  }
  if (symbol.filePath === 'backend/OrderService.java') {
    return [
      '@Service',
      'class OrderService {',
      '  private final OrderRepository orderRepository = new OrderRepository();',
      '  public String findOrders() {',
      '    return orderRepository.findAll();',
      '  }',
      '}'
    ].join('\n');
  }
  if (symbol.filePath === 'backend/OrderRepository.java') {
    return [
      '@Repository',
      'class OrderRepository {',
      '  public String findAll() {',
      '    return "orders";',
      '  }',
      '}'
    ].join('\n');
  }
  if (symbol.filePath === 'web/orders.ts') {
    return "export async function loadOrders() { return fetch('/api/orders'); }";
  }
  if (symbol.filePath === 'go/handler.go') {
    return 'package api\n\ntype OrderHandler struct{}\n\nfunc (h *OrderHandler) Handle() string {\n  return "orders"\n}\n';
  }
  if (symbol.filePath === 'backend/PostController.java') {
    return [
      '@RestController',
      '@RequestMapping("/api/v1/posts")',
      'class PostController {',
      '  @PostMapping("/{id}/like")',
      '  public void likePost(long id) {}',
      '}'
    ].join('\n');
  }
  if (symbol.filePath === 'backend/LikeCounterService.java') {
    return [
      'class LikeCounterService {',
      '  public void likePost(long id) {}',
      '}'
    ].join('\n');
  }
  if (symbol.filePath === 'web/PostDetailPage.tsx') {
    return [
      'export default function PostDetailPage() {',
      '  const handleLike = async () => {',
      "    await apiClient.post('/posts/' + id + '/like');",
      '  };',
      '}'
    ].join('\n');
  }
  return '';
}
