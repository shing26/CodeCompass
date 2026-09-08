import type { ToolSummary, ToolCallOutcome } from './types.js';
import type { ChatMessage, LlmManager, ToolSpec } from './llm.js';
import { maskSecrets } from './llm.js';
import type { SessionLogger } from './log.js';

/** Proven parameters from CodeCompass repoqa-llm.ts (chat-merge: 抄答案不抄代码). */
const MAX_STEPS = 3;
const TOOL_RESULT_CHAR_CAP = 4_000;
const HISTORY_KEEP = 8;

const SYSTEM_PROMPT = `你是 compass-copilot：以 CodeCompass MCP（17 个确定性工具）为唯一事实源的对话式副驾。

纪律（继承自 CodeCompass ADR，见本仓库 docs/adr/0001）：
1. 事实主张必须来自工具返回，回答中用 [cite: N] 标注——N 是本轮工具调用的序号（第 1 次调用 = [cite: 1]）。
2. 探查未知仓库时优先 codecompass_scan / codecompass_get_dashboard 自荐（scan 只报事实，判断由你给出）。
3. 静态不可见的运行时分支（如"Redis 失败降级 MySQL"）只能标 SUSPECT 并给证据，不得断言。
4. plan_evolution 返回 conventionConflict 或 alternatives 时，原样透出并引导用户带显式 target 重试。
5. 引擎输出（工具 JSON）原样尊重，不虚构字段；结果为空就说空。
6. 演进类工具（codecompass_plan_evolution / module_evolution）只在用户明确要求演进或拆除计划时调用。
   被问"能否删除 / 值不值得改"时：用 scan/diagnose/reverse_deps 的证据做分析判断即可，不要执行演进管线。
   孤儿桶候选（零静态调用者）可能是框架入口（main/@Bean/FeignClient/反射可达）——给 SUSPECT 判断并说明静态分析的盲区，不要断言可删。
7. 你不能真正删除或修改任何代码——引擎是只读的，你也没有写文件的通道。用户要求删除/重构时：
   给基于证据的拆除计划（哪些符号、为什么、如何验证），并说明执行要由人来完成。
   调用演进工具时 targetSymbolOrModule 必须是真实存在的符号或模块名——禁止把桶名（如 orphanedPublic）
   或类别名当 target。批量"删除所有孤儿代码"这类意图：先呈现孤儿桶的 SUSPECT 分析并逐类与用户确认，
   不要对整个桶一次性执行拆除。
8. 全程使用与用户相同的语言回答（中文提问就是中文回答，不要中途切换英文）。
   不要建议用 codecompass_remove_repo 解决"删除代码"问题——它只移除索引条目，与源码无关。
   演进工具的 target 禁止 "*" 或桶名这类通配值。回答里每个包含事实主张的段落都要带 [cite: N]。`;

export interface Citation {
  n: number;
  tool: string;
  args: Record<string, unknown>;
  ms: number;
}

/** CM-04 卡片化 v2：DEPRECATE 拆除清单的结构化卡片（数据来自
 * plan_evolution/module_evolution 的 EvolutionChecklistItem[]，非模型散文）。 */
export interface PlanChecklistItem {
  category: string;
  action: string;
  filePath: string;
  description: string;
}

export interface PlanCard {
  intentType: 'DEPRECATE' | 'EXTEND' | string;
  target: string;
  riskLevel?: string;
  items: PlanChecklistItem[];
}

export interface AgentTurn {
  answer: string;
  citations: Citation[];
  steps: number;
  fallback: boolean;
  planCards?: PlanCard[];
}

/** Structural surfaces so tests can stub without spawning processes. The
 * engine-side direct implementation satisfies this in-process (chat-merge Q3:
 * 进程内直调——McpLike 边界留在接口上，不留在线上）. */
export interface McpLike {
  connected: boolean;
  /** Engine port: the repoId bound to the chat session (was a local path in
   * the standalone copilot). */
  currentRepo: string;
  toolsDetail: readonly ToolSummary[];
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallOutcome>;
}

export interface AgentDeps {
  mcp: McpLike;
  llm: LlmManager;
  log: SessionLogger;
  onDelta: (text: string) => void;
  /** Test seam — injects a scripted fetch; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class ReActAgent {
  private history: ChatMessage[] = [];
  private sessionRepoId = '';
  private inFlight: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: AgentDeps) {}

  reset(): void {
    this.history = [];
  }

  /** QA-03: session repo identity — lets 「这个仓库」resolve without guessing. */
  setSessionRepo(repoId: string): void {
    this.sessionRepoId = repoId;
  }

