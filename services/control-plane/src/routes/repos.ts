import fs from 'node:fs/promises';
import { asyncHandler } from '../http-error';
import path from 'node:path';
import express from 'express';
import { requireRepo, type HttpDeps } from './deps';
import { deriveLocalRepoName, resolveDefaultBranchSync } from '../ingest/repoqa-repos';
import type { Repo } from '../ingest/repoqa-repos';
import { maskSensitiveText } from '../engine/repoqa-masking';
import {
  cloneGitRepo,
  deriveCloneName,
  validateGitBranch,
  validateGitUrl
} from '../git-importer';
import { pickFolderDialog } from '../dialog';
import { previewRepo } from '../ingest/repoqa-scan';
import { SAMPLE_PROJECT, sampleFileTarget } from '../ingest/sample-project';

/** v0.25.0 批次 2：仓库目录读取域——GET /api/repos 与 /api/repos/:id。
 * 注册顺序保持原样（catalog 在 analysis 域之前）。 */
export function registerReposCatalogRoutes(app: express.Express, deps: HttpDeps): void {
  // R3-Bug-02 — serve the working tree's actual default branch so the
  // delta/CI views can default to a ref that exists (the persisted `branch`
  // is often stale, e.g. 'main' on a locally imported master-first repo).
  const withDefaultBranch = (repo: Repo): Repo => ({
    ...repo,
    defaultBranch: resolveDefaultBranchSync(repo.localPath, repo.branch || 'main')
  });

  app.get('/api/repos', (_req, res) => {
    res.json({ repos: deps.repoqa.listRepos().map(withDefaultBranch) });
  });

  app.get('/api/repos/:id', (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
    res.json({ repo: withDefaultBranch(repo) });
  });
}

/** v0.25.0 批次 2：仓库写入/摄取域——POST 导入、preview、dialog、delete、
 * reindex、clone、file-raw。原 786-1006 行连续段。 */

/**
 * v1.2 票 03 — 僵尸防线的唯一实现：三处 fire-and-forget（POST / reindex /
 * clone）共用。indexRepo 的 pre-try 序言（fs.stat / upsertByLocalPath）**会
 * reject**（典型：导入后目录被删/改名/网络盘卸载再点重新索引）——吞掉即行永远
 * 停在 indexing（ADR-0016 §3 禁止，DELETE/reindex 都会 409，只能重启）。catch
 * 自身也必须自保：后台索引尾巴可能在 db.close() 之后落地（优雅关闭/测试
 * teardown 竞态——CI 三平台 unhandled rejection 的根因类）。
 */
function guardIndexFailure(deps: HttpDeps, repoId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  try {
    deps.repoqa.updateRepoStatus(repoId, 'error', undefined, undefined, message);
  } catch {
    // db already closed — nothing left to record on
  }
}

/**
 * v1.2.x（Round5 实测）— 用户输入的本地路径清洗。
 *
 * 实测：`"D:\CodeCompass"`（**从终端/资源管理器复制时连引号一起带进来**）被
 * `fs.stat` 判成「不是一个目录」而 400，用户看到的是「预检失败：路径不可读或
 * 不是仓库目录？」——指向完全错误的方向：路径明明是对的。
 *
 * 这与 Round4 修的反斜杠（R4-1 `normalizeLocalPath`）是同一族纸面缺陷：真实
 * 障碍从来不是路径语义，而是**人手复制来的杂质**。那次归一化的是「怎么比较两个
 * 路径」，这次清洗的是「用户到底敲了什么」——两者都要，缺一个就还在同一处卡人。
 *
 * 只剥**成对**的一层引号（直引号/中文引号都收），不做更激进的重写：`\\server\share`
 * 这类 UNC 路径以反斜杠开头，不受引号处理影响；路径中间的真引号在 Windows 上本就
 * 非法，不必为它发明规则。
 */
