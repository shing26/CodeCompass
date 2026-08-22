import fs from 'node:fs';
import path from 'node:path';
import { maskSensitiveText } from './repoqa-masking';

/**
 * Issue 10 — Real LLM adapter.
 *
 * A small OpenAI-compatible streaming adapter plus a ReAct agent loop.
 * Configuration comes from environment or a local `.env` file:
 *   REPOQA_LLM_BASE     API base URL, e.g. https://api.openai.com/v1
 *   REPOQA_LLM_URL      full chat-completions endpoint (overrides REPOQA_LLM_BASE)
 *   REPOQA_LLM_API_KEY  bearer token
 *   REPOQA_LLM_MODEL    model id
 * Process environment wins over `.env`. When nothing is configured the agent
 * reports `fallback: true` so callers can seamlessly use the deterministic path.
 */

export interface ReActLLMResult {
  answer?: string;
  mermaid?: string;
  anchors?: Array<{ file: string; line: number; symbol: string }>;
  suggestedAction?: string;
  firstTokenMs?: number;
  tool?: {
    name: string;
    args: Record<string, unknown>;
  };
  /** Issue 10: true when no LLM is configured — caller should fall back. */
  fallback?: boolean;
}

export const PROMPT_TOKEN_CAP = 8192;
export const TOOL_RESULT_CHAR_CAP = 4000;
export const MAX_AGENT_STEPS = 3;

export function capPrompt(input: string, maxTokens = PROMPT_TOKEN_CAP): string {
  const maxChars = maxTokens * 4;
  if (input.length <= maxChars) return input;
  const omitted = input.length - maxChars;
  return `${input.slice(0, maxChars)}\n[context truncated: ${omitted} chars omitted]`;
}

/* ------------------------------------------------------------------ *
 * .env support
 * ------------------------------------------------------------------ */

/** Parse dotenv content: `KEY=VALUE`, `#` comments, optional quotes. */
export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

export function dotEnvFilePath(): string {
  return path.join(process.cwd(), '.env');
}

/** Read and parse `.env`; missing file yields `{}`. */
export function readDotEnvFile(filePath = dotEnvFilePath()): Record<string, string> {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }
  return parseDotEnv(content);
}

export interface LlmEnvConfig {
  /** Full chat-completions endpoint (from REPOQA_LLM_URL). */
  url?: string;
  /** API base URL (from REPOQA_LLM_BASE). */
  baseUrl?: string;
  apiKey?: string;
  model: string;
}

/**
 * Resolve LLM configuration. Real process.env triggers `.env` loading so a
 * local `.env` file is honored; explicitly injected env objects (tests) are
 * used as-is and never read the filesystem.
 */
export function loadLlmEnv(env: NodeJS.ProcessEnv = process.env): LlmEnvConfig {
  const fromFile = env === process.env ? readDotEnvFile() : {};
  const merged: NodeJS.ProcessEnv = { ...fromFile, ...env };
  const url = merged.REPOQA_LLM_URL?.trim();
  const baseUrl = merged.REPOQA_LLM_BASE?.trim();
  return {
    url: url || undefined,
    baseUrl: baseUrl || undefined,
    apiKey: merged.REPOQA_LLM_API_KEY?.trim() || undefined,
    model: merged.REPOQA_LLM_MODEL?.trim() || 'repoqa-default'
  };
}

export function isLlmConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = loadLlmEnv(env);
  return Boolean(config.url || config.baseUrl);
}