  /** M4 增量 2（多轮上下文）：hydrate persisted history before a turn. */
  seedHistory(messages: readonly ChatMessage[]): void {
    this.history = [...messages.slice(-HISTORY_KEEP)];
  }

  /** QA-04: serialize turns per agent — a second message queued to the same
   * session waits for the in-flight one instead of interleaving history. */
  runSerialized(
    intent: string,
    opts: { onDelta?: (text: string) => void; onRegenerate?: () => void } = {},
  ): Promise<AgentTurn> {
    const next = this.inFlight.then(() => this.run(intent, opts));
    this.inFlight = next.catch(() => undefined);
    return next;
  }

  async run(
    intent: string,
    opts: { onDelta?: (text: string) => void; onRegenerate?: () => void } = {},
  ): Promise<AgentTurn> {
    if (!this.deps.llm.configured()) return this.fallback(intent);
    const tools = this.deps.mcp.connected ? toToolSpecs(this.deps.mcp.toolsDetail) : [];
    const onDelta = opts.onDelta ?? this.deps.onDelta;
    // QA-03: the session's repo is part of the standing context so 「这个仓库」
    // and follow-ups resolve against the right codebase without re-guessing.
    const systemLine = this.sessionRepoId
      ? `${SYSTEM_PROMPT}\n当前会话连接的仓库 ID：${this.sessionRepoId}（用户说「这个仓库/当前仓库」即指它）。`
      : SYSTEM_PROMPT;
    const messages: ChatMessage[] = [
      { role: 'system', content: systemLine },
      ...this.historyWindow(),
      { role: 'user', content: intent },
    ];
    const citations: Citation[] = [];
    const planCards: PlanCard[] = [];
    let n = 0;
    let steps = 0;
    let answer = '';

    while (steps < MAX_STEPS) {
      steps++;
      const res = await this.deps.llm.chat(
        messages,
        {
          tools: this.deps.mcp.connected ? tools : undefined,
          onDelta,
        },
        this.deps.fetchImpl,
      );
      answer = res.content;
      if (!res.toolCalls.length) break;

      messages.push({
        role: 'assistant',
        content: res.content,
        tool_calls: res.toolCalls,
      });
      for (const tc of res.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
        } catch {
          args = { _raw: tc.function.arguments.slice(0, 200) };
        }
        const t0 = Date.now();
        let content: string;
        try {
          const outcome = await this.deps.mcp.callTool(tc.function.name, args);
          content = this.summarizeIfLarge(tc.function.name, outcome.raw);
          if (!content) content = '(empty result)';
          // CM-04: 结构化拆除计划直供——模型散文做解读，卡片用真数据
          const card = extractPlanCard(tc.function.name, outcome);
          if (card) planCards.push(card);
        } catch (err) {
          content = `tool error: ${err instanceof Error ? err.message : String(err)}`;
        }
        n += 1;
        const citation: Citation = { n, tool: tc.function.name, args, ms: Date.now() - t0 };
        citations.push(citation);
        this.deps.log.write('tool_result', { tool: tc.function.name, via: 'react', cite: n, ms: citation.ms });
        messages.push({ role: 'tool', tool_call_id: tc.id, content });
      }
    }

    // M3-01 fix (dogfooding finding): when the step cap exhausted on tool
    // rounds, the model never got a synthesis turn — the user saw an empty
    // answer despite successful tool results. Force one final no-tools chat.
    if (messages[messages.length - 1]?.role === 'tool') {
      const synthesis = await this.deps.llm.chat(messages, { onDelta }, this.deps.fetchImpl);
      answer = synthesis.content;
      steps += 1;
    }

