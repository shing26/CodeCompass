import path from 'node:path';
import { openDb } from '../../services/control-plane/src/db';
import { RepoQARepos } from '../../services/control-plane/src/ingest/repoqa-repos';
import { RepoQAWorker } from '../../services/control-plane/src/ingest/repoqa-worker';
import { EventBus } from '../../services/control-plane/src/events';
import { buildCallIndex, resolveCallEdge } from '../../services/control-plane/src/engine/repoqa-callchain';

/**
 * v1.6 票 05 — Phase 1 + Phase 2 效果探针。
 *
 * 同一份符号索引跑两遍 `resolveCallEdge`：**带消解表** 与 **不带消解表**。
 *
 * 注意口径（Phase 2 之后）：歧义标记是绑定规则的共享逻辑，两个索引都会标，所以
 * 「带表 vs 不带表」的差额不再等于 Phase 1 的换绑量，而等于**import 把多少条边从
 * 歧义里救回来**（能钉死的不该被标可疑）。Phase 2 的影响面则直接读「标记了多少条歧义」。
 *
 *   node --max-old-space-size=4096 services/control-plane/node_modules/tsx/dist/cli.mjs \
 *     scripts/precision/pin_effect.ts [self|<abs-path>]
 */

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((item) => !item.startsWith('--'));
  const root = arg && arg !== 'self' ? path.resolve(arg) : process.cwd();
  const name = arg && arg !== 'self' ? path.basename(arg) : 'self';

  const db = openDb(':memory:');
  const repoqa = new RepoQARepos(db);
  const worker = new RepoQAWorker(repoqa, new EventBus());
  const result = await worker.indexRepo({ localPath: root });
  if (result.repo.status !== 'ready') throw new Error(`index status=${result.repo.status}`);

  const symbols = worker.getSymbolGraph(result.repo.id).symbols;
  const table = repoqa.getModuleImports(result.repo.id);
  const tableless = buildCallIndex(symbols);
  const withTable = buildCallIndex(symbols, table);

  let calls = 0;
  let bareNameCalls = 0;
  let bareNameWithGlobal = 0;
  let bareNameAmbiguous = 0;
  let ambiguousMarked = 0;
  let rescuedByImport = 0;
  let regressions = 0;
  const rescueSamples: string[] = [];
  const regressionSamples: string[] = [];
  const ambiguousSamples: string[] = [];

  for (const symbol of symbols) {
    if (!symbol.calls) continue;
    for (const call of symbol.calls) {
      calls += 1;
      if (!call.dynamic && !call.receiverType) {
        bareNameCalls += 1;
        const global = tableless.methodsByName.get(call.method) ?? [];
        const sameFile = tableless.methodsByFile.get(call.file)?.get(call.method) ?? [];
        if (sameFile.length === 0 && global.length > 0) {
          bareNameWithGlobal += 1;
          if (new Set(global.map((candidate) => candidate.filePath)).size > 1) bareNameAmbiguous += 1;
        }
      }
      const withoutTable = resolveCallEdge(tableless, symbol, call);
      const withModuleTable = resolveCallEdge(withTable, symbol, call);
      const reasonOf = (resolved: { target?: unknown; reason?: string }) =>
        'reason' in resolved ? (resolved.reason ?? '') : '';
      const fileOf = (resolved: { target?: unknown }) =>
        'target' in resolved && resolved.target && typeof resolved.target === 'object'
          ? (resolved.target as { filePath: string }).filePath
          : null;
      const beforeFile = fileOf(withoutTable);
      const afterFile = fileOf(withModuleTable);
      if (reasonOf(withModuleTable).includes('ambiguous target')) {
        ambiguousMarked += 1;
        if (ambiguousSamples.length < 8) {
          ambiguousSamples.push(`${symbol.filePath}: ${call.method}`);
        }
      }
      if (!afterFile && beforeFile) {
        regressions += 1;
        if (regressionSamples.length < 8) {
          regressionSamples.push(`${symbol.filePath}: ${call.method} (${beforeFile})`);
        }
      }
      if (afterFile && !beforeFile && reasonOf(withoutTable).includes('ambiguous target')) {
        rescuedByImport += 1;
        if (rescueSamples.length < 8) {
          rescueSamples.push(`${symbol.filePath}: ${call.method} -> ${afterFile}`);
        }
      }
    }
  }

  console.log(JSON.stringify({
    repo: name,
    commit: result.repo.commit ?? 'unknown',
    symbols: symbols.length,
    moduleTableFiles: table.size,
    calls,
    bareNameCalls,
    bareNameWithGlobal,
    bareNameAmbiguous,
    ambiguousMarked,
    rescuedByImport,
    regressions,
    rescueSamples,
    ambiguousSamples,
    regressionSamples
  }, null, 2));
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
