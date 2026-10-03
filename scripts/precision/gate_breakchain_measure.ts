import { openDb } from '../../services/control-plane/src/db';
import { EventBus } from '../../services/control-plane/src/events';
import { RepoQARepos } from '../../services/control-plane/src/ingest/repoqa-repos';
import { RepoQAWorker } from '../../services/control-plane/src/ingest/repoqa-worker';
import { CallResolver, buildCallIndex } from '../../services/control-plane/src/engine/repoqa-callchain';
import { isTestPath } from '../../services/control-plane/src/diagnose-engine';
import type { RepoSymbol } from '../../services/control-plane/src/ingest/repoqa-repos';
import { symbolIdentity } from '../../services/control-plane/src/engine/repoqa-callchain';

/**
 * v1.2.x（Round5）— `broken-chain` 门禁规则的**误报率测量**（只测量，不改行为）。
 *
 * 规则本身（repoqa-diff.ts `evaluateDiffPolicy`）：对每个被修改符号做**反向 BFS**
 * 沿确定性调用边向上找路由；找不到就进 `uncovered`，`failOnBreak` 时该规则 FAIL。
 *
 * 要回答的问题：这个 FAIL 在真实仓上是**真问题**还是**静态边缺失造成的假阳性**？
 * Round5 的分析判断是「对 TS/React 偏保守」，但那是推理——本脚本拿数据说。
 *
 * 口径（关键：不能拿被测源自己的判据当基准）：
 *   - **严格图** = 引擎真实用的边（`CallResolver.resolve` 解析成功才算边）。
 *     某符号在严格图下不可达路由 → 规则会 flag 它。
 *   - **放宽图** = 严格边 **加上**「动态/未解析调用的同名候选」与**跨语言桥**。
 *     放宽图只用于**判定真伪**，不进产品。若某符号在放宽图下可达路由，说明它
 *     真实可达、只是引擎缺边 → **计为假阳性**（下界：比真实 FP 率更保守）。
 *   - `uncovered` 里在两种图下都不可达的，可能是真死代码，也可能是更深的边缺失
 *     —— 单列为「未定」，不硬塞进任一桶。
 *
 * 被测集合不依赖 git 历史：取仓内**生产方法符号的确定性采样**（SEED 固定）当作
 * 「被修改符号」，这样数字可复现、可跨版本比较，也不受仓库当前分支影响。
 *
 * 用法（与 scan_precision 同样的堆设置）：
 *   node --max-old-space-size=4096 services/control-plane/node_modules/tsx/dist/cli.mjs \
 *     scripts/precision/gate_breakchain_measure.ts <repoPath> [repoPath...]
 */

const SEED = 20261003;
const SAMPLE_SIZE = 200;

interface RepoVerdict {
  repo: string;
  language: string;
  symbols: number;
  routes: number;
  sampled: number;
  /** 严格图下规则会 flag 的（uncovered）。 */
  flagged: number;
  /** 其中在放宽图下可达 → 判定为假阳性（下界）。 */
  falsePositive: number;
  /** 严格与放宽都不可达 → 再按「有无调用者」二分（见下）。 */
  undetermined: number;
  /** 未定且**严格图里没有任何调用者** → 判 dead code 是规则的正当结果。 */
  noCallers: number;
  /** 未定但**有调用者** → 调用链止于中途（工具链 / 更深的缺边），规则很可能误报。 */
  callersButDeadEnd: number;
  /** 严格图下可达 → 规则正确放行。 */
  correctPass: number;
  examples: Array<{ symbol: string; file: string; line: number }>;
}

