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

/**
 * Issue 24 / ADR-0013 — structured layer instruction. The model never paints
 * mermaid; it only chooses what the deterministic engine should render:
 * - kind       whitelist of engine-owned renderers (see LAYER_DIAGRAM_KINDS)
 * - focus      symbols / config keys / tour id the instruction applies to
 * - collapse   max hops for chain renderers (engine clamps)
 * - annotations plain notes attached to nodes that exist in the rendered graph
 */
export const LAYER_DIAGRAM_KINDS = ['call_chain', 'config_topo', 'tour'] as const;
export type LayerDiagramKind = (typeof LAYER_DIAGRAM_KINDS)[number];

export interface LayerInstruction {
  kind: LayerDiagramKind;
  focus?: string[];
  collapse?: number;
  annotations?: Record<string, string>;
}

export interface ReActLLMResult {
  answer?: string;
  /** @deprecated ADR-0013: model-painted mermaid is stripped at finalize. */
  mermaid?: string;
  /** Issue 24: structured layer instruction — geometry is engine-rendered. */
  diagram?: LayerInstruction;
  anchors?: Array<{ file: string; line: number; symbol: string }>;
  suggestedAction?: string;
  firstTokenMs?: number;
  /** Provider-reported or estimated token usage for this query. */
  usage?: LlmTokenUsage;
  tool?: {
    name: string;
    args: Record<string, unknown>;
  };
  /** Issue 10: true when no LLM is configured — caller should fall back. */
  fallback?: boolean;
}

export interface LlmTokenUsage {
  input: number;
  output: number;
  total: number;
  source: 'provider' | 'estimate';
}

export const PROMPT_TOKEN_CAP = 8192;
export const TOOL_RESULT_CHAR_CAP = 4000;
export const MAX_AGENT_STEPS = 3;
/** Issue 23: incident copilot gets an independent 6-step ReAct budget. */
export const INCIDENT_MAX_AGENT_STEPS = 6;

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

/** Character-based token estimate: 4 chars ≈ 1 token (OpenAI convention). */
export function estimateTokenCount(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

export function buildTokenUsage(
  input: number,
  output: number,
  source: LlmTokenUsage['source']
): LlmTokenUsage {
  return { input, output, total: input + output, source };
}

export function mergeTokenUsage(
  left: LlmTokenUsage | undefined,
  right: LlmTokenUsage | undefined
): LlmTokenUsage | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    total: left.total + right.total,
    source: left.source === 'provider' && right.source === 'provider' ? 'provider' : 'estimate'
  };
}

/** Read `usage` from a non-streamed OpenAI-compatible JSON response. */
export function parseProviderUsage(
  data: Record<string, any> | undefined
): { input: number; output: number; total: number } | undefined {
  const usage = data?.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const input = Number(usage.prompt_tokens);
  const output = Number(usage.completion_tokens);
  const total = Number(usage.total_tokens);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  return {
    input: Math.max(0, input),
    output: Math.max(0, output),
    total: Number.isFinite(total) && total > 0 ? total : Math.max(0, input + output)
  };
}

/** Extract the last `usage` object from a streamed OpenAI response. */
function parseStreamedUsage(raw: string): { input: number; output: number; total: number } | undefined {
  let usage: { input: number; output: number; total: number } | undefined;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as Record<string, any>;
      const next = parseProviderUsage(parsed);
      if (next) usage = next;
    } catch {
      // Ignore malformed keep-alive lines.
    }
  }
  return usage;
}

/**
 * Classify the configured LLM for Local-First UI: no config, loopback host
 * (Ollama/vLLM on localhost), or a remote endpoint. The hostname is returned
 * separately so callers can mask it before it reaches the browser.
 */
export function llmRuntimeInfo(
  env: NodeJS.ProcessEnv = process.env
): { mode: 'none' | 'local' | 'remote'; host?: string } {
  const endpoint = chatCompletionsEndpoint(env);
  if (!endpoint) return { mode: 'none' };
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase();
    const isLoopback =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname === '0.0.0.0';
    return { mode: isLoopback ? 'local' : 'remote', host: hostname };
  } catch {
    return { mode: 'remote' };
  }
}

/** True for IPv4 / bracketed or unbracketed IPv6 literals. */
function isIpLiteral(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare)) return true;
  return bare.includes(':');
}

