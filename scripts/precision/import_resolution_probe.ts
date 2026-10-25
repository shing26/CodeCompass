import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openDb } from '../../services/control-plane/src/db';
import { RepoQARepos } from '../../services/control-plane/src/ingest/repoqa-repos';
import { RepoQAWorker } from '../../services/control-plane/src/ingest/repoqa-worker';
import { EventBus } from '../../services/control-plane/src/events';

const execFileAsync = promisify(execFile);

/**
 * v1.5 / v1.4 票 08 前置条件 1 — TS/JS 模块路径解析探针（先量，再有战役）。
 *
 * 现状（v1.4 票 06 披露）：TS/JS 不解析 import 声明，跨文件调用按符号名绑定
 * （caller 自身文件优先，其次最早声明），monorepo 同名符号存在错绑可能。
 * 本探针回答一个问题：**如果引擎解析 import 声明（含 tsconfig paths/baseUrl），
 * 有多少跨文件调用边可以被唯一钉死？** 数字决定是否开票 08 的真实战役。
 *
 *   node --max-old-space-size=4096 node_modules/tsx/dist/cli.mjs \
 *     scripts/precision/import_resolution_probe.ts [self|<abs-path> ...]
 *
 * 只扫 .ts/.tsx/.js/.jsx/.mjs；Go/Java 仓自动报零并说明原因（不掺入读数）。
 */

const TS_EXT = /.(tsx?|jsx?|mjs)$/;

interface TsConfigPaths {
  baseUrl?: string;
  paths?: Record<string, string[]>;
}

async function readTsConfig(root: string): Promise<TsConfigPaths> {
  const raw = await fs.readFile(path.join(root, 'tsconfig.json'), 'utf8').catch(() => '');
  if (!raw) return {};
  // 容忍注释/尾逗号（tsconfig 常态）：剥掉 // 与 /* */ 再 JSON.parse，失败即空。
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  try {
    const parsed = JSON.parse(stripped) as { compilerOptions?: TsConfigPaths };
    return parsed.compilerOptions ?? {};
  } catch {
    return {};
  }
}

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.js'];

async function resolveSpecifier(fromFile: string, spec: string, root: string, cfg: TsConfigPaths): Promise<string | null> {
  // 归一化到 repo-root 相对 posix 路径，与 symbol.filePath 同口径。
  const toRootRel = (abs: string): string => path.relative(root, abs).split(path.sep).join('/');
  let base: string | null = null;
  if (spec.startsWith('.')) {
    base = toRootRel(path.resolve(path.dirname(fromFile), spec));
  } else if (spec.startsWith('@/')) {
    if (!cfg.baseUrl) return null;
    base = toRootRel(path.resolve(root, cfg.baseUrl, spec.slice(2)));
  } else if (!spec.includes('/') || spec.startsWith('~/')) {
    return null; // bare npm 包 / 不识别的别名 —— 不在本探针射程内
  } else if (cfg.paths) {
    // tsconfig paths 通配（仅支持单尾通配的最常见形态）
    for (const [pattern, targets] of Object.entries(cfg.paths)) {
      const starIdx = pattern.indexOf('*');
      if (starIdx === -1) continue;
      const prefix = pattern.slice(0, starIdx);
      const suffix = pattern.slice(starIdx + 1);
      if (spec.startsWith(prefix) && spec.endsWith(suffix) && spec.length >= prefix.length + suffix.length) {
        const middle = spec.slice(prefix.length, spec.length - suffix.length);
        for (const target of targets) {
          const expanded = target.replace('*', middle);
          base = toRootRel(path.resolve(root, cfg.baseUrl ?? '.', expanded));
          break;
        }
        if (base) break;
      }
    }
    if (!base) return null;
  } else {
    return null;
  }
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    try {
      const stat = await fs.stat(path.join(root, candidate));
      if (stat.isFile()) return candidate.replace(/\.(ts|tsx|js|jsx|mjs)$/, '');
    } catch {
      /* try next */
    }
  }
  return null;
}

const IMPORT_RE = /(?:from\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

/** file → 该文件 import 声明可解析到的模块文件集合（去后缀）。 */
async function buildImportMap(files: string[], root: string, cfg: TsConfigPaths): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  for (const file of files) {
    const text = await fs.readFile(path.join(root, file), 'utf8').catch(() => '');
    const targets = new Set<string>();
    if (text) {
      for (const match of text.matchAll(IMPORT_RE)) {
        const resolved = await resolveSpecifier(path.join(root, file), match[1], root, cfg);
        if (resolved) targets.add(resolved);
      }
    }
    map.set(file, targets);
  }
  return map;
}

