import http from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { WebSocketServer, WebSocket } from 'ws';
import type express from 'express';
import { loadConfig, isLoopbackListenAddress, type Config } from './config';
import { VERSION } from './version';
import { ServerLogger } from './log-sink';
import { openDb, ensureDefaultWorkspace, backupDb } from './db';
import { Repos } from './repos';
import { Orchestrator } from './orchestrator';
import { HarnessManager } from './harness-manager';
import { RepoQARepos, type Repo } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { RepoWatcher } from './repoqa-watcher';
import { EventBus } from './events';
import { createHttpApp } from './http';
import { readDotEnvFile } from './repoqa-llm';
import { ChatStore } from './chat/store.js';
import { LlmManager } from './chat/llm.js';
import { InProcessMcpClient } from './chat/client.js';
import { SessionLogger as ChatSessionLogger } from './chat/log.js';
import { registerChatRoutes, type ChatRuntime } from './chat/routes.js';
import type { ServerEvent } from './types';

export interface StartOptions {
  /** Environment passed to loadConfig (MHW_CP_HOST / MHW_CP_PORT / MHW_DATA_DIR / MHW_STATIC_DIR). */
  env?: NodeJS.ProcessEnv;
  /** Override the loaded port. Unlike MHW_CP_PORT, 0 is honored (random free port). */
  port?: number;
  /** Override the built-SPA directory (takes precedence over MHW_STATIC_DIR). */
  staticDir?: string;
  /** Called once the server is listening, with the actual port. */
  onListening?: (port: number) => void;
  /** Issue 30: enable FS-watcher hot reload for ready repos (default true). */
  watch?: boolean;
}

export interface RunningServer {
  server: http.Server;
  app: express.Express;
  /** Actual listening port (resolves 0 → OS-assigned port). */
  port: number;
  config: Config;
  db: Database.Database;
  repos: Repos;
  repoqa: RepoQARepos;
  worker: RepoQAWorker;
  orchestrator: Orchestrator;
  harnessManager: HarnessManager;
  eventBus: EventBus;
  watchers: ReadonlyMap<string, RepoWatcher>;
  close(): Promise<void>;
}

/**
 * Locate the built SPA dist relative to the running package, tolerating both
 * source (src/*.ts via tsx) and bundled (dist/*.js) layouts: both live two
 * directories under packages/apps siblings at the repo root.
 */
export function resolveWebDist(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../../apps/repoqa-web/dist'),
    path.resolve(process.cwd(), 'apps/repoqa-web/dist')
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // unreadable path — try the next candidate
    }
  }
  return null;
}

/**
 * Bootstrap the whole control plane in one process: config, sqlite db, RepoQA
 * worker, REST app, WebSocket broadcasting. Resolves once the HTTP server is
 * listening. Wraps the server lifecycle for graceful close().
 */
