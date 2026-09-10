import type { Repos } from '../repos';
import type { Orchestrator, TaskAction } from '../orchestrator';
import type { HarnessManager } from '../harness-manager';
import type { EventBus } from '../events';
import type { RepoQARepos } from '../repoqa-repos';
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
  exportDir: string;
  /** Absolute path to the built SPA dist. When present (and its index.html
   * exists) the app serves it with an SPA fallback; API/WS routes keep priority. */
  staticDir?: string;
  /** chat-merge (v0.24.0): 对话式智能体运行时；present → /api/chat/* routes mount. */
  chat?: ChatRuntime;
}
