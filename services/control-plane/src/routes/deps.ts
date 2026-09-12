import type { Response } from 'express';
import type { Repos } from '../repos';
import type { Orchestrator, TaskAction } from '../orchestrator';
import type { HarnessManager } from '../harness-manager';
import type { EventBus } from '../events';
import type { RepoQARepos, Repo } from '../repoqa-repos';
import type { RepoQAWorker } from '../repoqa-worker';
import type { ChatRuntime } from '../chat/routes';

export const ACTIONS: TaskAction[] = ['pause', 'resume', 'cancel', 'approve', 'reject'];

/** chat-merge (v0.24.0): 对话式智能体运行时；present → /api/chat/* routes mount.
 * v0.25.0 自 http.ts 迁出为独立契约文件——路由域文件只依赖本文件，杜绝循环引用。 */
export interface HttpDeps {
  repos: Repos;
  orchestrator: Orchestrator;
  harnessManager: HarnessManager;
  repoqa: RepoQARepos;
  worker: RepoQAWorker;
  eventBus: EventBus;
  version: string;
  dataDir: string;
  port: number;
  /** v0.27-B R4：实际绑定地址（/health.boundHost 回显）。可选——直接
   * 组装 createHttpApp 的测试面不传时 health 省略该字段（additive 契约）。 */
  host?: string;
  exportDir: string;
  /** Absolute path to the built SPA dist. When present (and its index.html
   * exists) the app serves it with an SPA fallback; API/WS routes keep priority. */
  staticDir?: string;
  /** chat-merge (v0.24.0): 对话式智能体运行时；present → /api/chat/* routes mount. */
  chat?: ChatRuntime;
}

/**
 * #09 — repo-scoped 端点守卫：命中返回 `Repo`；未命中则按统一 404 契约
 * `{ error: string }` 发出响应并返回 `null`，调用方据此 `return`。收敛 v0.25.0
 * 批2 拆分时原样搬迁的 `getRepo → if(!repo) 404` 同形样板（三域 18 处）。
 * 端点路径/方法/成功形状零变化，未命中统一走此一处。
 */
export function requireRepo(
  deps: HttpDeps,
  res: Response,
  repoId: string | undefined
): Repo | null {
  const repo = repoId ? deps.repoqa.getRepo(repoId) : undefined;
  if (!repo) {
    // v0.27-B R3: repo-scoped 404 across all five surfaces converges here.
    res.status(404).json({ error: 'Repo not found', code: 'repo_not_found' });
    return null;
  }
  return repo;
}
