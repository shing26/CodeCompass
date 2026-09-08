import type express from 'express';
import { randomUUID } from 'node:crypto';
import { ReActAgent } from './agent.js';
import type { ChatStore } from './store.js';
import type { LlmManager } from './llm.js';
import type { InProcessMcpClient } from './client.js';
import type { SessionLogger } from './log.js';

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
    if (!wantsJson(req)) return res.status(415).json({ error: 'content-type must be application/json' });
    try {
      chat.llm.switchTo(String(req.body?.name ?? ''));
      chat.log.write('model_switch', { active: chat.llm.activeProfileName, via: 'web' });
      res.json({ ok: true, active: chat.llm.activeProfileName });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/chat/sessions', (_req, res) => {
    res.json({ sessions: chat.store.listSessions() });
  });

  app.post('/api/chat/sessions', (req, res) => {
    if (!wantsJson(req)) return res.status(415).json({ error: 'content-type must be application/json' });
    const repoId = String(req.body?.repoId ?? '');
    if (!repoId) return res.status(400).json({ error: 'repoId required' });
    const id = randomUUID();
    const title = `会话 ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`;
    res.json({ session: chat.store.createSession(id, repoId, title) });
  });

  app.get('/api/chat/sessions/:id/messages', (req, res) => {
    const session = chat.store.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'unknown session' });
    res.json({ messages: chat.store.getMessages(req.params.id) });
  });

  app.post('/api/chat/sessions/:id/messages', async (req, res) => {
    if (!wantsJson(req)) return res.status(415).json({ error: 'content-type must be application/json' });
    const sessionId = String(req.params.id);
    const message = String(req.body?.message ?? '').trim();
    const session = chat.store.getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'unknown session' });
    if (!message) return res.status(400).json({ error: 'message required' });

    // M4-01: client disconnects mid-stream must not crash the server —
    // guard every write, swallow stream errors, still complete + persist.
    res.on('error', () => {});
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    const send = (event: string, data: unknown) => {
      if (closed || res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
      }
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
      deltaBuf += t;
      if (deltaBuf.length >= 200) flushDelta();
      else if (!deltaTimer) deltaTimer = setTimeout(flushDelta, 40);
    };

    // R2-01: 用户消息先于 run 入库（顺序陷阱：入库后 historyFor 才取，避免重复）。
    chat.store.addMessage(sessionId, 'user', message);
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

      const turn = await agent.runSerialized(message, {
        onDelta,
        onRegenerate: () => {
          flushDelta();
          send('regenerate', {});
        },
      });
      flushDelta();
      chat.store.addMessage(sessionId, 'assistant', turn.answer, turn.citations);
      assistantSaved = true;
      send('citations', { citations: turn.citations });
      send('done', { answer: turn.answer, steps: turn.steps, fallback: turn.fallback });
      if (!closed) res.end();
      else try { res.end(); } catch { /* socket already gone */ }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!assistantSaved && chat.store.getSession(sessionId)) {
        chat.store.addMessage(sessionId, 'assistant', `（回答未完成：${reason}）`);
      }
      if (!res.headersSent) {
        res.status(500).json({ error: reason });
      } else {
        send('error', { error: reason });
        if (!closed) res.end();
        else try { res.end(); } catch { /* socket already gone */ }
      }
    }
  });
}

function depsStoreAdd(chat: ChatRuntime, sessionId: string, turn: { answer: string; citations: unknown }): void {
  chat.store.addMessage(sessionId, 'assistant', turn.answer, turn.citations);
}