/** Keep the first and last hostname labels, masking every middle label. */
export function maskHostname(hostname: string): string {
  if (isIpLiteral(hostname)) return hostname;
  const labels = hostname.split('.').filter(Boolean);
  if (labels.length <= 2) return hostname;
  return labels
    .map((label, index) => (index === 0 || index === labels.length - 1 ? label : '***'))
    .join('.');
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
  const providerUsage = parsedJson
    ? parseProviderUsage(parsedJson)
    : parseStreamedUsage(raw);
  const usage = providerUsage
    ? { ...providerUsage, source: 'provider' as const }
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
      return { ...(JSON.parse(answerText) as ReActLLMResult), firstTokenMs, usage };
    } catch {
      // Fall through to a plain text answer.
    }
  }
  return { answer: answerText, firstTokenMs, usage };
}

/**
 * Issue 23 — one native OpenAI-compatible chat-completions turn with standard
 * `tools`/`tool_calls` (non-streamed for reliable tool-call parsing). Handles
 * DeepSeek/OpenAI dialect differences: `reasoning_content` may carry the
 * thinking while `content` stays empty; `tool_calls` and text may co-exist.
 * Throws `NativeToolsUnsupportedError` on 4xx so callers can degrade to the
 * legacy text-JSON protocol.
 */
export class NativeToolsUnsupportedError extends Error {
  constructor(public readonly status: number) {
    super(`endpoint rejected the tools API (HTTP ${status})`);
    this.name = 'NativeToolsUnsupportedError';
  }
}

export interface NativeTurnResult {
  /** The assistant message verbatim (tool_calls included) for transcript replay. */
  message: Record<string, any>;
  content?: string;
  toolCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    /** Set when `arguments` was not valid JSON — the loop feeds back an error. */
    argsError?: string;
  }>;
  finishReason?: string;
  usage?: LlmTokenUsage;
  firstTokenMs?: number;
}

export async function completeNativeChat(
  messages: NativeChatMessage[],
  env: NodeJS.ProcessEnv = process.env,
  tools?: NativeToolSpec[]
): Promise<NativeTurnResult> {
  const config = loadLlmEnv(env);
  const endpoint = chatCompletionsEndpoint(env);
  if (!endpoint) throw new Error('REPOQA_LLM_URL is not configured');

  const nativeTools = tools && tools.length > 0 ? tools : undefined;
  const body: Record<string, unknown> = {
    model: config.model,
    messages: messages.map((message) => ({ ...message })),
    stream: false,
    ...(nativeTools ? { tools: nativeTools, tool_choice: 'auto' } : {})
  };

  const send = (payload: Record<string, unknown>) =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify(payload)
    });

  const startedAt = Date.now();
  let response = await send(body);
  if (!response.ok && nativeTools && response.status >= 400 && response.status < 500) {
    // Degrade once: endpoint predates the tools API — retry without `tools`.
    // A successful plain retry means the tools API itself is unsupported, so
    // report the original status via NativeToolsUnsupportedError and let the
    // caller fall back to the text-JSON protocol.
    const originalStatus = response.status;
    const { tools: _omit, tool_choice: _omitChoice, ...plain } = body;
    void _omit;
    void _omitChoice;
    response = await send(plain);
    if (response.ok) {
      throw new NativeToolsUnsupportedError(originalStatus);
    }
  }
  if (!response.ok) {
    throw new Error(`LLM request failed with HTTP ${response.status}`);
  }

  const firstTokenMs = Date.now() - startedAt;
  const data = (await response.json()) as Record<string, any>;
  const usagePayload = parseProviderUsage(data);
  const usage = usagePayload ? { ...usagePayload, source: 'provider' as const } : undefined;
  const choice = data?.choices?.[0];
  const message: Record<string, any> = choice?.message ?? {};
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;

  const toolCalls: NativeTurnResult['toolCalls'] = [];
  if (Array.isArray(message.tool_calls)) {
    message.tool_calls.forEach((call: AssistantToolCall, index: number) => {
      const parsed = parseToolCall(call);
      const id = typeof call.id === 'string' && call.id ? call.id : `call_${index}`;
      if (!parsed) {
        // A named call with unparsable arguments is kept with an argsError so
        // the loop can feed the parse failure back to the model; nameless
        // garbage is dropped entirely.
        const name = call.function?.name ?? call.name;
        if (typeof name === 'string' && name) {
          toolCalls.push({ id, name, args: {}, argsError: 'tool arguments were not valid JSON' });
        }
        return;
      }
      toolCalls.push({ id, name: parsed.name, args: parsed.args });
    });
  }
  // reasoning_content (DeepSeek) never replaces content; tool_calls win over text.
  const content = typeof message.content === 'string' ? message.content : undefined;
  return { message, content, toolCalls, finishReason, usage, firstTokenMs };
}

