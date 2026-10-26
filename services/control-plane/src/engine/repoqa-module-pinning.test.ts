import { describe, expect, it } from 'vitest';
import type { RepoSymbol, RepoSymbolCall } from '../ingest/repoqa-repos';
import { buildCallIndex, resolveCallEdge } from './repoqa-callchain';

/**
 * v1.6 票 05 / ADR-0022 Phase 1 — import 陈述钉死跨文件绑定。
 *
 * 这些用例只盯「绑定到哪个文件」：同一个方法名在两个文件里都声明时，v1.5 的
 * 规则是「caller 自身文件优先，否则最早声明」——那是任意性；import 声明是词法事实，
 * Phase 1 让它优先。
 */

const REPO = 'repo-test';

function method(
  filePath: string,
  name: string,
  lineStart: number,
  calls: RepoSymbolCall[] = []
): RepoSymbol {
  return { repoId: REPO, kind: 'method', name, filePath, lineStart, lineEnd: lineStart + 1, calls };
}

/** implA 是更早声明（lineStart 10 < 20）——v1.5 默认会绑它。 */
const IMPL_A = method('src/implA.ts', 'run', 10);
const IMPL_B = method('src/implB.ts', 'run', 20);
const CALL: RepoSymbolCall = { file: 'src/caller.ts', method: 'run', line: 3 };

function resolveWith(moduleImports?: Map<string, Map<string, { target: string; kind: string }>>) {
  const caller = method('src/caller.ts', 'main', 1, [CALL]);
  const index = buildCallIndex([IMPL_A, IMPL_B, caller], moduleImports);
  return resolveCallEdge(index, caller, CALL);
}

function tableOf(target: string, kind: string) {
  return new Map([['src/caller.ts', new Map([['run', { target, kind }]])]]);
}

describe('Phase 1 — import 陈述钉死（L1）', () => {
  it('without a module table, a multi-file TS name is ambiguous — not the earliest declaration', () => {
    // Phase 2 之后这条不再是「绑最早声明」：多文件同名且无 import 证据 = 不确定。
    const resolved = resolveWith();
    expect('reason' in resolved && resolved.reason).toContain('ambiguous target');
  });

  it('a named import overrides the earliest-declaration tiebreak', () => {
    const resolved = resolveWith(tableOf('src/implB.ts', 'named'));
    expect('target' in resolved && resolved.target.filePath).toBe('src/implB.ts');
  });

  it('a default import does not pin — it binds the default export, not this name', () => {
    const resolved = resolveWith(tableOf('src/implB.ts', 'default'));
    expect('target' in resolved).toBe(false);
  });

  it('a namespace import does not pin — it yields a module object, not a name', () => {
    const resolved = resolveWith(tableOf('src/implB.ts', 'namespace'));
    expect('target' in resolved).toBe(false);
  });

  it('falls back to ambiguity when the pinned file does not declare the name', () => {
    const caller = method('src/caller.ts', 'main', 1, [CALL]);
    const index = buildCallIndex([IMPL_A, IMPL_B, caller], tableOf('src/none.ts', 'named'));
    const resolved = resolveCallEdge(index, caller, CALL);
    expect('target' in resolved).toBe(false);
  });

  it('same-file declaration still wins over an import (lexical fact beats both)', () => {
    const sameFile = method('src/caller.ts', 'run', 50);
    const caller = method('src/caller.ts', 'main', 1, [CALL]);
    const index = buildCallIndex([IMPL_A, IMPL_B, sameFile, caller], tableOf('src/implB.ts', 'named'));
    const resolved = resolveCallEdge(index, caller, CALL);
    expect('target' in resolved && resolved.target.filePath).toBe('src/caller.ts');
  });

  it('does not pin a dynamic/receiver-typed call (that path stays ADR-0002 dynamic)', () => {
    const dynamicCall: RepoSymbolCall = { ...CALL, dynamic: true };
    const caller = method('src/caller.ts', 'main', 1, [dynamicCall]);
    const index = buildCallIndex([IMPL_A, IMPL_B, caller], tableOf('src/implB.ts', 'named'));
    const resolved = resolveCallEdge(index, caller, dynamicCall);
    expect('reason' in resolved).toBe(true);
  });
});

describe('Phase 2 — 歧义显式化（TS/JS only）', () => {
  it('marks an unpinnable multi-file TS name ambiguous instead of binding the earliest declaration', () => {
    const resolved = resolveWith();
    expect('reason' in resolved && resolved.reason).toContain('ambiguous target');
  });

  it('still binds when only one file declares the name', () => {
    const caller = method('src/caller.ts', 'main', 1, [CALL]);
    const index = buildCallIndex([IMPL_A, caller]);
    const resolved = resolveCallEdge(index, caller, CALL);
    expect('target' in resolved && resolved.target.filePath).toBe('src/implA.ts');
  });

  it('a named import beats the ambiguity check', () => {
    const resolved = resolveWith(tableOf('src/implB.ts', 'named'));
    expect('target' in resolved && resolved.target.filePath).toBe('src/implB.ts');
  });

  it('Go keeps the package rule — no ambiguity marker on Go files (byte-identical hard assertion)', () => {
    const goA = method('app/a.go', 'Run', 10);
    const goB = method('other/b.go', 'Run', 20);
    const call: RepoSymbolCall = { file: 'app/main.go', method: 'Run', line: 3 };
    const caller = method('app/main.go', 'main', 1, [call]);
    const index = buildCallIndex([goA, goB, caller]);
    const resolved = resolveCallEdge(index, caller, call);
    expect('target' in resolved && resolved.target.filePath).toBe('app/a.go');
  });

  it('Java keeps the type/name rule — no ambiguity marker on Java files', () => {
    const javaA = method('src/A.java', 'run', 10);
    const javaB = method('src/B.java', 'run', 20);
    const call: RepoSymbolCall = { file: 'src/Caller.java', method: 'run', line: 3 };
    const caller = method('src/Caller.java', 'main', 1, [call]);
    const index = buildCallIndex([javaA, javaB, caller]);
    const resolved = resolveCallEdge(index, caller, call);
    expect('target' in resolved && resolved.target.filePath).toBe('src/A.java');
  });
});