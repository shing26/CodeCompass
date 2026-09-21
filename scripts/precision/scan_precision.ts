import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { openDb } from '../../services/control-plane/src/db';
import { EventBus } from '../../services/control-plane/src/events';
import { RepoQARepos } from '../../services/control-plane/src/ingest/repoqa-repos';
import { RepoQAWorker } from '../../services/control-plane/src/ingest/repoqa-worker';
import { runScan } from '../../services/control-plane/src/scan-engine';
import { isTestPath } from '../../services/control-plane/src/diagnose-engine';
import { cockpitBaseUrl } from '../../services/control-plane/src/config';
import { buildGoPackageTable, parseGoSource } from '../../services/control-plane/src/languages/GoAdapter';
import {
  buildCallIndex,
  resolveCallEdge
} from '../../services/control-plane/src/engine/repoqa-callchain';

const execFile = promisify(execFileCallback);

/**
 * v0.31 (V31-01) — real-repository scan precision harness.
 *
 * Measures the false-positive rate that the synthetic golden eval cannot see:
 * index a real repo, run the Candidate Scan, dump every bucket, and emit a
 * reproducible sample for human/agent verification. Companion `--score` mode
 * turns filled verdict files into the M1/M2 table (spec §3).
 *
 * Run (matches scripts/profile-index.ts so the heap is generous):
 *   node --max-old-space-size=4096 node_modules/tsx/dist/cli.mjs \
 *     scripts/precision/scan_precision.ts [lazygit|petclinic|self|--score]
 *
 * Clones are reused across runs (PRECISION_DIR, default <tmpdir>/cc-precision)
 * and their HEAD sha is recorded so numbers stay attributable to a revision.
 */

const SEED = 20260916;
const ORPHAN_SAMPLE_SIZE = 10;

interface SampleRef {
  name: string;
  /** Git URL to shallow-clone, or absolute local path to index in place. */
  url?: string;
  localPath?: string;
  note: string;
}

/** The three v0.21 dogfooding samples — kept identical so before/after is comparable. */
const SAMPLES: SampleRef[] = [
  {
    name: 'lazygit',
    url: 'https://github.com/jesseduffield/lazygit',
    note: 'Go 45k symbols; vendor/ + cross-file receiver types are the known noise sources'
  },
  {
    name: 'petclinic',
    url: 'https://github.com/spring-petclinic/spring-petclinic-microservices',
    note: 'Java multi-module; Spring DI container is the reflective hot zone'
  },
  {
    name: 'self',
    localPath: process.cwd(),
    note: 'CodeCompass itself (TS/Python); NOTE: .scratch/ holds sample repos — same as v0.21 baseline'
  }
];

const OUT_DIR = path.join(process.cwd(), 'scripts/precision/out');
const VERDICT_DIR = path.join(process.cwd(), 'scripts/precision/verdicts');
const CLONE_DIR = process.env.PRECISION_DIR ?? path.join(os.tmpdir(), 'cc-precision');

/** Deterministic PRNG (mulberry32) — the sample must be identical across runs.
 * Not security-relevant: reproducibility is the requirement here, so a seeded
 * non-crypto generator is correct by design (do not swap in crypto.random). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededSample<T>(items: T[], size: number): T[] {
  const rand = mulberry32(SEED);
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < size && pool.length > 0) {
    const idx = Math.floor(rand() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

async function gitHead(dir: string): Promise<string> {
  try {
    const { stdout } = await execFile('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']);
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Clone roots searched before any network clone, newest first. The CodeCompass
 * dogfooding runs (v0.21) left clones under ~/.mhw/clones/<name>-<epoch> — the
 * exact revisions behind the 43%/31% baseline — so reusing them keeps
 * before/after comparable and works offline (github.com clone is reset from
 * some networks; api.github.com is fine, hence the local-first order).
 */
const CLONE_ROOTS = [
  process.env.PRECISION_CLONE_ROOT,
  path.join(os.homedir(), '.mhw', 'clones')
].filter((root): root is string => Boolean(root));

async function findLocalClone(name: string): Promise<string | undefined> {
  for (const root of CLONE_ROOTS) {
    const entries = await fs.readdir(root).catch(() => [] as string[]);
    const matches = entries.filter((entry) => entry === name || entry.startsWith(`${name}-`)).sort();
    for (const match of matches.reverse()) {
      const candidate = path.join(root, match);
      try {
        await fs.access(path.join(candidate, '.git'));
        return candidate;
      } catch {
        // not a git checkout — keep looking
      }
    }
  }
  return undefined;
}