/* ------------------------------------------------------------------ *
 * ReAct agent loop + output contract (Issue 10)
 * ------------------------------------------------------------------ */

export interface AgentTool {
  name: string;
  description: string;
  /** Short parameter hint injected into the prompt, e.g. `query` or `text`. */
  parameters?: string;
  /** Issue 23: JSON Schema for the standard `tools:[{type:'function'}]` request body. */
  parameterSchema?: Record<string, unknown>;
  execute(args: Record<string, unknown>): unknown | Promise<unknown>;
}

/** Issue 23 — standard OpenAI tool descriptor sent when native tools are enabled. */
export interface NativeToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Issue 23 — a `tool_calls` entry from an assistant message. */
export interface AssistantToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  // Tolerant fallbacks: some OpenAI-compatible providers flatten the shape.
  name?: string;
  arguments?: string | Record<string, unknown>;
}

/** Issue 23 — one completed tool round-trip kept for the `role:'tool'` transcript. */
export interface AgentToolTranscript {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

/** Issue 23 — one chat message for the native protocol request body. */
export interface NativeChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: AssistantToolCall[];
  tool_call_id?: string;
}

/**
 * Issue 23 — zero-hallucination contract for the incident copilot: every call
 * chain assertion must be verbatim from a tool result; every file:line must be
 * validated; unprovable boundaries must be marked BREAK/SUSPECT, never guessed.
 */
export const INCIDENT_ZERO_HALLUCINATION_GUIDE = `Zero-Hallucination Contract (mandatory for incident mode):
- Every call-chain assertion MUST come verbatim from a tool result in this session. Never invent hops, files, lines or config keys.
- Every file:line you mention MUST appear in a tool result exactly as written.
- When the evidence stops (unmatched stack frame, dynamic dispatch, missing config), you MUST mark the boundary explicitly as BREAK (static analysis cannot continue) — never guess past it.
- Unresolved stack frames are reported as-is with the label BREAK.
- A plain-language summary is allowed, but it must not introduce facts absent from tool results.`;

/** Convert AgentTool descriptors to the standard `tools` request array. */
export function toNativeToolSpecs(tools: AgentTool[]): NativeToolSpec[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters:
        tool.parameterSchema ??
        ({
          type: 'object',
          properties: {},
          additionalProperties: true
        } as Record<string, unknown>)
    }
  }));
}

