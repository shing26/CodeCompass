import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  bindAnchorsToMermaid,
  capPrompt,
  chatCompletionsEndpoint,
  CODE_LINK_MMERMAID_GUIDE,
  completeReAct,
  extractCodeLinkBindings,
  isLlmConfigured,
  parseDotEnv,
  PROMPT_TOKEN_CAP,
  readDotEnvFile,
  runReActAgent,
  sanitizeMermaidClicks,
  THREE_PART_ANSWER_GUIDE,
  toThreePartAnswer,
  type AgentTool
} from './repoqa-llm';

function stubChatCompletions(
  handler: (body: any, call: number) => string
): Promise<{ url: string; bodies: string[]; close: () => void }> {
  return new Promise((resolve) => {
    const bodies: string[] = [];
    let call = 0;
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        bodies.push(raw);
        call += 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(handler(JSON.parse(raw), call));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        bodies,
        close: () => server.close()
      });
    });
  });
}

const spyTool: AgentTool = {
  name: 'trace_call_chain',
  description: 'Resolve a call chain.',
  parameters: 'query: string',
  execute: async (args) => {
    return [{ file: 'src/A.java', method: 'hello', line: 5, break: false }];
  }
};

describe('Issue 10 — .env configuration', () => {
  it('parses dotenv lines with comments, quotes, and blank lines', () => {
    const parsed = parseDotEnv(`
# comment
REPOQA_LLM_BASE=https://api.example.com/v1
REPOQA_LLM_API_KEY="sk-abc 123"
EMPTY=
REPOQA_LLM_MODEL='gpt-4o-mini'
`);
    expect(parsed.REPOQA_LLM_BASE).toBe('https://api.example.com/v1');
    expect(parsed.REPOQA_LLM_API_KEY).toBe('sk-abc 123');
    expect(parsed.REPOQA_LLM_MODEL).toBe('gpt-4o-mini');
    expect(parsed.EMPTY).toBe('');
  });

  it('returns {} for a missing .env file', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'repoqa-llm-dotenv-'));
    try {
      expect(readDotEnvFile(path.join(dir, 'nope.env'))).toEqual({});
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('builds the chat-completions endpoint from base URL, URL wins over base', () => {
    expect(
      chatCompletionsEndpoint({ REPOQA_LLM_BASE: 'https://api.example.com/v1/' })
    ).toBe('https://api.example.com/v1/chat/completions');
    expect(
      chatCompletionsEndpoint({
        REPOQA_LLM_BASE: 'https://api.example.com/v1',
        REPOQA_LLM_URL: 'https://proxy.local/custom'
      })
    ).toBe('https://proxy.local/custom');
    expect(chatCompletionsEndpoint({})).toBeUndefined();
  });

  it('reports configured only when an endpoint exists', () => {
    expect(isLlmConfigured({})).toBe(false);
    expect(isLlmConfigured({ REPOQA_LLM_BASE: 'https://api.example.com/v1' })).toBe(true);
    expect(isLlmConfigured({ REPOQA_LLM_URL: 'http://127.0.0.1:1/v1' })).toBe(true);
  });

  it('completeReAct sends model, stream, and bearer auth to the base endpoint', async () => {
    const stub = await stubChatCompletions(() =>
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ answer: 'pong' }) } }]
      })
    );
    try {
      const result = await completeReAct('ping', {
        REPOQA_LLM_BASE: stub.url,
        REPOQA_LLM_API_KEY: 'sk-test',
        REPOQA_LLM_MODEL: 'test-model'
      });
      expect(result.answer).toBe('pong');
      const sent = JSON.parse(stub.bodies[0]);
      expect(sent.model).toBe('test-model');
      expect(sent.stream).toBe(true);
      expect(sent.messages[0].content).toContain('ping');
    } finally {
      (stub as any).close();
    }
  });
});

