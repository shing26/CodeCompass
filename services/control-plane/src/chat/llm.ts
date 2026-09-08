import fs from 'node:fs';

export interface LlmProfile {
  name: string;
  /** Fallback: env COPILOT_LLM_BASE. */
  baseUrl?: string;
  /** Wins over baseUrl + /chat/completions. Fallback: env COPILOT_LLM_URL. */
  url?: string;
  /** Fallback: env COPILOT_LLM_MODEL. */
  model?: string;
  /** Env var holding the API key. Fallback: COPILOT_LLM_API_KEY. */
  apiKeyEnv?: string;
}

export interface ResolvedLlm {
  profileName: string;
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface ToolCallReq {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCallReq[];
  tool_call_id?: string;
}

export interface ChatOptions {
  tools?: ToolSpec[];
  onDelta?: (text: string) => void;
  timeoutMs?: number;
}

export interface ChatStreamResult {
  content: string;
  toolCalls: ToolCallReq[];
}

/**
 * Multi-provider LLM runtime with hot switching (ADR-0002). The active
 * profile is a runtime pointer: switching never restarts the process or
 * drops connections, and every switch lands in the session JSONL log.
 */
export class LlmManager {
  private profiles: LlmProfile[] = [];
  private activeName = '';

  constructor(
    private readonly profilesFile: string,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  load(): void {
    let profiles: LlmProfile[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(this.profilesFile, 'utf-8')) as {
        profiles?: LlmProfile[];
      };
      profiles = raw.profiles ?? [];
    } catch {
      // no profiles file — synthesize the env-passthrough default
    }
    if (!profiles.some((p) => p.name === 'default')) {
      profiles.unshift({ name: 'default' });
    }
    this.profiles = profiles;
    this.activeName = this.env.COPILOT_LLM_ACTIVE ?? profiles[0]!.name;
  }

  get profileNames(): string[] {
    return this.profiles.map((p) => p.name);
  }

  get activeProfileName(): string {
    return this.activeName;
  }

  switchTo(name: string): void {
    if (!this.profiles.some((p) => p.name === name)) {
      throw new Error(`unknown profile "${name}" — available: ${this.profileNames.join(', ')}`);
    }
    this.activeName = name;
  }

  configured(): boolean {
    return this.resolveActive() !== null;
  }

  resolveActive(): ResolvedLlm | null {
    const profile = this.profiles.find((p) => p.name === this.activeName);
    if (!profile) return null;
    const url = profile.url ?? this.env.COPILOT_LLM_URL;
    const base = profile.baseUrl ?? this.env.COPILOT_LLM_BASE;
    if (!url && !base) return null;
    const model = profile.model ?? this.env.COPILOT_LLM_MODEL;
    if (!model) return null;
    const apiKey = this.env[profile.apiKeyEnv ?? 'COPILOT_LLM_API_KEY'];
    if (!apiKey) return null;
    const endpoint = url ?? `${base!.replace(/\/$/, '')}/chat/completions`;
    return { profileName: profile.name, endpoint, model, apiKey };
  }

  /** OpenAI-compatible streaming chat; tool-call deltas are aggregated by
   * index the standard SSE way (id first chunk, name+arguments concatenated). */
  async chat(
    messages: readonly ChatMessage[],
    opts: ChatOptions = {},
    fetchImpl: typeof fetch = fetch,
  ): Promise<ChatStreamResult> {
    const resolved = this.resolveActive();
    if (!resolved) throw new Error('LLM not configured (COPILOT_LLM_* / llm-profiles.json)');
    const body: Record<string, unknown> = { model: resolved.model, messages, stream: true };
    if (opts.tools?.length) body.tools = opts.tools;
    const response = await fetchImpl(resolved.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`LLM ${response.status}: ${detail}`);
    }
    return parseSseStream(response, opts.onDelta);
  }
}

async function parseSseStream(
  response: Response,
  onDelta: ((text: string) => void) | undefined,
): Promise<ChatStreamResult> {
  const result: ChatStreamResult = { content: '', toolCalls: [] };
  if (!response.body) return result;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineAt: number;
    while ((newlineAt = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineAt).trim();
      buffer = buffer.slice(newlineAt + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        done = true;
        break;
      }
      try {
        const chunk = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{
            index?: number; id?: string; function?: { name?: string; arguments?: string };
          }> } }>;
        };
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          result.content += delta.content;
          onDelta?.(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const agg = result.toolCalls[idx] ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
          if (tc.id) agg.id = tc.id;
          if (tc.function?.name) agg.function.name += tc.function.name;
          if (tc.function?.arguments) agg.function.arguments += tc.function.arguments;
          result.toolCalls[idx] = agg;
        }
      } catch {
        // malformed chunk — skip, next data line decides
      }
    }
  }
  result.toolCalls = result.toolCalls.filter((tc) => tc.function.name);
  return result;
}

/** Minimal secret masking before tool results leave the machine (grill Q2:
 * full 13-pattern set stays in CodeCompass; copilot covers the obvious trio). */
export function maskSecrets(text: string): string {
  return text
    .replace(/(AKIA|ASIA)[A-Z0-9]{16}/g, '[REDACTED-AKID]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '[REDACTED-KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer [REDACTED]');
}

/** Minimal dotenv: KEY=VALUE lines, existing env wins (CodeCompass convention). */
export function loadDotEnv(file: string, env: NodeJS.ProcessEnv = process.env): number {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return 0;
  }
  let loaded = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && env[key] === undefined) {
      env[key] = value;
      loaded++;
    }
  }
  return loaded;
}