async function resolveSource(sample: SampleRef): Promise<string> {
  if (sample.localPath) return path.resolve(sample.localPath);
  const local = await findLocalClone(sample.name);
  if (local) {
    console.error(`[precision] reusing local clone ${local}`);
    return local;
  }
  const dir = path.join(CLONE_DIR, sample.name);
  try {
    await fs.access(path.join(dir, '.git'));
    console.error(`[precision] reusing clone at ${dir}`);
    return dir;
  } catch {
    await fs.mkdir(CLONE_DIR, { recursive: true });
    console.error(`[precision] shallow-cloning ${sample.url}`);
    await execFile('git', ['clone', '--depth', '1', '--quiet', sample.url as string, dir], {
      timeout: 600_000
    });
    return dir;
  }
}

/** M2 contamination: items that should never rank — vendor trees and test files. */
function contaminationOf(items: Array<{ filePath: string }>): {
  vendor: number;
  testPath: number;
} {
  let vendor = 0;
  let testPath = 0;
  for (const item of items) {
    const p = item.filePath.toLowerCase();
    if (p.includes('/vendor/') || p.includes('node_modules/') || p.includes('/target/') || p.includes('/dist/')) {
      vendor += 1;
    }
    if (isTestPath(item.filePath)) testPath += 1;
  }
  return { vendor, testPath };
}

