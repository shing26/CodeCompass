import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { registerChatRoutes } from './chat/routes';
import { registerWorkbenchRoutes, registerWorkbenchLateRoutes } from './routes/workbench';
import { registerReposCatalogRoutes, registerReposIngestRoutes } from './routes/repos';
import { registerAnalysisRoutes } from './routes/analysis';
import type { HttpDeps } from './routes/deps';

export type { HttpDeps } from './routes/deps';

/**
 * v0.25.0 批次 2：http.ts 缩为组装层——路由按域拆分至 routes/，注册顺序与
 * 中间件顺序与拆分前逐字节一致（/api 404 兜底、静态托管、错误中间件的先后
 * 关系是 v0.24 实测过的行为契约）。
 */
export function createHttpApp(deps: HttpDeps): express.Express {
  const app = express();

  // CORS: the web workbench runs on a different origin/port than the API server
  // (e.g. Vite dev server on 5173, API on 43110). Browsers enforce same-origin
  // for fetch and EventSource, so the API must answer with explicit CORS
  // headers, including the SSE GET preflight (no custom headers are used, so
  // the preflight only needs the origin + method).
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());

  // Bug-13: malformed JSON bodies must return a JSON 400, never Express's
  // default HTML error page (which leaks the SyntaxError stack trace).
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (
        err instanceof SyntaxError &&
        (err as { type?: string }).type === 'entity.parse.failed'
      ) {
        res.status(400).json({ error: 'invalid JSON body' });
        return;
      }
      next(err);
    }
  );

  // Issue 16: one-process workbench runtime (health/runtime/tasks/harnesses/
  // workspaces) — original registration order preserved by the domain split.
  registerWorkbenchRoutes(app, deps);

  // Repo catalog（读取面）：/api/repos 与 /api/repos/:id。
  registerReposCatalogRoutes(app, deps);

  // Analysis domain：symbols/reverse-deps/tours/dashboard/radar/delta/
  // subgraph/onboarding/chunks/query/evolve（原 277-687 行连续段）。
  registerAnalysisRoutes(app, deps);

  // Artifact hydrate + 证据面（workbench-cards/anchor-click/feedback/events，
  // 原 689-784 行连续段，位于 evolve 之后、repos POST 导入之前）。
  registerWorkbenchLateRoutes(app, deps);

  // Repo ingestion（POST 导入/preview/dialog/delete/reindex/clone/file-raw，
  // 原 786-1006 行连续段）。
  registerReposIngestRoutes(app, deps);

  // chat-merge (v0.24.0): 对话式智能体路由——必须在 /api 404 兜底之前注册
  if (deps.chat) {
    registerChatRoutes(app, deps.chat);
  }

  // Bug-R2-05: unknown /api routes must answer JSON, never Express's default
  // HTML 404 (which also breaks JSON-only API clients).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // Issue 16: single-process production hosting. Mounted after every API/WS
  // route so they keep priority; unknown non-API GETs fall back to index.html
  // for client-side routing (the SPA is state-driven, no router needed — but
  // deep links and hard refreshes still hit server routes).
  if (
    deps.staticDir &&
    existsSync(path.join(deps.staticDir, 'index.html'))
  ) {
    app.use(express.static(deps.staticDir));
    app.use((req, res, next) => {
      if (
        (req.method !== 'GET' && req.method !== 'HEAD') ||
        req.path === '/api' ||
        req.path.startsWith('/api/') ||
        req.path === '/ws'
      ) {
        next();
        return;
      }
      res.sendFile(path.join(deps.staticDir!, 'index.html'));
    });
  }

  return app;
}
