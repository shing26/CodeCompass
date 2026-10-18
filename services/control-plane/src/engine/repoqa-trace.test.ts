import { describe, expect, it } from 'vitest';
import type { RepoSymbol } from '../ingest/repoqa-repos';
import { buildTraceResult, renderTraceTree, resolveTraceTarget } from './repoqa-trace';

/**
 * v1.4 票 05 — fixture set for `codecompass trace`.
 *
 * Shape: POST /login (route) → login → {verifyPassword → compare, issueToken}.
 * `login` also calls an unknown name (external) and a dynamic receiver call.
 */
const symbols: RepoSymbol[] = [
  {
    repoId: 'r',
    kind: 'route',
    name: 'POST /login',
    filePath: 'src/routes.ts',
    lineStart: 4,
    lineEnd: 4,
    calls: [{ file: 'src/routes.ts', method: 'login', line: 4 }]
  },
  {
    repoId: 'r',
    kind: 'method',
    name: 'login',
    filePath: 'src/auth.ts',
    lineStart: 10,
    lineEnd: 24,
    calls: [
      { file: 'src/auth.ts', method: 'verifyPassword', line: 12 },
      { file: 'src/auth.ts', method: 'issueToken', line: 13 },
      { file: 'src/auth.ts', method: 'pbkdf2', line: 15 },
      { file: 'src/auth.ts', method: 'handle', receiver: 'hooks', dynamic: true, line: 18 }
    ]
  },
  {
    repoId: 'r',
    kind: 'method',
    name: 'verifyPassword',
    filePath: 'src/crypto.ts',
    lineStart: 5,
    lineEnd: 9,
    calls: [{ file: 'src/crypto.ts', method: 'compare', line: 6 }]
  },
  {
    repoId: 'r',
    kind: 'method',
    name: 'compare',
    filePath: 'src/crypto.ts',
    lineStart: 30,
    lineEnd: 34,
    calls: []
  },
  {
    repoId: 'r',
    kind: 'method',
    name: 'issueToken',
    filePath: 'src/token.ts',
    lineStart: 3,
    lineEnd: 8,
    calls: []
  }
];

const login = symbols.find((symbol) => symbol.name === 'login')!;

describe('v1.4 trace — buildTraceResult', () => {
  it('walks callees down to the requested depth with deterministic order', () => {
    const result = buildTraceResult(symbols, login, undefined, { up: 1, down: 2 });
    expect(result.target).toMatchObject({ name: 'login', file: 'src/auth.ts', line: 10 });
    const names = result.down.roots.map((node) => node.name);
    expect(names).toEqual(['verifyPassword', 'issueToken']);
    const verify = result.down.roots.find((node) => node.name === 'verifyPassword')!;
    expect(verify.children.map((node) => node.name)).toEqual(['compare']);
    expect(result.down.nodeCount).toBe(3);
  });

  it('stops at the depth limit', () => {
    const result = buildTraceResult(symbols, login, undefined, { up: 0, down: 1 });
    const verify = result.down.roots.find((node) => node.name === 'verifyPassword')!;
    expect(verify.children).toEqual([]);
    expect(result.up.roots).toEqual([]);
  });

  it('resolves upstream callers including the route symbol', () => {
    const result = buildTraceResult(symbols, login, undefined, { up: 2, down: 0 });
    const upNames = result.up.roots.map((node) => node.name);
    expect(upNames).toEqual(['POST /login']);
    expect(result.up.roots[0].kind).toBe('route');
  });

  it('counts unresolvable edges as static-analysis breaks, never as edges', () => {
    const result = buildTraceResult(symbols, login, undefined, { up: 0, down: 1 });
    expect(result.breaks.external).toBe(1); // pbkdf2 exists nowhere in the repo
    expect(result.breaks.dynamic).toBe(1); // dynamic receiver
    const labels = result.down.roots.map((node) => node.name);
    expect(labels).not.toContain('pbkdf2');
    expect(labels).not.toContain('handle');
  });

  it('marks cycles instead of looping forever', () => {
    const cyclic: RepoSymbol[] = [
      {
        repoId: 'r',
        kind: 'method',
        name: 'ping',
        filePath: 'src/ping.ts',
        lineStart: 1,
        lineEnd: 4,
        calls: [{ file: 'src/ping.ts', method: 'pong', line: 2 }]
      },
      {
        repoId: 'r',
        kind: 'method',
        name: 'pong',
        filePath: 'src/pong.ts',
        lineStart: 1,
        lineEnd: 4,
        calls: [{ file: 'src/pong.ts', method: 'ping', line: 2 }]
      }
    ];
    const result = buildTraceResult(cyclic, cyclic[0], undefined, { up: 0, down: 3 });
    const pong = result.down.roots[0];
    expect(pong.name).toBe('pong');
    expect(pong.children[0]).toMatchObject({ name: 'ping', note: 'cycle' });
  });

  it('marks a symbol expanded once as shown-above instead of duplicating subtrees', () => {
    const fanOut: RepoSymbol[] = [
      {
        repoId: 'r',
        kind: 'method',
        name: 'main',
        filePath: 'src/main.ts',
        lineStart: 1,
        lineEnd: 8,
        calls: [
          { file: 'src/main.ts', method: 'first', line: 2 },
          { file: 'src/main.ts', method: 'second', line: 3 }
        ]
      },
      {
        repoId: 'r',
        kind: 'method',
        name: 'first',
        filePath: 'src/a.ts',
        lineStart: 1,
        lineEnd: 3,
        calls: [{ file: 'src/a.ts', method: 'shared', line: 2 }]
      },
      {
        repoId: 'r',
        kind: 'method',
        name: 'second',
        filePath: 'src/b.ts',
        lineStart: 1,
        lineEnd: 3,
        calls: [{ file: 'src/b.ts', method: 'shared', line: 2 }]
      },
      {
        repoId: 'r',
        kind: 'method',
        name: 'shared',
        filePath: 'src/s.ts',
        lineStart: 1,
        lineEnd: 3,
        calls: []
      }
    ];
    const result = buildTraceResult(fanOut, fanOut[0], undefined, { up: 0, down: 3 });
    const flat = result.down.roots.flatMap((node) => node.children);
    expect(flat.filter((node) => node.name === 'shared')).toHaveLength(2);
    expect(flat.some((node) => node.note === 'shown-above')).toBe(true);
    expect(result.down.nodeCount).toBe(4); // main's children + shared, counted once
  });
});