async function measure(sample: SampleRef): Promise<void> {
  const dir = await resolveSource(sample);
  const commit = await gitHead(dir);
  const started = Date.now();

  const db = openDb(':memory:');
  const repoqa = new RepoQARepos(db);
  const worker = new RepoQAWorker(repoqa, new EventBus());
  const result = await worker.indexRepo({ localPath: dir });
  if (result.repo.status !== 'ready') {
    throw new Error(`${sample.name}: index ended in status=${result.repo.status} (${result.repo.error ?? ''})`);
  }
  const graph = worker.getSymbolGraph(result.repo.id);
  const scan = runScan({
    repoId: result.repo.id,
    repoName: result.repo.name,
    symbols: graph.symbols,
    index: graph.index,
    baseUrl: cockpitBaseUrl()
  });

  const buckets = scan.buckets.map((bucket) => {
    const contamination = contaminationOf(bucket.items);
    return {
      id: bucket.id,
      total: bucket.total,
      listed: bucket.items.length,
      wiredExcluded: bucket.wiredExcluded,
      // ADR-0018: the census is the point of the ruling — recording it here is
      // what makes "what left the candidate list, and how much" re-computable on
      // a real repo instead of only in a synthetic unit test.
      census: bucket.census,
      contamination,
      items: bucket.items
    };
  });

  const orphan = buckets.find((b) => b.id === 'orphanedPublic');
  const orphanItems = orphan?.items ?? [];
  // Attribution data for V31-02: which symbol kinds occupy the *listed* orphan
  // sample (the bucket payload carries only the top N — this is a sample
  // distribution, not a full-bucket census). Type declarations (class/
  // interface/…) cannot have callers at all — "0 static callers" says nothing
  // about them without reference tracking; ADR-0018 removed them from the
  // candidate list entirely, so this histogram is expected to be method-only.
  const kindCounts: Record<string, number> = {};
  for (const item of orphanItems) {
    kindCounts[item.kind] = (kindCounts[item.kind] ?? 0) + 1;
  }
  // ADR-0018 necessary condition ② — the census must conserve on `total`. Fail
  // loudly instead of writing a snapshot whose numbers do not add up.
  if (orphan?.census) {
    const { zeroCallers, testOnly } = orphan.census;
    if (zeroCallers + testOnly !== orphan.total) {
      throw new Error(
        `[precision] ${sample.name}: orphan census does not conserve — ` +
          `zeroCallers(${zeroCallers}) + testOnly(${testOnly}) != total(${orphan.total})`
      );
    }
    const flagged = orphanItems.filter((item) => item.testOnly === true).length;
    if (flagged > testOnly) {
      throw new Error(
        `[precision] ${sample.name}: census.testOnly(${testOnly}) is below the flagged ` +
          `candidates in the listed sample(${flagged})`
      );
    }
  }
  const record = {
    name: sample.name,
    source: sample.url ?? dir,
    commit,
    note: sample.note,
    measuredAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    fileCount: result.repo.fileCount,
    symbolCount: graph.symbols.length,
    orphanKindCounts: kindCounts,
    buckets: buckets.map(({ items, ...rest }) => ({ ...rest, topSample: items })),
    samples: {
      seed: SEED,
      size: ORPHAN_SAMPLE_SIZE,
      top: orphanItems.slice(0, ORPHAN_SAMPLE_SIZE),
      seeded: seededSample(orphanItems, ORPHAN_SAMPLE_SIZE)
    },
    contaminationTotal: contaminationOf(buckets.flatMap((b) => b.items))
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${sample.name}.json`);
  await fs.writeFile(outFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  console.error(
    `[precision] ${sample.name}@${commit}: ${graph.symbols.length} symbols, ` +
      `${buckets.map((b) => `${b.id}=${b.total}`).join(' ')} -> ${outFile}`
  );
  db.close();
}

/**
 * V31-02 — edge-level Go measurement (does not index; parses the clone directly).
 *
 * The orphan bucket only shows the edges whose target had no other caller, which
 * made the per-repo Go package table look like a −18 change when it actually
 * binds hundreds of edges the call chain depends on. This mode reports that
 * second, larger effect: the same sources parsed with and without the package
 * table, counting edges by whether the receiver got a type and whether the edge
 * resolves. Run: `... scan_precision.ts --edges lazygit`.
 */
async function edges(sampleName: string): Promise<void> {
  const sample = SAMPLES.find((s) => s.name === sampleName);
  if (!sample) throw new Error(`unknown sample "${sampleName}"`);
  const root = await resolveSource(sample);
  const sources: Array<{ relativePath: string; source: string }> = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'vendor' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.go')) {
        sources.push({
          relativePath: path.relative(root, full).split(path.sep).join('/'),
          source: await fs.readFile(full, 'utf8')
        });
      }
    }
  };
  await walk(root);
  const context = { goPackages: buildGoPackageTable(sources) };
  console.log(`# ${sampleName}@${await gitHead(root)} — ${sources.length} .go files\n`);
  console.log('| 口径 | 无包表 | 有包表 | Δ |');
  console.log('|---|---|---|---|');
  const rows: Array<[string, number, number]> = [];
  const measured: Record<string, number> = {};
  for (const [label, ctx] of [
    ['without', undefined],
    ['with', context]
  ] as const) {
    const symbols = sources.flatMap((file) =>
      parseGoSource(file.source, file.relativePath, 'edges', ctx)
    );
    let calls = 0;
    let typed = 0;
    let dynamic = 0;
    for (const symbol of symbols) {
      for (const call of symbol.calls ?? []) {
        calls += 1;
        if (call.receiverType) typed += 1;
        else if (call.dynamic === true) dynamic += 1;
      }
    }
    const index = buildCallIndex(symbols);
    let resolved = 0;
    for (const caller of symbols) {
      for (const call of caller.calls ?? []) {
        if ('target' in resolveCallEdge(index, caller, call)) resolved += 1;
      }
    }
    measured[`${label}.calls`] = calls;
    measured[`${label}.typed`] = typed;
    measured[`${label}.dynamic`] = dynamic;
    measured[`${label}.untyped`] = calls - typed - dynamic;
    measured[`${label}.resolved`] = resolved;
    measured[`${label}.broken`] = calls - resolved;
  }
  for (const [metric, key] of [
    ['调用边总数', 'calls'],
    ['带类型的 receiver 边', 'typed'],
    ['dynamic:true 的边（无 receiver 类型）', 'dynamic'],
    ['其余（裸调用 / pkg 限定）', 'untyped'],
    ['可解析边', 'resolved'],
    ['断点边', 'broken']
  ]) {
    const before = measured[`without.${key}`];
    const after = measured[`with.${key}`];
    rows.push([metric, before, after]);
    console.log(`| ${metric} | ${before} | ${after} | ${after - before} |`);
  }
}

/** M1 table from the dumps + filled verdicts. Verdicts are keyed by `filePath:line`. */
async function score(): Promise<void> {
  const files = await fs.readdir(OUT_DIR).catch(() => [] as string[]);
  const rows: string[] = [];
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    const dump = JSON.parse(await fs.readFile(path.join(OUT_DIR, file), 'utf8')) as {
      name: string;
      commit: string;
      samples: { top: Array<{ filePath: string; line: number; symbol: string }> };
    };
    let verdicts: Record<string, { verdict?: string }> = {};
    try {
      verdicts = JSON.parse(await fs.readFile(path.join(VERDICT_DIR, file), 'utf8'));
    } catch {
      rows.push(`| ${dump.name}@${dump.commit} | pending | — | — | 未核验（verdicts/${file} 缺失） |`);
      continue;
    }
    const keys = dump.samples.top.map((c) => `${c.filePath}:${c.line}`);
    const judged = keys.map((k) => verdicts[k]?.verdict).filter(Boolean);
    const fp = judged.filter((v) => v === 'false-positive').length;
    const tp = judged.filter((v) => v === 'true-positive').length;
    // V31-05 — coverage guard: a stale verdict file silently shrinks the
    // denominator (an unjudged entry just disappears from `judged`), so a
    // re-judged sample and a stale one would print the same "100%" and look
    // comparable. Never let that happen again: show the denominator and mark
    // incomplete rows loudly.
    const covered = `${judged.length}/${keys.length}`;
    const stale = judged.length < keys.length;
    const rate = judged.length
      ? `${((fp / judged.length) * 100).toFixed(1)}% (${fp}/${judged.length})${stale ? ` ⚠ 覆盖 ${covered}，未覆盖的 ${keys.length - judged.length} 条不计入` : ''}`
      : '—';
    rows.push(`| ${dump.name}@${dump.commit} | ${keys.length} | ${tp} | ${fp} | ${rate} |`);
  }
  console.log('| 样本 | 抽样 | 真阳性 | 假阳性 | M1 假阳性率 |');
  console.log('|---|---|---|---|---|');
  console.log(rows.join('\n'));
}

