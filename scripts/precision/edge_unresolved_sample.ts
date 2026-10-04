import path from 'node:path';
import Database from 'better-sqlite3';
import { buildCallIndex, CallResolver } from '../../services/control-plane/src/engine/repoqa-callchain';
import type { RepoSymbol } from '../../services/control-plane/src/ingest/repoqa-repos';

/**
 * v1.2.x — **未解析边的构成抽样**（先看清再决定改不改）。
 *
 * 上一把尺子给出「未解析率」：TS/JS 38%、Java 32%、Python 32%、Go 14%。但那个数字是
 * **上界**——它把两类完全不同的东西混在一起：
 *
 *   A. **真解析缺陷**：被调用的名字**就在本仓**，索引里有它，只是这条边没连上。
 *      这是解析器的锅，改它能直接涨可达率。
 *   B. **外部库调用**：被调用的名字本仓根本没有（`fmt.Sprintf`、`log.Infof`、
 *      `requests.get`…）。静态分析看不见外部，这些边**永远解析不了**，也不该被
 *      记成「解析失败」——它们与调用链里刚拆出来的 `EXTERNAL`（止于仓库外）是同一
 *      类东西，现在却落进了 unresolved 桶，**把指标灌了水**。
 *
 * 所以在决定改不改之前，先抽一批样本看构成。判据（不靠猜）：
 *   目标名在**本仓任一符号**里出现过 → A（真缺陷）
 *   从未出现 → B（外部，按定义不可解析）
 *
 * 用法：
 *   node services/control-plane/node_modules/tsx/dist/cli.mjs \
 *     scripts/precision/edge_unresolved_sample.ts [每类样本数=20]
 */

const DB = path.join(process.env.USERPROFILE!, '.mhw', 'mhw.db');
const PER_BUCKET = Number(process.argv[2] ?? '20');
const SEED = 20261004;

interface Row {
  repo_id: string;
  kind: string;
  name: string;
  file_path: string;
  line_start: number | null;
  calls: string | null;
  parent_type: string | null;
  display_path: string | null;
}

const db = new Database(DB, { readonly: true });
const rows = db.prepare('SELECT * FROM repo_symbols').all() as Row[];
const repoNames = new Map(
  (db.prepare('SELECT id, name FROM repos').all() as Array<{ id: string; name: string }>).map((r) => [
    r.id,
    r.name
  ])
);
db.close();

const byRepo = new Map<string, RepoSymbol[]>();
for (const r of rows) {
  const sym = {
    repoId: r.repo_id,
    kind: r.kind,
    name: r.name,
    filePath: r.file_path,
    lineStart: r.line_start ?? undefined,
    calls: r.calls ? JSON.parse(r.calls) : [],
    parentType: r.parent_type ?? undefined,
    displayPath: r.display_path ?? undefined
  } as unknown as RepoSymbol;
  const list = byRepo.get(r.repo_id) ?? [];
  list.push(sym);
  byRepo.set(r.repo_id, list);
}

/** 本仓出现过的名字，分两类：**可绑定的**（method/route）与**结构上绑不上的**（class/field/type/config）。 */
const bindableNames = new Map<string, Set<string>>();
const anyNames = new Map<string, Set<string>>();
for (const symbols of byRepo.values()) {
  for (const s of symbols) {
    let any = anyNames.get(s.repoId);
    if (!any) {
      any = new Set<string>();
      anyNames.set(s.repoId, any);
    }
    any.add(s.name);
    if (s.parentType) any.add(`${s.parentType}.${s.name}`);
    // 只有方法/路由才是调用边**可以**绑定的目标。类字段（构造函数里赋的箭头函数）、
    // 类本身（构造函数调用）、类型、配置键都没有方法符号，绑不上不是解析器的锅。
    if (s.kind === 'method' || s.kind === 'route') {
      let bind = bindableNames.get(s.repoId);
      if (!bind) {
        bind = new Set<string>();
        bindableNames.set(s.repoId, bind);
      }
      bind.add(s.name);
      if (s.parentType) bind.add(`${s.parentType}.${s.name}`);
    }
  }
}

interface Sample {
  repo: string;
  lang: string;
  caller: string;
  callerAt: string;
  callee: string;
  receiver?: string;
  dynamic?: boolean;
  verdict: 'A-仓内存在但未连上' | 'B-本仓不存在（外部）';
  where: string;
}

function langOf(paths: string[]): string {
  const counts: Record<string, number> = {};
  for (const p of paths) {
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p)) counts.ts = (counts.ts ?? 0) + 1;
    else if (p.endsWith('.java')) counts.java = (counts.java ?? 0) + 1;
    else if (p.endsWith('.go')) counts.go = (counts.go ?? 0) + 1;
    else if (p.endsWith('.py')) counts.py = (counts.py ?? 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : '?';
}

