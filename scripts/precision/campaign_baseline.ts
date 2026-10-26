import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * v1.6 票 02 — 战役棘轮基线（campaign baseline）。
 *
 * 与 `scan_precision.ts --freeze` 的区别：`frozen/` 冻的是**人工判定的 top-10 真值**
 * （账实一致用），本文件冻的是**孤儿桶读数**（战役前后逐字节比较用）——两者用途不同，
 * 不要互相替代。
 *
 *   1. 先量一遍：npm run precision -- lazygit petclinic self
 *   2. 抓基线：  node .../tsx/dist/cli.mjs scripts/precision/campaign_baseline.ts capture \
 *                  --out scripts/precision/campaign-baselines/v1.6-module-resolution-before.json
 *   3. 改完再量，比对：
 *                node .../tsx/dist/cli.mjs scripts/precision/campaign_baseline.ts compare \
 *                  --must-match lazygit,petclinic
 *
 * 只写**确定性字段**：时间戳、耗时、以及 top-N 明细的 detail 文案一律不进基线
 * （易变字段会让「逐字节相等」变成噪声）。
 */

interface BucketDump {
  id: string;
  total: number;
  listed: number;
  wiredExcluded?: number;
  census?: {
    zeroCallers: number;
    testOnly: number;
    candidatesBeforeRules: number;
    excluded: Array<{ rule: string; count?: number; deferred?: boolean }>;
  };
}

interface RepoDump {
  name: string;
  commit: string;
  fileCount: number;
  symbolCount: number;
  buckets: BucketDump[];
  samples: { seed: number; size: number; top: Array<{ symbol: string; filePath: string; line: number }> };
  contaminationTotal: { vendor: number; testPath: number };
}

interface RepoBaseline {
  commit: string;
  fileCount: number;
  symbolCount: number;
  orphanTotal: number;
  /** orphanTotal / symbolCount——与 ratchet-baseline.json 同口径。 */
  ratio: number;
  buckets: Array<{ id: string; total: number; listed: number; wiredExcluded: number }>;
  orphanCensus: { zeroCallers: number; testOnly: number; candidatesBeforeRules: number; excluded: Array<{ rule: string; count: number }> } | null;
  contamination: { vendor: number; testPath: number };
  sample: { seed: number; size: number; keys: string[] };
}

const OUT_DIR = path.join(process.cwd(), 'scripts/precision/out');
const DEFAULT_OUT = path.join(
  process.cwd(),
  'scripts/precision/campaign-baselines/v1.6-module-resolution-before.json'
);

async function readDump(name: string): Promise<RepoDump> {
  const file = path.join(OUT_DIR, `${name}.json`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as RepoDump;
  } catch {
    throw new Error(`no dump at ${file} — run: npm run precision -- ${name}`);
  }
}

function toBaseline(dump: RepoDump): RepoBaseline {
  const orphan = dump.buckets.find((b) => b.id === 'orphanedPublic');
  const orphanTotal = orphan?.total ?? 0;
  return {
    commit: dump.commit,
    fileCount: dump.fileCount,
    symbolCount: dump.symbolCount,
    orphanTotal,
    ratio: Number((dump.symbolCount ? orphanTotal / dump.symbolCount : 0).toFixed(6)),
    buckets: dump.buckets.map((b) => ({
      id: b.id,
      total: b.total,
      listed: b.listed,
      wiredExcluded: b.wiredExcluded ?? 0
    })),
    orphanCensus: orphan?.census
      ? {
          zeroCallers: orphan.census.zeroCallers,
          testOnly: orphan.census.testOnly,
          candidatesBeforeRules: orphan.census.candidatesBeforeRules,
          // 只留确定性部分：rule 名与计数；deferred 规则的 count 可能缺省，记 0。
          excluded: orphan.census.excluded.map((e) => ({ rule: e.rule, count: e.count ?? 0 }))
        }
      : null,
    contamination: dump.contaminationTotal,
    // 只留键（file:line:symbol）——明细文案易变，不参与比较。
    sample: {
      seed: dump.samples.seed,
      size: dump.samples.size,
      keys: dump.samples.top.map((item) => `${item.filePath}:${item.line}:${item.symbol}`)
    }
  };
}

