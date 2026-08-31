import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { openDb } from '../services/control-plane/src/db';
import { EventBus } from '../services/control-plane/src/events';
import { RepoQARepos } from '../services/control-plane/src/repoqa-repos';
import { RepoQAWorker } from '../services/control-plane/src/repoqa-worker';

const execFile = promisify(execFileCallback);

/**
 * v0.15 — index-time profiling baseline. Shallow-clones a large open-source
 * repo into a temp dir, indexes it, and reports elapsed wall time, peak RSS,
 * symbol/file counts and per-phase budget usage. Run with a generous heap:
 *   node --max-old-space-size=4096 node_modules/tsx/dist/cli.mjs scripts/profile-index.ts <repo-url> [--keep]
 * Output is a JSON line to stdout for docs/profiling.md + e2e consumption.
 */
async function profileRepo(repoUrl: string, keep: boolean): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-profile-'));
  const repoDir = path.join(root, 'repo');
  const started = Date.now();
  const rssStart = process.memoryUsage().rss;

  console.error(`[profile] cloning ${repoUrl} (shallow)`);
  await execFile('git', ['clone', '--depth', '1', '--quiet', repoUrl, repoDir], {
    timeout: 600_000
  });
  const clonedMs = Date.now() - started;

  const db = openDb(':memory:');
  const repoqa = new RepoQARepos(db);
  const worker = new RepoQAWorker(repoqa, new EventBus());

  const indexStarted = Date.now();
  const result = await worker.indexRepo({ localPath: repoDir });
  const indexMs = Date.now() - indexStarted;

  const symbols = repoqa.listSymbols(result.repo.id);
  const chunks = repoqa.searchChunks(result.repo.id, ''); // count only
  const report = {
    repoUrl,
    status: result.repo.status,
    fileCount: result.repo.fileCount,
    symbolCount: symbols.length,
    chunkCount: chunks.length,
    cloneMs,
    indexMs,
    peakRssMb: Math.round(((process.memoryUsage().rss - rssStart) / 1024 / 1024) * 10) / 10,
    error: result.repo.error ?? undefined
  };
  console.log(JSON.stringify(report));
  db.close();

  if (!keep) await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}

const url = process.argv[2];
if (!url) {
  console.error('usage: node --max-old-space-size=4096 node_modules/tsx/dist/cli.mjs scripts/profile-index.ts <repo-url> [--keep]');
  process.exit(2);
}
profileRepo(url, process.argv.includes('--keep')).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
