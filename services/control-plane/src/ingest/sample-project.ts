import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * v1.4 票 01 — 内嵌示例项目「任务看板 API」。 *
 * 自撰的精选 TS 小仓（非第三方源码），随 dist 编译分发，随包可用，无外部
 * 文件依赖。构成对齐引擎已支持的模式：
 *   - `app.get('/path', handler)` / `app.post(...)` 具名与内联 handler
 *   - `app.use(middlewareRef)` 具名中间件（USE * 边 + 中间件链导览）
 *   - 类字段/构造参数定型接收者（this.repository / service.xxx 可解析）
 *   - 跨文件裸调用（唯一名字 → 确定性绑定）
 * 刻意不含 tsconfig `paths` 别名：别名当前不参与模块路径解析（见 README
 * Known Limitations 与 .scratch/v1.4-usable-tool/issues/08），示例不演示
 * 未被支持的能力。
 */

export interface SampleProject {
  slug: string;
  name: string;
  /** relative path -> file content */
  files: Record<string, string>;
}

/**
 * Resolve a bundled file's absolute path under `root`, refusing anything that
 * escapes the root. Keys are compile-time constants today; the guard keeps
 * that property true even if the map ever becomes data-driven.
 */
export function sampleFileTarget(root: string, relative: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`sample file escapes its root: ${relative}`);
  }
  return target;
}

const PACKAGE_JSON = `{
  "name": "taskboard-api",
  "version": "1.0.0",
  "private": true,
  "description": "CodeCompass sample project: a small task board HTTP API",
  "main": "src/server.ts",
  "dependencies": {
    "express": "^4.19.2"
  }
}
`;

const README_MD = `# Taskboard API

A small task board HTTP API used as the CodeCompass sample project.

## Endpoints

- GET /api/tasks - list all tasks
- POST /api/tasks - create a task from a JSON body
- POST /api/tasks/:id/complete - mark a task as done

## Layout

- src/server.ts - app wiring: middleware and routes
- src/routes - HTTP handlers
- src/services - task and token logic
- src/repositories - in-memory storage
- src/utils - ids and logging
`;

const SERVER_TS = `import { registerAuthMiddleware } from './middleware/auth-middleware';
import { registerTaskRoutes } from './routes/task-routes';
import { TaskRepository } from './repositories/task-repository';
import { TaskService } from './services/task-service';
import { logEvent } from './utils/logger';

export interface ExpressLike {
  use(handler: unknown): void;
  get(path: string, handler: unknown): void;
  post(path: string, handler: unknown): void;
  listen(port: number): void;
}

export function buildServer(app: ExpressLike): void {
  const repository = new TaskRepository();
  const service = new TaskService(repository);
  registerAuthMiddleware(app);
  registerTaskRoutes(app, service);
  logEvent('server', 'routes registered');
}

export function startServer(app: ExpressLike, port: number): void {
  buildServer(app);
  app.listen(port);
}
`;

const AUTH_MIDDLEWARE_TS = `import { verifyToken } from '../services/token-service';
import { logEvent } from '../utils/logger';

export interface MiddlewareHost {
  use(handler: unknown): void;
}

export function registerAuthMiddleware(app: MiddlewareHost): void {
  app.use(authMiddleware);
}

export function authMiddleware(req: any, res: any, next: () => void): void {
  const header = readAuthHeader(req);
  if (!verifyToken(header)) {
    logEvent('auth', 'rejected request without a valid token');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

export function readAuthHeader(req: any): string {
  return String(req.headers.authorization);
}
`;

const TOKEN_SERVICE_TS = `const KNOWN_TOKENS: string[] = ['demo-token'];

export function verifyToken(header: string): boolean {
  const token = extractToken(header);
  if (token.length === 0) {
    return false;
  }
  return isKnownToken(token);
}

export function extractToken(header: string): string {
  return header.replace('Bearer ', '');
}

export function isKnownToken(token: string): boolean {
  return KNOWN_TOKENS.includes(token);
}
`;

