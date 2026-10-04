import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../../services/control-plane/src/db';
import { buildCallIndex, CallResolver, symbolIdentity } from '../../services/control-plane/src/engine/repoqa-callchain';
import { isTestPath } from '../../services/control-plane/src/diagnose-engine';
import type { RepoSymbol } from '../../services/control-plane/src/ingest/repoqa-repos';

/**
 * v1.2.x — **边解析率**跨语言体检（只测量，不改行为）。
 *
 * 可达基线（gate_breakchain_measure.ts）问的是「有多少符号能走到路由」，它受**有没有
 * HTTP 入口**主导：纯库 / CLI 仓天然是 0，于是分不出「解析器不行」与「本来就没有
 * 路由」。
 *
 * 这把尺子问的是更基础的一层：**索引出来的调用表达式里，有多少能解析到同仓的真实
 * 目标**。它与框架无关、与入口无关，因此能横向比较各语言的解析器质量：
 *   - resolved        解析到目标（这条边可用）
 *   - http            识别为 HTTP 调用（跨进程，已单独标注，不算解析失败）
 *   - dynamic-break   判定为动态分派（接口/注入/库调用——静态分析的天花板，可接受）
 *   - unresolved-break 连动态理由都没有、目标确实找不到（**这才是真缺陷**）
 *
 * 用法：
 *   node services/control-plane/node_modules/tsx/dist/cli.mjs \
 *     scripts/precision/edge_resolution_measure.ts [repoPath ...]
 */

const DB = path.join(process.env.USERPROFILE!, '.mhw', 'mhw.db');

interface Row {
  repo_id: string;
  kind: string;
  name: string;
  file_path: string;
  line_start: number | null;
  line_end: number | null;
  signature: string | null;
  calls: string | null;
  parent_type: string | null;
  type_name: string | null;
  interfaces: string | null;
  display_path: string | null;
  annotations: string | null;
  param_annotations: string | null;
  super_class: string | null;
  return_type: string | null;
}

function dominantLanguage(paths: string[]): string {
  const counts = new Map<string, number>();
  for (const p of paths) {
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p)) counts.set('TS/JS', (counts.get('TS/JS') ?? 0) + 1);
    else if (p.endsWith('.java')) counts.set('Java', (counts.get('Java') ?? 0) + 1);
    else if (p.endsWith('.go')) counts.set('Go', (counts.get('Go') ?? 0) + 1);
    else if (p.endsWith('.py')) counts.set('Python', (counts.get('Python') ?? 0) + 1);
  }
  let best = 'other';
  let n = 0;
  for (const [k, c] of counts) if (c > n) ((best = k), (n = c));
  return best;
}

const raw = new Database(DB, { readonly: true });
const rows = raw.prepare('SELECT * FROM repo_symbols').all() as Row[];
const repoNameRows = raw.prepare('SELECT id, name FROM repos').all() as Array<{ id: string; name: string }>;
raw.close();
const repoNames = new Map(repoNameRows.map((r) => [r.id, r.name]));

function toSymbol(r: Row): RepoSymbol {
  return {
    repoId: r.repo_id,
    kind: r.kind as RepoSymbol['kind'],
    name: r.name,
    filePath: r.file_path,
    lineStart: r.line_start ?? undefined,
    lineEnd: r.line_end ?? undefined,
    signature: r.signature ?? undefined,
    calls: r.calls ? (JSON.parse(r.calls) as RepoSymbol['calls']) : [],
    parentType: r.parent_type ?? undefined,
    displayPath: r.display_path ?? undefined
  } as RepoSymbol;
}

const byRepo = new Map<string, RepoSymbol[]>();
for (const r of rows) {
  const list = byRepo.get(r.repo_id) ?? [];
  list.push(toSymbol(r));
  byRepo.set(r.repo_id, list);
}

const reposArg = process.argv.slice(2);

console.log('=== 边解析率跨语言体检（v1.2.x；只测量，不改行为）===');
console.log('resolved=解析到同仓目标 | http=跨进程 HTTP 调用 | dynamic=动态分派（静态天花板）');
console.log('unresolved=**真缺陷**（目标既不在索引、也没有动态理由）\n');

/** 每仓一行（名字取自 repos 表），外加按语言聚合。 */
const perRepo: Array<{ name: string; lang: string; resolved: number; http: number; dynamic: number; unresolved: number }> = [];

for (const [repoId, symbols] of byRepo) {
  if (!symbols.length) continue;
  if (reposArg.length > 0) {
    const first = symbols[0].filePath.replace(/\\/g, '/');
    const hit = reposArg.some((p) => first.toLowerCase().startsWith(p.replace(/\\/g, '/').toLowerCase()));
    if (!hit) continue;
  }
  const lang = dominantLanguage(symbols.map((s) => s.filePath));
  const index = buildCallIndex(symbols);
  const resolver = new CallResolver(symbols, index);

  let resolved = 0;
  let http = 0;
  let dynamic = 0;
  let unresolved = 0;
  for (const caller of symbols) {
    if (caller.kind !== 'method' && caller.kind !== 'route') continue;
    for (const call of caller.calls ?? []) {
      if ((call as { http?: unknown }).http) {
        http += 1;
        continue;
      }
      const r = resolver.resolve(caller, call);
      if ('target' in r && r.target) resolved += 1;
      else if ('reason' in r && /Dynamic/.test(r.reason)) dynamic += 1;
      else unresolved += 1;
    }
  }
  if (resolved + http + dynamic + unresolved === 0) continue;
  perRepo.push({
    name: repoNames.get(repoId) ?? repoId,
    lang,
    resolved,
    http,
    dynamic,
    unresolved
  });
}

const pct = (n: number, total: number) => (total > 0 ? `${((n / total) * 100).toFixed(0)}%` : '—');

for (const r of perRepo.sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))) {
  const total = r.resolved + r.http + r.dynamic + r.unresolved;
  console.log(
    `${r.name.padEnd(28)} ${r.lang.padEnd(7)} 边${String(total).padStart(6)} | 解析 ${String(r.resolved).padStart(5)} (${pct(r.resolved, total).padStart(4)}) | http ${String(r.http).padStart(4)} | 动态 ${String(r.dynamic).padStart(5)} (${pct(r.dynamic, total).padStart(4)}) | **未解析 ${String(r.unresolved).padStart(5)} (${pct(r.unresolved, total).padStart(4)})**`
  );
}

console.log('\n--- 按语言聚合（跨仓）---');
const byLang = new Map<string, { resolved: number; http: number; dynamic: number; unresolved: number; edges: number }>();
for (const r of perRepo) {
  const acc = byLang.get(r.lang) ?? { resolved: 0, http: 0, dynamic: 0, unresolved: 0, edges: 0 };
  acc.resolved += r.resolved;
  acc.http += r.http;
  acc.dynamic += r.dynamic;
  acc.unresolved += r.unresolved;
  acc.edges += r.resolved + r.http + r.dynamic + r.unresolved;
  byLang.set(r.lang, acc);
}
for (const [lang, a] of [...byLang].sort((x, y) => y[1].edges - x[1].edges)) {
  console.log(
    `${lang.padEnd(8)} 边${String(a.edges).padStart(6)} | 解析 ${pct(a.resolved, a.edges).padStart(4)} | 动态 ${pct(a.dynamic, a.edges).padStart(4)} | **未解析 ${pct(a.unresolved, a.edges).padStart(4)}**`
  );
}
console.log('\n读法：「未解析」是唯一可直接归咎于解析器的部分；「动态」是静态分析的天花板，不该记在头上。');
void openDb;