import readline from 'node:readline/promises';
import { ReActAgent } from './agent.js';
import { InProcessMcpClient } from './client.js';
import type { LlmManager } from './llm.js';
import type { SessionLogger } from './log.js';
import type { McpDeps } from '../repoqa-mcp.js';

const HELP = `commands:
  /tools        list the 17-tool surface
  /model [name] LLM hot-switch (REPOQA_LLM_* / profiles)
  /status       connection + llm health
  /help         this text
  /quit         exit
free text goes through the ReAct编排层（facts from CodeCompass, [cite: N]溯源）.`;

/**
 * `codecompass chat` — terminal REPL over the in-process MCP client
 * (chat-merge Q2: 本地对话客户端形态保留，单一来源).
 */
export async function startChatRepl(mcpDeps: McpDeps, llm: LlmManager, log: SessionLogger): Promise<void> {
  const mcp = new InProcessMcpClient(mcpDeps, log, (line) => console.error(`  [mcp] ${line}`));
  await mcp.connect();
  console.log(`chat: ${mcp.toolCount} tools ready — llm ${llm.configured() ? `(${llm.activeProfileName})` : '未配置（REPOQA_LLM_*）'}`);
  const agent = new ReActAgent({ mcp, llm, log, onDelta: (t) => process.stdout.write(t) });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'chat> ' });
  console.log(HELP);
  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }
    if (input === '/quit' || input === '/exit') break;
    if (input === '/help') console.log(HELP);
    else if (input === '/tools') {
      for (const name of mcp.toolNames) console.log(`  - ${name}`);
    } else if (input === '/status') {
      console.log(`tools=${mcp.toolCount} llm=${llm.configured() ? llm.activeProfileName : '未配置'}`);
    } else if (input === '/model') {
      console.log(`profiles: ${llm.profileNames.join(', ')} — active: ${llm.activeProfileName}`);
      console.log('切换：/model <name>');
    } else if (input.startsWith('/model ')) {
      const name = input.slice(7).trim();
      try {
        llm.switchTo(name);
        log.write('model_switch', { active: name, via: 'repl' });
        console.log(`已切换到 ${name}`);
      } catch (err) {
        console.error(`  ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      try {
        const turn = await agent.runSerialized(input, { onDelta: (t) => process.stdout.write(t) });
        if (turn.citations.length) {
          console.log('\nsources:');
          for (const c of turn.citations) {
            console.log(`  [${c.n}] ${c.tool}(${JSON.stringify(c.args).slice(0, 120)}) — ${c.ms}ms`);
          }
        }
      } catch (err) {
        console.error(`  error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    rl.prompt();
  }
  log.write('chat_repl_end', {});
  await mcp.disconnect();
  process.exit(0);
}
