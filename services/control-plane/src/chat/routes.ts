import type express from 'express';
import { asyncHandler } from '../http-error';
import { maskSensitiveText } from '../engine/repoqa-masking';
import {
  CHAT_HEARTBEAT_MS,
  CHAT_SLOW_FIRST_TOKEN_MS,
  CHAT_VERY_SLOW_FIRST_TOKEN_MS,
  CHAT_TOOL_LONG_RUNNING_MS,
  ERROR_CODES,
  type ChatHintEvent,
  type ChatProgressEvent
} from '../../../../packages/contracts/src/index';
import { randomUUID } from 'node:crypto';
import { ReActAgent } from './agent.js';
import type { ChatStore } from './store.js';
import type { LlmManager } from './llm.js';
import type { InProcessMcpClient } from './client.js';
import type { SessionLogger } from './log.js';

/** ADR-0024 — 计时参数（测试可注入更小的值；默认取 contracts 共用常量）。 */
export interface ChatTimings {
  heartbeatMs: number;
  slowFirstTokenMs: number;
  verySlowFirstTokenMs: number;
  toolLongMs: number;
}

const DEFAULT_TIMINGS: ChatTimings = {
  heartbeatMs: CHAT_HEARTBEAT_MS,
  slowFirstTokenMs: CHAT_SLOW_FIRST_TOKEN_MS,
  verySlowFirstTokenMs: CHAT_VERY_SLOW_FIRST_TOKEN_MS,
  toolLongMs: CHAT_TOOL_LONG_RUNNING_MS
};

/** ADR-0024 — 模型超时（AbortSignal.timeout）的判别；映射到 chat_llm_timeout。 */
function isTimeoutError(err: unknown): boolean {
  // 单一判别源：AbortSignal.timeout 抛出的 DOMException/Error name 恒为 TimeoutError。
  // 不再嗅探 message（provider 原文含 "timeout" 会被误判成我们自己的硬超时）。
  return err instanceof Error && err.name === 'TimeoutError';
}

/** Runtime handed to the chat HTTP routes (wired in server.ts). */
export interface ChatRuntime {
  store: ChatStore;
  llm: LlmManager;
  mcp: InProcessMcpClient;
  log: SessionLogger;
  /** Per-session ReAct pool (增量 4 会话隔离: one agent = one conversation). */
  agents: Map<string, ReActAgent>;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  /** ADR-0024 — 计时参数覆盖（测试用）。 */
  timings?: Partial<ChatTimings>;
}

const wantsJson = (req: express.Request): boolean =>
  (req.headers['content-type'] ?? '').includes('application/json');

