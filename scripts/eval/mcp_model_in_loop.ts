/**
 * Issue 16 (评估维 E-M5 自愈率 / E-M2 误调率前向基线) — 模型在环一轮实验。
 *
 *   node --max-old-space-size=4096 services/control-plane/node_modules/tsx/dist/cli.mjs \
 *     scripts/eval/mcp_model_in_loop.ts [--repo <path>] [--data-dir <dir>] [--budget 20]
 *
 * 为什么必须模型在环：仓内 `npm run eval` 走 `scripts/smoke/stub-llm.mjs`（零 token），
 * 产不出「模型遇错后自愈成功率」与「误调率」这两个数字。本脚本用 `.env` 里已配置的
 * `REPOQA_LLM_MODEL`（native tool calling，即宿主真实用法）。
 *
 * 口径（先写清楚，防事后倒推）：
 *  - **E-M5 本轮可到 3 分**：产出「模型读错误载荷后修正成功」的比例。
 *  - **E-M2 只到前向基线**：单轮测出误调率，**没有"下降"**（未做描述迭代）→ 报告如实标注仍记 2 分。
 *  - 调用上限默认 20 次；超限即中止（不静默多花 token）。
 *  - 不产生仓库副作用：工具选择任务**只取模型的调用意图，不真跑**；自愈场景只跑只读工具。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { MCP_TOOLS } from '../../services/control-plane/src/mcp/repoqa-mcp';
import {
  completeNativeChat,
  isLlmConfigured,
  loadLlmEnv,
  readDotEnvFile,
  type NativeToolSpec
} from '../../services/control-plane/src/engine/repoqa-llm';

const argv = process.argv.slice(2);
const argOf = (name: string, fallback: string): string => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const repoPath = path.resolve(argOf('repo', '.'));
const dataDir = path.resolve(argOf('data-dir', path.join(process.env.TMPDIR ?? '/tmp', `cc-model-probe-${Date.now()}`)));
// Mimosa 选项注入提示的加固：这两个值会作为 CLI 参数传给子进程，若以 '-' 开头会被
// 我们自己的 CLI 当成选项解析。它们是操作者本机路径（非不可信输入），但仍 fail-fast。
for (const [label, value] of [['--repo', repoPath], ['--data-dir', dataDir]] as const) {
  if (path.isAbsolute(value) === false || value.split(path.sep).some((segment) => segment.startsWith('-'))) {
    throw new Error(`${label} 含以 '-' 开头的路径段，会与 CLI 选项混淆（请改用不含 '-' 段前缀的绝对路径）：${value}`);
  }
}
const callBudget = Number(argOf('budget', '20'));
const cli = path.resolve('services/control-plane/dist/cli.js');

// ------------------------------------------------------------------ MCP session
interface McpCallResult {
  text: string;
  isError: boolean;
  rpcError?: string;
}

function startSession() {
  const proc = spawn(process.execPath, [cli, 'mcp', repoPath, '--data-dir', dataDir], {
    stdio: ['pipe', 'pipe', 'ignore']
  });
  const pending = new Map<number, (message: any) => void>();
  let buffer = '';
  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        const resolver = message.id !== undefined ? pending.get(message.id) : undefined;
        if (resolver) {
          pending.delete(message.id);
          resolver(message);
        }
      } catch {
        /* non-protocol line */
      }
    }
  });
  let id = 1;
  const request = (method: string, params?: unknown): Promise<any> =>
    new Promise((resolve, reject) => {
      const requestId = id++;
      pending.set(requestId, resolve);
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
      setTimeout(() => reject(new Error(`${method} timed out`)), 180_000).unref?.();
    });
  const notify = (method: string) => proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { proc, request, notify };
}

