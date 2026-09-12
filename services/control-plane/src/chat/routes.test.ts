import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { registerChatRoutes, type ChatRuntime } from './routes';
import { ChatStore } from './store';
import type { ReActAgent } from './agent.js';

/**
 * v0.27-B R3 — 路由级错误契约（不拉起整服务器）：五面中的 chat 面。
 * 钉：404/400 带稳定 code；runSerialized 炸掉时 SSE error 帧带
 * chat_run_failed，且 reason 已过掩码（R1 review P2-5 的收口证据）。
 */

const DSN_SECRET = 'super-secret-pw';

describe('chat routes error contract (R3)', () => {
  let baseUrl = '';
  let server: http.Server;
  let store: ChatStore;
  const agents = new Map<string, ReActAgent>();

  beforeAll(async () => {
    const db = openDb(':memory:');
    store = new ChatStore(db);
    store.init();
    store.createSession('s1', 'repo-x', '测试会话');
    // 预置一个必炸的 agent：message 携带 DSN 形状机密，验证出站掩码。
    agents.set('s1', {
      setSessionRepo: () => {},
      seedHistory: () => {},
      runSerialized: async () => {
        throw new Error(`provider 502: postgres://user:${DSN_SECRET}@db.internal/prod`);
      }
    } as unknown as ReActAgent);

    const runtime: ChatRuntime = {
      store,
      llm: {
        configured: () => true,
        activeProfileName: 'default',
        profileNames: ['default'],
        switchTo: () => {}
      } as unknown as ChatRuntime['llm'],
      mcp: { connected: false, toolCount: 0 } as unknown as ChatRuntime['mcp'],
      log: { write: () => {} } as unknown as ChatRuntime['log'],
      agents
    };
    const app = express();
    app.use(express.json());
    registerChatRoutes(app, runtime);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET messages of an unknown session → 404 with chat_session_not_found', async () => {
    const res = await fetch(`${baseUrl}/api/chat/sessions/nope/messages`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown session', code: 'chat_session_not_found' });
  });

  it('POST empty message → 400 with chat_message_required', async () => {
    const res = await fetch(`${baseUrl}/api/chat/sessions/s1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '  ' })
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'message required', code: 'chat_message_required' });
  });

  it('POST with wrong content-type → 415 with unsupported_media_type', async () => {
    const res = await fetch(`${baseUrl}/api/chat/sessions/s1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hi'
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({
      error: 'content-type must be application/json',
      code: 'unsupported_media_type'
    });
  });

  it('agent failure: SSE error frame carries chat_run_failed AND masks the DSN (P2-5)', async () => {
    const res = await fetch(`${baseUrl}/api/chat/sessions/s1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '会炸的问题' })
    });
    expect(res.status).toBe(200); // SSE 已开始
    const raw = await res.text();
    // R3 review P2-4：帧级解析 data 的 {error, code} 形状（子串断言弱于形状）。
    const frame = raw
      .split('\n\n')
      .find((f) => f.startsWith('event: error'));
    expect(frame, `no error frame in: ${raw.slice(0, 200)}`).toBeTruthy();
    const dataLine = frame!.split('\n').find((l) => l.startsWith('data:'));
    const parsed = JSON.parse(dataLine!.slice(5).trim()) as { error: string; code: string };
    expect(parsed.code).toBe('chat_run_failed');
    // url-userinfo 掩码规则：口令必消失，主机/用户保留（可诊断性）。
    expect(parsed.error).not.toContain(DSN_SECRET);
    expect(parsed.error).toContain('provider 502');
    // 入库的兜底文案同样掩码（它会被回放给用户）
    const msgs = store.getMessages('s1');
    const note = msgs.find((m) => m.role === 'assistant');
    expect(note?.content).toContain('回答未完成');
    expect(note?.content).not.toContain(DSN_SECRET);
  });

  // R3 review P2-4：三出口的第三个——writeHead 之前炸（seedHistory）→ 500 JSON 分支。
  it('agent failure BEFORE streaming → 500 JSON with chat_run_failed, masked', async () => {
    store.createSession('s3', 'repo-x', '早炸会话');
    agents.set('s3', {
      setSessionRepo: () => {},
      seedHistory: () => {
        throw new Error(`history explode: ghp_${'A'.repeat(24)}token`);
      }
    } as unknown as ReActAgent);
    const res = await fetch(`${baseUrl}/api/chat/sessions/s3/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '早炸' })
    });
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('chat_run_failed');
    expect(body.error).not.toContain('ghp_');
    expect(body.error).toContain('history explode');
  });
});