/** Parse a `tool_calls` entry into `{ name, args }`; null when it is malformed. */
export function parseToolCall(call: AssistantToolCall): { name: string; args: Record<string, unknown> } | null {
  const name = call.function?.name ?? call.name;
  if (typeof name !== 'string' || !name) return null;
  const rawArgs = call.function?.arguments ?? call.arguments;
  let args: Record<string, unknown> = {};
  if (typeof rawArgs === 'string' && rawArgs.trim()) {
    try {
      const parsed = JSON.parse(rawArgs);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    args = rawArgs as Record<string, unknown>;
  }
  return { name, args };
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
  /**
   * Issue 23: use the standard OpenAI `tools`/`tool_calls` protocol
   * (non-streamed request, `role:'tool'` transcript). Falls back to the
   * legacy text-JSON protocol when the endpoint answers 4xx.
   */
  nativeTools?: boolean;
  /** Issue 23: extra contract guide appended to the prompt (e.g. incident mode). */
  guideExtra?: string;
  /**
   * Issue 24 / ADR-0013: invoked for every executed tool with its raw result
   * so the caller can harvest the session's physical Call Edges (and detect
   * failed tool calls). Layer instructions may only render these edges.
   */
  onToolResult?: (toolName: string, result: unknown) => void;
}

/** Issue 10: constrain every answer to the three section layout. */
export const THREE_PART_ANSWER_GUIDE = `Answer with EXACTLY three sections separated by a single blank line:
1) 业务概述 — one plain-language sentence about the code/config being asked.
2) 证据与拆解 — concrete evidence: symbol names, file paths, line numbers and config keys (NEVER include secret values).
3) 结论与下一步 — the direct answer to the question plus one concrete next step for the developer.`;

/**
 * Issue 24 / ADR-0013: the model never paints mermaid. It may only emit a
 * structured layer instruction and let the deterministic engine render.
 */
export const DIAGRAM_LAYER_GUIDE = `Diagram contract (ADR-0013, mandatory): NEVER output mermaid code or a "mermaid" field — model-drawn diagrams are discarded. To request a diagram, return a "diagram" layer instruction in the final JSON:
{"diagram": {"kind": "call_chain" | "config_topo" | "tour", "focus": ["SymbolOrKeyOrTourId"], "collapse": 3, "annotations": {"NodeName": "note"}}}
- kind "call_chain": the call chain from this session's tool results (focus selects symbols on the chain, in order; collapse caps the hops).
- kind "config_topo": the configuration topology (focus selects config keys returned by get_config_evidence).
- kind "tour": one of the engine tours (focus[0] = tour id: auth-chain | main-flow | error-handling).
- focus entries must exist in this session's tool results; annotations attach short notes to nodes that exist in the rendered graph. Geometry, edges and code:// bindings are produced by the engine only.`;

/**
 * ReAct loop: ask the model; if it asks for a tool, run it and continue; when
 * it answers, finalize (three-part answer + sanitized mermaid with code://
 * anchors). Returns `{ fallback: true }` when no LLM is configured so callers
 * can fall back to the static deterministic mode seamlessly.
 *
 * Issue 23: with `nativeTools` the loop speaks the standard OpenAI
 * `tools`/`tool_calls` protocol (`role:'tool'` transcript replay). On
 * `NativeToolsUnsupportedError` (endpoint rejected the tools API) it degrades
 * once to the legacy text-JSON protocol for the remaining steps.
 */
export async function runReActAgent(options: ReActAgentOptions): Promise<ReActLLMResult> {
  const env = options.env ?? process.env;
  const maxSteps = options.maxSteps ?? MAX_AGENT_STEPS;
  const budget = options.budgetTokens ?? PROMPT_TOKEN_CAP;
  const guideExtra = options.guideExtra ? `${options.guideExtra}\n` : '';
  if (options.nativeTools && isLlmConfigured(env)) {
    try {
      return await runNativeToolsLoop(options, maxSteps, budget, guideExtra);
    } catch (error) {
      // Only an endpoint-level tools rejection degrades to the text protocol;
      // anything else is a real failure and propagates.
      if (!(error instanceof NativeToolsUnsupportedError)) throw error;
    }
  }

  const toolHistory: string[] = [];
  let accumulatedUsage: LlmTokenUsage | undefined;

  for (let step = 0; step < maxSteps; step += 1) {
    const prompt = maskSensitiveText(
      buildAgentPrompt({
        question: options.question,
        context: options.context,
        tools: options.tools,
        toolHistory,
        budget,
        guideExtra
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
    accumulatedUsage = mergeTokenUsage(accumulatedUsage, result.usage);
    if (result.answer) {
      const usage =
        accumulatedUsage ??
        buildTokenUsage(
          estimateTokenCount(prompt + toolHistory.join('')),
          estimateTokenCount(result.answer),
          'estimate'
        );
      return finalizeAgentResult({ ...result, usage });
    }
    if (!result.tool) {
      const usage =
        accumulatedUsage ??
        buildTokenUsage(estimateTokenCount(prompt), estimateTokenCount('LLM did not provide an answer.'), 'estimate');
      return finalizeAgentResult({ answer: 'LLM did not provide an answer.', usage });
    }

    const tool = options.tools.find((candidate) => candidate.name === result.tool!.name);
    const executed = tool
      ? await tool.execute(result.tool!.args ?? {})
      : { error: `unknown tool: ${result.tool!.name}` };
    options.onToolResult?.(result.tool!.name, executed);
    toolHistory.push(
      capPrompt(
        `Tool ${result.tool!.name}(${JSON.stringify(result.tool!.args)}) -> ${JSON.stringify(executed)}`,
        TOOL_RESULT_CHAR_CAP
      )
    );
  }
  const usage =
    accumulatedUsage ??
    buildTokenUsage(
      estimateTokenCount(toolHistory.join('')),
      estimateTokenCount('LLM did not converge to an answer after tool calls.'),
      'estimate'
    );
  return finalizeAgentResult({
    answer: 'LLM did not converge to an answer after tool calls.',
    usage
  });
}

/** Issue 23 — native `tools`/`tool_calls` ReAct loop. */
async function runNativeToolsLoop(
  options: ReActAgentOptions,
  maxSteps: number,
  budget: number,
  guideExtra: string
): Promise<ReActLLMResult> {
  const env = options.env ?? process.env;
  const specs = toNativeToolSpecs(options.tools);
  const messages: NativeChatMessage[] = [
    {
      role: 'user',
      content: maskSensitiveText(
        buildAgentPrompt({
          question: options.question,
          context: options.context,
          tools: options.tools,
          toolHistory: [],
          budget,
          guideExtra
        })
      )
    }
  ];
  const transcript: AgentToolTranscript[] = [];
  let accumulatedUsage: LlmTokenUsage | undefined;
  let firstTokenMs: number | undefined;

  for (let step = 0; step < maxSteps; step += 1) {
    const turn = await completeNativeChat(messages, env, specs);
    if (turn.firstTokenMs !== undefined && firstTokenMs === undefined) {
      firstTokenMs = turn.firstTokenMs;
      options.onFirstToken?.(turn.firstTokenMs);
    }
    accumulatedUsage = mergeTokenUsage(accumulatedUsage, turn.usage);

    if (turn.toolCalls.length === 0) {
      // No tool request: treat the content as the final answer. DeepSeek R1
      // may put everything in reasoning_content with an empty content — in
      // that case there is nothing anchorable to say.
      const answer = turn.content?.trim();
      const usage =
        accumulatedUsage ??
        buildTokenUsage(
          estimateTokenCount(options.question + options.context),
          estimateTokenCount(answer ?? ''),
          'estimate'
        );
      if (!answer) {
        return finalizeAgentResult({ answer: 'LLM did not provide an answer.', usage });
      }
      let parsed: ReActLLMResult = { answer };
      if (answer.startsWith('{')) {
        try {
          parsed = JSON.parse(answer) as ReActLLMResult;
        } catch {
          // Plain text answer without the JSON contract.
        }
      }
      return finalizeAgentResult({ ...parsed, firstTokenMs, usage });
    }

    // Execute every requested tool, then replay assistant.tool_calls + role:'tool'.
    // The replayed assistant message carries exactly the calls we executed
    // (malformed entries were dropped during parsing) so every tool_call_id
    // has a matching role:'tool' response — strict OpenAI endpoints 400 otherwise.
    const toolResults: NativeChatMessage[] = [];
    for (const call of turn.toolCalls) {
      const tool = options.tools.find((candidate) => candidate.name === call.name);
      const executed = call.argsError
        ? { error: `invalid ${call.argsError}` }
        : tool
          ? await tool.execute(call.args ?? {})
          : { error: `unknown tool: ${call.name}` };
      transcript.push({ callId: call.id, name: call.name, args: call.args, result: executed });
      options.onToolResult?.(call.name, executed);
      toolResults.push({
        role: 'tool',
        tool_call_id: call.id,
        content: capPrompt(JSON.stringify(executed ?? null), TOOL_RESULT_CHAR_CAP)
      });
    }
    messages.push({
      role: 'assistant',
      content: typeof turn.message.content === 'string' ? turn.message.content : null,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) }
      }))
    });
    messages.push(...toolResults);
  }

  const usage =
    accumulatedUsage ??
    buildTokenUsage(
      estimateTokenCount(transcript.map((entry) => JSON.stringify(entry.result)).join('')),
      estimateTokenCount('LLM did not converge to an answer after tool calls.'),
      'estimate'
    );
  return finalizeAgentResult({
    answer: 'LLM did not converge to an answer after tool calls.',
    usage
  });
}

