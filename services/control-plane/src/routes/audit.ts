import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { asyncHandler } from '../http-error';
import { maskSensitiveText } from '../engine/repoqa-masking';
import type { HttpDeps } from './deps';

/**
 * 票 04 — Audit-driven cockpit: MCP tool_call 审计读数端点。
 *
 * ServerLogger 已把每次 MCP 工具调用落成 `logs/control-plane-<date>.jsonl`
 * 里的一行（scope='mcp', msg='tool_call', 字段 tool/repoId/durationMs/ok/
 * argsBytes/resultBytes/error——见 mcp/repoqa-mcp.ts 的 audit 钩子）。本端点
 * 把这份已落盘的日志聚合成驾驶舱可消费的读数，让维护者第一次看见 agent
 * 与引擎交互的真实形态（ADR-0021 dogfooding；数据零新增采集）。
 *
 * R1 不变量延伸到读出面：所有回显字符串再过一次 maskSensitiveText（写侧
 * 已掩码，读侧双保险与 snippet/export 同尺）。日志目录不存在或读文件失败
 * 一律 fail-soft 返回空聚合（非 404/500）——空态本身是合法读数「还没有
 * agent 活动」。
 */

export interface McpAuditEntry {
  ts: string;
  tool: string;
  repoId?: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface McpAuditSummary {
  /** 日志面是否存在（false = 该 dataDir 还没有任何控制面日志）。 */
  logsPresent: boolean;
  window: { files: number; sinceTs: string | null };
  totals: { calls: number; ok: number; failed: number; okRate: number | null };
  byTool: Array<{
    tool: string;
    calls: number;
    ok: number;
    failed: number;
    okRate: number;
    p50Ms: number;
    p95Ms: number;
  }>;
  recentFailures: Array<{ ts: string; tool: string; repoId?: string; error: string }>;
  recentCalls: Array<{ ts: string; tool: string; repoId?: string; ok: boolean; durationMs: number }>;
}

const FILE_RE = /^control-plane-(\d{8})\.jsonl(\.\d+)?$/;
const MAX_DAYS = 3;
const MAX_FAILURE_SAMPLES = 50;

/** 日期 + 轮转代序：日期新在前；同日内从最老代（.5）读到当前代，产出时间序。 */
function auditLogFilesChronological(logsDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(logsDir);
  } catch {
    return [];
  }
  const byDay = new Map<string, string[]>();
  for (const name of names) {
    const match = FILE_RE.exec(name);
    if (!match) continue;
    const list = byDay.get(match[1]) ?? [];
    list.push(name);
    byDay.set(match[1], list);
  }
  const days = [...byDay.keys()].sort().reverse().slice(0, MAX_DAYS);
  const files: string[] = [];
  for (const day of days) {
    const gens = (byDay.get(day) ?? []).sort(
      (a, b) => genOf(a) - genOf(b)
    );
    files.push(...gens.map((name) => path.join(logsDir, name)));
  }
  return files;
}

function genOf(name: string): number {
  const match = FILE_RE.exec(name);
  return match?.[2] ? Number(match[2].slice(1)) : Number.MAX_SAFE_INTEGER;
}

/** 读文件 → 只解析含 `"scope":"mcp"` 的行（廉价预滤）→ tool_call 条目。 */
export function readMcpAuditEntries(logsDir: string): { files: number; entries: McpAuditEntry[] } {
  const fileList = auditLogFilesChronological(logsDir);
  const entries: McpAuditEntry[] = [];
  for (const file of fileList) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.includes('"scope":"mcp"')) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (row.msg !== 'tool_call' || typeof row.tool !== 'string') continue;
      entries.push({
        ts: typeof row.ts === 'string' ? row.ts : '',
        tool: row.tool,
        ...(typeof row.repoId === 'string' ? { repoId: row.repoId } : {}),
        ok: row.ok === true,
        durationMs: typeof row.durationMs === 'number' ? row.durationMs : 0,
        ...(typeof row.error === 'string' && row.error ? { error: row.error } : {})
      });
    }
  }
  return { files: fileList.length, entries };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function summarizeMcpAudit(
  files: number,
  entries: McpAuditEntry[],
  limit: number
): McpAuditSummary {
  const perTool = new Map<string, { ok: number; failed: number; durations: number[] }>();
  let okTotal = 0;
  for (const entry of entries) {
    const bucket = perTool.get(entry.tool) ?? { ok: 0, failed: 0, durations: [] };
    if (entry.ok) {
      bucket.ok += 1;
      okTotal += 1;
    } else {
      bucket.failed += 1;
    }
    bucket.durations.push(entry.durationMs);
    perTool.set(entry.tool, bucket);
  }
  const byTool = [...perTool.entries()]
    .map(([tool, bucket]) => {
      const sorted = [...bucket.durations].sort((a, b) => a - b);
      const calls = bucket.ok + bucket.failed;
      return {
        tool,
        calls,
        ok: bucket.ok,
        failed: bucket.failed,
        okRate: calls === 0 ? 0 : bucket.ok / calls,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95)
      };
    })
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));

  const failures = entries.filter((entry) => !entry.ok);
  const sinceTs = entries.length > 0 ? entries[0].ts : null;
  // R1 双保险（票 04 评审）：整个回显面统一过掩码——identifier 类字段
  // （tool/repoId）正常情况下掩码为 no-op，但契约上「出库即单尺」不留例外。
  const maskFields = (entry: McpAuditEntry) => ({
    ts: entry.ts,
    tool: maskSensitiveText(entry.tool),
    ...(entry.repoId ? { repoId: maskSensitiveText(entry.repoId) } : {})
  });
  const recent = (arr: McpAuditEntry[], n: number) => arr.slice(-n).reverse();
  return {
    logsPresent: files > 0,
    window: { files, sinceTs },
    totals: {
      calls: entries.length,
      ok: okTotal,
      failed: entries.length - okTotal,
      okRate: entries.length === 0 ? null : okTotal / entries.length
    },
    byTool,
    recentFailures: recent(failures, MAX_FAILURE_SAMPLES).map((entry) => ({
      ...maskFields(entry),
      error: maskSensitiveText(entry.error ?? 'unknown error')
    })),
    recentCalls: recent(entries, limit).map((entry) => ({
      ...maskFields(entry),
      ok: entry.ok,
      durationMs: entry.durationMs
    }))
  };
}

export function registerAuditRoutes(app: express.Express, deps: HttpDeps): void {
  app.get(
    '/api/audit/mcp/summary',
    asyncHandler(async (req, res) => {
      const rawLimit = Number(req.query.limit);
      const limit = Number.isInteger(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 500) : 200;
      const logsDir = path.join(deps.dataDir, 'logs');
      const { files, entries } = readMcpAuditEntries(logsDir);
      res.json(summarizeMcpAudit(files, entries, limit));
    })
  );
}