/** 确定性 xorshift 抽样——可复现，不引入随机性。 */
function take<T>(items: T[], n: number, seed: number): T[] {
  const pool = [...items];
  const out: T[] = [];
  let state = seed >>> 0;
  for (let i = 0; i < Math.min(n, pool.length); i += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    const idx = state % pool.length;
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

const bucketA = new Map<string, Sample[]>();
const bucketB = new Map<string, Sample[]>();
const bucketC = new Map<string, Sample[]>();
const langTotals = new Map<string, { a: number; b: number; c: number }>();

for (const [repoId, symbols] of byRepo) {
  if (!symbols.length) continue;
  const repoName = repoNames.get(repoId) ?? repoId;
  // 跳过测试夹具/空仓，避免样本被零星仓稀释
  if (symbols.length < 50) continue;
  const lang = langOf(symbols.map((s) => s.filePath));
  const names = anyNames.get(repoId) ?? new Set<string>();
  const bindable = bindableNames.get(repoId) ?? new Set<string>();
  const index = buildCallIndex(symbols);
  const resolver = new CallResolver(symbols, index);

  const local: Sample[] = [];
  const external: Sample[] = [];
  const structural: Sample[] = [];
  for (const caller of symbols) {
    if (caller.kind !== 'method' && caller.kind !== 'route') continue;
    for (const call of caller.calls ?? []) {
      if ((call as { http?: unknown }).http) continue;
      const r = resolver.resolve(caller, call);
      if ('target' in r && r.target) continue;
      if ('reason' in r && /Dynamic/.test(r.reason)) continue;
      const isBindable = bindable.has(call.method);
      const existsAny = names.has(call.method);
      const verdict: Sample['verdict'] = isBindable
        ? 'A-仓内有同名方法却没连上（真缺陷）'
        : existsAny
          ? 'C-名字存在但无可绑方法符号（类字段/构造/类型，结构上绑不上）'
          : 'B-本仓无此名（外部库调用）';
      const sample: Sample = {
        repo: repoName,
        lang,
        caller: `${caller.parentType ? `${caller.parentType}.` : ''}${caller.name}`,
        callerAt: `${caller.filePath}:${caller.lineStart ?? 1}`,
        callee: call.method,
        receiver: (call as { receiver?: string }).receiver,
        dynamic: (call as { dynamic?: boolean }).dynamic,
        verdict,
        where: isBindable ? '本仓有同名 method/route' : existsAny ? '本仓只有同名非方法符号' : '本仓无此名'
      };
      (verdict.startsWith('A') ? local : verdict.startsWith('B') ? external : structural).push(sample);
    }
  }
  const t = langTotals.get(lang) ?? { a: 0, b: 0, c: 0 };
  t.a += local.length;
  t.b += external.length;
  t.c += structural.length;
  langTotals.set(lang, t);
  // 按语言分桶存放，最后轮流取样——否则打印时会被 map 顺序最靠前的仓吃满，
  // 其它语言一条都显示不出来（总数对、抽样偏）。
  const put = (map: Map<string, Sample[]>, list: Sample[]) => {
    for (const s of take(list, PER_BUCKET, SEED)) {
      const arr = map.get(s.lang) ?? [];
      arr.push(s);
      map.set(s.lang, arr);
    }
  };
  put(bucketA, local);
  put(bucketB, external);
  put(bucketC, structural);
}

/** 轮流从各语言取一条，保证样本跨语言均衡。 */
function interleave(byLang: Map<string, Sample[]>, cap: number): Sample[] {
  const queues = [...byLang.values()].map((a) => [...a]);
  const out: Sample[] = [];
  let progressed = true;
  while (progressed && out.length < cap) {
    progressed = false;
    for (const q of queues) {
      if (out.length >= cap) break;
      const next = q.shift();
      if (next) {
        out.push(next);
        progressed = true;
      }
    }
  }
  return out;
}

console.log('=== 未解析边的全量构成（未抽样）===');
console.log('A=仓内有同名方法却没连上（真缺陷）  C=名字存在但无可绑方法（结构上绑不上）  B=本仓无此名（外部库）');
for (const [lang, t] of [...langTotals].sort((x, y) => (y[1].a + y[1].b + y[1].c) - (x[1].a + x[1].b + x[1].c))) {
  const total = t.a + t.b + t.c;
  const f = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(0)}%` : '—');
  console.log(
    `${lang.padEnd(7)} 合计 ${String(total).padStart(6)}  |  A ${String(t.a).padStart(5)} (${f(t.a).padStart(4)})  C ${String(t.c).padStart(5)} (${f(t.c).padStart(4)})  B ${String(t.b).padStart(5)} (${f(t.b).padStart(4)})`
  );
}

console.log(`\n=== A 类抽样：仓内有同名方法却没连上 = 真解析缺陷（最多 ${PER_BUCKET} 条）===`);
if (interleave(bucketA, 1).length === 0) console.log('  （无）');
for (const s of interleave(bucketA, PER_BUCKET)) {
  console.log(
    `[${s.lang}] ${s.repo}  ${s.caller}  →  ${s.callee}${s.receiver ? ` (recv=${s.receiver})` : ''}${s.dynamic ? ' [dynamic]' : ''}\n      ${s.callerAt}`
  );
}

console.log(`\n=== C 类抽样：名字存在但没有可绑的方法符号 = 结构性不可解析（最多 ${PER_BUCKET} 条）===`);
for (const s of interleave(bucketC, PER_BUCKET)) {
  console.log(`[${s.lang}] ${s.repo}  ${s.caller}  →  ${s.callee}${s.receiver ? ` (recv=${s.receiver})` : ''}`);
}

console.log(`\n=== B 类抽样：本仓无此名 = 外部库调用（最多 ${PER_BUCKET} 条）===`);
for (const s of interleave(bucketB, PER_BUCKET)) {
  console.log(`[${s.lang}] ${s.repo}  ${s.caller}  →  ${s.callee}${s.receiver ? ` (recv=${s.receiver})` : ''}`);
}