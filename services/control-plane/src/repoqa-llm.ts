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
}

export const PROMPT_TOKEN_CAP = 8192;

export function capPrompt(input: string, maxTokens = PROMPT_TOKEN_CAP): string {
  const maxChars = maxTokens * 4;
  if (input.length <= maxChars) return input;
  const omitted = input.length - maxChars;
  return `${input.slice(0, maxChars)}\n[context truncated: ${omitted} chars omitted]`;
}

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

export async function completeReAct(
  prompt: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ReActLLMResult> {
  const url = env.REPOQA_LLM_URL?.trim();
  if (!url) throw new Error('REPOQA_LLM_URL is not configured');

  const model = env.REPOQA_LLM_MODEL?.trim() || 'repoqa-default';
  const apiKey = env.REPOQA_LLM_API_KEY?.trim();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
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
