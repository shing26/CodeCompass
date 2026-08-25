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
  index_parsed INTEGER NOT NULL DEFAULT 0,
  index_total INTEGER NOT NULL DEFAULT 0,
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
  annotations TEXT,
  param_annotations TEXT,
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

function backupTimestamp(): string {
  const now = new Date();
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-` +
    `${pad(now.getMilliseconds(), 3)}`
  );
}

function listDbBackups(dbPath: string): Array<{ name: string; mtimeMs: number }> {
  const backupDir = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.backup-`;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(backupDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
    .map((entry) => {
      const stat = fs.statSync(path.join(backupDir, entry.name));
      return { name: entry.name, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
}

/**
 * Personal-use safety net: take a consistent SQLite backup before the app
 * opens the live database, keeping the newest `maxBackups` copies. Uses
 * better-sqlite3's online backup API so a WAL-mode database is captured
 * without copying the main file and WAL separately.
 */
export async function backupDb(
  dbPath: string,
  maxBackups = 5
): Promise<string | null> {
  if (dbPath === ':memory:' || !fs.existsSync(dbPath)) return null;

  const backupDir = path.dirname(dbPath);
  fs.mkdirSync(backupDir, { recursive: true });
  const base = `${path.basename(dbPath)}.backup-`;
  let backupPath = path.join(backupDir, `${base}${backupTimestamp()}`);
  let suffix = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = path.join(backupDir, `${base}${backupTimestamp()}-${suffix}`);
    suffix += 1;
  }

  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(backupPath);
  } finally {
    source.close();
  }

  const backups = listDbBackups(dbPath);
  for (const stale of backups.slice(maxBackups)) {
    fs.rmSync(path.join(backupDir, stale.name), { force: true });
  }
  return backupPath;
}

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
  if (!repoColumns.some((column) => column.name === 'index_parsed')) {
    db.exec('ALTER TABLE repos ADD COLUMN index_parsed INTEGER NOT NULL DEFAULT 0');
  }
  if (!repoColumns.some((column) => column.name === 'index_total')) {
    db.exec('ALTER TABLE repos ADD COLUMN index_total INTEGER NOT NULL DEFAULT 0');
  }
  // Issue 05: richer symbol metadata for deterministic call chains.
  const symbolColumns = db
    .prepare('PRAGMA table_info(repo_symbols)')
    .all() as Array<{ name: string }>;
  for (const [column, ddl] of [
    ['parent_type', 'ALTER TABLE repo_symbols ADD COLUMN parent_type TEXT'],
    ['type_name', 'ALTER TABLE repo_symbols ADD COLUMN type_name TEXT'],
    ['interfaces', 'ALTER TABLE repo_symbols ADD COLUMN interfaces TEXT'],
    ['display_path', 'ALTER TABLE repo_symbols ADD COLUMN display_path TEXT'],
    ['annotations', 'ALTER TABLE repo_symbols ADD COLUMN annotations TEXT'],
    ['param_annotations', 'ALTER TABLE repo_symbols ADD COLUMN param_annotations TEXT']
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
