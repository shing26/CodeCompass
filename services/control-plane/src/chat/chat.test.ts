import { describe, expect, it, vi } from 'vitest';
import {
  ReActAgent,
  StreamLeakFilter,
  stripTextToolCalls,
  toToolSpecs,
  type AgentDeps,
  type McpLike,
} from './agent';
import { LlmManager, loadDotEnv, maskSecrets } from './llm';
import { ChatStore } from './store';
import { deriveAutoApprove } from './approve';

const noopLog = { write: vi.fn() } as unknown as import('./log').SessionLogger;

function makeLlm(env: Record<string, string>): LlmManager {
  const llm = new LlmManager('Z:/definitely-missing.json', env);
  llm.load();
  return llm;
}

function makeMcp(overrides: Partial<McpLike> = {}) {
  const callTool = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    if (name === 'codecompass_list_repos') {
      return { payload: { repos: [{ id: 'repo-1', localPath: 'D:/repo' }] }, raw: '{}', ms: 1 };
    }
    return { payload: { buckets: { hubs: { total: 3 } } }, raw: '{"buckets":{"hubs":{"total":3}}}', ms: 5 };
  });
  return {
    connected: true as boolean,
    currentRepo: 'repo-1',
    toolsDetail: [
      {
        name: 'codecompass_scan',
        description: 'scan',
        inputSchema: { type: 'object', properties: { repoId: { type: 'string' } } },
      },
    ],
    callTool,
    ...overrides,
  } as McpLike & { callTool: typeof callTool };
}

function sseResponse(payloads: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const payload of payloads) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

const llmEnv = {
  COPILOT_LLM_BASE: 'https://api.x.com/v1',
  COPILOT_LLM_MODEL: 'm1',
  COPILOT_LLM_API_KEY: 'k',
};

// ---------- config / approve ----------

describe('deriveAutoApprove', () => {
  it('follows the live tools/list result, sorted', () => {
    expect(
      deriveAutoApprove([
        { name: 'codecompass_scan' },
        { name: 'codecompass_list_repos' },
        { name: 'codecompass_diagnose' },
      ]),
    ).toEqual(['codecompass_diagnose', 'codecompass_list_repos', 'codecompass_scan']);
  });
});

// ---------- llm ----------

describe('LlmManager (chat keys)', () => {
  it('resolves COPILOT_LLM_* env fallback and url-over-base rule', () => {
    const llm = new LlmManager('Z:/definitely-missing.json', {
      COPILOT_LLM_URL: 'https://gw.example.com/chat',
      COPILOT_LLM_BASE: 'https://api.x.com/v1',
      COPILOT_LLM_MODEL: 'm1',
      COPILOT_LLM_API_KEY: 'k',
    });
    llm.load();
    expect(llm.resolveActive()?.endpoint).toBe('https://gw.example.com/chat');
    expect(llm.configured()).toBe(true);
  });

  it('is unconfigured without an API key and rejects unknown profiles', () => {
    const llm = new LlmManager('Z:/definitely-missing.json', { COPILOT_LLM_BASE: 'https://x', COPILOT_LLM_MODEL: 'm' });
    llm.load();
    expect(llm.configured()).toBe(false);
    expect(() => llm.switchTo('nope')).toThrow(/unknown profile/);
  });

  it('maskSecrets redacts the obvious trio', () => {
    const fakeAkid = 'AKIA' + 'IOSFODNN7EXAMPLE';
    const masked = maskSecrets(`key ${fakeAkid} and sk-${'a'.repeat(24)} and Bearer ${'x'.repeat(30)}`);
    expect(masked).toContain('[REDACTED-AKID]');
    expect(masked).toContain('[REDACTED-KEY]');
    expect(masked).not.toContain(fakeAkid);
  });

  it('loadDotEnv returns 0 for a missing file', () => {
    const env: Record<string, string | undefined> = { EXISTING: 'keep' };
    expect(loadDotEnv('Z:/definitely-missing.env', env)).toBe(0);
    expect(env.EXISTING).toBe('keep');
  });
});