/**
 * V31-05 — the precision RATCHET (ticket 08/11 closeout, user-approved
 * 2026-09-19): precision regressions had no gate at all, so the numbers won a
 * hard fight for and then nothing defended them.
 *
 * What it guards, and why each is a STRUCTURAL invariant rather than a raw
 * count: source files legitimately appear and disappear, so `orphanTotal`
 * alone would red-flag ordinary work. The invariants below can only break if
 * a real regression lands:
 *   1. census conservation  — zeroCallers + testOnly == total (ADR-0018)
 *   2. contamination == 0   — vendor/test fixtures never on any board (M2)
 *   3. callable-only scope  — every listed orphan is a `method` (ADR-0018)
 *   4. exclusion rules live — `type-declaration` counted > 0, and the deferred
 *                             `interface-implementation` target still declared
 *   5. ratio ceiling        — orphanTotal/symbolCount against a FROZEN baseline
 *                             with documented slack (guards the class of bugs
 *                             that silently stops recording edges)
 *
 * The baseline is frozen on purpose: it never self-updates. Raising it is an
 * explicit `--ratchet-update` (a deliberate, reviewable act), because a ratchet
 * that follows the code defends nothing.
 */
const RATCHET_BASELINE = path.join(process.cwd(), 'scripts/precision/ratchet-baseline.json');
/** Ceiling = frozen ratio * (1 + SLACK) + FLOOR — headroom for small-sample noise. */
const RATCHET_SLACK = 0.25;
const RATCHET_FLOOR = 0.02;

interface RatchetBaselineEntry {
  commit: string;
  symbolCount: number;
  orphanTotal: number;
  ratio: number;
  recordedAt: string;
}

interface RatchetBaseline {
  note: string;
  samples: Record<string, RatchetBaselineEntry>;
}