async function main(): Promise<void> {
  const env = { ...readDotEnvFile(), ...process.env } as NodeJS.ProcessEnv;
  if (!isLlmConfigured(env)) {
    console.error('[model-probe] REPOQA_LLM_* is not configured — refusing to fabricate numbers.');
    process.exitCode = 1;
    return;
  }
  const llm = loadLlmEnv(env);
  let calls = 0;
  const askModel = async (messages: Array<{ role: string; content: string }>) => {
    if (calls >= callBudget) throw new Error(`call budget ${callBudget} exhausted`);
    calls += 1;
    return completeNativeChat(messages as never, env, nativeTools);
  };

  const nativeTools: NativeToolSpec[] = MCP_TOOLS.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as unknown as Record<string, unknown>
    }
  }));

  const session = startSession();
  try {
    await session.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'model-probe', version: '0' }
    });
    session.notify('notifications/initialized');
    const repos = await session.request('tools/call', { name: 'codecompass_list_repos', arguments: {} });
    const list = JSON.parse(repos.result.content[0].text).repos as Array<{ id: string; localPath: string; status: string }>;
    const repo = list.find((entry) => path.resolve(entry.localPath) === repoPath) ?? list[0];
    if (!repo) throw new Error('no indexed repo available');

    const callTool = async (name: string, args: Record<string, unknown>): Promise<McpCallResult> => {
      const response = await session.request('tools/call', { name, arguments: args });
      if (response.error) return { text: JSON.stringify(response.error), isError: true, rpcError: String(response.error.message ?? '') };
      const text = response.result?.content?.[0]?.text ?? '';
      return { text, isError: response.result?.isError === true };
    };

    // ---------------------------------------------------- (a) E-M2 误调率前向基线
    const tasks: Array<{ prompt: string; expect: string; requireKeys: string[] }> = [
      { prompt: '列出当前已索引的仓库，我要挑一个开始干活。', expect: 'codecompass_list_repos', requireKeys: [] },
      { prompt: '在这个仓库里我不知道该从哪儿改起，帮我找出值得先看的候选位置。', expect: 'codecompass_scan', requireKeys: ['repoId'] },
      { prompt: '哪些地方调用了 runScan 这个函数？列出调用点。', expect: 'codecompass_reverse_deps', requireKeys: ['repoId', 'symbolOrMethod'] },
      { prompt: '从 mcpScan 这个入口往下，静态调用链长什么样？', expect: 'codecompass_trace_call_chain', requireKeys: ['repoId', 'symbolOrMethod'] },
      { prompt: '某个配置项到底在哪个文件哪一行定义的？（只要位置，不要值）', expect: 'codecompass_get_config_evidence', requireKeys: ['repoId'] },
      { prompt: '给我一条新人上手这个仓库的导览路径。', expect: 'codecompass_get_tours', requireKeys: ['repoId'] },
      { prompt: '我准备给 runScan 换签名，需要知道爆炸半径和风险评级。', expect: 'codecompass_refactor_plan', requireKeys: ['repoId', 'targetSymbol'] },
      { prompt: '要一次性把足够精确又不太长的相关代码上下文喂给我，带 token 上限。', expect: 'codecompass_get_subgraph_context', requireKeys: ['repoId', 'query'] },
      { prompt: '这个仓库的架构热点在哪里？谁被依赖得最多？', expect: 'codecompass_domain_radar', requireKeys: ['repoId'] },
      { prompt: '我要新增一个 handler，这个仓的既有约定是什么？', expect: 'codecompass_get_conventions', requireKeys: ['repoId'] }
    ];
    const toolChoiceRows: Array<Record<string, unknown>> = [];
    for (const task of tasks) {
      let picked = '';
      let args: Record<string, unknown> = {};
      let note = '';
      try {
        const turn = await askModel([
          {
            role: 'system',
            content:
              'You are a coding agent holding CodeCompass MCP tools. Pick the SINGLE best tool for the task and emit it as a tool call with the arguments you would pass. Do not call anything else.'
          },
          { role: 'user', content: task.prompt }
        ]);
        const first = turn.toolCalls[0];
        picked = first?.name ?? '';
        args = first?.args ?? {};
        note = first?.argsError ?? '';
      } catch (error) {
        note = `call failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      const missing = task.requireKeys.filter((key) => args[key] === undefined);
      toolChoiceRows.push({
        task: task.prompt,
        expected: task.expect,
        picked,
        correctTool: picked === task.expect,
        missingRequiredArgs: missing,
        argsOk: missing.length === 0,
        args,
        note
      });
    }

    // ---------------------------------------------------- (b) E-M5 自愈成功率
    const scenarios: Array<{ label: string; wrongName: string; wrongArgs: Record<string, unknown>; goodName: string; goodArgs: Record<string, unknown> }> = [
      { label: 'repoId 不存在', wrongName: 'codecompass_scan', wrongArgs: { repoId: 'no-such-repo' }, goodName: 'codecompass_scan', goodArgs: { repoId: repo.id } },
      { label: 'maxTokens 传成字符串', wrongName: 'codecompass_get_subgraph_context', wrongArgs: { repoId: repo.id, query: 'runScan', maxTokens: '500' }, goodName: 'codecompass_get_subgraph_context', goodArgs: { repoId: repo.id, query: 'runScan', maxTokens: 500 } },
      { label: 'maxTokens 超出上限', wrongName: 'codecompass_get_subgraph_context', wrongArgs: { repoId: repo.id, query: 'runScan', maxTokens: 200000 }, goodName: 'codecompass_get_subgraph_context', goodArgs: { repoId: repo.id, query: 'runScan', maxTokens: 6000 } },
      { label: '缺少必填 symbolOrMethod', wrongName: 'codecompass_reverse_deps', wrongArgs: { repoId: repo.id }, goodName: 'codecompass_reverse_deps', goodArgs: { repoId: repo.id, symbolOrMethod: 'runScan' } },
      { label: '工具名拼错', wrongName: 'codecompass_scan_repo', wrongArgs: { repoId: repo.id }, goodName: 'codecompass_scan', goodArgs: { repoId: repo.id } },
      { label: 'repoId 用了仓库名而非 id', wrongName: 'codecompass_get_tours', wrongArgs: { repoId: 'CodeCompass' }, goodName: 'codecompass_get_tours', goodArgs: { repoId: repo.id } },
      { label: '删除不存在的仓库', wrongName: 'codecompass_remove_repo', wrongArgs: { repoId: 'ghost-repo' }, goodName: 'codecompass_list_repos', goodArgs: {} },
      { label: 'trace 起点不存在', wrongName: 'codecompass_trace_call_chain', wrongArgs: { repoId: repo.id, symbolOrMethod: 'definitelyNotASymbol' }, goodName: 'codecompass_trace_call_chain', goodArgs: { repoId: repo.id, symbolOrMethod: 'runScan' } },
      { label: 'refactorPlan 缺 targetSymbol', wrongName: 'codecompass_refactor_plan', wrongArgs: { repoId: repo.id, changeType: 'SIGNATURE_CHANGE' }, goodName: 'codecompass_refactor_plan', goodArgs: { repoId: repo.id, targetSymbol: 'runScan', changeType: 'SIGNATURE_CHANGE' } },
      { label: 'diagnose 入口不存在', wrongName: 'codecompass_diagnose', wrongArgs: { repoId: repo.id, entrySymbol: 'notAnEntry' }, goodName: 'codecompass_diagnose', goodArgs: { repoId: repo.id, entrySymbol: 'mcpScan' } }
    ];
    const selfHealRows: Array<Record<string, unknown>> = [];
    for (const scenario of scenarios) {
      const failed = await callTool(scenario.wrongName, scenario.wrongArgs);
      // 权威判定：以 MCP 的 isError（或 JSON-RPC error）为准，不用文本启发式。
      // 2026-09-21 实测教训：初版把"首次调用没报错"的场景也算作可自愈，
      // 于是 10/10 里混进了 3 个根本没失败的场景（如 repoId 传仓库名被名称解析接受、
      // trace/diagnose 对陌生符号仍返回载荷）。
      const initialFailed = failed.isError || Boolean(failed.rpcError);
      let retried = '';
      let retryArgs: Record<string, unknown> = {};
      let ok = false;
      let note = initialFailed ? '' : '场景无效：首次调用未报错，不计入自愈率';
      if (initialFailed) {
        try {
          const turn = await askModel([
            {
              role: 'system',
              content:
                'You are a coding agent. A CodeCompass MCP tool call just failed. Read the error payload and emit ONE corrected tool call that fixes it. If the original tool name does not exist, pick the right tool.'
            },
            {
              role: 'user',
              content: `Original call: ${scenario.wrongName} ${JSON.stringify(scenario.wrongArgs)}\nError payload: ${failed.text.slice(0, 1200)}`
            }
          ]);
          const first = turn.toolCalls[0];
          retried = first?.name ?? '';
          retryArgs = first?.args ?? {};
          if (first?.argsError) note = first.argsError;
        } catch (error) {
          note = `call failed: ${error instanceof Error ? error.message : String(error)}`;
        }
        if (retried) {
          const outcome = await callTool(retried, retryArgs);
          ok = !outcome.isError;
        }
      }
      selfHealRows.push({
        scenario: scenario.label,
        initialFailed,
        firstError: failed.text.slice(0, 160),
        retriedTool: retried,
        retriedArgs: retryArgs,
        recovered: ok,
        note
      });
    }

    const toolCorrect = toolChoiceRows.filter((row) => row.correctTool === true).length;
    const argsOk = toolChoiceRows.filter((row) => row.argsOk === true).length;
    // 自愈率只在"真的失败过"的场景上计算（invalid 场景单列，不参与分母）
    const genuine = selfHealRows.filter((row) => row.initialFailed === true);
    const invalidScenarios = selfHealRows.length - genuine.length;
    const recovered = genuine.filter((row) => row.recovered === true).length;

    // 先落盘原始记录，再渲染汇总：展示层的任何错误都不该毁掉已经花掉的实验数据
    // （2026-09-21 实测教训：初版在汇总处有个变量名笔误，20 次调用后的结果整批丢失）。
    const outFile = path.join(process.cwd(), 'scripts/out', 'mcp-model-in-the-loop.json');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(
      outFile,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          model: llm.model,
          repo: { id: repo.id, path: repo.localPath },
          callsUsed: calls,
          callBudget,
          toolChoiceRows,
          selfHealRows
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    console.log(`# 模型在环一轮实验（model=${llm.model}，调用 ${calls}/${callBudget}）\n`);
    console.log('## E-M2 误调率（前向基线）\n');
    console.log('| 指标 | 值 |');
    console.log('|---|---|');
    console.log(`| 工具选择正确 | ${toolCorrect}/${toolChoiceRows.length} |`);
    console.log(`| **误调率** | **${(100 * (1 - toolCorrect / toolChoiceRows.length)).toFixed(1)}%** |`);
    console.log(`| 参数键集正确 | ${argsOk}/${toolChoiceRows.length} |\n`);
    console.log('## E-M5 自愈成功率\n');
    console.log('| 指标 | 值 |');
    console.log('|---|---|');
    console.log(`| 真失败场景 | ${genuine.length}（另有 ${invalidScenarios} 个场景首次调用未报错，已剔除不计入） |`);
    console.log(`| 修正后成功 | ${recovered}/${genuine.length} |`);
    console.log(`| **自愈成功率** | **${genuine.length ? (100 * (recovered / genuine.length)).toFixed(1) : '—'}%** |\n`);
    console.log('| 场景 | 真失败 | 首次错误 | 模型重试 | 恢复 |');
    console.log('|---|---|---|---|---|');
    for (const row of selfHealRows) {
      console.log(
        `| ${row.scenario} | ${row.initialFailed ? '是' : '否'} | ${String(row.firstError).replace(/\|/g, '\\|').slice(0, 60)} | ${row.retriedTool || '—'} | ${row.initialFailed ? (row.recovered ? '✅' : '❌') : '—'} |`
      );
    }
    console.log(`\n原始记录：${outFile}`);
  } finally {
    session.proc.stdin.end();
    setTimeout(() => session.proc.kill(), 500).unref?.();
  }
}

main().catch((error) => {
  console.error(`[model-probe] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