    // M3-03/M3-04 fix (user dogfooding, adversarial intent): some models emit
    // tool-call attempts as TEXT (`<tool_call><function=…>`, DSML tokens)
    // instead of native calls — that block must never reach the user as an
    // answer, and an empty or stripped-out answer means the model never
    // actually concluded. Retry once with an explicit no-tools instruction.
    for (let retries = 0; retries < 1; retries++) {
      const cleaned = stripTextToolCalls(answer);
      if (cleaned === answer && answer.trim()) break;
      answer = cleaned;
      this.deps.log.write('answer_retry', { reason: cleaned ? 'text_tool_call_leak' : 'empty_answer' });
      // P3-6/QA-F-04: 重试标记走专用事件——前端收到即清空流式缓冲并显示
      // 独立提示条；废弃片段不再拼接进最终答案（REPL 端仍用文本标记）。
      onDelta('\n\n');
      if (opts.onRegenerate) opts.onRegenerate();
      messages.push({
        role: 'user',
        content: '请基于以上工具结果直接输出文字结论；不要再尝试调用任何工具，不要输出工具调用语法，也不要重复之前的内容。',
      });
      const retry = await this.deps.llm.chat(messages, { onDelta }, this.deps.fetchImpl);
      answer = stripTextToolCalls(retry.content);
      steps += 1;
    }

    // R2-03: 出口校验——剔除正文中没有对应 citation 的悬空角标（web/REPL 共用）。
    // citations 为空时全部剔除（正文引用必须能溯源到真实工具调用）。
    const finalAnswer = answer.replace(/\[cite:\s*(\d+)\]/g, (m, n: string) =>
      citations.some((c) => c.n === Number(n)) ? m : '',
    );
    this.history.push({ role: 'user', content: intent }, { role: 'assistant', content: finalAnswer });
    this.deps.log.write('agent_turn', {
      steps,
      citations,
      fallback: false,
      planCards: planCards.length,
    });
    return { answer: finalAnswer, citations, steps, fallback: false, planCards: planCards.length ? planCards : undefined };
  }

  /** Deterministic degradation when no LLM is configured (reference semantics:
   * fallback:true, never fabricate). Keyword-routes the obvious intents. */
  private async fallback(intent: string): Promise<AgentTurn> {
    const lower = intent.toLowerCase();
    if (!this.deps.mcp.connected) {
      return {
        answer: '尚未连接仓库：先在侧栏连接仓库。配置 LLM（REPOQA_LLM_*）后自由文本将由 ReAct 编排。',
        citations: [],
        steps: 0,
        fallback: true,
      };
    }
    if (/scan|扫|哪里|改动|债务|debt|touch/.test(lower)) {
      // engine port: currentRepo is the repoId bound to the chat session
      const repoId = this.deps.mcp.currentRepo;
      const outcome = await this.deps.mcp.callTool('codecompass_scan', { repoId });
      return {
        answer: renderScan(outcome.payload),
        citations: [{ n: 1, tool: 'codecompass_scan', args: { repoId }, ms: outcome.ms }],
        steps: 1,
        fallback: true,
      };
    }
    return {
      answer:
        'LLM 未配置（引擎 .env 的 REPOQA_LLM_*，或 COPILOT_HOME/llm-profiles.json）。当前可用 /tools、/status；或配置 LLM 后重试自由文本。',
      citations: [],
      steps: 0,
      fallback: true,
    };
  }

  private historyWindow(): ChatMessage[] {
    return this.history.slice(-HISTORY_KEEP);
  }

  /**
   * QA-02: a blanket char cap silently amputated scan payloads — the model
   * saw only bucket #1 and honestly reported "no hubs list". Structure-aware
   * compression instead: five buckets become compact per-bucket summaries
   * (top symbols + totals + nextAction), easily within budget. Non-scan tools
   * keep the proven mask+cap path.
   */
  private summarizeIfLarge(toolName: string, raw: string): string {
    const masked = maskSecrets(raw);
    if (toolName !== 'codecompass_scan' || masked.length <= TOOL_RESULT_CHAR_CAP) {
      return masked.slice(0, TOOL_RESULT_CHAR_CAP);
    }
    try {
      const parsed = JSON.parse(raw) as {
        repoName?: string;
        buckets?: Array<{
          id?: string;
          title?: string;
          total?: number;
          nextAction?: string;
          items?: Array<{ symbol?: string; kind?: string; filePath?: string; line?: number; detail?: string }>;
        }>;
      };
      const lines: string[] = [];
      if (parsed.repoName) lines.push(`repo: ${parsed.repoName}`);
      for (const bucket of parsed.buckets ?? []) {
        const items = bucket.items ?? [];
        lines.push(`## ${bucket.id ?? '?'} (${bucket.title ?? ''}) total=${bucket.total ?? items.length}`);
        for (const item of items.slice(0, 8)) {
          const loc = item.filePath ? ` @${item.filePath}:${item.line ?? '?'}` : '';
          // P3-7: hubs 等桶的量化指标（PageRank/出入度等）在 detail 字符串里，
          // 必须随行带入——QA-02 回归轮确认模型对缺失数值会如实说明而非编造。
          lines.push(`- ${item.symbol ?? '?'} (${item.kind ?? '?'})${loc}${item.detail ? ` — ${item.detail}` : ''}`);
        }
        if (items.length > 8) lines.push(`- …and ${items.length - 8} more`);
        if (bucket.nextAction) lines.push(`  next: ${bucket.nextAction}`);
      }
      const summary = lines.join('\n');
      return summary.length <= TOOL_RESULT_CHAR_CAP ? summary : summary.slice(0, TOOL_RESULT_CHAR_CAP);
    } catch {
      return masked.slice(0, TOOL_RESULT_CHAR_CAP);
    }
  }
}

