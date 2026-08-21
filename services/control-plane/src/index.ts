import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConfig } from './config';
import { openDb, ensureDefaultWorkspace } from './db';
import { Repos } from './repos';
import { Orchestrator } from './orchestrator';
import { HarnessManager } from './harness-manager';
import { RepoQARepos } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { EventBus } from './events';
import { createHttpApp } from './http';
import type { ServerEvent } from './types';

const config = loadConfig();
const dataDir = config.dataDir;
const db = openDb(config.dbPath);
ensureDefaultWorkspace(db, dataDir);

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
  version: '0.1.0',
  dataDir,
  port: config.port,
  exportDir: path.join(dataDir, 'exports')
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

server.listen(config.port, () => {
  console.log(`Control Plane running on http://localhost:${config.port}`);
});
