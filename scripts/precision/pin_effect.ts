import path from 'node:path';
import { openDb } from '../../services/control-plane/src/db';
import { RepoQARepos } from '../../services/control-plane/src/ingest/repoqa-repos';
import { RepoQAWorker } from '../../services/control-plane/src/ingest/repoqa-worker';
import { EventBus } from '../../services/control-plane/src/events';
import { buildCallIndex, resolveCallEdge } from '../../services/control-plane/src/engine/repoqa-callchain';

/**
 * v1.6 票 05 — Phase 1 效果探针。
 *
 * 同一份符号索引，分别用「不带消解表」和「带消解表」的索引走 `resolveCallEdge`，
 * 量三件事：真的换绑了多少条、换绑到哪、有没有出现「v1.5 有目标 → Phase 1 反而解析不出来」
 * 的回退（Phase 1 只该增加确定、不该减少解析）。
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
  const legacyIndex = buildCallIndex(symbols);
  const pinnedIndex = buildCallIndex(symbols, table);

  let calls = 0;
  // 绑定规则的分支人口：只有「无 dynamic、无 receiverType」的裸调用会走到按名绑定，
  // 其余由类型化接收者/跨语言桥/routes 分支先处理——这是 884 与实际换绑量之间的桥。
  let bareNameCalls = 0;
  let bareNameWithGlobal = 0;
  let bareNameAmbiguous = 0;
  let bothResolved = 0;
  let repinned = 0;
  let legacyOnly = 0;
  let pinnedOnly = 0;
  let unchanged = 0;
  const samples: string[] = [];
  const regressions: string[] = [];

  for (const symbol of symbols) {
    if (!symbol.calls) continue;
    for (const call of symbol.calls) {
      calls += 1;
      if (!call.dynamic && !call.receiverType) {
        bareNameCalls += 1;
        const global = legacyIndex.methodsByName.get(call.method) ?? [];
        const sameFile = legacyIndex.methodsByFile.get(call.file)?.get(call.method) ?? [];
        if (sameFile.length === 0 && global.length > 0) {
          bareNameWithGlobal += 1;
          if (new Set(global.map((candidate) => candidate.filePath)).size > 1) bareNameAmbiguous += 1;
        }
      }
      const before = resolveCallEdge(legacyIndex, symbol, call);
      const after = resolveCallEdge(pinnedIndex, symbol, call);
      const beforeFile = 'target' in before ? before.target.filePath : null;
      const afterFile = 'target' in after ? after.target.filePath : null;
      if (beforeFile && afterFile) {
        bothResolved += 1;
        if (beforeFile === afterFile) unchanged += 1;
        else {
          repinned += 1;
          if (samples.length < 10) {
            samples.push(`${symbol.filePath}: ${call.method} ${beforeFile} -> ${afterFile}`);
          }
        }
      } else if (beforeFile && !afterFile) {
        legacyOnly += 1;
        if (regressions.length < 10) {
          regressions.push(`${symbol.filePath}: ${call.method} (${beforeFile})`);
        }
      } else if (!beforeFile && afterFile) {
        pinnedOnly += 1;
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
    bothResolved,
    repinned,
    pinnedOnly,
    legacyOnly,
    unchanged,
    samples,
    regressions
  }, null, 2));
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