async function ratchet(names: string[], update: boolean): Promise<void> {
  let baseline: RatchetBaseline = { note: '', samples: {} };
  try {
    baseline = JSON.parse(await fs.readFile(RATCHET_BASELINE, 'utf8')) as RatchetBaseline;
  } catch {
    baseline = {
      note:
        'Frozen precision ratchet baseline (V31-05). ratioCeiling = ratio * (1 + 0.25) + 0.02. ' +
        'Raise it only with an explicit `--ratchet-update` and a reason in the commit message.',
      samples: {}
    };
  }

  const failures: string[] = [];
  const rows: string[] = [];

  for (const name of names) {
    const sample = SAMPLES.find((s) => s.name === name);
    if (!sample) throw new Error(`unknown sample "${name}"`);
    await measure(sample);
    const dump = JSON.parse(
      await fs.readFile(path.join(OUT_DIR, `${name}.json`), 'utf8')
    ) as {
      name: string;
      commit: string;
      symbolCount: number;
      contaminationTotal: number;
      orphanKindCounts: Record<string, number>;
      buckets: Array<{
        id: string;
        total: number;
        census?: {
          zeroCallers: number;
          testOnly: number;
          excluded: Array<{ rule: string; count?: number; deferred?: boolean }>;
        };
      }>;
    };

    const orphan = dump.buckets.find((b) => b.id === 'orphanedPublic');
    if (!orphan?.census) {
      failures.push(`${name}: orphanedPublic has no census — ADR-0018 reporting was dropped`);
      continue;
    }
    const { zeroCallers, testOnly, excluded } = orphan.census;

    // 1. conservation
    if (zeroCallers + testOnly !== orphan.total) {
      failures.push(
        `${name}: census does not conserve — ${zeroCallers} + ${testOnly} != ${orphan.total}`
      );
    }
    // 2. contamination — the record stores it per class ({vendor, testPath}), so sum it.
    const contamination = dump.contaminationTotal as unknown;
    const contaminationSum =
      typeof contamination === 'number'
        ? contamination
        : Object.values((contamination ?? {}) as Record<string, number>).reduce((a, b) => a + b, 0);
    if (contaminationSum !== 0) {
      failures.push(
        `${name}: contamination=${contaminationSum} (${JSON.stringify(contamination)}) — vendor/test fixtures on a board`
      );
    }
    // 3. callable-only scope
    const nonCallable = Object.keys(dump.orphanKindCounts).filter((kind) => kind !== 'method');
    if (nonCallable.length > 0) {
      failures.push(`${name}: non-callable kinds back in the orphan list: ${nonCallable.join(', ')}`);
    }
    // 4. exclusion rules live
    const typeDecl = excluded.find((e) => e.rule === 'type-declaration');
    if (!typeDecl?.count) {
      failures.push(`${name}: type-declaration exclusion is gone or counted 0 — ADR-0018 rule disabled?`);
    }
    if (!excluded.some((e) => e.rule === 'interface-implementation' && e.deferred === true)) {
      failures.push(`${name}: deferred interface-implementation target is no longer declared`);
    }
    // 5. ratio ceiling against the FROZEN baseline
    const ratio = dump.symbolCount > 0 ? orphan.total / dump.symbolCount : 0;
    const entry = baseline.samples[name];
    if (!entry || update) {
      baseline.samples[name] = {
        commit: dump.commit,
        symbolCount: dump.symbolCount,
        orphanTotal: orphan.total,
        ratio,
        recordedAt: new Date().toISOString()
      };
      rows.push(
        `| ${name} | ${orphan.total}/${dump.symbolCount} | ${(ratio * 100).toFixed(1)}% | ${entry ? 'refreshed' : 'recorded'} |`
      );
      continue;
    }
    const ceiling = entry.ratio * (1 + RATCHET_SLACK) + RATCHET_FLOOR;
    const ok = ratio <= ceiling;
    if (!ok) {
      failures.push(
        `${name}: orphan ratio ${(ratio * 100).toFixed(1)}% exceeds ceiling ${(ceiling * 100).toFixed(1)}% ` +
          `(frozen baseline ${(entry.ratio * 100).toFixed(1)}% @ ${entry.commit})`
      );
    }
    rows.push(
      `| ${name} | ${orphan.total}/${dump.symbolCount} | ${(ratio * 100).toFixed(1)}% | ` +
        `${ok ? 'ok' : 'EXCEEDED'} (ceiling ${(ceiling * 100).toFixed(1)}%) |`
    );
  }

  // A failing run must not bootstrap or refresh the baseline: the frozen entry
  // is a reference for a state that passed.
  if (update || failures.length === 0) {
    await fs.mkdir(path.dirname(RATCHET_BASELINE), { recursive: true });
    await fs.writeFile(RATCHET_BASELINE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  }

  console.log('| 样本 | 孤儿/符号 | 比值 | 棘轮 |');
  console.log('|---|---|---|---|');
  console.log(rows.join('\n'));
  if (failures.length > 0) {
    console.error('[precision] RATCHET FAILED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    throw new Error(`${failures.length} ratchet invariant(s) violated`);
  }
  console.error(`[precision] ratchet ok (${names.join(', ')})`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--score')) {
    await score();
  } else if (args.includes('--ratchet')) {
    const names = args.filter((a) => !a.startsWith('--'));
    await ratchet(names.length ? names : ['self'], args.includes('--ratchet-update'));
  } else if (args.includes('--edges')) {
    const name = args[args.indexOf('--edges') + 1];
    if (!name) throw new Error('--edges needs a sample name');
    await edges(name);
  } else if (args.includes('--all') || args.length === 0) {
    for (const sample of SAMPLES) await measure(sample);
  } else {
    for (const name of args) {
      const sample = SAMPLES.find((s) => s.name === name);
      if (!sample) {
        throw new Error(`unknown sample "${name}" (known: ${SAMPLES.map((s) => s.name).join(', ')})`);
      }
      await measure(sample);
    }
  }
}

// tsx compiles to CJS here (no "type": "module" at the root), so top-level await
// is unavailable — dispatch through an async entry point instead.
main().catch((err) => {
  console.error(`[precision] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
