import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS harnesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  bridge_adapter TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT,
  assigned_harness_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  token_input INTEGER NOT NULL DEFAULT 0,
  token_output INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  requires_approval INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  stream TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  trigger TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_logs_task ON task_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON task_events(task_id);

CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_url TEXT,
  local_path TEXT NOT NULL,
  branch TEXT DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'idle',
  error TEXT,
  file_count INTEGER NOT NULL DEFAULT 0,
  symbol_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  signature TEXT,
  calls TEXT,
  parent_type TEXT,
  type_name TEXT,
  interfaces TEXT,
  display_path TEXT,
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);
CREATE INDEX IF NOT EXISTS idx_repo_symbols_repo ON repo_symbols(repo_id, kind, name);

CREATE TABLE IF NOT EXISTS repo_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  content TEXT NOT NULL,
  file_path TEXT,
  line_start INTEGER,
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);
CREATE INDEX IF NOT EXISTS idx_repo_chunks_repo ON repo_chunks(repo_id, chunk_type);

CREATE TABLE IF NOT EXISTS repo_files (
  repo_id TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (repo_id, path),
  FOREIGN KEY (repo_id) REFERENCES repos(id)
);
CREATE INDEX IF NOT EXISTS idx_repo_files_repo ON repo_files(repo_id);

CREATE TABLE IF NOT EXISTS repoqa_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id TEXT,
  session_id TEXT,
  event_type TEXT NOT NULL,
  intent TEXT,
  query_start_at TEXT,
  first_token_at TEXT,
  query_done_at TEXT,
  anchor_clicked INTEGER,
  tool_miss TEXT,
  feedback TEXT,
  failure_class TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repoqa_events_repo ON repoqa_events(repo_id);
CREATE INDEX IF NOT EXISTS idx_repoqa_events_type ON repoqa_events(event_type);
`;

export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  const repoColumns = db
    .prepare('PRAGMA table_info(repos)')
    .all() as Array<{ name: string }>;
  if (!repoColumns.some((column) => column.name === 'error')) {
    db.exec('ALTER TABLE repos ADD COLUMN error TEXT');
  }
  // Issue 05: richer symbol metadata for deterministic call chains.
  const symbolColumns = db
    .prepare('PRAGMA table_info(repo_symbols)')
    .all() as Array<{ name: string }>;
  for (const [column, ddl] of [
    ['parent_type', 'ALTER TABLE repo_symbols ADD COLUMN parent_type TEXT'],
    ['type_name', 'ALTER TABLE repo_symbols ADD COLUMN type_name TEXT'],
    ['interfaces', 'ALTER TABLE repo_symbols ADD COLUMN interfaces TEXT'],
    ['display_path', 'ALTER TABLE repo_symbols ADD COLUMN display_path TEXT']
  ] as const) {
    if (!symbolColumns.some((existing) => existing.name === column)) {
      db.exec(ddl);
    }
  }
  return db;
}

export function ensureDefaultWorkspace(
  db: Database.Database,
  rootPath: string
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, root_path, created_at, updated_at)
     VALUES ('default', 'Default Workspace', ?, ?, ?)`
  ).run(rootPath, now, now);
}
