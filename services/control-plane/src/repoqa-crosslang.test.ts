import { describe, expect, it } from 'vitest';
import { parseJavaSource } from './repoqa-parser';
import { parseTypeScriptSource } from './languages/TypeScriptAdapter';
import { buildCallIndex, CallResolver, resolveCallChain } from './repoqa-callchain';

describe('cross-language HTTP call chain bridging (Issue 25)', () => {
  it('bridges a frontend fetch call to a Java Spring route via displayPath', () => {
    const backend = parseJavaSource(
      [
        '@RestController',
        '@RequestMapping("/owners")',
        'class OwnerController {',
        '  @GetMapping("/")',
        '  List<Owner> listOwners() { return null; }',
        '}'
      ].join('\n'),
      'backend/OwnerController.java',
      'repo'
    );
    const frontend = parseTypeScriptSource(
      [
        'export async function loadOwners() {',
        "  return fetch('/api/owners');",
        '}'
      ].join('\n'),
      'web/owners-api.ts',
      'repo'
    );

    const start = frontend.find((symbol) => symbol.name === 'loadOwners');
    expect(start).toBeDefined();
    const index = buildCallIndex([...backend, ...frontend]);
    const trace = resolveCallChain([...backend, ...frontend], start!, 4, index);

    expect(trace).toHaveLength(2);
    expect(trace[0].method).toBe('loadOwners');
    expect(trace[0].file).toBe('web/owners-api.ts');
    expect(trace[1]).toMatchObject({
      method: 'listOwners',
      file: 'backend/OwnerController.java'
    });
    expect(trace[1].break).not.toBe(true);
  });

  it('bridges an axios call to an Express route and then its handler', () => {
    const symbols = parseTypeScriptSource(
      [
        "import axios from 'axios';",
        'const router = express.Router();',
        "router.get('/orders', getOrders);",
        'export async function loadOrders() {',
        "  return axios.get('/api/orders');",
        '}',
        'function getOrders() { return []; }'
      ].join('\n'),
      'web/orders-api.ts',
      'repo'
    );

    const start = symbols.find((symbol) => symbol.name === 'loadOrders');
    expect(start).toBeDefined();
    const trace = resolveCallChain(symbols, start!, 4);

    expect(trace.map((hop) => hop.method)).toEqual([
      'loadOrders',
      'GET /orders',
      'getOrders'
    ]);
    expect(trace.every((hop) => hop.break !== true)).toBe(true);
  });

  it('bridges apiClient dynamic paths to Spring route patterns (v0.5.1 D8)', () => {
    const backend = parseJavaSource(
      [
        '@RestController',
        '@RequestMapping("/api/v1/posts")',
        'class PostController {',
        '  @PostMapping("/{id}/like")',
        '  void likePost(long id) { }',
        '}'
      ].join('\n'),
      'backend/PostController.java',
      'repo'
    );
    const frontend = parseTypeScriptSource(
      [
        'export async function handleLike(id: string) {',
        "  await apiClient.post('/posts/' + id + '/like');",
        '}'
      ].join('\n'),
      'web/PostDetailPage.tsx',
      'repo'
    );

    const symbols = [...backend, ...frontend];
    const index = buildCallIndex(symbols);
    const start = frontend.find((symbol) => symbol.name === 'handleLike')!;
    const trace = resolveCallChain(symbols, start!, 4, index);
    expect(trace.map((hop) => hop.method)).toEqual([
      'handleLike',
      'likePost'
    ]);
    expect(trace[1]).toMatchObject({
      file: 'backend/PostController.java'
    });

    const backendTarget = backend.find((symbol) => symbol.name === 'likePost')!;
    const callers = new CallResolver(symbols, index).reverseCallers(backendTarget);
    expect(callers.map((caller) => caller.file)).toEqual(['web/PostDetailPage.tsx']);
  });
});