function diffValue(label: string, before: unknown, after: unknown, out: string[]): void {
  const b = JSON.stringify(before);
  const a = JSON.stringify(after);
  if (b !== a) out.push(`  ${label}: baseline=${b} current=${a}`);
}

function diffRepo(before: RepoBaseline, after: RepoBaseline): string[] {
  const lines: string[] = [];
  diffValue('commit', before.commit, after.commit, lines);
  diffValue('fileCount', before.fileCount, after.fileCount, lines);
  diffValue('symbolCount', before.symbolCount, after.symbolCount, lines);
  diffValue('orphanTotal', before.orphanTotal, after.orphanTotal, lines);
  diffValue('ratio', before.ratio, after.ratio, lines);
  diffValue('buckets', before.buckets, after.buckets, lines);
  diffValue('orphanCensus', before.orphanCensus, after.orphanCensus, lines);
  diffValue('contamination', before.contamination, after.contamination, lines);
  diffValue('sample.seed', before.sample.seed, after.sample.seed, lines);
  diffValue('sample.keys', before.sample.keys, after.sample.keys, lines);
  return lines;
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function capture(args: string[]): Promise<void> {
  const outPath = parseFlag(args, '--out') ?? DEFAULT_OUT;
  const names = args.filter((a) => !a.startsWith('--') && a !== parseFlag(args, '--out'));
  const targets = names.length ? names : ['lazygit', 'petclinic', 'self'];
  const samples: Record<string, RepoBaseline> = {};
  for (const name of targets) {
    samples[name] = toBaseline(await readDump(name));
    const s = samples[name];
    console.log(`[campaign] captured ${name}@${s.commit}: ${s.symbolCount} symbols, orphan=${s.orphanTotal} (ratio ${s.ratio})`);
  }
  const payload = {
    campaign: 'v1.6-ts-module-resolution',
    purpose:
      '战役棘轮基线：Phase 1/2 改跨文件绑定后，Go/Java 两仓必须与 baseline 逐字节相等，self 的每条差异必须能归因到消解。',
    metric_direction: 'inverse',
    sampling: 'top-n',
    reproduction:
      'npm run precision -- lazygit petclinic self（复用 ~/.mhw/clones 的 v0.21 克隆；petclinic 需在 PRECISION_DIR 下建 junction），然后 capture 本文件。',
    fixedPoint: 'v1.5.1 之后、v1.6 实现之前',
    capturedAt: new Date().toISOString().slice(0, 10),
    mustMatch: ['lazygit', 'petclinic'],
    samples
  };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`[campaign] baseline written to ${path.relative(process.cwd(), outPath)}`);
}

async function compare(args: string[]): Promise<void> {
  const outPath = parseFlag(args, '--baseline') ?? DEFAULT_OUT;
  const mustMatch = (parseFlag(args, '--must-match') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const baseline = JSON.parse(await fs.readFile(outPath, 'utf8')) as {
    samples: Record<string, RepoBaseline>;
  };
  let failed = 0;
  for (const [name, before] of Object.entries(baseline.samples)) {
    const after = toBaseline(await readDump(name));
    const lines = diffRepo(before, after);
    const strict = mustMatch.includes(name);
    if (!lines.length) {
      console.log(`[campaign] ${name}: IDENTICAL`);
      continue;
    }
    console.log(`[campaign] ${name}: ${lines.length} field(s) differ${strict ? ' — MUST MATCH' : ' (drift allowed, must be attributable)'}`);
    for (const line of lines) console.log(line);
    if (strict) failed += 1;
  }
  if (failed) {
    console.error(`[campaign] FAIL: ${failed} repo(s) that must stay byte-identical have drifted (${mustMatch.join(', ')})`);
    process.exit(1);
  }
  console.log('[campaign] OK');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'capture') return capture(argv.slice(1));
  if (argv[0] === 'compare') return compare(argv.slice(1));
  console.error('usage: campaign_baseline.ts capture [--out <file>] [repo...] | compare [--baseline <file>] [--must-match a,b]');
  process.exit(2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
