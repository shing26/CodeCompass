import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  buildTokenUsage,
  capPrompt,
  chatCompletionsEndpoint,
  completeReAct,
  DIAGRAM_LAYER_GUIDE,
  LAYER_DIAGRAM_KINDS,
  sanitizeLayerInstruction,
  estimateTokenCount,
  isLlmConfigured,
  llmRuntimeInfo,
  maskHostname,
  mergeTokenUsage,
  parseProviderUsage,
  parseDotEnv,
  PROMPT_TOKEN_CAP,
  readDotEnvFile,
  runReActAgent,
  finalizeAgentResult,
  sanitizeAgentAnchors,
  unionIncidentAnchors,
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

describe('Sprint 1 token usage and runtime classification', () => {
  it('estimates tokens as ceil(chars / 4) and builds usage totals', () => {
    expect(estimateTokenCount('')).toBe(0);
    expect(estimateTokenCount('abcd')).toBe(1);
    expect(estimateTokenCount('abcde')).toBe(2);
    expect(buildTokenUsage(10, 20, 'provider')).toEqual({
      input: 10,
      output: 20,
      total: 30,
      source: 'provider'
    });
  });

  it('merges provider usage across ReAct steps and downgrades to estimate', () => {
    const provider = buildTokenUsage(10, 20, 'provider');
    const estimate = buildTokenUsage(5, 5, 'estimate');
    expect(mergeTokenUsage(provider, provider)).toEqual({
      input: 20,
      output: 40,
      total: 60,
      source: 'provider'
    });
    expect(mergeTokenUsage(provider, estimate)?.source).toBe('estimate');
    expect(mergeTokenUsage(provider, undefined)).toBe(provider);
    expect(mergeTokenUsage(undefined, estimate)).toBe(estimate);
  });

  it('parses provider usage with fallback totals', () => {
    expect(
      parseProviderUsage({
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 30 }
      })
    ).toEqual({ input: 12, output: 8, total: 30 });
    expect(
      parseProviderUsage({
        usage: { prompt_tokens: 12, completion_tokens: 8 }
      })
    ).toEqual({ input: 12, output: 8, total: 20 });
    expect(parseProviderUsage({})).toBeUndefined();
    expect(parseProviderUsage(undefined)).toBeUndefined();
  });

  it('classifies LLM endpoints as none/local/remote', () => {
    expect(llmRuntimeInfo({})).toEqual({ mode: 'none' });
    expect(llmRuntimeInfo({ REPOQA_LLM_URL: 'http://localhost:11434/v1' })).toEqual({
      mode: 'local',
      host: 'localhost'
    });
    expect(llmRuntimeInfo({ REPOQA_LLM_URL: 'http://[::1]:8080/v1' })).toEqual({
      mode: 'local',
      host: '[::1]'
    });
    expect(
      llmRuntimeInfo({ REPOQA_LLM_URL: 'https://api.example.com/v1/chat/completions' })
    ).toEqual({ mode: 'remote', host: 'api.example.com' });
  });

  it('masks middle hostname labels while keeping the first and TLD', () => {
    expect(maskHostname('api.openai.com')).toBe('api.***.com');
    expect(maskHostname('my.proxy.internal.example.com')).toBe(
      'my.***.***.***.com'
    );
    expect(maskHostname('127.0.0.1')).toBe('127.0.0.1');
    expect(maskHostname('[::1]')).toBe('[::1]');
  });

  it('reads provider usage from a non-streamed completion response', async () => {
    const stub = await stubChatCompletions(() =>
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ answer: 'done' }) } }],
        usage: { prompt_tokens: 14, completion_tokens: 9, total_tokens: 23 }
      })
    );
    try {
      const result = await completeReAct('ping', {
        REPOQA_LLM_BASE: stub.url,
        REPOQA_LLM_MODEL: 'test-model'
      });
      expect(result.answer).toBe('done');
      expect(result.usage).toEqual({ input: 14, output: 9, total: 23, source: 'provider' });
    } finally {
      (stub as any).close();
    }
  });

  it('reads provider usage from a streamed completion response', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
      res.write(
        'data: {"usage":{"prompt_tokens":7,"completion_tokens":5,"total_tokens":12}}\n\n'
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    try {
      const result = await completeReAct('say hello', {
        REPOQA_LLM_URL: `http://127.0.0.1:${address.port}`
      });
      expect(result.answer).toBe('hello');
      expect(result.usage).toEqual({ input: 7, output: 5, total: 12, source: 'provider' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
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
              diagram: {
                kind: 'call_chain',
                focus: ['hello'],
                collapse: 3,
                annotations: { hello: '入口路由方法' }
              },
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
      // ADR-0013: the sanitized layer instruction survives; no model mermaid.
      expect(result.diagram).toEqual({
        kind: 'call_chain',
        focus: ['hello'],
        collapse: 3,
        annotations: { hello: '入口路由方法' }
      });
      expect(result.mermaid).toBeUndefined();
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

  it('exposes the answer and diagram-layer guide constants', () => {
    expect(THREE_PART_ANSWER_GUIDE).toContain('业务概述');
    expect(THREE_PART_ANSWER_GUIDE).toContain('证据与拆解');
    expect(THREE_PART_ANSWER_GUIDE).toContain('结论与下一步');
    // ADR-0013: the guide forbids model mermaid and pins the kind whitelist.
    expect(DIAGRAM_LAYER_GUIDE).toContain('NEVER output mermaid');
    expect(DIAGRAM_LAYER_GUIDE).toContain('call_chain');
    expect(DIAGRAM_LAYER_GUIDE).toContain('config_topo');
    expect(DIAGRAM_LAYER_GUIDE).toContain('tour');
    expect(LAYER_DIAGRAM_KINDS).toEqual(['call_chain', 'config_topo', 'tour']);
  });

  it('sanitizes layer instructions: kind whitelist, focus/collapse/annotations caps', () => {
    expect(sanitizeLayerInstruction('nope')).toBeUndefined();
    expect(sanitizeLayerInstruction({ kind: 'blast' })).toBeUndefined(); // unknown kind
    expect(sanitizeLayerInstruction({ kind: 42 })).toBeUndefined();
    const clean = sanitizeLayerInstruction({
      kind: 'call_chain',
      focus: ['hello', '  ', 42, 'DemoService'],
      collapse: 99,
      annotations: {
        hello: '入口方法\n第二行',
        Ghost: 'no such node',
        dropped: 7
      }
    });
    expect(clean).toEqual({
      kind: 'call_chain',
      focus: ['hello', 'DemoService'],
      collapse: 20,
      // Structural layer only filters shape; node existence is enforced by the
      // engine renderer (Ghost stays until the render-time existence check).
      annotations: { hello: '入口方法 第二行', Ghost: 'no such node' }
    });
    // Everything invalid → undefined (finalize drops the instruction wholly).
    expect(
      sanitizeLayerInstruction({ kind: 'tour', focus: 'not-an-array', collapse: 0 })
    ).toEqual({ kind: 'tour' });
  });

  it('finalizeAgentResult strips model mermaid and keeps the sanitized diagram', () => {
    const result = finalizeAgentResult({
      answer: '概述\n\n证据\n\n结论',
      mermaid: 'flowchart LR\n  A --> B',
      diagram: { kind: 'config_topo', focus: ['server.port'] },
      anchors: [
        { file: 'src/A.java', symbol: 'A', line: 5 },
        { symbol: 'Broken', line: 1 }
      ] as any
    });
    expect(result.anchors).toEqual([{ file: 'src/A.java', symbol: 'A', line: 5 }]);
    expect(result.mermaid).toBeUndefined();
    expect(result.diagram).toEqual({ kind: 'config_topo', focus: ['server.port'] });
  });

  it('finalizeAgentResult drops wholly-invalid diagram instructions', () => {
    const result = finalizeAgentResult({
      answer: '概述\n\n证据\n\n结论',
      diagram: { kind: 'evil_graph', focus: ['x'] } as any
    });
    expect(result.diagram).toBeUndefined();
    expect(result.mermaid).toBeUndefined();
    expect(result.answer).toContain('概述');
  });
});

describe('Issue 23 hotfix — agent anchor sanitization', () => {
  it('drops malformed model-supplied anchors (missing file/symbol/line)', () => {
    const cleaned = sanitizeAgentAnchors([
      { symbol: 'OrderService', line: 11 }, // missing file — crashed path.resolve before
      { file: 'src/A.java', symbol: 'A', line: 5 },
      { file: '', symbol: 'B', line: 3 }, // blank file
      { file: 'src/C.java', symbol: '', line: 2 }, // blank symbol
      { file: 'src/D.java', symbol: 'D' }, // missing line
      { file: 'src/E.java', symbol: 'E', line: Number.NaN },
      'not-an-object' as unknown as Record<string, unknown>,
      { file: 'src/F.java', symbol: 'F', line: 7.9 } // fractional line truncates
    ]);
    expect(cleaned).toEqual([
      { file: 'src/A.java', symbol: 'A', line: 5 },
      { file: 'src/F.java', symbol: 'F', line: 7 }
    ]);
  });

  it('returns undefined for non-array input and empty arrays stay empty', () => {
    expect(sanitizeAgentAnchors(undefined)).toBeUndefined();
    expect(sanitizeAgentAnchors('nope')).toBeUndefined();
    expect(sanitizeAgentAnchors([])).toEqual([]);
  });

  it('finalizeAgentResult sanitizes anchors and strips model mermaid', () => {
    const result = finalizeAgentResult({
      answer: '概述\n\n证据\n\n结论',
      mermaid: 'flowchart LR\n  A[A]',
      anchors: [
        { file: 'src/A.java', symbol: 'A', line: 5 },
        { symbol: 'Broken', line: 1 }
      ] as any
    });
    expect(result.anchors).toEqual([{ file: 'src/A.java', symbol: 'A', line: 5 }]);
    // ADR-0013: the model-painted diagram is discarded, anchors are minted by
    // the engine — no click-binding synthesis on model text anymore.
    expect(result.mermaid).toBeUndefined();
  });

  it('unionIncidentAnchors leads with stack anchors, dedups and drops malformed', () => {
    const stack = [
      { file: 'src/OrderService.java', line: 11, symbol: 'OrderService.findById' },
      { file: 'src/OrdersController.java', line: 11, symbol: 'OrdersController.getOrder' }
    ];
    const merged = unionIncidentAnchors(stack, [
      { file: 'src/OrderService.java', symbol: 'OrderService.findById', line: 11 }, // dup of stack[0]
      { file: 'src/OrderRepository.java', symbol: 'OrderRepository.findById', line: 9 }, // extra location
      { symbol: 'malformed' } as any // no file — dropped
    ]);
    expect(merged).toEqual([
      { file: 'src/OrderService.java', line: 11, symbol: 'OrderService.findById' },
      { file: 'src/OrdersController.java', line: 11, symbol: 'OrdersController.getOrder' },
      { file: 'src/OrderRepository.java', line: 9, symbol: 'OrderRepository.findById' }
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Issue 23 — native tools/tool_calls protocol (incident copilot)      */
/* ------------------------------------------------------------------ */

import {
  completeNativeChat,
  INCIDENT_MAX_AGENT_STEPS,
  INCIDENT_ZERO_HALLUCINATION_GUIDE,
  NativeToolsUnsupportedError,
  parseToolCall,
  toNativeToolSpecs
} from './repoqa-llm';

describe('Issue 23 — native tool protocol helpers', () => {
  it('converts AgentTool descriptors to standard tool specs', () => {
    const specs = toNativeToolSpecs([
      {
        name: 'parse_stack_trace',
        description: 'Parse a stack trace.',
        parameterSchema: { type: 'object', properties: { stack: { type: 'string' } } },
        execute: () => null
      }
    ]);
    expect(specs).toEqual([
      {
        type: 'function',
        function: {
          name: 'parse_stack_trace',
          description: 'Parse a stack trace.',
          parameters: { type: 'object', properties: { stack: { type: 'string' } } }
        }
      }
    ]);
    // Missing schema falls back to a permissive object schema.
    const fallback = toNativeToolSpecs([{ name: 't', description: 'd', execute: () => null }]);
    expect(fallback[0].function.parameters).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: true
    });
  });

  it('parses standard and flattened tool_call shapes', () => {
    const standard = parseToolCall({
      id: 'call_1',
      function: { name: 'diagnose_chain', arguments: '{"entrySymbol":"hello"}' }
    });
    expect(standard).toEqual({ name: 'diagnose_chain', args: { entrySymbol: 'hello' } });
    // DeepSeek-style empty arguments string.
    expect(parseToolCall({ id: 'c2', function: { name: 'x', arguments: '' } })).toEqual({
      name: 'x',
      args: {}
    });
    // Malformed JSON arguments -> null (caller feeds back an error).
    expect(parseToolCall({ function: { name: 'x', arguments: '{oops' } })).toBeNull();
    // Flattened shape from tolerant providers.
    expect(parseToolCall({ name: 'y', arguments: { key: 1 } })).toEqual({ name: 'y', args: { key: 1 } });
    // No name -> null.
    expect(parseToolCall({ function: { arguments: '{}' } })).toBeNull();
  });

  it('exposes the incident budget and zero-hallucination guide', () => {
    expect(INCIDENT_MAX_AGENT_STEPS).toBe(6);
    expect(INCIDENT_ZERO_HALLUCINATION_GUIDE).toContain('Zero-Hallucination Contract');
    expect(INCIDENT_ZERO_HALLUCINATION_GUIDE).toContain('BREAK');
  });
});

describe('Issue 23 — runReActAgent with nativeTools', () => {
  it('handles DeepSeek-style reasoning_content + tool_calls then final answer', async () => {
    const executed: string[] = [];
    const stub = await stubChatCompletions((_body, call) => {
      if (call === 1) {
        // DeepSeek dialect: reasoning_content carries the thinking, content is
        // empty, the tool request lives in tool_calls (JSON string arguments).
        return JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                reasoning_content: '先解析堆栈再诊断。',
                tool_calls: [
                  {
                    id: 'call_a1',
                    type: 'function',
                    function: {
                      name: 'trace_call_chain',
                      arguments: '{"query":"hello"}'
                    }
                  }
                ]
              }
            }
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
        });
      }
      return JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({
                answer: '崩溃点在 DemoService.greet',
                anchors: [{ file: 'src/DemoService.java', line: 4, symbol: 'greet' }]
              })
            }
          }
        ]
      });
    });
    try {
      const tool: AgentTool = {
        name: 'trace_call_chain',
        description: 'Resolve a call chain.',
        execute: async (args) => {
          executed.push(String((args as any).query));
          return [{ file: 'src/DemoService.java', method: 'greet', line: 4 }];
        }
      };
      const result = await runReActAgent({
        question: '排查 NPE',
        context: 'hello (method @ src/Controller.java:6)',
        tools: [tool],
        env: { REPOQA_LLM_BASE: stub.url, REPOQA_LLM_MODEL: 'deepseek-reasoner' },
        nativeTools: true,
        guideExtra: INCIDENT_ZERO_HALLUCINATION_GUIDE
      });
      expect(executed).toEqual(['hello']);
      expect(result.answer).toContain('崩溃点在 DemoService.greet');
      expect(result.usage?.source).toBe('provider');
      expect(result.fallback).toBeUndefined();
      // The transcript must replay assistant.tool_calls + role:'tool' results.
      const secondRequest = JSON.parse(stub.bodies[1]) as any;
      const roles = secondRequest.messages.map((m: any) => m.role);
      expect(roles).toEqual(['user', 'assistant', 'tool']);
      expect(secondRequest.messages[1].tool_calls[0].id).toBe('call_a1');
      expect(secondRequest.messages[2].tool_call_id).toBe('call_a1');
      expect(secondRequest.messages[2].content).toContain('src/DemoService.java');
      // The request carried standard tools + zero-hallucination guide.
      const firstRequest = JSON.parse(stub.bodies[0]) as any;
      expect(firstRequest.tools[0].function.name).toBe('trace_call_chain');
      expect(firstRequest.messages[0].content).toContain('Zero-Hallucination Contract');
    } finally {
      (stub as any).close();
    }
  });

  it('converges within the 6-step incident budget and stops after it', async () => {
    let call = 0;
    const stub = await stubChatCompletions(() => {
      call += 1;
      return JSON.stringify({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: `call_${call}`,
                  function: { name: 'trace_call_chain', arguments: '{"query":"x"}' }
                }
              ]
            }
          }
        ]
      });
    });
    try {
      const result = await runReActAgent({
        question: 'loop forever',
        context: 'ctx',
        tools: [spyTool],
        env: { REPOQA_LLM_BASE: stub.url },
        nativeTools: true,
        maxSteps: INCIDENT_MAX_AGENT_STEPS
      });
      // 6 native turns, each executing one tool, then the non-convergence answer.
      expect(call).toBe(INCIDENT_MAX_AGENT_STEPS);
      expect(result.answer).toContain('did not converge');
    } finally {
      (stub as any).close();
    }
  });

  it('tolerates unknown tools and malformed tool_calls without crashing', async () => {
    const stub = await stubChatCompletions((_body, call) => {
      if (call === 1) {
        return JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  { id: 'c1', function: { name: 'no_such_tool', arguments: '{}' } },
                  { id: 'c2', function: { name: 'trace_call_chain', arguments: '{broken json' } },
                  { function: {} }
                ]
              }
            }
          ]
        });
      }
      return JSON.stringify({
        choices: [
          { message: { role: 'assistant', content: JSON.stringify({ answer: 'recovered' }) } }
        ]
      });
    });
    try {
      const result = await runReActAgent({
        question: 'weird model output',
        context: 'ctx',
        tools: [spyTool],
        env: { REPOQA_LLM_BASE: stub.url },
        nativeTools: true
      });
      expect(result.answer).toContain('recovered');
      // Malformed/empty calls were dropped; the two executable calls were run
      // (unknown tool -> error result, broken JSON args -> error result) and
      // every replayed assistant.tool_call has a matching role:'tool' response.
      const second = JSON.parse(stub.bodies[1]) as any;
      const toolMessages = second.messages.filter((m: any) => m.role === 'tool');
      expect(toolMessages).toHaveLength(2);
      const assistant = second.messages.find((m: any) => m.role === 'assistant');
      expect(assistant.tool_calls).toHaveLength(2);
      expect(toolMessages.map((m: any) => m.tool_call_id)).toEqual(
        assistant.tool_calls.map((c: any) => c.id)
      );
      expect(JSON.parse(toolMessages[0].content).error).toContain('unknown tool');
      expect(JSON.parse(toolMessages[1].content).error).toContain('arguments');
    } finally {
      (stub as any).close();
    }
  });

  it('degrades to the legacy text-JSON protocol when the endpoint rejects tools', async () => {
    let sawTools = false;
    const raw = http.createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        const parsed = JSON.parse(data) as any;
        if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
          sawTools = true;
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'tools is not supported' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    answer: '文本协议回答',
                    anchors: [{ file: 'src/A.java', line: 5, symbol: 'A' }]
                  })
                }
              }
            ]
          })
        );
      });
    });
    await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve));
    const address = raw.address() as AddressInfo;
    try {
      const result = await runReActAgent({
        question: 'legacy endpoint',
        context: 'ctx',
        tools: [spyTool],
        env: { REPOQA_LLM_BASE: `http://127.0.0.1:${address.port}` },
        nativeTools: true
      });
      expect(sawTools).toBe(true);
      expect(result.answer).toContain('文本协议回答');
    } finally {
      await new Promise<void>((resolve) => raw.close(() => resolve()));
    }
  });

  it('completeNativeChat reports NativeToolsUnsupportedError with the original status', async () => {
    const raw = http.createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        const parsed = JSON.parse(data) as any;
        if (Array.isArray(parsed.tools)) {
          res.writeHead(422, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'no tools here' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
      });
    });
    await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', resolve));
    const address = raw.address() as AddressInfo;
    try {
      await expect(
        completeNativeChat([{ role: 'user', content: 'hi' }], {
          REPOQA_LLM_BASE: `http://127.0.0.1:${address.port}`
        }, toNativeToolSpecs([{ name: 't', description: 'd', execute: () => null }]))
      ).rejects.toThrowError(NativeToolsUnsupportedError);
    } finally {
      await new Promise<void>((resolve) => raw.close(() => resolve()));
    }
  });
});
