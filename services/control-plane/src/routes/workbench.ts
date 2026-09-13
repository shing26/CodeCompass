import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { asyncHandler } from '../http-error';
import type { HttpDeps } from './deps';
import { ACTIONS, requireRepo } from './deps';
import type { TaskAction } from '../orchestrator';
import { exportWorkspace, importWorkspace } from '../workspace-export';
import { llmRuntimeInfo, maskHostname } from '../repoqa-llm';
import { maskEventPayload } from '../repoqa-masking';

/** Issue 14/16/19/30 + runtime：harness 编排面（tasks/harnesses/workspaces）
 * 与运行时状态。v0.25.0 自 http.ts 按域拆出，注册顺序保持原样。 */
type HealthChecks = { db: 'ok' | 'down' | 'skipped'; dataDir: 'ok' | 'down' };

export function registerWorkbenchRoutes(app: express.Express, deps: HttpDeps): void {
  // v0.27-B R6 — /health 深检：DB 真读 + dataDir 真写探针，失败 503 degraded。
  // 探针纪律（R6 review P1-1/P2-5）：固定文件名（崩溃/rm 失败至多留一个文件，
  // 下次覆盖）；rm 失败不降级（写成功即证明可写，Windows AV 暂扣句柄不是故障）；
  // 结果 TTL 1.5s 缓存（热轮询不打爆同步 syscall）。deps.db 缺席时报
  // 'skipped' 不报口头 ok（P1-2：诚实披露未探）。
  let probeCache: { atMs: number; checks: HealthChecks } | null = null;
  app.get('/health', (_req, res) => {
    const now = Date.now();
    if (!probeCache || now - probeCache.atMs > 1_500) {
      const checks: HealthChecks = { db: 'skipped', dataDir: 'ok' };
      if (deps.db) {
        try {
          deps.db.prepare('SELECT 1').get();
          checks.db = 'ok';
        } catch {
          checks.db = 'down';
        }
      }
      try {
        const probe = path.join(deps.dataDir, '.health-probe');
        fs.writeFileSync(probe, 'x');
        try {
          fs.rmSync(probe, { force: true });
        } catch {
          /* AV 暂扣句柄：写已成功，可写性结论不变 */
        }
      } catch {
        checks.dataDir = 'down'; // 只有「写不进去」才是真 down
      }
      probeCache = { atMs: now, checks };
    }
    const { checks } = probeCache;
    const ok = checks.db !== 'down' && checks.dataDir !== 'down';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      version: deps.version,
      port: deps.port,
      // R4 (V27-1)：绑定面回显——排障时一眼看出是否被逃生开关放到 LAN。
      ...(deps.host ? { boundHost: deps.host } : {}),
      dataDir: deps.dataDir,
      checks
    });
  });

  app.get('/api/runtime', (req, res) => {
    const runtime = llmRuntimeInfo(process.env);
    // R6 review P2-4：进程指标只回环可见——LAN 逃生（零鉴权）时 uptime/rss/
    // indexingJobs 组合是重启时刻与负载的侧信道，与 maskHostname 同一克制。
    const peer = req.socket.remoteAddress ?? '';
    const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    res.json({
      llm: {
        mode: runtime.mode,
        host: runtime.host ? maskHostname(runtime.host) : undefined
      },
      // R6 — 进程基线指标（本机排障用；无采集器不上外路面）。
      // P1-3：worker.running 只登记 indexRepo——字段叫 indexingJobs，不冒充
      // 「在途任务全集」（query/evolve 流不占该 map）。
      ...(loopback
        ? {
            process: {
              uptimeSec: Math.round(process.uptime()),
              rssKb: Math.round(process.memoryUsage().rss / 1024),
              indexingJobs: deps.worker.activeOpCount()
            }
          }
        : {})
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

  app.post('/api/tasks/:id/actions', asyncHandler(async (req, res) => {
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
  }));

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
}

/** Issue 25 / Ticket 03 — hydrate replay 与 anchor/feedback/events 证据面。 */
export function registerWorkbenchLateRoutes(app: express.Express, deps: HttpDeps): void {
  // Issue 25 / Ticket 03 — hydrate replay: the persisted artifact cards of
  // one (repoId, commit) stream, seq ascending. No commit param = the
  // repo's current physical stream (repo.commit ?? 'unversioned'); payloads
  // pass the masking middleware like every other read surface.
  app.get('/api/repos/:id/workbench-cards', (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
    const commitParam =
      typeof req.query.commit === 'string' && req.query.commit.trim()
        ? req.query.commit.trim()
        : undefined;
    const commit = commitParam ?? repo.commit ?? 'unversioned';
    const cards = deps.repoqa
      .listWorkbenchCards(repo.id, commit)
      .map((card) => maskEventPayload(card));
    res.json({ repoId: repo.id, commit, cards });
  });

  app.post('/api/repos/:id/anchor-click', (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
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
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
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

  // Issue 08: read-only local evidence plane accessor.
  app.get('/api/events', (req, res) => {
    const query = req.query as Record<string, unknown>;
    const asString = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
    const asNumber = (value: unknown): number | undefined => {
      if (typeof value !== 'string' || value.trim() === '') return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    };
    res.json(
      deps.repoqa.listEvents({
        repoId: asString(query.repoId),
        eventType: asString(query.eventType),
        intent: asString(query.intent),
        limit: asNumber(query.limit),
        offset: asNumber(query.offset)
      })
    );
  });
}
