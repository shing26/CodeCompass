import type Database from 'better-sqlite3';
import type { ChatMessage } from './llm.js';

export interface SessionRow {
  id: string;
  repoId: string;
  title: string;
  createdAt: string;
}

export interface StoredMessage {
  id: number;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  citations: string | null;
  createdAt: string;
}

export const CHAT_SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  citations TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
`;

interface SessionDbRow {
  id: string;
  repo_id: string;
  title: string;
  created_at: string;
}

interface MessageDbRow {
  id: number;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: string | null;
  created_at: string;
}

function mapSession(row: SessionDbRow): SessionRow {
  return { id: row.id, repoId: row.repo_id, title: row.title, createdAt: row.created_at };
}

function mapMessage(row: MessageDbRow): StoredMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    citations: row.citations,
    createdAt: row.created_at,
  };
}

/**
 * Chat persistence (chat-merge Q4): sessions and messages in the SAME sqlite
 * database as the engine (grill Q3 — one store), but in dedicated tables —
 * conversation history semantics ≠ workbench_cards artifact-replay semantics
 * (ADR-0001 #2: 分桶 vs 对话隔离是两套语义，不混表).
 */
export class ChatStore {
  constructor(private readonly db: Database.Database) {}

  init(): void {
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL)'
    ).run();
    this.db.prepare(
      'CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, citations TEXT, created_at TEXT NOT NULL)'
    ).run();
    this.db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id)'
    ).run();
  }

  createSession(id: string, repoId: string, title: string): SessionRow {
    const createdAt = new Date().toISOString();
    this.db
      .prepare('INSERT INTO chat_sessions (id, repo_id, title, created_at) VALUES (?, ?, ?, ?)')
      .run(id, repoId, title, createdAt);
    return { id, repoId, title, createdAt };
  }

  getSession(id: string): SessionRow | undefined {
    const row = this.db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as
      | SessionDbRow
      | undefined;
    return row ? mapSession(row) : undefined;
  }

  listSessions(): SessionRow[] {
    // rowid tiebreak keeps insertion order when two sessions share a timestamp
    // (CI lesson: ubuntu runners create rows within the same millisecond).
    return (
      this.db
        .prepare('SELECT * FROM chat_sessions ORDER BY created_at DESC, rowid DESC')
        .all() as SessionDbRow[]
    ).map(mapSession);
  }

  addMessage(sessionId: string, role: 'user' | 'assistant', content: string, citations?: unknown): void {
    this.db
      .prepare('INSERT INTO chat_messages (session_id, role, content, citations, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(
        sessionId,
        role,
        content,
        citations === undefined ? null : JSON.stringify(citations),
        new Date().toISOString(),
      );
  }

  getMessages(sessionId: string): StoredMessage[] {
    return (
      this.db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id').all(sessionId) as MessageDbRow[]
    ).map(mapMessage);
  }

  /** ReAct history hydration (增量 2 多轮上下文): user/assistant pairs only —
   * tool rounds are transient by design (ADR-0001 #2). */
  historyFor(sessionId: string): ChatMessage[] {
    return this.getMessages(sessionId)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  }
}
