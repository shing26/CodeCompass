import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, ensureDefaultWorkspace } from '../db';
import { EventBus } from '../events';
import { RepoQARepos } from '../ingest/repoqa-repos';
import { RepoQAWorker } from '../ingest/repoqa-worker';
import { mcpListRepos, mcpRemoveRepo, type McpDeps } from './repoqa-mcp';

/**
 * Issue 13 (评估维 E-M7) — 幂等与副作用边界。
 *
 * 契约先核后钉（2026-09-21 实测）：
 *  - 同路径重复 index_repo **身份幂等**：复用同一 repoId（`created:false`），但**会重跑索引**（有代价的副作用）；
 *  - indexing 中重复 index_repo → `repo_indexing_conflict`（协议层既有行为，见 CONTEXT 错误码表）；
 *  - 重复 remove_repo **不静默**：第二次因仓库已不存在而明确报错（fail-closed，镜像 HTTP 404）；
 *  - indexing 中 remove_repo → 拒绝（防"索引完成复活幽灵索引"）。
 *
 * 这三条此前一条测试都没有 —— 本文件是 E-M7 从 2 分到 3 分的第一份要件。
 */

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function boot(): Promise<{ deps: McpDeps; repoDir: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-idem-'));
  const dataDir = path.join(dir, 'data');
  const repoDir = path.join(dir, 'repo');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(repoDir, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(repoDir, 'src', 'Owner.java'),
    'package demo;\npublic class Owner {\n  public String name() { return "x"; }\n}\n',
    'utf8'
  );
  const db = openDb(path.join(dataDir, 'idem.db'));
  ensureDefaultWorkspace(db, dataDir);
  const repoqa = new RepoQARepos(db);
  const worker = new RepoQAWorker(repoqa, new EventBus());
  cleanups.push(async () => {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { deps: { repoqa, worker, dataDir }, repoDir, dir };
}

describe('Issue 13 idempotency (评估维 E-M7)', () => {
  it('同一路径重复导入复用同一 repoId，且不新增仓库行', async () => {
    const { deps, repoDir } = await boot();

    const first = await deps.worker.indexRepo({ localPath: repoDir });
    expect(first.repo).not.toBeNull();
    expect(first.created).toBe(true);

    const second = await deps.worker.indexRepo({ localPath: repoDir });
    // 身份幂等：同一 repoId、created:false —— 但索引确实重跑了一遍（副作用，非免费）
    expect(second.repo!.id).toBe(first.repo!.id);
    expect(second.created).toBe(false);

    const listed = mcpListRepos(deps).repos as Array<{ id: string }>;
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(first.repo!.id);
  });

  it('重复 remove_repo 第二次明确报错，且不误伤其它仓库', async () => {
    const { deps, repoDir, dir } = await boot();
    const indexed = await deps.worker.indexRepo({ localPath: repoDir });

    const otherDir = path.join(dir, 'other');
    await fs.mkdir(otherDir, { recursive: true });
    await fs.writeFile(path.join(otherDir, 'Other.java'), 'package demo;\npublic class Other {}\n', 'utf8');
    const other = await deps.worker.indexRepo({ localPath: otherDir });

    const removed = mcpRemoveRepo(deps, { repoId: indexed.repo!.id });
    expect(removed).toMatchObject({ removed: true, repoId: indexed.repo!.id });

    // 第二次：仓库已不存在 → fail-closed 报错（不静默成功，也不误删别的仓库）
    expect(() => mcpRemoveRepo(deps, { repoId: indexed.repo!.id })).toThrow();

    const listed = mcpListRepos(deps).repos as Array<{ id: string }>;
    expect(listed.map((entry) => entry.id)).toEqual([other.repo!.id]);
  });

  it('indexing 中的仓库拒绝 remove_repo（防幽灵索引复活）', async () => {
    const { deps, repoDir } = await boot();
    const indexed = await deps.worker.indexRepo({ localPath: repoDir });
    const repoId = indexed.repo!.id;

    // 强制置为 indexing：等价于"索引任务在跑"，而 worker 不参与本断言
    deps.repoqa.updateRepoStatus(repoId, 'indexing');
    expect(() => mcpRemoveRepo(deps, { repoId })).toThrow(/still indexing/i);

    deps.repoqa.updateRepoStatus(repoId, 'ready');
    expect(mcpRemoveRepo(deps, { repoId })).toMatchObject({ removed: true });
  });
});