function dominantLanguage(symbols: RepoSymbol[]): string {
  const counts = new Map<string, number>();
  for (const s of symbols) {
    if (/\.(ts|tsx|js|jsx|mjs)$/.test(s.filePath)) counts.set('TS/JS', (counts.get('TS/JS') ?? 0) + 1);
    else if (s.filePath.endsWith('.java')) counts.set('Java', (counts.get('Java') ?? 0) + 1);
    else if (s.filePath.endsWith('.go')) counts.set('Go', (counts.get('Go') ?? 0) + 1);
    else if (s.filePath.endsWith('.py')) counts.set('Python', (counts.get('Python') ?? 0) + 1);
  }
  let best = 'other';
  let n = 0;
  for (const [lang, c] of counts) {
    if (c > n) {
      best = lang;
      n = c;
    }
  }
  return best;
}

/** 确定性采样：按 name+file 排序后用固定种子抽。 */
function sample<T>(items: T[], size: number, seed: number): T[] {
  if (items.length <= size) return items;
  const out: T[] = [];
  let state = seed >>> 0;
  const pool = [...items];
  for (let i = 0; i < size; i += 1) {
    // xorshift32
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    out.push(pool[state % pool.length]);
    pool.splice(state % (pool.length - i), 1);
  }
  return out;
}

interface EdgeIndex {
  /** callerId → calleeIds */
  out: Map<string, Set<string>>;
  /** 严格边（仅解析成功） */
  strict: Map<string, Set<string>>;
  /** calleeId → callerIds（严格图反边），用于「有无人调用」判定 */
  strictCallers: Map<string, Set<string>>;
}

function buildEdges(symbols: RepoSymbol[], index: ReturnType<typeof buildCallIndex>): EdgeIndex {
  const resolver = new CallResolver(symbols, index);
  const out = new Map<string, Set<string>>();
  const strict = new Map<string, Set<string>>();
  const strictCallers = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, from: string, to: string) => {
    let set = m.get(from);
    if (!set) {
      set = new Set<string>();
      m.set(from, set);
    }
    set.add(to);
  };
  for (const caller of symbols) {
    if (caller.kind !== 'method' && caller.kind !== 'route') continue;
    const from = symbolIdentity(caller);
    for (const call of caller.calls ?? []) {
      const resolved = resolver.resolve(caller, call);
      if ('target' in resolved && resolved.target) {
        const to = symbolIdentity(resolved.target);
        add(out, from, to);
        add(strict, from, to);
        let callers = strictCallers.get(to);
        if (!callers) {
          callers = new Set<string>();
          strictCallers.set(to, callers);
        }
        callers.add(from);
        continue;
      }
      // 放宽边：动态/未解析的调用 → 同名方法候选。只用于判定，不进产品。
      const name = String(call.method ?? '').toLowerCase();
      if (!name) continue;
      for (const cand of symbols) {
        if (cand.kind !== 'method') continue;
        if (cand.name.toLowerCase() !== name) continue;
        add(out, from, symbolIdentity(cand));
      }
    }
  }
  return { out, strict, strictCallers };
}

