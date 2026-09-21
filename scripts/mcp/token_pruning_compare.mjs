#!/usr/bin/env node
/**
 * Issue 15 (评估维 E-M4) — token 剪枝开/关对比 + 超限触发实测。
 *
 * 走真实 MCP stdio 会话（不是直调引擎），因为被评估的是**工具输出**的上下文治理：
 *   node scripts/mcp/token_pruning_compare.mjs [--repo <path>] [--query <symbol>] [--data-dir <dir>]
 *
 * 三档预算同 query 各跑一次：
 *   - 默认档 6000（剪枝生效）；
 *   - 上限档 100000（handler 的上限是 1..100000，数据量远小于它 ⇒ 剪枝实际不触发 ≈ 关）；
 *   - 小预算 500（触发超限 → truncated=true）。
 *
 * 实测教训（2026-09-21）：初版用 200000 做"关剪枝"档，结果被 handler 以
 * `maxTokens must be a positive integer (1..100000)` 拒绝，脚本却把这条 48 字符的
 * 错误消息当作"输出"，算出 -60808% 的荒谬节省。现在被拒调用会单列并标注，
 * 绝不参与节省计算。
 *
 * token 口径与代码同源：engine/repoqa-graphrag.ts 用 `maxChars = maxTokens * 4`，
 * 因此本脚本按 chars/4 估算并**在报告里标注这是估算**（不是真实 tokenizer）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const repoPath = path.resolve(argOf('repo', '.'));
const query = argOf('query', 'runScan');
const dataDir = path.resolve(argOf('data-dir', path.join(process.env.TMPDIR ?? '/tmp', `cc-token-compare-${Date.now()}`)));
// 加固（Mimosa 选项注入提示）：这两个值作为 CLI 参数传给子进程，若含以 '-' 开头的
// 路径段会被我们自己的 CLI 当成选项解析 —— 操作者本机路径，仍 fail-fast。
for (const [label, value] of [['--repo', repoPath], ['--data-dir', dataDir]]) {
  if (!path.isAbsolute(value) || value.split(path.sep).some((segment) => segment.startsWith('-'))) {
    throw new Error(`${label} 含以 '-' 开头的路径段，会与 CLI 选项混淆：${value}`);
  }
}
const cli = path.resolve('services/control-plane/dist/cli.js');
const BUDGETS = [6000, 100000, 500];

/** 深度查找某字段（剪枝字段嵌在载荷深处，层级不是契约面）。 */
function findField(value, key, path = '') {
  if (value === null || typeof value !== 'object') return undefined;
  for (const [childKey, childValue] of Object.entries(value)) {
    const childPath = path ? `${path}.${childKey}` : childKey;
    if (childKey === key) return { path: childPath, value: childValue };
    const nested = findField(childValue, key, childPath);
    if (nested) return nested;
  }
  return undefined;
}

function session() {
  const proc = spawn(process.execPath, [cli, 'mcp', repoPath, '--data-dir', dataDir], {
    stdio: ['pipe', 'pipe', 'ignore']
  });
  const pending = new Map();
  let buffer = '';
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message);
          pending.delete(message.id);
        }
      } catch {
        /* non-protocol line */
      }
    }
  });
  let id = 1;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const requestId = id++;
      pending.set(requestId, resolve);
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
      setTimeout(() => reject(new Error(`${method} timed out`)), 120_000).unref?.();
    });
  const notify = (method) => proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { proc, request, notify };
}

const { proc, request, notify } = session();
const rows = [];
try {
  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'token-compare', version: '0' }
  });
  notify('notifications/initialized');
  const repos = await request('tools/call', { name: 'codecompass_list_repos', arguments: {} });
  const list = JSON.parse(repos.result.content[0].text).repos;
  const repo = list.find((entry) => path.resolve(entry.localPath) === repoPath) ?? list[0];
  if (!repo) throw new Error('no indexed repo in this data dir');
  if (repo.status !== 'ready') throw new Error(`repo ${repo.id} status=${repo.status}`);

  for (const budget of BUDGETS) {
    const started = Date.now();
    const call = await request('tools/call', {
      name: 'codecompass_get_subgraph_context',
      arguments: { repoId: repo.id, query, maxTokens: budget }
    });
    const text = call.result?.content?.[0]?.text ?? '';
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    const rejected = call.result?.isError === true || payload === null;
    rows.push({
      budget,
      elapsedMs: Date.now() - started,
      chars: text.length,
      estTokens: Math.ceil(text.length / 4),
      prunedCount: payload ? findField(payload, 'prunedCount') : undefined,
      truncated: payload ? findField(payload, 'truncated') : undefined,
      rejected,
      note: rejected ? text.slice(0, 80) : undefined
    });
  }
} finally {
  proc.stdin.end();
  setTimeout(() => proc.kill(), 500).unref?.();
}

const defaultRow = rows[0];
const wideRow = rows[1];
const tightRow = rows[2];
console.log(`# token 剪枝对比（query=\`${query}\`，repo=\`${repoPath}\`）\n`);
console.log('| 预算 maxTokens | 输出字符 | 估算 token（chars/4） | prunedCount | truncated | 耗时 ms | 备注 |');
console.log('|---|---|---|---|---|---|---|');
for (const row of rows) {
  const cell = (entry) => (row.rejected || !entry ? '—' : `${entry.value} @${entry.path}`);
  console.log(
    `| ${row.budget} | ${row.chars} | ${row.estTokens} | ${cell(row.prunedCount)} | ${cell(row.truncated)} | ${row.elapsedMs} | ${row.note ?? ''} |`
  );
}
console.log('');
const usable = rows.filter((row) => !row.rejected);
if (usable.length < rows.length) {
  console.log(`- **被拒档位**：${rows.filter((r) => r.rejected).map((r) => r.budget).join(', ')} —— 拒绝消息见备注列，不参与任何节省计算。\n`);
}
if (wideRow && defaultRow && !wideRow.rejected && !defaultRow.rejected) {
  const saved = wideRow.estTokens - defaultRow.estTokens;
  const pct = wideRow.estTokens ? ((saved / wideRow.estTokens) * 100).toFixed(1) : '—';
  console.log(`- 剪枝节省：默认档比上限档少 **${saved}** 估算 token（${pct}%）。`);
  if (saved <= 0) console.log('  ⚠ 本 query 上默认档没有触发剪枝——**不得**用它声称"剪枝有效"，请换更大 query/repo 重跑。');
}
if (tightRow && !tightRow.rejected) {
  const truncatedValue = tightRow.truncated?.value;
  console.log(`- 超限触发：小预算档 truncated=${truncatedValue}（要求 true）。`);
}
console.log(`\n口径：token 为 chars/4 估算（与 engine/repoqa-graphrag.ts 同一口径），非真实 tokenizer。审计日志：${dataDir}/logs/`);