export function registerChatRoutes(app: express.Express, chat: ChatRuntime): void {
  app.get('/api/chat/status', (_req, res) => {
    res.json({
      llm: chat.llm.configured() ? chat.llm.activeProfileName : null,
      mcpConnected: chat.mcp.connected,
      tools: chat.mcp.toolCount,
      sessions: chat.store.listSessions().length,
    });
  });

  app.get('/api/chat/model', (_req, res) => {
    res.json({
      profiles: chat.llm.profileNames,
      active: chat.llm.activeProfileName,
      configured: chat.llm.configured(),
    });
  });

  app.post('/api/chat/model', (req, res) => {
    if (!wantsJson(req)) return res.status(415).json({ error: 'content-type must be application/json', code: 'unsupported_media_type' });
    try {
      chat.llm.switchTo(String(req.body?.name ?? ''));
      chat.log.write('model_switch', { active: chat.llm.activeProfileName, via: 'web' });
      res.json({ ok: true, active: chat.llm.activeProfileName });
    } catch (err) {
      res.status(400).json({
        error: maskSensitiveText(err instanceof Error ? err.message : String(err)),
        code: 'invalid_model'
      });
    }
  });

  app.get('/api/chat/sessions', (_req, res) => {
    res.json({ sessions: chat.store.listSessions() });
  });

  app.post('/api/chat/sessions', (req, res) => {
    if (!wantsJson(req)) return res.status(415).json({ error: 'content-type must be application/json', code: 'unsupported_media_type' });
    const repoId = String(req.body?.repoId ?? '');
    if (!repoId) return res.status(400).json({ error: 'repoId required', code: 'chat_repo_required' });
    const id = randomUUID();
    // CM-03: title 前缀标注未命名——首条消息到达时由 addMessage 升级为摘要标题
    const title = String(req.body?.title ?? '').trim() || `未命名会话 · ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`;
    res.json({ session: chat.store.createSession(id, repoId, title) });
  });

  app.patch('/api/chat/sessions/:id', (req, res) => {
    if (!wantsJson(req)) return res.status(415).json({ error: 'content-type must be application/json', code: 'unsupported_media_type' });
    const newTitle = String(req.body?.title ?? '').trim();
    if (!newTitle) return res.status(400).json({ error: 'title required', code: 'chat_title_required' });
    if (!chat.store.getSession(req.params.id)) return res.status(404).json({ error: 'unknown session', code: 'chat_session_not_found' });
    chat.store.renameSession(req.params.id, newTitle);
    res.json({ ok: true });
  });

  app.get('/api/chat/sessions/:id/messages', (req, res) => {
    const session = chat.store.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'unknown session', code: 'chat_session_not_found' });
    res.json({ messages: chat.store.getMessages(req.params.id) });
  });

  app.post('/api/chat/sessions/:id/messages', asyncHandler(async (req, res) => {
    if (!wantsJson(req)) return res.status(415).json({ error: 'content-type must be application/json', code: 'unsupported_media_type' });
    const sessionId = String(req.params.id);
    const message = String(req.body?.message ?? '').trim();
    const session = chat.store.getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'unknown session', code: 'chat_session_not_found' });
    if (!message) return res.status(400).json({ error: 'message required', code: 'chat_message_required' });

    // M4-01: client disconnects mid-stream must not crash the server —
    // guard every write, swallow stream errors, still complete + persist.
    res.on('error', () => {});
    let closed = false;
    res.on('close', () => {
      closed = true;
      cleanupTurn();
    });
    const send = (event: string, data: unknown) => {
      if (closed || res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
        cleanupTurn();
      }
    };

    // ADR-0024 — 轮次进度/心跳/慢提示。计时参数可被测试注入；sent 前先 open，
    // 因此这里只准备状态与函数，真正的 start 在 send('open') 之后。
    const timings = { ...DEFAULT_TIMINGS, ...(chat.timings ?? {}) };
    const turnStart = Date.now();
    let sawFirstDelta = false;
    let toolTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    let verySlowTimer: ReturnType<typeof setTimeout> | undefined;
    const hint = (code: ChatHintEvent['code']) => {
      send('hint', {
        code,
        elapsedMs: Date.now() - turnStart,
        profile: chat.llm.activeProfileName,
        profilesAvailable: chat.llm.profileNames.length
      } satisfies ChatHintEvent);
    };
    const clearToolTimer = () => {
      if (toolTimer) {
        clearTimeout(toolTimer);
        toolTimer = undefined;
      }
    };
    function cleanupTurn() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (slowTimer) clearTimeout(slowTimer);
      if (verySlowTimer) clearTimeout(verySlowTimer);
      clearToolTimer();
      heartbeatTimer = undefined;
      slowTimer = undefined;
      verySlowTimer = undefined;
    }
    const noteFirstDelta = () => {
      if (sawFirstDelta) return;
      sawFirstDelta = true;
      if (slowTimer) clearTimeout(slowTimer);
      if (verySlowTimer) clearTimeout(verySlowTimer);
      slowTimer = undefined;
      verySlowTimer = undefined;
    };
    const startTurnTimers = () => {
      heartbeatTimer = setInterval(() => send('heartbeat', { elapsedMs: Date.now() - turnStart }), timings.heartbeatMs);
      slowTimer = setTimeout(() => hint('SLOW_FIRST_TOKEN'), timings.slowFirstTokenMs);
      verySlowTimer = setTimeout(() => hint('VERY_SLOW_FIRST_TOKEN'), timings.verySlowFirstTokenMs);
    };
    const handleProgress = (event: ChatProgressEvent) => {
      send('progress', event);
      if (event.phase !== 'tool') return;
      if (typeof event.toolMs === 'number') {
        clearToolTimer();
        return;
      }
      clearToolTimer();
      toolTimer = setTimeout(() => hint('TOOL_LONG_RUNNING'), timings.toolLongMs);
    };

    // R2-02: batch streamed deltas — per-char deltas flooded the wire (393
    // chunks per answer); flush every 40ms or 200 chars.
    let deltaBuf = '';
    let deltaTimer: ReturnType<typeof setTimeout> | undefined;
    const flushDelta = () => {
      if (deltaTimer) {
        clearTimeout(deltaTimer);
        deltaTimer = undefined;
      }
      if (deltaBuf) {
        send('delta', { text: deltaBuf });
        deltaBuf = '';
      }
    };
    const onDelta = (t: string) => {
      noteFirstDelta();
      deltaBuf += t;
      if (deltaBuf.length >= 200) flushDelta();
      else if (!deltaTimer) deltaTimer = setTimeout(flushDelta, 40);
    };

    // R2-01: 用户消息先于 run 入库（顺序陷阱：入库后 historyFor 才取，避免重复）。
    chat.store.addMessage(sessionId, 'user', message);
    // CM-03: 首条消息升级会话标题为摘要（截断 40 字符），只升级一次
    const current = chat.store.getSession(sessionId);
    if (current && current.title.startsWith('未命名会话')) {
      chat.store.renameSession(sessionId, message.slice(0, 40) + (message.length > 40 ? '…' : ''));
    }
    let assistantSaved = false;

    try {
      let agent = chat.agents.get(sessionId);
      if (!agent) {
        agent = new ReActAgent({
          mcp: chat.mcp,
          llm: chat.llm,
          log: chat.log,
          onDelta: () => {},
          fetchImpl: chat.fetchImpl,
          // Ticket 08 (v1.1) — the turnId prefix; per-session agents keep the
          // per-agent seq monotonic within one session.
          sessionId,
        });
        chat.agents.set(sessionId, agent);
      }
      agent.setSessionRepo(session.repoId);
      agent.seedHistory(chat.store.historyFor(sessionId));

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      send('open', { sessionId });
      startTurnTimers();

      const turn = await agent.runSerialized(message, {
        onDelta,
        onProgress: handleProgress,
        onRegenerate: () => {
          flushDelta();
          send('regenerate', {});
        },
      });
      flushDelta();
      cleanupTurn();
      // CM-04: planCards 结构化下线方案随 citations JSON 列一并持久化（勾选状态在客户端）
      chat.store.addMessage(sessionId, 'assistant', turn.answer, {
        citations: turn.citations,
        planCards: turn.planCards ?? []
      });
      assistantSaved = true;
      send('citations', { citations: turn.citations });
      send('plan', { planCards: turn.planCards ?? [] });
      // Ticket 08 (v1.1) — done carries the turnId so a replay can join the
      // SSE turn with its JSONL tool_result/agent_turn rows as one unit.
      send('done', {
        answer: turn.answer,
        steps: turn.steps,
        fallback: turn.fallback,
        turnId: turn.turnId,
      });
      if (!closed) res.end();
      else try { res.end(); } catch { /* socket already gone */ }
    } catch (err) {
      // R1 review P2-5 (closed by R3): provider failures often echo the
      // request URL/params into `message`. The reason is now masked before it
      // touches ANY egress— the persisted note, the 500 JSON, and the SSE
      // error frame alike—and carries the stable `chat_run_failed` code so the
      // frontend can render human guidance instead of a raw string (V27-12).
      cleanupTurn();
      const errorCode = isTimeoutError(err) ? ERROR_CODES.chat_llm_timeout : ERROR_CODES.chat_run_failed;
      const reason = maskSensitiveText(
        err instanceof Error ? err.message : String(err)
      );
      if (!assistantSaved && chat.store.getSession(sessionId)) {
        chat.store.addMessage(sessionId, 'assistant', `（回答未完成：${reason}）`);
      }
      if (!res.headersSent) {
        res.status(500).json({ error: reason, code: errorCode });
      } else {
        send('error', { error: reason, code: errorCode });
        if (!closed) res.end();
        else try { res.end(); } catch { /* socket already gone */ }
      }
    }
  }));
}

function depsStoreAdd(chat: ChatRuntime, sessionId: string, turn: { answer: string; citations: unknown }): void {
  chat.store.addMessage(sessionId, 'assistant', turn.answer, turn.citations);
}