describe('v1.4 trace — resolveTraceTarget', () => {
  it('picks a symbol inside a file when -f is given', () => {
    const result = resolveTraceTarget(symbols, { query: 'auth.ts', filter: 'login' });
    expect(result).toEqual({ ok: true, symbol: login });
  });

  it('accepts a path fragment for the file positional', () => {
    const result = resolveTraceTarget(symbols, { query: 'crypto', filter: 'compare' });
    expect(result.ok && result.symbol.name).toBe('compare');
  });

  it('reports no-match honestly instead of guessing', () => {
    expect(resolveTraceTarget(symbols, { query: 'auth.ts', filter: 'nope' })).toEqual({
      ok: false,
      reason: 'no-match',
      candidates: []
    });
  });

  it('lists candidates when a bare name is ambiguous across files', () => {
    const ambiguous: RepoSymbol[] = [
      ...symbols,
      { repoId: 'r', kind: 'method', name: 'login', filePath: 'src/legacy.ts', lineStart: 2, lineEnd: 6 }
    ];
    const result = resolveTraceTarget(ambiguous, { query: 'login' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('ambiguous');
    expect(!result.ok && result.candidates.length).toBe(2);
  });

  it('prefers the worker resolution when provided', () => {
    const result = resolveTraceTarget(symbols, { query: 'login' }, login);
    expect(result).toEqual({ ok: true, symbol: login });
  });
});

describe('v1.4 trace — renderTraceTree', () => {
  it('renders a unicode tree with stats and breaks', () => {
    const text = renderTraceTree(buildTraceResult(symbols, login, undefined, { up: 1, down: 2 }));
    expect(text).toContain('login — src/auth.ts:10 (method)');
    expect(text).toContain('Upstream (callers, depth 1): 1 node(s)');
    expect(text).toContain('POST /login — src/routes.ts:4');
    expect(text).toContain('├─ verifyPassword — src/crypto.ts:5');
    expect(text).toContain('Static analysis breaks: EXTERNAL x1, DYNAMIC x1');
  });

  it('renders pure ASCII when asked (--ascii)', () => {
    const text = renderTraceTree(buildTraceResult(symbols, login, undefined, { up: 1, down: 1 }), {
      ascii: true
    });
    expect(text).not.toMatch(/[├└│─]/);
    expect(text).toContain('`-- ');
    expect(text).toContain('|-- ');
  });

  it('says none when nothing is broken', () => {
    const text = renderTraceTree(
      buildTraceResult(symbols, symbols.find((s) => s.name === 'compare')!, undefined, {
        up: 1,
        down: 1
      })
    );
    expect(text).toContain('Static analysis breaks: none');
    expect(text).toContain('Downstream (callees, depth 1): 0 node(s)');
    expect(text).toContain('(none)');
  });
});