export function sanitizeLocalPathInput(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let value = raw.trim();
  // 连续剥两层：手输常见 `"D:\x"` 或从 JSON/日志里再包一层 `'D:\x'`。
  for (let i = 0; i < 2; i += 1) {
    const first = value[0];
    const last = value[value.length - 1];
    if (value.length < 2) break;
    const isPair =
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '“' && last === '”') ||
      (first === '‘' && last === '’');
    if (!isPair) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

export function registerReposIngestRoutes(app: express.Express, deps: HttpDeps): void {
  app.post('/api/repos', asyncHandler(async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        localPath?: unknown;
        branch?: unknown;
        name?: unknown;
      };
      const localPath = sanitizeLocalPathInput(body.localPath);
      if (!localPath) {
        res.status(400).json({ error: 'localPath is required', code: 'repo_path_required' });
        return;
      }
      const branch =
        typeof body.branch === 'string' && body.branch.trim() !== ''
          ? body.branch.trim()
          : undefined;
      // Bug-10: respect the user-supplied display name; empty falls back to
      // the directory basename.
      const name =
        typeof body.name === 'string' && body.name.trim() !== ''
          ? body.name.trim()
          : undefined;
      // v1.2 票 03（V29-1 后半）— 同步校验、异步索引：坏路径在此 400 且
      // **不建行**（保留旧语义，与 MCP index_repo 同规）；通过校验后行即刻
      // 建立并置 indexing，**202 秒回 `{ repo, taskId }`**——进度走既有 WS
      // `repoqa.index.progress` 帧 + catalog 轮询（reindex/clone 同款机制），
      // 最长 600s 的同步长挂就此消灭。破坏性契约变更（202 取代 200/201）
      // 在 CHANGELOG 破坏性段登记在案。
      // v1.4 票 03 — 相对路径按服务进程目录解析，并把**解析结果**存库：
      // 存原文会让后续 reindex 换一个 cwd 就指向别处（同一行两次索引不同目录）。
      const resolvedLocalPath = path.resolve(localPath);
      const stat = await fs.stat(resolvedLocalPath).catch(() => null);
      if (!stat?.isDirectory()) {
        res.status(400).json({
          error:
            `local path is not a directory: ${localPath}` +
            (resolvedLocalPath !== localPath ? ` (resolved to ${resolvedLocalPath})` : ''),
          code: 'import_failed'
        });
        return;
      }
      const upsert = deps.repoqa.upsertByLocalPath({
        name: name ?? deriveLocalRepoName(resolvedLocalPath),
        localPath: resolvedLocalPath,
        branch
      });
      const repoId = upsert.repo.id;
      deps.repoqa.updateRepoStatus(repoId, 'indexing');
      // Fire-and-forget（照 MCP index_repo 的 ADR-0016 先例）。indexRepo 内部
      // 把失败记为 status='error'；其 pre-try 序言（stat/upsert）仍可能
      // reject——吞掉会让行永远停在 indexing（僵尸防线，ADR-0016 §3 禁止），
      // 所以 catch 翻 error 并带上根因供 catalog 轮询；catch 自身也要自保：
      // 后台索引尾巴可能晚于 db.close()（优雅关闭/测试 teardown 与 202 赛跑），
      // 在已关库上再写会变成 unhandled rejection 瀑布（CI 三平台实证）。
      void deps.worker
        .indexRepo({ localPath: resolvedLocalPath, branch, name })
        .catch((error: unknown) => guardIndexFailure(deps, repoId, error));
      res.status(202).json({
        repo: deps.repoqa.getRepo(repoId)!,
        // taskId 与 worker.broadcast 的 taskId 同源（`index-${repoId}`），供日志/
        // WS 帧关联；行 id 已是即时可用的主关联键。
        taskId: `index-${repoId}`
      });
    } catch (error) {
      // R3 review P2-3：引擎/FS 报错可能内嵌凭据形状串——出库过掩码，与 chat 面同尺。
      res.status(400).json({
        error: maskSensitiveText(error instanceof Error ? error.message : String(error)),
        code: 'import_failed'
      });
    }
  }));

  /**
   * v1.4 票 01 — one-click sample project.
   *
   * Materializes the built-in sample source tree under `<dataDir>/samples/`
   * and drives the exact same import path as POST /api/repos (upsert → indexing
   * → fire-and-forget indexRepo → 202). Idempotent by normalized local path, so
   * repeat clicks reuse one repo row instead of cloning rows.
   */
  app.post('/api/repos/sample', asyncHandler(async (_req, res) => {
    try {
      const localPath = path.join(deps.dataDir, 'samples', SAMPLE_PROJECT.slug);
      await fs.mkdir(localPath, { recursive: true });
      for (const [relative, content] of Object.entries(SAMPLE_PROJECT.files)) {
        const target = sampleFileTarget(localPath, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, 'utf8');
      }
      const upsert = deps.repoqa.upsertByLocalPath({
        name: SAMPLE_PROJECT.name,
        localPath
      });
      const repoId = upsert.repo.id;
      // Double-click guard: never start a second index run on a live one
      // (mirrors the reindex 409 intent without failing the click).
      if (!upsert.created && upsert.repo.status === 'indexing') {
        res.status(202).json({ repo: upsert.repo, taskId: `index-${repoId}` });
        return;
      }
      deps.repoqa.updateRepoStatus(repoId, 'indexing');
      void deps.worker
        .indexRepo({ localPath, name: SAMPLE_PROJECT.name })
        .catch((error: unknown) => guardIndexFailure(deps, repoId, error));
      res.status(202).json({ repo: deps.repoqa.getRepo(repoId)!, taskId: `index-${repoId}` });
    } catch (error) {
      res.status(400).json({
        error: maskSensitiveText(error instanceof Error ? error.message : String(error)),
        code: 'sample_import_failed'
      });
    }
  }));

  // Round 2 B4: read-only pre-import preview. The frontend calls this while
  // the user types a local path so they can see exactly what will be indexed
  // (and which ignored dirs will be skipped) before committing to an import.
  app.post('/api/repos/preview', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { localPath?: unknown };
    const localPath = sanitizeLocalPathInput(body.localPath);
    try {
      if (!localPath) {
        res.status(400).json({ error: 'localPath is required', code: 'repo_path_required' });
        return;
      }
      const stats = await previewRepo(localPath);
      // 回显**清洗后**的路径：界面显示的必须是真正被索引的那一条，否则用户
      // 看着输入框里的引号、以为系统吃的是另一个路径。
      // v1.4 票 03 — 显式给出解析后的绝对路径与"是否相对输入"：相对路径按
      // 服务进程目录解析这一事实必须可见，而不是藏在实现里。
      res.json({
        preview: {
          path: localPath,
          resolvedPath: path.resolve(localPath),
          wasRelative: !path.isAbsolute(localPath),
          ...stats
        }
      });
    } catch (error) {
      // v1.4 票 03 — 相对输入失败时把解析结果带进消息：否则「路径不存在」
      // 对着一个用户以为的本地目录说，而实际检查的是服务进程目录下的同名项。
      const base = error instanceof Error ? error.message : String(error);
      const resolved = path.resolve(localPath);
      const detail =
        !path.isAbsolute(localPath) && !base.includes(resolved)
          ? `${base} (resolved to ${resolved})`
          : base;
      res.status(400).json({
        error: maskSensitiveText(detail),
        code: 'repo_path_invalid'
      });
    }
  }));

  // v0.25.0 批次 1：原生目录选择器——绕过浏览器沙箱拿不到绝对路径的根因。
  // Windows 拉起系统 FolderBrowserDialog（STA + 置顶）；非 Windows 返回
  // supported:false 让前端降级手输。契约见 src/dialog.ts。
  app.get('/api/dialog/folder', asyncHandler(async (_req, res) => {
    try {
      const result = await pickFolderDialog();
      res.json(result);
    } catch {
      // 防御兜底（pickFolderDialog 本身从不 reject）：错误内容不出服务端，
      // 响应形状严格守住 {supported, canceled?, path?} 契约。
      res.json({ supported: true, canceled: true });
    }
  }));

  // Personal-use lifecycle: remove the index from the catalog. Source files
  // and local clones are intentionally left on disk — the user can re-import
  // the same path later.
  app.delete('/api/repos/:id', (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
    if (repo.status === 'indexing') {
      res.status(409).json({ error: 'repo is still indexing; wait for it to finish first', code: 'repo_indexing_conflict' });
      return;
    }
    deps.worker.invalidate(repo.id);
    deps.repoqa.deleteRepo(repo.id);
    res.status(204).send();
  });

  // Personal-use lifecycle: rebuild the index from the stored local path
  // without opening the import dialog. Returns 202; the catalog poll follows
  // indexing → ready/error like a fresh import.
  app.post('/api/repos/:id/reindex', (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
    if (repo.status === 'indexing') {
      res.status(409).json({ error: 'repo is still indexing; wait for it to finish first', code: 'repo_indexing_conflict' });
      return;
    }
    deps.worker.invalidate(repo.id);
    deps.repoqa.updateRepoStatus(repo.id, 'indexing');
    // v1.2 票 03 修复（评审 P1）——reindex 与 POST 同险：pre-try reject 会留
    // 永久 indexing 僵尸；统一走僵尸防线（旧实现 `.catch(() => {})` 吞掉一切）。
    deps.worker
      .indexRepo({
        localPath: repo.localPath,
        branch: repo.branch,
        name: repo.name
      })
      .catch((error: unknown) => guardIndexFailure(deps, repo.id, error));
    res.status(202).json({ repo: deps.repoqa.getRepo(repo.id)! });
  });

  // Issue 19: remote repo ingestion — validated shallow clone, then async
  // indexing. The clone runs synchronously (frontend shows a "cloning" phase);
  // the index runs fire-and-forget so the frontend can poll the repo status
  // and show a second "indexing" phase until the catalog flips to ready.
  app.post('/api/repos/clone', asyncHandler(async (req, res) => {
    try {
      const body = (req.body ?? {}) as { url?: unknown; branch?: unknown };
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!url) {
        res.status(400).json({ error: 'url is required', code: 'clone_url_required' });
        return;
      }
      const urlCheck = validateGitUrl(url);
      if (!urlCheck.ok) {
        res.status(400).json({ error: urlCheck.error, code: 'clone_url_invalid' });
        return;
      }
      let branch: string | undefined;
      try {
        branch = validateGitBranch(
          typeof body.branch === 'string' && body.branch.trim() !== ''
            ? body.branch
            : undefined
        );
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : String(error),
          code: 'clone_branch_invalid'
        });
        return;
      }
      const name = deriveCloneName(url);
      const targetDir = path.join(
        deps.dataDir,
        'clones',
        `${name}-${Date.now()}`
      );
      await cloneGitRepo({
        url,
        branch,
        targetDir,
        // V27-18: transient blips retry (1s/2s). v1.2 票 03 — 重试可感知化：
        // 同一退避事件广播上 WS（V29-1 后半），导入/克隆进度区显示
        // 「网络瞬断，重试中（第 N 次）」；reason 先过掩码（URL 可能带凭据）。
        onRetry: ({ attempt, backoffMs, reason }) => {
          deps.logger?.info(
            'clone',
            `transient failure before attempt ${attempt} (retry in ${backoffMs}ms): ${reason.slice(0, 200)}`
          );
          deps.eventBus.emit({
            type: 'repoqa.import.clone-retry',
            payload: {
              name,
              attempt,
              backoffMs,
              reason: maskSensitiveText(reason)
            }
          });
        }
      });

      const upsert = deps.repoqa.upsertByLocalPath({
        name,
        localPath: targetDir,
        branch,
        repoUrl: url
      });
      // The worker re-upserts (idempotent) and manages idle/indexing/ready
      // itself; marking indexing here keeps the 202 response consistent with
      // the state the catalog poll will observe.
      deps.repoqa.updateRepoStatus(upsert.repo.id, 'indexing');
      // v1.2 票 03 修复（评审 P1）——clone 与 POST 同险，统一走僵尸防线
      //（旧实现 `.catch(() => {})` 只满足 no-floating-promises，pre-try
      // reject 会留永久 indexing 僵尸——如克隆目录被清后再点）。
      deps.worker
        .indexRepo({ localPath: targetDir, branch, name })
        .catch((error: unknown) => guardIndexFailure(deps, upsert.repo.id, error));
      res.status(202).json({ repo: deps.repoqa.getRepo(upsert.repo.id)! });
    } catch (error) {
      res.status(400).json({
        // R3 review P2-3：git 认证失败的报错历史上会回显带凭据的 URL。
        error: maskSensitiveText(error instanceof Error ? error.message : String(error)),
        code: 'clone_git_failed'
      });
    }
  }));

  app.get('/api/repos/:id/file/raw', asyncHandler(async (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;

    const requested = req.query.path;
    if (typeof requested !== 'string' || requested === '') {
      res.status(400).json({ error: 'path query parameter is required', code: 'file_path_required' });
      return;
    }

    const root = path.resolve(repo.localPath);
    const resolved = path.resolve(root, requested);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.status(403).json({ error: 'path escapes the indexed repo', code: 'path_escape' });
      return;
    }

    try {
      const realRoot = await fs.realpath(root);
      const realResolved = await fs.realpath(resolved);
      const realRelative = path.relative(realRoot, realResolved);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        res.status(403).json({ error: 'path escapes the indexed repo', code: 'path_escape' });
        return;
      }
      const indexedPath = realRelative.split(path.sep).join('/');
      if (!deps.repoqa.isFileIndexed(repo.id, indexedPath)) {
        res.status(403).json({ error: 'file is not part of the indexed repo', code: 'not_indexed' });
        return;
      }
      const raw = await fs.readFile(realResolved, 'utf8');
      const fileName = path.basename(realResolved).toLowerCase();
      const isConfigFile =
        (fileName.startsWith('application') &&
          (/\.ya?ml$/.test(fileName) || fileName.endsWith('.properties'))) ||
        fileName === 'pom.xml';
      res.type('text/plain').send(isConfigFile ? maskSensitiveText(raw) : raw);
    } catch {
      res.status(404).json({ error: 'File not found', code: 'file_not_found' });
    }
  }));
}