async function probe(name: string, root: string): Promise<void> {
  const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', '--short', 'HEAD']).catch(() => ({ stdout: 'unknown' }));
  const commit = stdout.trim();

  const db = openDb(':memory:');
  const repoqa = new RepoQARepos(db);
  const worker = new RepoQAWorker(repoqa, new EventBus());
  const result = await worker.indexRepo({ localPath: root });
  if (result.repo.status !== 'ready') {
    throw new Error(`${name}: index status=${result.repo.status}`);
  }
  const graph = worker.getSymbolGraph(result.repo.id);
  const symbols = graph.symbols;

  const tsFiles = new Set<string>();
  for (const symbol of symbols) {
    if (TS_EXT.test(symbol.filePath)) tsFiles.add(symbol.filePath);
  }
  const cfg = await readTsConfig(root);
  const importMap = await buildImportMap([...tsFiles].sort(), root, cfg);

  // 声明表：去后缀文件名 → 符号名集合；符号名 → 声明文件集合（去后缀）。
  const declsByFile = new Map<string, Set<string>>();
  const filesByName = new Map<string, Set<string>>();
  const stripExt = (file: string): string => file.replace(/\.(ts|tsx|js|jsx|mjs)$/, '');
  for (const symbol of symbols) {
    if (!TS_EXT.test(symbol.filePath)) continue;
    if (symbol.kind === 'method' || symbol.kind === 'class' || symbol.kind === 'service') {
      const file = stripExt(symbol.filePath);
      if (!declsByFile.has(file)) declsByFile.set(file, new Set());
      declsByFile.get(file)!.add(symbol.name);
      if (!filesByName.has(symbol.name)) filesByName.set(symbol.name, new Set());
      filesByName.get(symbol.name)!.add(file);
    }
  }

  let crossFileCalls = 0;
  let ambiguousNameCalls = 0;
  let pinnableViaImports = 0;
  let aliasCalls = 0;
  const aliasSamples: string[] = [];

  for (const symbol of symbols) {
    if (!TS_EXT.test(symbol.filePath) || !symbol.calls) continue;
    const callerFile = stripExt(symbol.filePath);
    for (const call of symbol.calls) {
      if (call.reference) continue;
      const declared = filesByName.get(call.method);
      if (!declared) continue; // 未声明的目标不在消解射程内
      // 跨文件边：被调名至少在一个其它文件声明（引擎按「caller 自身文件优先，
      // 其次最早声明」绑定——错绑风险只在名字多文件声明且 caller 文件不含它时）。
      if (![...declared].some((file) => file !== callerFile)) continue;
      crossFileCalls += 1;
      if (declared.has(callerFile)) continue; // 同名在本文件也有：引擎同文件优先，绑定正确
      ambiguousNameCalls += 1;
      const imports = importMap.get(symbol.filePath) ?? new Set<string>();
      const candidates = [...declared].filter((file) => imports.has(file));
      if (candidates.length === 1) {
        pinnableViaImports += 1;
        aliasSamples.push(`${callerFile} → ${call.method} (唯一可钉: ${candidates[0]})`);
        if (aliasSamples.length <= 10) aliasCalls = aliasSamples.length;
      }
    }
  }

  const report = {
    name,
    commit,
    tsFiles: tsFiles.size,
    tsconfigPaths: Boolean(cfg.paths),
    crossFileCalls,
    ambiguousNameCalls,
    pinnableViaImports,
    headline: pinnableViaImports === 0
      ? 'import 解析可唯一钉死的歧义边为 0 —— 按票 08 触发线，无需开战役'
      : `import 解析可唯一钉死 ${pinnableViaImports} / ${ambiguousNameCalls} 条同名歧义跨文件边 —— 数字进票 08 触发线判定`,
    samples: aliasSamples.slice(0, 10)
  };
  console.log(JSON.stringify(report, null, 2));
  const outDir = path.join(process.cwd(), 'scripts/precision/out');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, `import_probe_${name}.json`), JSON.stringify(report, null, 2));
  db.close();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targets: Array<{ name: string; root: string }> = [];
  if (args.length === 0 || args.includes('self')) {
    targets.push({ name: 'self', root: process.cwd() });
  }
  for (const arg of args) {
    if (arg === 'self') continue;
    const abs = path.resolve(arg);
    targets.push({ name: path.basename(abs), root: abs });
  }
  for (const target of targets) {
    await probe(target.name, target.root);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