describe('Issue 10 — ReAct agent loop', () => {
  it('executes a requested tool, feeds the result back, and finalizes the answer', async () => {
    const executed: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    const stub = await stubChatCompletions((_body, call) => {
      calls.push(JSON.stringify(_body));
      const content =
        call === 1
          ? JSON.stringify({ tool: { name: 'trace_call_chain', args: { query: 'hello' } } })
          : JSON.stringify({
              answer: 'hello 经由 DemoService 到达 greet',
              mermaid: 'flowchart LR\n  A[A]\n  B[B]\n  A --> B',
              anchors: [{ file: 'src/A.java', line: 5, symbol: 'A' }],
              suggestedAction: 'Trace B'
            });
      return JSON.stringify({ choices: [{ message: { content } }] });
    });
    try {
      const tool: AgentTool = {
        ...spyTool,
        execute: async (args) => {
          executed.push(args as Record<string, unknown>);
          return [{ file: 'src/A.java', method: 'hello', line: 5 }];
        }
      };
      const result = await runReActAgent({
        question: 'trace hello',
        context: 'hello (method @ src/Controller.java:6)',
        tools: [tool],
        env: { REPOQA_LLM_BASE: stub.url, REPOQA_LLM_MODEL: 'test-model' }
      });
      expect(executed).toEqual([{ query: 'hello' }]);
      expect(result.answer).toContain('业务概述');
      expect(result.answer).toContain('结论与下一步');
      expect(result.answer).toContain('hello 经由 DemoService 到达 greet');
      expect(result.mermaid).toContain('code://src/A.java#5');
      expect(result.suggestedAction).toBe('Trace B');
      expect(result.fallback).toBeUndefined();
      // Second request must carry the tool result history.
      expect(calls.length).toBe(2);
      expect(calls[1]).toContain('[tool result 1]');
      expect(calls[1]).toContain('Tool trace_call_chain');
    } finally {
      (stub as any).close();
    }
  });

  it('stops after maxSteps when the model keeps requesting tools', async () => {
    const stub = await stubChatCompletions(() =>
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ tool: { name: 'trace_call_chain', args: { query: 'x' } } })
            }
          }
        ]
      })
    );
    try {
      const result = await runReActAgent({
        question: 'trace x',
        context: 'x (method @ src/X.java:1)',
        tools: [spyTool],
        env: { REPOQA_LLM_URL: stub.url },
        maxSteps: 2
      });
      expect(result.answer).toContain('did not converge');
    } finally {
      (stub as any).close();
    }
  });

  it('falls back seamlessly when no LLM is configured', async () => {
    const result = await runReActAgent({
      question: 'trace hello',
      context: 'hello (method @ src/Controller.java:6)',
      tools: [spyTool],
      env: {}
    });
    expect(result.fallback).toBe(true);
  });

  it('caps prompts to the 8K token budget', () => {
    const huge = 'x'.repeat(PROMPT_TOKEN_CAP * 4 + 5000);
    const capped = capPrompt(huge);
    expect(capped.length).toBeLessThan(huge.length);
    expect(capped).toContain('context truncated');
  });
});

describe('Issue 10 — output contract helpers', () => {
  it('normalizes answers into the three-section layout', () => {
    expect(toThreePartAnswer('single line')).toBe('业务概述\n\nsingle line\n\n结论与下一步');
    const structured = '概述\n\n证据\n\n结论';
    expect(toThreePartAnswer(structured)).toBe('概述\n\n证据\n\n结论');
    expect(toThreePartAnswer('')).toBe('');
  });

  it('exposes the answer and mermaid guide constants', () => {
    expect(THREE_PART_ANSWER_GUIDE).toContain('业务概述');
    expect(THREE_PART_ANSWER_GUIDE).toContain('证据与拆解');
    expect(THREE_PART_ANSWER_GUIDE).toContain('结论与下一步');
    expect(CODE_LINK_MMERMAID_GUIDE).toContain('code://');
  });

  it('sanitizes mermaid clicks to code:// links only and strips fences', () => {
    const messy = '```mermaid\nflowchart LR\n  A[A]\n  click A "https://evil.example/x"\n  click A "code://src/A.java#5-9"\n```';
    const clean = sanitizeMermaidClicks(messy);
    expect(clean.startsWith('flowchart LR')).toBe(true);
    expect(clean).not.toContain('https://evil.example');
    expect(clean).toContain('code://src/A.java#5-9');
    expect(clean).not.toContain('```');
  });

  it('extracts code:// click bindings with file and line', () => {
    const bindings = extractCodeLinkBindings(
      'flowchart LR\n  A[A]\n  B[B]\n  A --> B\nclick A "code://src/A.java#12-20"\nclick B "code://src/B.java#3"'
    );
    expect(bindings).toEqual([
      { node: 'A', url: 'code://src/A.java#12-20', file: 'src/A.java', line: 12, lineEnd: 20 },
      { node: 'B', url: 'code://src/B.java#3', file: 'src/B.java', line: 3, lineEnd: undefined }
    ]);
  });

  it('binds anchors into mermaid for nodes that lack a code:// link', () => {
    const bound = bindAnchorsToMermaid('flowchart LR\n  A[A]\n  B[B]\n  A --> B', [
      { file: 'src/A.java', line: 5, symbol: 'A' },
      { file: 'src/B.java', line: 9, symbol: 'B' },
      { file: 'src/Missing.java', line: 1, symbol: 'Missing' }
    ]);
    expect(bound).toContain('click A "code://src/A.java#5"');
    expect(bound).toContain('click B "code://src/B.java#9"');
    expect(bound).not.toContain('Missing');
  });

  it('keeps existing code:// bindings untouched', () => {
    const bound = bindAnchorsToMermaid('flowchart LR\n  A[A]\nclick A "code://src/A.java#42"', [
      { file: 'src/A.java', line: 5, symbol: 'A' }
    ]);
    expect(bound).toContain('click A "code://src/A.java#42"');
    expect(bound).not.toContain('code://src/A.java#5');
  });
});