/** Full endpoint: REPOQA_LLM_URL wins, otherwise BASE + /chat/completions. */
export function chatCompletionsEndpoint(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const config = loadLlmEnv(env);
  if (config.url) return config.url;
  if (config.baseUrl) return `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Streaming request
 * ------------------------------------------------------------------ */

function contentFromMessage(data: Record<string, any>): string | undefined {
  if (typeof data.choices?.[0]?.message?.content === 'string') {
    return data.choices[0].message.content;
  }
  if (typeof data.message === 'string') return data.message;
  if (typeof data.text === 'string') return data.text;
  return undefined;
}

async function readResponseBody(
  response: Response
): Promise<{ raw: string; firstTokenMs: number }> {
  const startedAt = Date.now();
  if (!response.body) {
    const raw = await response.text();
    return { raw, firstTokenMs: Date.now() - startedAt };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let firstTokenMs: number | undefined;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const decoded = decoder.decode(value, { stream: true });
    raw += decoded;
    if (firstTokenMs === undefined && decoded.trim() !== '') {
      firstTokenMs = Date.now() - startedAt;
    }
  }
  raw += decoder.decode();
  return { raw, firstTokenMs: firstTokenMs ?? Date.now() - startedAt };
}

function parseStreamedContent(raw: string): string | undefined {
  let text = '';
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as Record<string, any>;
      const delta = parsed.choices?.[0]?.delta;
      if (delta) {
        if (typeof delta.content === 'string') text += delta.content;
        if (Array.isArray(delta.tool_calls)) {
          for (const call of delta.tool_calls) {
            if (typeof call.function?.name === 'string') text += call.function.name;
            if (typeof call.function?.arguments === 'string') text += call.function.arguments;
          }
        }
      }
      const messageContent = contentFromMessage(parsed);
      if (messageContent !== undefined) text += messageContent;
    } catch {
      // Ignore malformed keep-alive lines.
    }
  }
  return text || undefined;
}

/**
 * One OpenAI-compatible chat completion call. The model is asked (via prompt)
 * to reply with JSON either `{ "answer": ..., "mermaid": ..., ... }` or
 * `{ "tool": { "name": ..., "args": ... } }`.
 */
export async function completeReAct(
  prompt: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ReActLLMResult> {
  const config = loadLlmEnv(env);
  const endpoint = chatCompletionsEndpoint(env);
  if (!endpoint) throw new Error('REPOQA_LLM_URL is not configured');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: capPrompt(prompt) }],
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(`LLM request failed with HTTP ${response.status}`);
  }

  const { raw, firstTokenMs } = await readResponseBody(response);
  const trimmed = raw.trim();
  let parsedJson: Record<string, any> | undefined = trimmed.startsWith('{')
    ? (JSON.parse(trimmed) as Record<string, any>)
    : undefined;
  let rawContent =
    parsedJson !== undefined
      ? contentFromMessage(parsedJson)
      : parseStreamedContent(raw);
  if (typeof rawContent !== 'string' && trimmed.startsWith('{')) {
    try {
      parsedJson = JSON.parse(trimmed) as Record<string, any>;
      rawContent = contentFromMessage(parsedJson) ?? trimmed;
    } catch {
      // Fall through to the error below.
    }
  }
  if (typeof rawContent !== 'string') {
    throw new Error('LLM response did not contain text');
  }

  const answerText = rawContent.trim();
  if (answerText.startsWith('{')) {
    try {
      return { ...(JSON.parse(answerText) as ReActLLMResult), firstTokenMs };
    } catch {
      // Fall through to a plain text answer.
    }
  }
  return { answer: answerText, firstTokenMs };
}

/* ------------------------------------------------------------------ *
 * ReAct agent loop + output contract (Issue 10)
 * ------------------------------------------------------------------ */

export interface AgentTool {
  name: string;
  description: string;
  /** Short parameter hint injected into the prompt, e.g. `query` or `text`. */
  parameters?: string;
  execute(args: Record<string, unknown>): unknown | Promise<unknown>;
}

export interface ReActAgentOptions {
  question: string;
  /** Prebuilt, already capped+masked context (symbols/chunks/evidence). */
  context: string;
  tools: AgentTool[];
  env?: NodeJS.ProcessEnv;
  onFirstToken?: (latencyMs: number) => void;
  maxSteps?: number;
  budgetTokens?: number;
}

/** Issue 10: constrain every answer to the three section layout. */
export const THREE_PART_ANSWER_GUIDE = `Answer with EXACTLY three sections separated by a single blank line:
1) 业务概述 — one plain-language sentence about the code/config being asked.
2) 证据与拆解 — concrete evidence: symbol names, file paths, line numbers and config keys (NEVER include secret values).
3) 结论与下一步 — the direct answer to the question plus one concrete next step for the developer.`;

/** Issue 10: mermaid diagrams must deep-link nodes to source via code://. */
export const CODE_LINK_MMERMAID_GUIDE = `When you return a mermaid diagram, every node MUST carry a source link:
click NodeName "code://<relative-file-path>#<line>-<line>"
Never use http(s) URLs in click bindings.`;

/**
 * ReAct loop: ask the model; if it asks for a tool, run it and continue; when
 * it answers, finalize (three-part answer + sanitized mermaid with code://
 * anchors). Returns `{ fallback: true }` when no LLM is configured so callers
 * can fall back to the static deterministic mode seamlessly.
 */
export async function runReActAgent(options: ReActAgentOptions): Promise<ReActLLMResult> {
  const env = options.env ?? process.env;
  const maxSteps = options.maxSteps ?? MAX_AGENT_STEPS;
  const budget = options.budgetTokens ?? PROMPT_TOKEN_CAP;
  const toolHistory: string[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const prompt = maskSensitiveText(
      buildAgentPrompt({
        question: options.question,
        context: options.context,
        tools: options.tools,
        toolHistory,
        budget
      })
    );
    let result: ReActLLMResult;
    try {
      result = await completeReAct(prompt, env);
    } catch (error) {
      if (!isLlmConfigured(env)) return { fallback: true };
      throw error;
    }
    if (result.firstTokenMs !== undefined) options.onFirstToken?.(result.firstTokenMs);
    if (result.answer) return finalizeAgentResult(result);
    if (!result.tool) return finalizeAgentResult({ answer: 'LLM did not provide an answer.' });

    const tool = options.tools.find((candidate) => candidate.name === result.tool!.name);
    const executed = tool
      ? await tool.execute(result.tool!.args ?? {})
      : { error: `unknown tool: ${result.tool!.name}` };
    toolHistory.push(
      capPrompt(
        `Tool ${result.tool!.name}(${JSON.stringify(result.tool!.args)}) -> ${JSON.stringify(executed)}`,
        TOOL_RESULT_CHAR_CAP
      )
    );
  }
  return finalizeAgentResult({
    answer: 'LLM did not converge to an answer after tool calls.'
  });
}

function buildAgentPrompt(input: {
  question: string;
  context: string;
  tools: AgentTool[];
  toolHistory: string[];
  budget: number;
}): string {
  const toolLines = input.tools
    .map(
      (tool) =>
        `- ${tool.name}${tool.parameters ? `(${tool.parameters})` : ''}: ${tool.description}`
    )
    .join('\n');
  const history = input.toolHistory
    .map((entry, index) => `[tool result ${index + 1}]\n${entry}`)
    .join('\n\n');
  const core = [
    `Question: ${input.question}`,
    `Context:\n${input.context}`,
    `Tools:\n${toolLines}`,
    THREE_PART_ANSWER_GUIDE,
    CODE_LINK_MMERMAID_GUIDE,
    'Reply with JSON only: {"answer": "...", "mermaid": "...", "anchors": [...], "suggestedAction": "..."} or {"tool": {"name": "...", "args": {...}}}.'
  ].join('\n\n');
  return capPrompt(history ? `${core}\n\nTool history:\n${history}` : core, input.budget);
}

/** Issue 10: final hardening of a model answer before it reaches users. */
export function finalizeAgentResult(result: ReActLLMResult): ReActLLMResult {
  const answer =
    typeof result.answer === 'string' ? toThreePartAnswer(result.answer) : result.answer;
  const mermaid = result.mermaid
    ? bindAnchorsToMermaid(sanitizeMermaidClicks(result.mermaid), result.anchors ?? [])
    : undefined;
  return { ...result, answer, mermaid };
}

/** Normalize a model answer into the three-section layout. */
export function toThreePartAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) return parts.slice(0, 3).join('\n\n');
  if (parts.length === 2) return `${parts[0]}\n\n${parts[1]}\n\n结论与下一步`;
  return `业务概述\n\n${parts[0]}\n\n结论与下一步`;
}

/** Strip a ```mermaid ... ``` fence, if present. */
export function stripMermaidFence(code: string): string {
  return code
    .trim()
    .replace(/^```(?:mermaid)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '');
}