describe('chat SSE streaming', () => {
  it('aggregates content deltas and tool-call fragments', async () => {
    const llm = new LlmManager('Z:/definitely-missing.json', {
      COPILOT_LLM_BASE: 'https://api.x.com/v1',
      COPILOT_LLM_MODEL: 'm1',
      COPILOT_LLM_API_KEY: 'k',
    });
    llm.load();
    const deltas: string[] = [];
    const fetchImpl = (async () =>
      sseResponse([
        { choices: [{ delta: { content: 'Hello ' } }] },
        { choices: [{ delta: { content: 'world' } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'codecompass_scan', arguments: '{"repo' } },
                ],
              },
            },
          ],
        },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'Id":"r1"}' } }] } }] },
      ])) as unknown as typeof fetch;
    const result = await llm.chat([{ role: 'user', content: 'hi' }], { onDelta: (t) => deltas.push(t) }, fetchImpl);
    expect(result.content).toBe('Hello world');
    expect(result.toolCalls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'codecompass_scan', arguments: '{"repoId":"r1"}' } },
    ]);
    expect(deltas.join('')).toBe('Hello world');
  });

  it('surfaces provider errors with status', async () => {
    const llm = new LlmManager('Z:/definitely-missing.json', {
      COPILOT_LLM_BASE: 'https://api.x.com/v1',
      COPILOT_LLM_MODEL: 'm1',
      COPILOT_LLM_API_KEY: 'k',
    });
    llm.load();
    const fetchImpl = (async () => new Response('{"error":"quota"}', { status: 402 })) as unknown as typeof fetch;
    await expect(llm.chat([{ role: 'user', content: 'hi' }], {}, fetchImpl)).rejects.toThrow(/LLM 402/);
  });
});

// ---------- store ----------

describe('ChatStore (engine db tables)', () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const store = new ChatStore(db);
  store.init();

  it('creates sessions, persists messages with citations, isolates sessions', () => {
    store.createSession('s1', 'repo-1', '会话 A');
    store.createSession('s2', 'repo-2', '会话 B');
    expect(store.listSessions()).toHaveLength(2);

    store.addMessage('s1', 'user', '第一问');
    store.addMessage('s1', 'assistant', '第一答', [{ n: 1, tool: 'codecompass_scan', args: {}, ms: 5 }]);
    store.addMessage('s2', 'user', '另一会话');
    expect(store.getMessages('s1')).toHaveLength(2);
    expect(store.historyFor('s1')).toEqual([
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
    ]);
    expect(store.historyFor('s2')).toEqual([{ role: 'user', content: '另一会话' }]);
    expect(JSON.parse(store.getMessages('s1')[1].citations!)).toEqual([
      { n: 1, tool: 'codecompass_scan', args: {}, ms: 5 },
    ]);
  });

  it('is idempotent on re-init (PRAGMA-style migration safety)', () => {
    expect(() => store.init()).not.toThrow();
    expect(store.listSessions()).toHaveLength(2);
  });
});

// ---------- agent ----------

describe('ReActAgent fallback (no LLM configured)', () => {
  it('routes scan-like intents to codecompass_scan with the session repoId', async () => {
    const mcp = makeMcp();
    const agent = new ReActAgent({ mcp, llm: makeLlm({}), log: noopLog, onDelta: () => {} });
    const turn = await agent.run('这个仓库哪里最值得改？');
    expect(turn.fallback).toBe(true);
    expect(turn.citations).toEqual([
      { n: 1, tool: 'codecompass_scan', args: { repoId: 'repo-1' }, ms: expect.any(Number) },
    ]);
    expect(turn.citations[0].tool).toBe('codecompass_scan');
  });
});