/** 反向 BFS：start 是否能（经 callers 链）到达任一路由方法。 */
function reachesRoute(
  startId: string,
  edges: Map<string, Set<string>>,
  idToSymbol: Map<string, RepoSymbol>,
  routeIds: Set<string>
): boolean {
  const callersOf = new Map<string, string[]>();
  for (const [from, tos] of edges) {
    for (const to of tos) {
      let arr = callersOf.get(to);
      if (!arr) {
        arr = [];
        callersOf.set(to, arr);
      }
      arr.push(from);
    }
  }
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (routeIds.has(cur)) return true;
    for (const next of callersOf.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  void idToSymbol;
  return false;
}

async function measure(repoPath: string): Promise<RepoVerdict> {
  const db = openDb(':memory:');
  const repoqa = new RepoQARepos(db);
  const worker = new RepoQAWorker(repoqa, new EventBus());
  try {
    const result = await worker.indexRepo({ localPath: repoPath });
    if (!result.repo) throw new Error(`index failed for ${repoPath}`);
    const { symbols } = worker.getSymbolGraph(result.repo.id);
    const index = buildCallIndex(symbols);

    const routeClassByName = new Set(
      symbols.filter((s) => s.kind === 'route').map((s) => s.name)
    );
    const routeIds = new Set<string>();
    for (const s of symbols) {
      if (s.kind === 'route' || (s.kind === 'method' && s.parentType && routeClassByName.has(s.parentType))) {
        routeIds.add(symbolIdentity(s));
      }
    }

    const idToSymbol = new Map(symbols.map((s) => [symbolIdentity(s), s]));
    const { out, strict, strictCallers } = buildEdges(symbols, index);
    const candidates = symbols.filter(
      (s) => s.kind === 'method' && !isTestPath(s.filePath)
    );
    const sampled = sample(candidates, SAMPLE_SIZE, SEED);

    let flagged = 0;
    let falsePositive = 0;
    let undetermined = 0;
    let noCallers = 0;
    let callersButDeadEnd = 0;
    let correctPass = 0;
    const examples: RepoVerdict['examples'] = [];

    for (const s of sampled) {
      const id = symbolIdentity(s);
      const strictOk = reachesRoute(id, strict, idToSymbol, routeIds);
      if (strictOk) {
        correctPass += 1;
        continue;
      }
      flagged += 1;
      const relaxedOk = reachesRoute(id, out, idToSymbol, routeIds);
      if (relaxedOk) {
        falsePositive += 1;
      } else {
        undetermined += 1;
        // 关键二分：严格图里**一个人都不调它** → 真死码，规则判对了；
        // 有调用者却到不了路由 → 工具链或更深的缺边，规则很可能误报。
        const callers = strictCallers.get(id);
        if (!callers || callers.size === 0) noCallers += 1;
        else callersButDeadEnd += 1;
      }
      if (examples.length < 8) {
        examples.push({ symbol: s.name, file: s.filePath, line: s.lineStart ?? 1 });
      }
    }

    return {
      repo: repoPath.split(/[\\/]/).pop() ?? repoPath,
      language: dominantLanguage(symbols),
      symbols: symbols.length,
      routes: routeIds.size,
      sampled: sampled.length,
      flagged,
      falsePositive,
      undetermined,
      noCallers,
      callersButDeadEnd,
      correctPass,
      examples
    };
  } finally {
    db.close();
  }
}

const targets = process.argv.slice(2);
const repos = targets.length > 0 ? targets : [process.cwd()];
const verdicts: RepoVerdict[] = [];

async function main(): Promise<void> {
  for (const t of repos) {
    process.stdout.write(`measuring ${t} ... `);
    try {
      const v = await measure(t);
      verdicts.push(v);
      console.log('done');
    } catch (error) {
      console.log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\n=== broken-chain 误报率测量（v1.2.x / Round5）===');
  console.log('判据：严格图 = 引擎真实用的边；放宽图 = 严格边 + 动态/未解析调用的同名候选。');
  console.log('     「假阳性」= 严格图不可达但放宽图可达 → 真实可达、只是引擎缺边（下界）。\n');
  for (const v of verdicts) {
    const rate = v.flagged > 0 ? ((v.falsePositive / v.flagged) * 100).toFixed(0) : '—';
    console.log(
      `${v.repo.padEnd(20)} ${v.language.padEnd(6)} 符号${String(v.symbols).padStart(6)} 路由${String(v.routes).padStart(4)} | 采样${String(v.sampled).padStart(4)} 放行${String(v.correctPass).padStart(4)} flag${String(v.flagged).padStart(4)}`
    );
    console.log(
      `${' '.repeat(28)}└ flag 细分: 假阳性${String(v.falsePositive).padStart(4)}（${rate}%） | 真死码(无调用者)${String(v.noCallers).padStart(4)} | 有调用者但到不了路由${String(v.callersButDeadEnd).padStart(4)}`
    );
    if (v.examples.length > 0) {
      console.log(
        `    被 flag 样例: ${v.examples.map((e) => `${e.symbol}@${e.file.split(/[\\/]/).pop()}:${e.line}`).join(', ')}`
      );
    }
  }
  console.log('\n读法：flag 越多，门禁越吵；假阳性占比越高，越说明是缺边而非真死码。');
}

void main();