export function toToolSpecs(tools: readonly ToolSummary[]): ToolSpec[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters: (t.inputSchema as unknown) ?? { type: 'object', properties: {} },
    },
  }));
}

/** CM-04 卡片化 v2：从 plan_evolution/module_evolution 载荷提取结构化拆除计划。
 * EvolutionChecklistItem（contracts/repoqa.ts）= {category, action, filePath, description}。 */
export function extractPlanCard(toolName: string, outcome: ToolCallOutcome): PlanCard | null {
  if (toolName !== 'codecompass_plan_evolution' && toolName !== 'codecompass_module_evolution') return null;
  let data: {
    intentType?: string;
    target?: string;
    riskLevel?: string;
    checklists?: Array<{ category?: string; action?: string; filePath?: string; description?: string }>;
  };
  try {
    // outcome.payload 在 JSON 可解析时已含对象；否则退回 raw 再解析一次
    data =
      typeof outcome.payload === 'object' && outcome.payload !== null && 'checklists' in (outcome.payload as object)
        ? (outcome.payload as typeof data)
        : (JSON.parse(outcome.raw) as typeof data);
  } catch {
    return null;
  }
  if (!data.checklists?.length) return null;
  const items = (data.checklists ?? [])
    .filter((i) => i.filePath && i.description)
    .map((i) => ({
      category: i.category ?? 'CONFIG',
      action: i.action ?? 'MODIFY',
      filePath: i.filePath as string,
      description: i.description as string,
    }));
  if (!items.length) return null;
  return {
    intentType: data.intentType ?? 'DEPRECATE',
    target: data.target ?? '',
    riskLevel: data.riskLevel,
    items,
  };
}

function renderScan(payload: unknown): string {
  const raw = (payload as { buckets?: unknown }).buckets;
  const buckets: Array<{ id?: string; title?: string; items?: unknown[]; total?: number; nextAction?: string }> =
    Array.isArray(raw)
      ? (raw as Array<{ id?: string; title?: string; items?: unknown[]; total?: number; nextAction?: string }>)
      : Object.entries((raw ?? {}) as Record<string, { total?: number; nextAction?: string }>).map(
          ([id, bucket]) => ({ id, ...bucket }),
        );
  if (!buckets.length) return 'scan returned no buckets (see /call codecompass_scan for raw)';
  const lines = ['scan（五桶候选，事实层）：'];
  for (const bucket of buckets) {
    const total = bucket.total ?? bucket.items?.length ?? 0;
    lines.push(`  ${bucket.id ?? '?'}: total=${total}${bucket.nextAction ? ` — ${bucket.nextAction}` : ''}`);
  }
  lines.push('判断属编排层：以上为引擎事实，未做好坏评价。');
  return lines.join('\n');
}

/** Some models emit tool-call attempts as text instead of native function
 * calls (dogfooding M3-03). That syntax is never a valid answer. */
export function stripTextToolCalls(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<function=[^>]*>[\s\S]*?<\/function>/gi, '')
    // QA-F-01: DeepSeek-style DSML tool-call tokens leak as plain text on
    // multi-step turns (steps>=3) — strip the whole invocation block too.
    .replace(/<｜｜DSML｜｜tool_calls>[\s\S]*?<｜｜DSML｜｜\/tool_calls>/g, '')
    .replace(/<｜｜DSML｜｜invoke[\s\S]*?<｜｜DSML｜｜\/invoke>/g, '')
    .replace(/<｜｜DSML｜｜[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