describe('ReActAgent tool loop (LLM configured)', () => {
  function twoStepDeps(finalContent = 'hubs 榜首最值得看 [cite: 1]') {
    const bodies: Array<Record<string, unknown>> = [];
    let calls = 0;
    const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
      if (init?.body) bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      calls += 1;
      return calls === 1
        ? sseResponse([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: 'call_1', function: { name: 'codecompass_scan', arguments: '{"repoId":"repo-1"}' } },
                    ],
                  },
                },
              ],
            },
          ])
        : sseResponse([{ choices: [{ delta: { content: finalContent } }] }]);
    }) as unknown as typeof fetch;
    return { deps: { mcp: makeMcp(), llm: makeLlm(llmEnv), log: noopLog, onDelta: () => {}, fetchImpl } as AgentDeps, bodies };
  }

  it('injects the system prompt with session repo identity (QA-03 根治)', async () => {
    const { deps, bodies } = twoStepDeps();
    const agent = new ReActAgent(deps);
    agent.setSessionRepo('repo-1');
    await agent.run('哪里值得改？');
    const firstBody = bodies[0];
    const sys = (firstBody.messages as Array<{ role: string; content: string }>)[0];
    expect(sys.role).toBe('system');
    expect(sys.content).toContain('[cite: N]');
    expect(sys.content).toContain('repo-1');
  });

  it('delivers ALL bucket summaries to the model instead of amputating at 4K (QA-02)', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const mcp = makeMcp();
    const items = (n: number, prefix: string, withDetail = false) =>
      Array.from({ length: n }, (_, i) => ({
        symbol: `${prefix}${i}`,
        kind: 'method',
        filePath: `a/${prefix}${i}.java`,
        line: i + 1,
        ...(withDetail ? { detail: `PageRank 0.0${i}; in ${n - i} / out 0` } : {}),
      }));
    (mcp as unknown as { callTool: unknown }).callTool = vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({
      payload: {},
      raw: JSON.stringify({
        repoName: 'petclinic',
        buckets: [
          { id: 'orphanedPublic', title: 'orphaned', total: 154, items: items(150, 'Orphan') },
          { id: 'hubs', title: 'hubs', total: 185, items: items(170, 'Hub', true), nextAction: 'run refactor_plan' },
        ],
      }),
      ms: 1,
    }));
    let calls = 0;
    const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
      if (init?.body) bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      calls += 1;
      return calls === 1
        ? sseResponse([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: 'call_1', function: { name: 'codecompass_scan', arguments: '{"repoId":"repo-1"}' } },
                    ],
                  },
                },
              ],
            },
          ])
        : sseResponse([{ choices: [{ delta: { content: '五桶齐了 [cite: 1]' } }] }]);
    }) as unknown as typeof fetch;

    const agent = new ReActAgent({ mcp, llm: makeLlm(llmEnv), log: noopLog, onDelta: () => {}, fetchImpl });
    const turn = await agent.run('scan');

    const lastBody = bodies[bodies.length - 1];
    const toolMsgs = ((lastBody.messages as Array<{ role: string; content?: string }>) ?? []).filter(
      (m) => m.role === 'tool',
    );
    const content = toolMsgs[0]!.content!;
    expect(content).toContain('## orphanedPublic');
    expect(content).toContain('## hubs'); // 旧实现 4K 截断后此桶不可见（QA-02 主诉）
    expect(content).toMatch(/Hub0.*— PageRank 0\.00; in 170/); // P3-7: detail 随行
    expect(content.length).toBeLessThanOrEqual(4_000);
    expect(turn.answer).toContain('五桶齐了');
  });

  it('forces a synthesis round when the step cap exhausts on tool rounds (M3-01)', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const toolCallChunk = {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'call_n', function: { name: 'codecompass_scan', arguments: '{"repoId":"repo-1"}' } },
            ],
          },
        },
      ],
    };
    let calls = 0;
    const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
      if (init?.body) bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      calls += 1;
      return calls <= 3
        ? sseResponse([toolCallChunk])
        : sseResponse([{ choices: [{ delta: { content: '综合结论 [cite: 3]' } }] }]);
    }) as unknown as typeof fetch;
    const agent = new ReActAgent({ mcp: makeMcp(), llm: makeLlm(llmEnv), log: noopLog, onDelta: () => {}, fetchImpl });

    const turn = await agent.run('哪里值得改？');
    expect(turn.steps).toBe(4);
    expect(turn.citations).toHaveLength(3);
    expect(turn.answer).toBe('综合结论 [cite: 3]');
    const lastBody = bodies[bodies.length - 1];
    expect(lastBody.tools).toBeUndefined();
  });

  it('serializes overlapping turns so history does not interleave (QA-04)', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let calls = 0;
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const fetchImpl = (async (_url: unknown, init?: { body?: string }) => {
      if (init?.body) bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      calls += 1;
      if (calls === 1) await gateA;
      return sseResponse([{ choices: [{ delta: { content: `answer-${calls}` } }] }]);
    }) as unknown as typeof fetch;
    const agent = new ReActAgent({ mcp: makeMcp(), llm: makeLlm(llmEnv), log: noopLog, onDelta: () => {}, fetchImpl });

    const pA = agent.runSerialized('问题A');
    const pB = agent.runSerialized('问题B');
    await new Promise((r) => setTimeout(r, 30));
    expect(bodies.some((b) => JSON.stringify(b).includes('问题B'))).toBe(false);
    releaseA();
    const [a, b] = await Promise.all([pA, pB]);
    expect(a.answer).toBe('answer-1');
    expect(b.answer).toBe('answer-2');
    expect(JSON.stringify(bodies[bodies.length - 1].messages)).toContain('问题A');
  });
});

