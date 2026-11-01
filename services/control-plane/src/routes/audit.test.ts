/**
 * 票 04 — MCP 审计读数端点：聚合形状 / fail-soft 空态 / 读侧掩码 / 轮转代时序。
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readMcpAuditEntries, registerAuditRoutes, summarizeMcpAudit } from './audit';
import type { HttpDeps } from './deps';

function line(fields: Record<string, unknown>): string {
  return (
    JSON.stringify({
      ts: '2026-11-01T03:00:00.000Z',
      level: 'info',
      scope: 'mcp',
      msg: 'tool_call',
      ...fields
    }) + '\n'
  );
}

describe('summarizeMcpAudit (pure aggregation)', () => {
  const entries = readMcpAuditEntries('nonexistent-dir-does-not-exist').entries;

  it('returns zeroed aggregates for empty input', () => {
    const summary = summarizeMcpAudit(0, [], 10);
    expect(summary.logsPresent).toBe(false);
    expect(summary.totals.calls).toBe(0);
    expect(summary.totals.okRate).toBeNull();
    expect(summary.byTool).toEqual([]);
    expect(entries).toEqual([]);
  });

  it('aggregates per-tool rates and latency percentiles, recents newest-first', () => {
    const base = [
      { ts: '2026-11-01T03:00:01Z', tool: 'codecompass_scan', ok: true, durationMs: 100 },
      { ts: '2026-11-01T03:00:02Z', tool: 'codecompass_scan', ok: true, durationMs: 300 },
      { ts: '2026-11-01T03:00:03Z', tool: 'codecompass_scan', ok: false, durationMs: 50, error: 'Repo not found: r1' },
      { ts: '2026-11-01T03:00:04Z', tool: 'codecompass_list_repos', ok: true, durationMs: 10 }
    ];
    const summary = summarizeMcpAudit(1, base, 10);
    expect(summary.totals).toEqual({ calls: 4, ok: 3, failed: 1, okRate: 0.75 });
    const scan = summary.byTool.find((t) => t.tool === 'codecompass_scan');
    expect(scan).toMatchObject({ calls: 3, ok: 2, failed: 1, okRate: 2 / 3, p50Ms: 100, p95Ms: 300 });
    // 列表类按调用量排序在前；均量并列时按名称稳定排序。
    expect(summary.byTool[0].tool).toBe('codecompass_scan');
    expect(summary.recentCalls[0].tool).toBe('codecompass_list_repos');
    expect(summary.recentFailures).toEqual([
      { ts: '2026-11-01T03:00:03Z', tool: 'codecompass_scan', error: 'Repo not found: r1' }
    ]);
  });
});

describe('GET /api/audit/mcp/summary', () => {
  let baseUrl = '';
  let server: http.Server;
  let dataDir = '';

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repoqa-audit-'));
    const logsDir = path.join(dataDir, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    // 轮转代 .1（更早）→ 当前代（更晚）：读序必须产出时间序。
    fs.writeFileSync(
      path.join(logsDir, 'control-plane-20261101.jsonl.1'),
      line({ ts: '2026-11-01T01:00:00Z', tool: 'codecompass_trace_call_chain', ok: true, durationMs: 40, repoId: 'r1' })
    );
    fs.writeFileSync(
      path.join(logsDir, 'control-plane-20261101.jsonl'),
      [
        line({ ts: '2026-11-01T02:00:00Z', tool: 'codecompass_scan', ok: true, durationMs: 120, repoId: 'r1' }),
        // 非 mcp scope / 非 tool_call 行必须被滤掉。
        JSON.stringify({ ts: '2026-11-01T02:00:01Z', level: 'info', scope: 'http', msg: 'request' }) + '\n',
        line({ ts: '2026-11-01T02:00:02Z', tool: 'codecompass_trace_call_chain', ok: false, durationMs: 60, repoId: 'r1', error: 'boom with ' + 'AKIA' + 'A'.repeat(16) })
      ].join('')
    );

    const app = express();
    registerAuditRoutes(app, { dataDir } as unknown as HttpDeps);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('aggregates across rotation generations in chronological order', async () => {
    const res = await fetch(`${baseUrl}/api/audit/mcp/summary`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      logsPresent: boolean;
      window: { files: number };
      totals: { calls: number };
      recentCalls: Array<{ ts: string; tool: string }>;
    };
    expect(body.logsPresent).toBe(true);
    expect(body.window.files).toBe(2);
    expect(body.totals.calls).toBe(3);
    // 最新在先：base 文件末行的失败 trace(02:00:02) 最先，轮转代的 trace(01:00) 最后。
    expect(body.recentCalls[0]).toMatchObject({ ts: '2026-11-01T02:00:02Z' });
    expect(body.recentCalls.at(-1)).toMatchObject({ ts: '2026-11-01T01:00:00Z' });
  });

  it('masks failure samples on egress (read-side double cover)', async () => {
    const res = await fetch(`${baseUrl}/api/audit/mcp/summary`);
    const text = await res.text();
    expect(text.includes('AKIA' + 'A'.repeat(16))).toBe(false);
    const body = JSON.parse(text) as { recentFailures: Array<{ error: string }> };
    expect(body.recentFailures).toHaveLength(1);
    expect(body.recentFailures[0].error).toContain('boom');
  });

  it('clamps the limit parameter for the recent stream', async () => {
    const res = await fetch(`${baseUrl}/api/audit/mcp/summary?limit=2`);
    const body = (await res.json()) as { recentCalls: unknown[] };
    expect(body.recentCalls).toHaveLength(2);
  });

  it('answers with an empty summary (not 404) when no logs exist', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repoqa-audit-empty-'));
    try {
      const app = express();
      registerAuditRoutes(app, { dataDir: emptyDir } as unknown as HttpDeps);
      const tmpServer = http.createServer(app);
      await new Promise<void>((resolve) => tmpServer.listen(0, '127.0.0.1', resolve));
      const url = `http://127.0.0.1:${(tmpServer.address() as AddressInfo).port}`;
      const res = await fetch(`${url}/api/audit/mcp/summary`);
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { logsPresent: boolean; totals: { calls: number } };
      expect(body.logsPresent).toBe(false);
      expect(body.totals.calls).toBe(0);
      await new Promise<void>((resolve) => tmpServer.close(() => resolve()));
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
