import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import type { Repos } from './repos';
import type { Orchestrator, TaskAction } from './orchestrator';
import type { HarnessManager } from './harness-manager';
import type { EventBus } from './events';
import type { RepoQARepos } from './repoqa-repos';
import type { RepoQAWorker } from './repoqa-worker';
import { exportWorkspace, importWorkspace } from './workspace-export';
import { maskSensitiveText } from './repoqa-masking';

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
}

const ACTIONS: TaskAction[] = ['pause', 'resume', 'cancel', 'approve', 'reject'];

export function createHttpApp(deps: HttpDeps): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: deps.version,
      port: deps.port,
      dataDir: deps.dataDir
    });
  });

  app.get('/api/tasks', (_req, res) => {
    res.json({ tasks: deps.repos.listTasks() });
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = deps.repos.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ task });
  });

  app.get('/api/tasks/:id/logs', (req, res) => {
    res.json({ logs: deps.repos.listLogs(req.params.id) });
  });

  app.post('/api/tasks', (req, res) => {
    try {
      const body = req.body as {
        type: string;
        input?: Record<string, unknown>;
        workspaceId?: string;
        requiresApproval?: boolean;
      };
      const task = deps.orchestrator.createTask({
        type: body.type as 'coding' | 'shell' | 'browser',
        input: body.input ?? {},
        workspaceId: body.workspaceId ?? 'default',
        requiresApproval: Boolean(body.requiresApproval)
      });
      res.status(201).json({ task });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post('/api/tasks/:id/actions', async (req, res) => {
    try {
      const body = req.body as { action: TaskAction; approved?: boolean };
      if (!ACTIONS.includes(body.action)) {
        res.status(400).json({ error: `Unknown action: ${String(body.action)}` });
        return;
      }
      const task = await deps.orchestrator.action(
        req.params.id,
        body.action,
        body.approved
      );
      res.json({ task });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/harnesses', (_req, res) => {
    res.json({ harnesses: deps.repos.listHarnesses() });
  });

  app.post('/api/harnesses', (req, res) => {
    try {
      const body = req.body as {
        id?: string;
        name: string;
        type: 'coding' | 'shell' | 'browser' | 'external';
        bridgeAdapter?: string;
        config?: Record<string, unknown>;
      };
      const now = new Date().toISOString();
      const harness = {
        id: body.id ?? `external-${now}`,
        name: body.name,
        type: body.type,
        mode: 'external' as const,
        status: 'disconnected' as const,
        bridgeAdapter: body.bridgeAdapter ?? 'bridge-v1',
        config: body.config ?? {}
      };
      deps.repos.upsertHarness(harness);
      res.status(201).json({ harness });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/workspaces', (_req, res) => {
    res.json({ workspaces: deps.repos.listWorkspaces() });
  });

  app.post('/api/workspaces/:id/export', (req, res) => {
    try {
      const bundleDir = exportWorkspace(deps.repos, req.params.id, deps.exportDir);
      res.json({ bundleDir });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post('/api/workspaces/import', (req, res) => {
    try {
      const bundleDir = String((req.body as { bundleDir?: unknown }).bundleDir ?? '');
      const result = importWorkspace(deps.repos, bundleDir);
      res.json(result);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/repos', (_req, res) => {
    res.json({ repos: deps.repoqa.listRepos() });
  });

  app.get('/api/repos/:id', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    res.json({ repo });
  });

  app.get('/api/repos/:id/symbols', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const kind =
      typeof req.query.kind === 'string' && req.query.kind !== ''
        ? req.query.kind
        : undefined;
    res.json({ symbols: deps.repoqa.listSymbols(repo.id, kind) });
  });

  app.get('/api/repos/:id/chunks', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const query =
      typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query) {
      res.status(400).json({ error: 'q query parameter is required' });
      return;
    }
    res.json({ chunks: deps.repoqa.searchChunks(repo.id, query) });
  });

  app.get('/api/repos/:id/query', async (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const question =
      typeof req.query.question === 'string' ? req.query.question.trim() : '';
    if (!question) {
      res.status(400).json({ error: 'question query parameter is required' });
      return;
    }
    const mode =
      req.query.mode === 'architecture' ||
      req.query.mode === 'call-chain' ||
      req.query.mode === 'environment'
        ? req.query.mode
        : undefined;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.flushHeaders();
    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    try {
      for await (const event of deps.worker.queryRepo({
        repoId: repo.id,
        question,
        mode
      })) {
        if (closed) return;
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
      }
      res.end();
    } catch (error) {
      if (!closed) {
        const message = error instanceof Error ? error.message : String(error);
        deps.repoqa.recordEvent({
          repoId: repo.id,
          eventType: 'query.failure',
          failureClass: message
        });
        res.write(
          `event: repoqa.query.error\ndata: ${JSON.stringify({ error: message })}\n\n`
        );
        res.end();
      }
    }
  });

  app.post('/api/repos/:id/anchor-click', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const body = (req.body ?? {}) as {
      file?: unknown;
      line?: unknown;
      symbol?: unknown;
      sessionId?: unknown;
    };
    if (typeof body.file !== 'string' || typeof body.symbol !== 'string') {
      res.status(400).json({ error: 'file and symbol are required' });
      return;
    }
    const sessionId =
      typeof body.sessionId === 'string' ? body.sessionId : undefined;
    deps.repoqa.recordEvent({
      repoId: repo.id,
      eventType: 'anchor.click',
      sessionId,
      anchorClicked: true,
      feedback:
        typeof body.line === 'number'
          ? `${body.file}:${body.line}:${body.symbol}`
          : `${body.file}:${body.symbol}`
    });
    res.status(201).json({ ok: true });
  });

  app.post('/api/repos/:id/feedback', (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }
    const body = (req.body ?? {}) as {
      feedback?: unknown;
      sessionId?: unknown;
    };
    if (typeof body.feedback !== 'string' || body.feedback.trim() === '') {
      res.status(400).json({ error: 'feedback is required' });
      return;
    }
    deps.repoqa.recordEvent({
      repoId: repo.id,
      eventType: 'feedback.submitted',
      sessionId:
        typeof body.sessionId === 'string' ? body.sessionId : undefined,
      feedback: body.feedback
    });
    res.status(201).json({ ok: true });
  });

  app.post('/api/repos', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        localPath?: unknown;
        branch?: unknown;
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
      const result = await deps.worker.indexRepo({ localPath, branch });
      res.status(result.created ? 201 : 200).json({ repo: result.repo });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get('/api/repos/:id/file/raw', async (req, res) => {
    const repo = deps.repoqa.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

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
  });

  return app;
}
