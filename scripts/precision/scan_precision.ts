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
  // about them without reference tracking.
  const kindCounts: Record<string, number> = {};
  for (const item of orphanItems) {
    kindCounts[item.kind] = (kindCounts[item.kind] ?? 0) + 1;
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
    const rate = judged.length ? `${((fp / judged.length) * 100).toFixed(1)}% (${fp}/${judged.length})` : '—';
    rows.push(`| ${dump.name}@${dump.commit} | ${keys.length} | ${tp} | ${fp} | ${rate} |`);
  }
  console.log('| 样本 | 抽样 | 真阳性 | 假阳性 | M1 假阳性率 |');
  console.log('|---|---|---|---|---|');
  console.log(rows.join('\n'));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--score')) {
    await score();
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