function buildAgentPrompt(input: {
  question: string;
  context: string;
  tools: AgentTool[];
  toolHistory: string[];
  budget: number;
  guideExtra?: string;
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
    DIAGRAM_LAYER_GUIDE,
    ...(input.guideExtra ? [input.guideExtra] : []),
    'Reply with JSON only: {"answer": "...", "diagram": {"kind": "call_chain"|"config_topo"|"tour", "focus": [...], "collapse": 3, "annotations": {...}}, "anchors": [...], "suggestedAction": "..."} or {"tool": {"name": "...", "args": {...}}}.'
  ].join('\n\n');
  return capPrompt(history ? `${core}\n\nTool history:\n${history}` : core, input.budget);
}

/**
 * Issue 23 hotfix: anchors arrive from model JSON (untrusted). Drop malformed
 * entries — missing/blank `file` or `symbol`, non-finite `line` — before any
 * consumer calls `path.resolve(root, anchor.file)`, which throws on undefined
 * and kills the whole SSE query.
 */
export function sanitizeAgentAnchors(
  anchors: unknown
): Array<{ file: string; line: number; symbol: string }> | undefined {
  if (!Array.isArray(anchors)) return undefined;
  const cleaned: Array<{ file: string; line: number; symbol: string }> = [];
  for (const raw of anchors) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const file = typeof entry.file === 'string' ? entry.file.trim() : '';
    const symbol = typeof entry.symbol === 'string' ? entry.symbol.trim() : '';
    const line = Number(entry.line);
    if (!file || !symbol || !Number.isFinite(line)) continue;
    cleaned.push({ file, line: Math.max(1, Math.trunc(line)), symbol });
  }
  return cleaned;
}