export async function startServer(options: StartOptions = {}): Promise<RunningServer> {
  const loaded = loadConfig(options.env);
  const config: Config = {
    ...loaded,
    port: options.port ?? loaded.port,
    staticDir: options.staticDir ?? loaded.staticDir ?? resolveWebDist() ?? undefined
  };

  await backupDb(config.dbPath);
  // chat-merge: 引擎 .env 惰性加载的启动固化——cwd 漂移（如从 apps/repoqa-web
  // 启动）会让后续 loadLlmEnv 找不到 REPOQA_LLM_*，启动时一次性并入 process.env。
  for (const [key, value] of Object.entries(readDotEnvFile())) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const db = openDb(config.dbPath);
  ensureDefaultWorkspace(db, config.dataDir);

  // v0.27-B R5: server-side operational log sink (dataDir/logs/*.jsonl).
  // MHW_LOG_LEVEL gates it (default info); errors additionally mirror stderr.
  // R5 review P2-6：options.env 是 cli 在 .env 合并前快照的副本——回退读
  // 已合并的 process.env，让引擎 .env 里的 MHW_LOG_LEVEL 也生效。
  const serverLog = new ServerLogger(
    config.dataDir,
    options.env?.MHW_LOG_LEVEL ?? process.env.MHW_LOG_LEVEL
  );

  const repos = new Repos(db);
  const repoqa = new RepoQARepos(db);
  repoqa.resetInterrupted();

  const eventBus = new EventBus();
  const worker = new RepoQAWorker(repoqa, eventBus);
  const orchestrator = new Orchestrator(repos);
  const harnessManager = new HarnessManager({ repos, eventBus });

  // chat-merge: 编排层运行时（进程内直调引擎 handler，见 .scratch/chat-merge/spec.md Q3）
  const chatLog = new ChatSessionLogger(path.join(config.dataDir, 'chat-logs'));
  chatLog.start();
  const chatStore = new ChatStore(db);
  chatStore.init();
  const chatLlm = new LlmManager(path.join(config.dataDir, 'llm-profiles.json'), process.env);
  chatLlm.load();
  const chatMcp = new InProcessMcpClient({ repoqa, worker, dataDir: config.dataDir }, chatLog);
  await chatMcp.connect();
  const chatRuntime: ChatRuntime = {
    store: chatStore,
    llm: chatLlm,
    mcp: chatMcp,
    log: chatLog,
    agents: new Map()
  };

  const app = createHttpApp({
    repos,
    orchestrator,
    harnessManager,
    repoqa,
    worker,
    eventBus,
    // V27-25: was a stale hardcoded '0.6.0' — /health now echoes the real
    // product version; the e2e gate pins payload == version.ts constant.
    version: VERSION,
    dataDir: config.dataDir,
    port: config.port,
    // R4：/health 回显实际绑定面（boundHost）。
    host: config.host,
    exportDir: path.join(config.dataDir, 'exports'),
    staticDir: config.staticDir,
    chat: chatRuntime,
    logger: serverLog,
    // R6：/health 深检的 DB 探针句柄。
    db
  });

  const server = http.createServer(app);
  const clients = new Set<WebSocket>();
  const watchers = new Map<string, RepoWatcher>();

  const stopRepoWatcher = (repoId: string): void => {
    const watcher = watchers.get(repoId);
    if (!watcher) return;
    watcher.close();
    watchers.delete(repoId);
  };

  const ensureRepoWatcher = (repo: Repo | undefined): void => {
    if ((options.watch ?? true) === false) return;
    if (!repo || repo.status !== 'ready' || watchers.has(repo.id)) return;
    const watcher = new RepoWatcher(repo, worker, eventBus);
    watcher.start();
    watchers.set(repo.id, watcher);
  };

  function broadcast(event: ServerEvent) {
    const msg = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'system.welcome', payload: { ts: Date.now() } }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'task.create') {
          const task = orchestrator.createTask({
            workspaceId: msg.payload.workspaceId || 'default',
            type: msg.payload.type || 'coding',
            input: msg.payload.input || {}
          });
          broadcast({ type: 'task.created', payload: task } as ServerEvent);
          return;
        }

        if (msg.type === 'task.run') {
          const task = orchestrator.run(msg.payload.id, msg.payload.harnessId);
          if (!task) return;

          setTimeout(() => {
            const completed = orchestrator.complete(
              task.id,
              { result: 'ok' },
              { input: 120, output: 340 },
              1000
            );
            if (completed) {
              broadcast({ type: 'task.updated', payload: completed } as ServerEvent);
              broadcast({
                type: 'token.usage',
                payload: { taskId: completed.id, input: 120, output: 340 }
              });
            }
          }, 1000);
          return;
        }
      } catch {
        ws.send(JSON.stringify({ type: 'system.error', payload: { message: 'invalid message' } }));
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  eventBus.on((event) => {
    // R5: operational trail of the worker/event surface. Progress frames are
    // high-frequency by design (per-file) → not worth the log volume; every
    // other repoqa.*/repo_updated/task event is a state change worth keeping.
    // R5 review P1-2：真实失败事件是 repoqa.index.error（index.done 恒 ready，
    // done&&status==='error' 是永不命中的死分支）；payload 联合类型宽 → log-only
    // 鸭子读取 repoId/taskId 存在即可。
    const payload = event.payload as { repoId?: string; taskId?: string; error?: string };
    if (event.type !== 'repoqa.index.progress') {
      serverLog.info('events', event.type, {
        ...(payload.repoId ? { repoId: payload.repoId } : {}),
        ...('taskId' in payload && payload.taskId ? { taskId: payload.taskId } : {})
      });
    }
    if (event.type === 'repoqa.index.error') {
      serverLog.error('worker', `index failed${payload.repoId ? ` for ${payload.repoId}` : ''}`, {
        error: payload.error
      });
    }
    if (event.type === 'repoqa.index.progress' && event.payload.phase === 'parsing') {
      stopRepoWatcher(event.payload.repoId);
    }
    if (event.type === 'repoqa.index.done' && event.payload.status === 'ready') {
      ensureRepoWatcher(repoqa.getRepo(event.payload.repoId));
    }
    if (event.type.startsWith('repoqa.') || event.type === 'repo_updated') {
      broadcast(event as ServerEvent);
    }
  });

  for (const repo of repoqa.listRepos()) ensureRepoWatcher(repo);

  let resolved = false;
  const port = await new Promise<number>((resolve, reject) => {
    // Both the http server and the WebSocketServer emit 'error' on listen
    // failures (EADDRINUSE …): ws relays the underlying server's error to the
    // wss emitter, and an unhandled 'error' there crashes the process before
    // our rejection is observed. Listen so failures reject cleanly; errors
    // after a successful listen are logged, not fatal.
    const onError = (err: Error) => {
      if (!resolved) reject(err);
      else console.error('Control plane error:', err);
    };
    server.on('error', onError);
    wss.on('error', onError);
    server.listen(config.port, config.host, () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : config.port;
      // v0.27-B R4 (V27-1)：默认回环。绑到非回环=局域网零鉴权可达，显式提示
      // （R4 review P2-3a：判定用**解析后的监听地址**而非配置串——
      //  hosts 把 localhost 拐到路由网卡时也如实告警，127.x 全段不误报）。
      const addrObj = typeof address === 'object' && address ? address : null;
      if (addrObj && !isLoopbackListenAddress(addrObj.address, addrObj.family)) {
        console.warn(
          `Control plane bound to ${addrObj.address}:${actual} — LAN exposure, no auth. ` +
            `Every device on this network can read indexes and call the LLM. ` +
            `Set MHW_CP_HOST=127.0.0.1 to keep it loopback-only.`
        );
        serverLog.warn('server', 'LAN exposure (non-loopback bind, no auth)', {
          address: addrObj.address,
          port: actual
        });
      } else {
        serverLog.info('server', 'listening', {
          address: addrObj?.address ?? config.host,
          port: actual,
          dataDir: config.dataDir
        });
      }
      resolved = true;
      options.onListening?.(actual);
      resolve(actual);
    });
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const watcher of watchers.values()) await watcher.flush();
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    // V27-31: terminate live WebSocket clients BEFORE server.close().
    // Neither wss.close() nor server.closeAllConnections() destroys an
    // upgraded WS connection (verified by probe on Node 24 + ws@8), so
    // `await server.close()` below would hang forever while a browser tab
    // held /ws open — SIGTERM's graceful shutdown never reached exit,
    // leaving a process that stopped listening but kept the client's socket
    // half-open. On Windows `child.kill()` TerminateProcess masks this;
    // Linux CI exercises the graceful path, so the UI smoke (v0.27.0 Release
    // first run) caught it: the page never saw 'close', never reconnected,
    // and the R2 lock legitimately went red.
    for (const client of wss.clients) client.terminate();
    wss.close();
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    serverLog.info('server', 'shutdown');
    serverLog.close();
    db.close();
  };

  return {
    server,
    app,
    port,
    config,
    db,
    repos,
    repoqa,
    worker,
    orchestrator,
    harnessManager,
    eventBus,
    watchers,
    close
  };
}