const TASK_ROUTES_TS = `import { TaskService } from '../services/task-service';
import { logEvent } from '../utils/logger';

export interface ExpressLike {
  get(path: string, handler: unknown): void;
  post(path: string, handler: unknown): void;
}

export function registerTaskRoutes(app: ExpressLike, service: TaskService): void {
  app.get('/api/tasks', (req: any, res: any) => {
    const tasks = service.listTasks();
    logEvent('http', 'GET /api/tasks');
    res.json({ tasks });
  });

  app.post('/api/tasks', (req: any, res: any) => {
    const task = service.createTask(String(req.body.title));
    res.status(201).json({ task });
  });

  app.post('/api/tasks/:id/complete', (req: any, res: any) => {
    const task = service.completeTask(String(req.params.id));
    res.json({ task });
  });
}
`;

const TASK_SERVICE_TS = `import { TaskRow } from '../domain/task';
import { TaskRepository } from '../repositories/task-repository';
import { makeTaskId } from '../utils/id';
import { logEvent } from '../utils/logger';

export class TaskService {
  private readonly repository: TaskRepository;

  constructor(repository: TaskRepository) {
    this.repository = repository;
  }

  listTasks(): TaskRow[] {
    return this.repository.list();
  }

  createTask(title: string): TaskRow {
    const row: TaskRow = { id: makeTaskId(), title, done: false };
    this.repository.save(row);
    logEvent('task', 'created');
    return row;
  }

  completeTask(id: string): TaskRow | undefined {
    const row = this.repository.findById(id);
    if (row === undefined) {
      return undefined;
    }
    row.done = true;
    this.repository.save(row);
    return row;
  }
}
`;

const TASK_REPOSITORY_TS = `import { TaskRow } from '../domain/task';

export class TaskRepository {
  private readonly rows: TaskRow[] = [];

  list(): TaskRow[] {
    return this.rows;
  }

  findById(id: string): TaskRow | undefined {
    return this.rows.find((row: TaskRow) => row.id === id);
  }

  save(row: TaskRow): void {
    this.rows.push(row);
  }
}
`;

const DOMAIN_TASK_TS = `export interface TaskRow {
  id: string;
  title: string;
  done: boolean;
}

export function describeTask(row: TaskRow): string {
  return row.done ? row.title + ' (done)' : row.title;
}
`;

const UTILS_ID_TS = `let counter = 0;

export function makeTaskId(): string {
  counter = counter + 1;
  return 'task-' + String(counter);
}
`;

const UTILS_LOGGER_TS = `export function logEvent(scope: string, message: string): void {
  console.log('[' + scope + '] ' + message);
}
`;

export const SAMPLE_PROJECT: SampleProject = {
  slug: 'taskboard-api',
  name: '示例项目：任务看板 API',
  files: {
    'package.json': PACKAGE_JSON,
    'README.md': README_MD,
    'src/server.ts': SERVER_TS,
    'src/middleware/auth-middleware.ts': AUTH_MIDDLEWARE_TS,
    'src/services/token-service.ts': TOKEN_SERVICE_TS,
    'src/routes/task-routes.ts': TASK_ROUTES_TS,
    'src/services/task-service.ts': TASK_SERVICE_TS,
    'src/repositories/task-repository.ts': TASK_REPOSITORY_TS,
    'src/domain/task.ts': DOMAIN_TASK_TS,
    'src/utils/id.ts': UTILS_ID_TS,
    'src/utils/logger.ts': UTILS_LOGGER_TS
  }
};

/**
 * v1.4.1 评审 P2 — content hash of the bundled tree. The import endpoint only
 * rewrites the sample when the bundled content actually changed, so a user who
 * edited the sample while reading it does not get silently rolled back on the
 * next click. The stamp lives OUTSIDE the sample directory so it never enters
 * the index (fileCount must stay exactly the bundled file count).
 */
export function sampleProjectHash(): string {
  // SHA-256 (not a security boundary — just a content fingerprint; chosen over
  // SHA-1 so security scanners do not flag a weak-algorithm pattern).
  const hash = createHash('sha256');
  for (const [relative, content] of Object.entries(SAMPLE_PROJECT.files).sort(
    ([a], [b]) => a.localeCompare(b)
  )) {
    hash.update(relative).update('\0').update(content).update('\0');
  }
  return hash.digest('hex');
}