const CODE_BINDING_LINE_RE = /^click\s+([A-Za-z_][\w]*)\s+"(code:\/\/[^"]+)"/;
const CODE_BINDING_GLOBAL_RE = /click\s+([A-Za-z_][\w]*)\s+"(code:\/\/[^"]+)"/g;

export function isCodeLinkBinding(line: string): boolean {
  return CODE_BINDING_LINE_RE.test(line.trim());
}

/** Keep only `click Node "code://..."` bindings; drop http(s) or stray clicks. */
export function sanitizeMermaidClicks(code: string): string {
  const body = stripMermaidFence(code);
  return body
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (!/^click\s+/i.test(trimmed)) return true;
      return isCodeLinkBinding(trimmed);
    })
    .join('\n');
}

export interface CodeLinkBinding {
  node: string;
  url: string;
  file: string;
  line: number;
  lineEnd?: number;
}

export function extractCodeLinkBindings(code: string): CodeLinkBinding[] {
  const out: CodeLinkBinding[] = [];
  let match: RegExpExecArray | null;
  while ((match = CODE_BINDING_GLOBAL_RE.exec(code)) !== null) {
    const deep = /^code:\/\/(.+?)#(\d+)(?:-(\d+))?$/.exec(match[2]);
    if (!deep) continue;
    out.push({
      node: match[1],
      url: match[2],
      file: deep[1],
      line: Number(deep[2]),
      lineEnd: deep[3] ? Number(deep[3]) : undefined
    });
  }
  return out;
}

/** All identifier tokens in the diagram body (clicks/quoted strings excluded). */
function mermaidNodeIds(code: string): Set<string> {
  const withoutStrings = code.replace(/"([^"]*)"/g, '');
  const body = withoutStrings
    .split('\n')
    .filter((line) => !/^\s*click\s/i.test(line))
    .join('\n');
  const ids = new Set<string>();
  for (const match of body.matchAll(/[A-Za-z_][\w]*/g)) ids.add(match[0]);
  return ids;
}

/**
 * Add missing `click Node "code://file#line"` bindings so every diagram node
 * that has a matching anchor becomes clickable and jumps to source.
 */
export function bindAnchorsToMermaid(
  code: string,
  anchors: Array<{ file: string; line: number; symbol: string }>
): string {
  if (!code.trim() || anchors.length === 0) return code;
  const nodeIds = mermaidNodeIds(code);
  const existing = new Set(extractCodeLinkBindings(code).map((binding) => binding.node));
  const added: string[] = [];
  for (const anchor of anchors) {
    if (!existing.has(anchor.symbol) && nodeIds.has(anchor.symbol)) {
      added.push(`click ${anchor.symbol} "code://${anchor.file}#${anchor.line}"`);
      existing.add(anchor.symbol);
    }
  }
  if (added.length === 0) return code;
  return `${code}\n${added.join('\n')}`;
}