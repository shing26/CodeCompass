import path from 'node:path';
import { openDb } from '../../services/control-plane/src/db';
import { RepoQARepos } from '../../services/control-plane/src/ingest/repoqa-repos';
import { RepoQAWorker } from '../../services/control-plane/src/ingest/repoqa-worker';
import { EventBus } from '../../services/control-plane/src/events';
import {
  parseModuleDeclarations,
  resolveRelativeSpecifier
} from '../../services/control-plane/src/engine/repoqa-module-resolution';

/**
 * v1.6 票 04 — 消解表对账探针。
 *
 * 票 01 的 `import_resolution_probe.ts` 量的是「若解析 import，会有多少条同名歧义边
 * 可被唯一钉死」（self 仓 1301）。本脚本换成**索引期真正落库的那张表**再算一遍：
 * 数字对得上，说明表覆盖了探针的射程；对不上，说明解析器漏了声明形态。
 *
 *   node --max-old-space-size=4096 services/control-plane/node_modules/tsx/dist/cli.mjs \
 *     scripts/precision/module_table_check.ts [self|<abs-path>]
 *
 * 与探针的口径差异（有意）：
 *   - 探针按「模块」匹配（候选文件 ∈ 该文件 import 的模块集合）；
 *   - 本脚本按「名字」匹配（call.method 在 caller 文件里被 import 绑到唯一文件），
 *     并要求该文件确实声明了这个名字——更严格，数字比探针略低是正常的。
 */

const TS_EXT = /\.(tsx?|jsx?|mjs)$/;
const STRIP_EXT = /\.(ts|tsx|js|jsx|mjs)$/;

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((item) => !item.startsWith('--'));
  const root = arg && arg !== 'self' ? path.resolve(arg) : process.cwd();
  const name = arg && arg !== 'self' ? path.basename(root) : 'self';

  const db = openDb(':memory:');
  const repoqa = new RepoQARepos(db);
  const worker = new RepoQAWorker(repoqa, new EventBus());
  const result = await worker.indexRepo({ localPath: root });
  if (result.repo.status !== 'ready') throw new Error(`index status=${result.repo.status}`);

  const symbols = worker.getSymbolGraph(result.repo.id).symbols;
  const moduleImports = repoqa.getModuleImports(result.repo.id);
  const rows = [...moduleImports.values()].reduce((sum, byName) => sum + byName.size, 0);

  const filesByName = new Map<string, Set<string>>();
  for (const symbol of symbols) {
    if (!TS_EXT.test(symbol.filePath)) continue;
    if (symbol.kind !== 'method' && symbol.kind !== 'class' && symbol.kind !== 'service') continue;
    const file = symbol.filePath.replace(STRIP_EXT, '');
    if (!filesByName.has(symbol.name)) filesByName.set(symbol.name, new Set());
    filesByName.get(symbol.name)!.add(file);
  }

  /**
   * 探针口径的对照集合：caller 文件 import 过的**模块**（不区分名字）。用它算
   * 「模块级可钉死」，才能解释 1301 与本表 882 的差额——探针按模块算，表按名字算。
   */
  const fsmod = await import('node:fs/promises');
  const repoFileSet = new Set(repoqa.listRepoFiles(result.repo.id));
  const importedModules = new Map<string, Set<string>>();
  for (const callerRel of [...repoFileSet].filter((file) => TS_EXT.test(file)).sort()) {
    const source = await fsmod.readFile(path.join(root, callerRel), 'utf8').catch(() => '');
    const decl = parseModuleDeclarations(source);
    const targets = new Set<string>();
    for (const specifier of [
      ...decl.namedImports.map((entry) => entry.specifier),
      ...decl.defaultImports.map((entry) => entry.specifier),
      ...decl.namespaceImports.map((entry) => entry.specifier)
    ]) {
      const target = resolveRelativeSpecifier(callerRel, specifier, repoFileSet);
      if (target) targets.add(target.replace(STRIP_EXT, ''));
    }
    importedModules.set(callerRel, targets);
  }

  let crossFileCalls = 0;
  let ambiguousNameCalls = 0;
  let pinnable = 0;
  let pinnableModuleLevel = 0;
  const delta = { moduleImportedNameNot: 0, bindingNotDeclaring: 0, noBinding: 0 };
  const unpinnableSamples: string[] = [];
  for (const symbol of symbols) {
    if (!TS_EXT.test(symbol.filePath) || !symbol.calls) continue;
    const callerFile = symbol.filePath.replace(STRIP_EXT, '');
    for (const call of symbol.calls) {
      if (call.reference) continue;
      const declared = filesByName.get(call.method);
      if (!declared) continue;
      if (![...declared].some((file) => file !== callerFile)) continue;
      crossFileCalls += 1;
      if (declared.has(callerFile)) continue;
      ambiguousNameCalls += 1;
      const modules = importedModules.get(symbol.filePath) ?? new Set<string>();
      const moduleLevel = [...declared].filter((file) => modules.has(file));
      if (moduleLevel.length === 1) pinnableModuleLevel += 1;

      const binding = moduleImports.get(symbol.filePath)?.get(call.method);
      if (binding && binding.kind !== 'namespace') {
        const target = binding.target.replace(STRIP_EXT, '');
        if (declared.has(target)) {
          pinnable += 1;
          continue;
        }
        delta.bindingNotDeclaring += 1;
      } else if (moduleLevel.length === 1) {
        // 模块 imported 了、但这个名字没被 import —— 词法上它根本不在作用域里，
        // 探针按模块算会把它计成可钉死，表不认。这是两个口径的差额主项。
        delta.moduleImportedNameNot += 1;
      } else {
        delta.noBinding += 1;
      }
      if (unpinnableSamples.length < 10) {
        unpinnableSamples.push(`${callerFile} → ${call.method}`);
      }
    }
  }

  const report = {
    repo: name,
    commit: result.repo.commit ?? 'unknown',
    symbolCount: symbols.length,
    tsFiles: new Set(symbols.filter((s) => TS_EXT.test(s.filePath)).map((s) => s.filePath)).size,
    moduleTableRows: rows,
    moduleTableFiles: moduleImports.size,
    crossFileCalls,
    ambiguousNameCalls,
    pinnableViaTable: pinnable,
    pinnableModuleLevel,
    deltaBreakdown: delta,
    coverageOfProbe: null as number | null,
    unpinnableSamples
  };
  const probeFile = path.join(process.cwd(), 'scripts/precision/out', `import_probe_${name}.json`);
  try {
    const probe = JSON.parse(await (await import('node:fs/promises')).readFile(probeFile, 'utf8')) as {
      pinnableViaImports: number;
    };
    report.coverageOfProbe = Number((pinnable / probe.pinnableViaImports).toFixed(3));
  } catch {
    // 没有探针读数就不比，不猜。
  }
  console.log(JSON.stringify(report, null, 2));
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
