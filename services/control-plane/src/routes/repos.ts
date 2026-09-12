import fs from 'node:fs/promises';
import { asyncHandler } from '../http-error';
import path from 'node:path';
import express from 'express';
import { requireRepo, type HttpDeps } from './deps';
import { resolveDefaultBranchSync } from '../repoqa-repos';
import type { Repo } from '../repoqa-repos';
import { maskSensitiveText } from '../repoqa-masking';
import {
  cloneGitRepo,
  deriveCloneName,
  validateGitBranch,
  validateGitUrl
} from '../git-importer';
import { pickFolderDialog } from '../dialog';
import { previewRepo } from '../repoqa-scan';

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
export function registerReposIngestRoutes(app: express.Express, deps: HttpDeps): void {
  app.post('/api/repos', asyncHandler(async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        localPath?: unknown;
        branch?: unknown;
        name?: unknown;
      };
      const localPath =
        typeof body.localPath === 'string' ? body.localPath.trim() : '';
      if (!localPath) {
        res.status(400).json({ error: 'localPath is required' });
        return;
      }
      const branch =
        typeof body.branch === 'string' && body.branch.trim() !== ''
          ? body.branch.trim()
          : undefined;
      // Bug-10: respect the user-supplied display name; empty falls back to
      // the directory basename inside the worker.
      const name =
        typeof body.name === 'string' && body.name.trim() !== ''
          ? body.name.trim()
          : undefined;
      const result = await deps.worker.indexRepo({ localPath, branch, name });
      // repo is null only on the ghost path (row deleted mid-index) — this
      // endpoint awaits the full index, so treat it as an unlikely 409.
      if (!result.repo) {
        res.status(409).json({ error: 'repo was removed while indexing' });
        return;
      }
      res.status(result.created ? 201 : 200).json({ repo: result.repo });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }));

  // Round 2 B4: read-only pre-import preview. The frontend calls this while
  // the user types a local path so they can see exactly what will be indexed
  // (and which ignored dirs will be skipped) before committing to an import.
  app.post('/api/repos/preview', asyncHandler(async (req, res) => {
    try {
      const body = (req.body ?? {}) as { localPath?: unknown };
      const localPath =
        typeof body.localPath === 'string' ? body.localPath.trim() : '';
      if (!localPath) {
        res.status(400).json({ error: 'localPath is required' });
        return;
      }
      const stats = await previewRepo(localPath);
      res.json({ preview: { path: localPath, ...stats } });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
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
      res.status(409).json({ error: 'repo is still indexing; wait for it to finish first' });
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
      res.status(409).json({ error: 'repo is still indexing; wait for it to finish first' });
      return;
    }
    deps.worker.invalidate(repo.id);
    deps.repoqa.updateRepoStatus(repo.id, 'indexing');
    deps.worker
      .indexRepo({
        localPath: repo.localPath,
        branch: repo.branch,
        name: repo.name
      })
      .catch(() => {
        // indexRepo never rejects — failures are recorded on the repo row.
      });
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
        res.status(400).json({ error: 'url is required' });
        return;
      }
      const urlCheck = validateGitUrl(url);
      if (!urlCheck.ok) {
        res.status(400).json({ error: urlCheck.error });
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
          error: error instanceof Error ? error.message : String(error)
        });
        return;
      }
      const name = deriveCloneName(url);
      const targetDir = path.join(
        deps.dataDir,
        'clones',
        `${name}-${Date.now()}`
      );
      await cloneGitRepo({ url, branch, targetDir });

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
      deps.worker.indexRepo({ localPath: targetDir, branch, name }).catch(() => {
        // indexRepo never rejects — failures are recorded as status='error'
        // on the repo. The catch only satisfies no-floating-promises.
      });
      res.status(202).json({ repo: deps.repoqa.getRepo(upsert.repo.id)! });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }));

  app.get('/api/repos/:id/file/raw', asyncHandler(async (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;

    const requested = req.query.path;
    if (typeof requested !== 'string' || requested === '') {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    const root = path.resolve(repo.localPath);
    const resolved = path.resolve(root, requested);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      res.status(403).json({ error: 'path escapes the indexed repo' });
      return;
    }

    try {
      const realRoot = await fs.realpath(root);
      const realResolved = await fs.realpath(resolved);
      const realRelative = path.relative(realRoot, realResolved);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        res.status(403).json({ error: 'path escapes the indexed repo' });
        return;
      }
      const indexedPath = realRelative.split(path.sep).join('/');
      if (!deps.repoqa.isFileIndexed(repo.id, indexedPath)) {
        res.status(403).json({ error: 'file is not part of the indexed repo' });
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
      res.status(404).json({ error: 'File not found' });
    }
  }));
}