/**
 * Issue 23 integration: deterministic stack anchors lead the evidence chain,
 * model-supplied anchors only add extra locations. Dedup by file|line|symbol
 * preserving order; malformed entries are dropped (see sanitizeAgentAnchors).
 */
export function unionIncidentAnchors(
  stackAnchors: Array<{ file: string; line: number; symbol: string }>,
  modelAnchors: ReActLLMResult['anchors']
): Array<{ file: string; line: number; symbol: string }> {
  const out: Array<{ file: string; line: number; symbol: string }> = [];
  const seen = new Set<string>();
  for (const anchor of [...stackAnchors, ...(modelAnchors ?? [])]) {
    if (!anchor || typeof anchor.file !== 'string' || !anchor.file.trim()) continue;
    const key = `${anchor.file}|${anchor.line}|${anchor.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: anchor.file, line: anchor.line, symbol: anchor.symbol });
  }
  return out;
}

/**
 * Issue 24 / ADR-0013: structural sanitization of an untrusted model layer
 * instruction. Only the whitelisted shape survives: kind must be one of
 * LAYER_DIAGRAM_KINDS, focus entries must be non-empty strings (capped),
 * collapse a positive number (clamped to 1..20) and annotations a string→string
 * record (capped, single-line). Existence checks (focus symbols / annotation
 * nodes present in the session) happen at the engine renderer, which owns the
 * session's symbol table and rendered node set.
 */
export function sanitizeLayerInstruction(instruction: unknown): LayerInstruction | undefined {
  if (!instruction || typeof instruction !== 'object' || Array.isArray(instruction)) {
    return undefined;
  }
  const raw = instruction as Record<string, unknown>;
  if (typeof raw.kind !== 'string' || !LAYER_DIAGRAM_KINDS.includes(raw.kind as LayerDiagramKind)) {
    return undefined;
  }
  const out: LayerInstruction = { kind: raw.kind as LayerDiagramKind };
  if (Array.isArray(raw.focus)) {
    const focus = raw.focus
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry) => entry.trim())
      .slice(0, 12);
    if (focus.length > 0) out.focus = focus;
  }
  if (raw.collapse !== undefined) {
    const collapse = Number(raw.collapse);
    if (Number.isFinite(collapse) && collapse >= 1) {
      out.collapse = Math.min(20, Math.max(1, Math.trunc(collapse)));
    }
  }
  if (raw.annotations && typeof raw.annotations === 'object' && !Array.isArray(raw.annotations)) {
    const annotations: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.annotations as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      const cleanKey = key.trim().slice(0, 80);
      const cleanValue = value.replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
      if (!cleanKey || !cleanValue) continue;
      annotations[cleanKey] = cleanValue;
    }
    if (Object.keys(annotations).length > 0) out.annotations = annotations;
  }
  return out;
}

/** Issue 10: final hardening of a model answer before it reaches users. */
export function finalizeAgentResult(result: ReActLLMResult): ReActLLMResult {
  const answer =
    typeof result.answer === 'string' ? toThreePartAnswer(result.answer) : result.answer;
  const anchors = sanitizeAgentAnchors(result.anchors);
  const diagram = sanitizeLayerInstruction(result.diagram);
  // ADR-0013: model-painted mermaid never reaches any payload — geometry is
  // rendered exclusively by the engine's layer-instruction dispatchers.
  return { ...result, answer, anchors, diagram, mermaid: undefined };
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
