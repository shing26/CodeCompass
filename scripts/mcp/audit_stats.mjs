#!/usr/bin/env node
/**
 * Issue 12 (评估维 E-M12) — MCP 调用统计。
 *
 * Reads the audit rows written by the MCP chokepoint (`scope:'mcp'`,
 * `msg:'tool_call'`) and derives the 3-point-tier evidence the scoring standard
 * asks for: 成功率 / 耗时分布 / 错误分布, per tool.
 *
 *   node scripts/mcp/audit_stats.mjs [dataDir] [--json]
 *
 * dataDir defaults to $MHW_DATA_DIR or ~/.mhw. Zero dependencies on purpose —
 * this must run on a bare checkout next to a fresh log file.
 *
 * Boundary (recorded in docs/adr/0019): calls rejected by the SDK's input
 * validation never reach the handler, so they are not in these numbers —
 * the success rate here is over EXECUTED calls.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const dataDir = args.find((arg) => !arg.startsWith('--')) ?? process.env.MHW_DATA_DIR ?? path.join(os.homedir(), '.mhw');
const logDir = path.join(dataDir, 'logs');

function readAuditRows(dir) {
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (row.scope === 'mcp' && row.msg === 'tool_call') rows.push(row);
      } catch {
        // A torn last line (process killed mid-append) must not kill the report.
      }
    }
  }
  return rows;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

const rows = readAuditRows(logDir);
const durations = rows.map((row) => Number(row.durationMs) || 0).sort((a, b) => a - b);
const ok = rows.filter((row) => row.ok === true).length;
const failed = rows.length - ok;

const byTool = new Map();
for (const row of rows) {
  const entry = byTool.get(row.tool) ?? { tool: row.tool, calls: 0, failed: 0, durations: [] };
  entry.calls += 1;
  if (row.ok !== true) entry.failed += 1;
  entry.durations.push(Number(row.durationMs) || 0);
  byTool.set(row.tool, entry);
}

const errors = new Map();
for (const row of rows) {
  if (row.ok === true) continue;
  const key = String(row.error ?? 'unknown').slice(0, 80);
  errors.set(key, (errors.get(key) ?? 0) + 1);
}

const summary = {
  dataDir,
  logDir,
  calls: rows.length,
  ok,
  failed,
  successRate: rows.length ? Number((ok / rows.length).toFixed(4)) : null,
  durationMs: {
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    max: durations.length ? durations[durations.length - 1] : 0
  },
  errors: [...errors.entries()].map(([error, count]) => ({ error, count })).sort((a, b) => b.count - a.count),
  tools: [...byTool.values()]
    .map((entry) => ({
      tool: entry.tool,
      calls: entry.calls,
      failed: entry.failed,
      p50: percentile(entry.durations.sort((a, b) => a - b), 50),
      p95: percentile(entry.durations, 95)
    }))
    .sort((a, b) => b.calls - a.calls)
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (rows.length === 0) {
  console.log(`# MCP 调用统计\n\n未找到审计行（${logDir}）。先跑一次 MCP 会话（\`codecompass mcp <path>\`）再看。`);
  process.exit(0);
}

console.log('# MCP 调用统计（评估维 E-M12）\n');
console.log(`数据目录：\`${dataDir}\`　样本：**${summary.calls}** 次调用（口径：已进入 handler 的调用）\n`);
console.log('| 指标 | 值 |');
console.log('|---|---|');
console.log(`| 成功率 | **${(summary.successRate * 100).toFixed(1)}%**（${summary.ok}/${summary.calls}） |`);
console.log(`| 耗时 P50 / P95 / max | ${summary.durationMs.p50} ms / ${summary.durationMs.p95} ms / ${summary.durationMs.max} ms |`);
console.log(`| 失败调用 | ${summary.failed} |`);
console.log('\n## 错误分布\n');
if (summary.errors.length === 0) {
  console.log('无失败调用。\n');
} else {
  console.log('| 错误 | 次数 |');
  console.log('|---|---|');
  for (const entry of summary.errors) console.log(`| ${entry.error.replace(/\|/g, '\\|')} | ${entry.count} |`);
  console.log('');
}
console.log('## 按工具的调用量 / 耗时\n');
console.log('| 工具 | 调用 | 失败 | P50 | P95 |');
console.log('|---|---|---|---|---|');
for (const entry of summary.tools) console.log(`| ${entry.tool} | ${entry.calls} | ${entry.failed} | ${entry.p50} ms | ${entry.p95} ms |`);
