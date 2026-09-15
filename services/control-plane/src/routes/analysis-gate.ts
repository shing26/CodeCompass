import express from 'express';
import { asyncHandler } from '../http-error';
import { requireRepo, type HttpDeps } from './deps';
import { analyzeDiff, evaluateDiffPolicy, summarizeGitError } from '../engine/repoqa-diff';
import {
  resolveRepoCommitSync,
  type GateRunPolicyOptions,
  type GateRunRouteRow
} from '../ingest/repoqa-repos';
import { maskEventPayload, maskSensitiveText } from '../engine/repoqa-masking';

/**
 * V27-30 (B3 increment 2) — Delta/门禁域（architecture-delta、gate/run、
 * gate-runs）。自 routes/analysis.ts 按域物理拆分，逐字搬家零行为变更。
 */
export function registerGateRoutes(app: express.Express, deps: HttpDeps): void {
  // v0.6.0 — Architecture Delta: base/head 两个 git ref 的多语言路由增删、
  // 断边与风险分级。复用 `codecompass diff` 的只读 git 内核，不触碰工作区。
  app.post('/api/repos/:id/architecture-delta', asyncHandler(async (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
    const body = (req.body ?? {}) as { base?: unknown; head?: unknown };
    const base = typeof body.base === 'string' ? body.base.trim() : '';
    const head = typeof body.head === 'string' ? body.head.trim() : '';
    if (!base || !head) {
      res.status(400).json({ error: 'base and head git refs are required', code: 'git_refs_required' });
      return;
    }
    // 收口 review P1-2：`-` 起头的 ref 会被 git 当选项（--output 写文件面）。
    // 路由前置挡=校验失败而非执行失败：不走 catch、不落 error 历史行（票 14 语义不受碰）。
    if (/^-/.test(base) || /^-/.test(head)) {
      res.status(400).json({ error: 'git refs must not start with "-"', code: 'git_ref_invalid' });
      return;
    }
    try {
      const report = await analyzeDiff({ repoPath: repo.localPath, base, head });
      res.json({ delta: report.architectureDelta ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // R3-Bug-02 — one UI-ready sentence plus the raw git output for the
      // collapsible detail block (was: raw multi-line git stderr as-is).
      res.status(400).json({ error: summarizeGitError(message), detail: message, code: 'git_command_failed' });
    }
  }));

  // v0.26-B / ADR-0017 — server-side gate execution history. POST runs the
  // same deterministic engine `pr-summary` uses (analyzeDiff +
  // evaluateDiffPolicy), persists verdict + materialized routes + masked
  // payload through the single store seam (saveGateRun also writes the
  // `gate.run` event). A git/engine failure follows the ticket-14 contract
  // (400 `{error: 人话首行, detail: 原始输出}`) AND still lands as a FAIL row
  // with `error` set — the history must show runs that broke; a policy FAIL
  // without `error` is a normal verdict row. GET replays newest-first with
  // /api-events-style paging. Commit stream = live resolveRepoCommitSync
  // (hash / hash+dirty / unversioned; dirty runs isolate per Q12).
  app.post('/api/repos/:id/gate/run', asyncHandler(async (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const base = typeof body.base === 'string' ? body.base.trim() : '';
    const head = typeof body.head === 'string' ? body.head.trim() : '';
    if (!base || !head) {
      res.status(400).json({ error: 'base and head git refs are required', code: 'git_refs_required' });
      return;
    }
    // 收口 review P1-2（同 architecture-delta）：选项注入面在落库前挡下，
    // 校验失败不落 error 历史行、不触票 14 语义。
    if (/^-/.test(base) || /^-/.test(head)) {
      res.status(400).json({ error: 'git refs must not start with "-"', code: 'git_ref_invalid' });
      return;
    }
    const options: GateRunPolicyOptions = {};
    if (body.maxAffectedRoutes !== undefined) {
      if (
        typeof body.maxAffectedRoutes !== 'number' ||
        !Number.isInteger(body.maxAffectedRoutes) ||
        body.maxAffectedRoutes < 0
      ) {
        res.status(400).json({ error: 'maxAffectedRoutes must be a non-negative integer', code: 'policy_option_invalid' });
        return;
      }
      options.maxAffectedRoutes = body.maxAffectedRoutes;
    }
    if (typeof body.failOnBreak === 'boolean') options.failOnBreak = body.failOnBreak;
    if (typeof body.failOnAuthImpact === 'boolean') options.failOnAuthImpact = body.failOnAuthImpact;

    const commit = resolveRepoCommitSync(repo.localPath);
    const started = Date.now();
    try {
      const report = await analyzeDiff({ repoPath: repo.localPath, base, head });
      const policy = evaluateDiffPolicy(report, options);
      const impacted = report.architectureDelta?.impactedApis ?? [];
      // Key = displayPath#Controller.method: displayPath alone carries neither
      // verb nor controller (GET+POST on one path collide → silent dedup), so
      // the materialized line must identify the API (dual-axis review #1).
      const routes: GateRunRouteRow[] = impacted.map((api) => ({
        route: `${api.routeSymbol.displayPath ?? ''}#${api.routeSymbol.parentType ?? ''}.${api.routeSymbol.name}`,
        displayPath: api.routeSymbol.displayPath ?? null,
        riskLevel: api.riskLevel ?? null
      }));
      const payload = maskEventPayload({
        summary: report.summary,
        affectedRoutes: report.affectedApis.length,
        violations: policy.violations,
        impactedApis: impacted
      });
      // Echo the STORED row by runId — never "latest of the stream" (two
      // concurrent runs would make an echo steal another request's verdict;
      // dual-axis review #2a).
      const { runId } = deps.repoqa.saveGateRun({
        repoId: repo.id,
        commit,
        base,
        head,
        options,
        status: policy.status,
        violationsCount: policy.violations.length,
        routes,
        durationMs: Date.now() - started,
        payload
      });
      const { runs } = deps.repoqa.listGateRuns(repo.id, { limit: 1, id: runId });
      res.status(201).json({ run: runs[0] ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const line = summarizeGitError(message);
      // The history write must never eat the ticket-14 response: a repo
      // deleted mid-analyze makes this INSERT throw on FK, and Express 4
      // would hang the request (dual-axis review #2c). error/detail are
      // masked on the way in — every persisted text column obeys the same
      // masking invariant as payload (#4); the 400 body stays raw per the
      // ticket-14 contract.
      try {
        deps.repoqa.saveGateRun({
          repoId: repo.id,
          commit,
          base,
          head,
          options,
          status: 'FAIL',
          violationsCount: 0,
          routes: [],
          error: maskSensitiveText(line),
          detail: maskSensitiveText(message),
          durationMs: Date.now() - started
        });
      } catch {
        // history unavailable — the verdict response still stands
      }
      res.status(400).json({ error: line, detail: message, code: 'git_command_failed' });
    }
  }));

  app.get('/api/repos/:id/gate-runs', (req, res) => {
    const repo = requireRepo(deps, res, req.params.id);
    if (!repo) return;
    const query = req.query as Record<string, unknown>;
    const asString = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
    const asNumber = (value: unknown): number | undefined => {
      if (typeof value !== 'string' || value.trim() === '') return undefined;
      const parsed = Number(value);
      // v0.26-B ticket 02 review：只认整数——小数交给 SQLite 隐式截断太含糊，
      // 非法值按容错契约回退默认分页（与 subgraph-context 的整数校验精神一致）。
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
    };
    res.json(
      deps.repoqa.listGateRuns(repo.id, {
        limit: asNumber(query.limit),
        offset: asNumber(query.offset),
        commit: asString(query.commit)
      })
    );
  });
}
