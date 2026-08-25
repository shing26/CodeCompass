import http from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { WebSocketServer, WebSocket } from 'ws';
import type express from 'express';
import { loadConfig, type Config } from './config';
import { openDb, ensureDefaultWorkspace, backupDb } from './db';
import { Repos } from './repos';
import { Orchestrator } from './orchestrator';
import { HarnessManager } from './harness-manager';
import { RepoQARepos } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { EventBus } from './events';
import { createHttpApp } from './http';
import type { ServerEvent } from './types';

export interface StartOptions {
  /** Environment passed to loadConfig (MHW_CP_PORT / MHW_DATA_DIR / MHW_STATIC_DIR). */
  env?: NodeJS.ProcessEnv;
  /** Override the loaded port. Unlike MHW_CP_PORT, 0 is honored (random free port). */
  port?: number;
  /** Override the built-SPA directory (takes precedence over MHW_STATIC_DIR). */
  staticDir?: string;
  /** Called once the server is listening, with the actual port. */
  onListening?: (port: number) => void;
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
  const db = openDb(config.dbPath);
  ensureDefaultWorkspace(db, config.dataDir);

  const repos = new Repos(db);
  const repoqa = new RepoQARepos(db);
  repoqa.resetInterrupted();

  const eventBus = new EventBus();
  const worker = new RepoQAWorker(repoqa, eventBus);
  const orchestrator = new Orchestrator(repos);
  const harnessManager = new HarnessManager({ repos, eventBus });

  const app = createHttpApp({
    repos,
    orchestrator,
    harnessManager,
    repoqa,
    worker,
    eventBus,
    version: '0.3.5',
    dataDir: config.dataDir,
    port: config.port,
    exportDir: path.join(config.dataDir, 'exports'),
    staticDir: config.staticDir
  });

  const server = http.createServer(app);
  const clients = new Set<WebSocket>();

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
    if (event.type.startsWith('repoqa.')) broadcast(event as ServerEvent);
  });

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
    server.listen(config.port, () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : config.port;
      resolved = true;
      options.onListening?.(actual);
      resolve(actual);
    });
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    wss.close();
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
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
    close
  };
}