// ---------- stream filter ----------

describe('StreamLeakFilter', () => {
  it('suppresses text-form tool-call blocks mid-stream, even when tags split across chunks', () => {
    const emitted: string[] = [];
    const filter = new StreamLeakFilter((t) => emitted.push(t));
    filter.write('正常开头 ');
    filter.write('<tool_');
    filter.write('call>\n<function=x>secret-stuff</function>\n</tool_call>');
    filter.write('\n正常结尾');
    filter.flushRest();
    const text = emitted.join('');
    expect(text).toContain('正常开头');
    expect(text).toContain('正常结尾');
    expect(text).not.toContain('secret-stuff');
    expect(text).not.toContain('<tool_call');
  });

  it('QA-01 regression: nested </function> must not release an outer <tool_call> block', () => {
    const emitted: string[] = [];
    const filter = new StreamLeakFilter((t) => emitted.push(t));
    filter.write('前文。');
    filter.write('<tool_call><function=x>leak</function>');
    filter.write('更多泄漏');
    filter.write('</tool_call>后文');
    filter.flushRest();
    const text = emitted.join('');
    expect(text).toContain('前文。');
    expect(text).toContain('后文');
    expect(text).not.toContain('leak');
    expect(text).not.toContain('更多泄漏');
    expect(text).not.toContain('tool_call');
  });

  it('stripTextToolCalls cleans text-form calls', () => {
    expect(stripTextToolCalls('a<tool_call>x</tool_call>b')).toBe('ab');
  });
});

// ---------- toToolSpecs ----------

describe('toToolSpecs', () => {
  it('maps MCP tools/list output to OpenAI function specs with dynamic schemas', () => {
    const specs = toToolSpecs([
      { name: 'codecompass_scan', description: 'scan a repo', inputSchema: { type: 'object', properties: {} } },
    ]);
    expect(specs).toEqual([
      {
        type: 'function',
        function: { name: 'codecompass_scan', description: 'scan a repo', parameters: { type: 'object', properties: {} } },
      },
    ]);
  });
});
