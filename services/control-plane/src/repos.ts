import type Database from 'better-sqlite3';
import type {
  Harness,
  HarnessMode,
  HarnessStatus,
  HarnessType,
  LogStream,
  Task,
  TaskStatus,
  TaskType
} from '../../../packages/contracts/src/index';

export interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Issue 18 — normalize a user-supplied local path before it is stored.
 * Users paste paths from shells / docs / chat, so this strips:
 *  - surrounding whitespace and paired wrapping quotes (`'D:\repo'`, `"D:\repo"`, repeated)
 *  - doubled backslashes introduced by copy/paste escaping (`D:\\repo` → `D:\repo`)
 *  - trailing separators (`D:\repo\` → `D:\repo`), while keeping drive roots
 *    (`C:\`) and UNC roots (`\\host\share`) intact.
 */
export function cleanLocalPath(raw: string): string {
  let p = raw.trim();
  while (
    p.length >= 2 &&
    ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'")))
  ) {
    p = p.slice(1, -1).trim();
  }
  // Collapse doubled backslashes except the leading pair of UNC paths.
  p = p.replace(/([^\\])\\(?=\\)/g, '$1');
  const isRoot = /^[a-zA-Z]:[\\/]?$/.test(p) || /^\\\\[^\\/]+(?:\\[^\\/]+)?[\\/]?$/.test(p);
  if (!isRoot) {
    p = p.replace(/[\\/]+$/, '');
  }
  return p;
}

export interface TaskEvent {
  id?: number;
  taskId: string;
  type: string;
  fromStatus?: string;
  toStatus?: string;
  trigger: string;
  createdAt?: string;
}

export interface TaskLog {
  id?: number;
  taskId: string;
  stream: LogStream;
  text: string;
  createdAt: string;
}

interface TaskRow {
  id: string;
  workspace_id: string;
  type: string;
  status: string;
  input: string;
  output: string | null;
  assigned_harness_id: string | null;
  requires_approval: number;
  created_at: string;
  updated_at: string;
  token_input: number;
  token_output: number;
  duration_ms: number | null;
}

interface HarnessRow {
  id: string;
  name: string;
  type: string;
  mode: string;
  status: string;
  bridge_adapter: string;
  config: string;
  created_at: string;
  updated_at: string;
}

function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.type as TaskType,
    status: row.status as TaskStatus,
    input: parseJson(row.input),
    output: row.output ? parseJson(row.output) : undefined,
    assignedHarnessId: row.assigned_harness_id ?? undefined,
    requiresApproval: row.requires_approval === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tokenUsage: { input: row.token_input, output: row.token_output },
    durationMs: row.duration_ms ?? undefined
  };
}

function mapHarness(row: HarnessRow): Harness {
  return {
    id: row.id,
    name: row.name,
    type: row.type as HarnessType,
    mode: row.mode as HarnessMode,
    status: row.status as HarnessStatus,
    bridgeAdapter: row.bridge_adapter,
    config: parseJson(row.config)
  };
}

export class Repos {
  constructor(private db: Database.Database) {}

  listWorkspaces(): Workspace[] {
    const rows = this.db
      .prepare('SELECT * FROM workspaces ORDER BY created_at')
      .all() as Array<{
      id: string;
      name: string;
      root_path: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  getWorkspace(id: string): Workspace | undefined {
    const row = this.db
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(id) as
      | {
          id: string;
          name: string;
          root_path: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  createWorkspace(input: {
    id: string;
    name: string;
    rootPath: string;
  }): Workspace {
    const now = new Date().toISOString();
    const rootPath = cleanLocalPath(input.rootPath);
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, root_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.id, input.name, rootPath, now, now);
    return {
      id: input.id,
      name: input.name,
      rootPath,
      createdAt: now,
      updatedAt: now
    };
  }

  listHarnesses(): Harness[] {
    const rows = this.db
      .prepare('SELECT * FROM harnesses ORDER BY created_at')
      .all() as HarnessRow[];
    return rows.map(mapHarness);
  }

  getHarness(id: string): Harness | undefined {
    const row = this.db
      .prepare('SELECT * FROM harnesses WHERE id = ?')
      .get(id) as HarnessRow | undefined;
    return row ? mapHarness(row) : undefined;
  }

  upsertHarness(harness: Harness): void {
    this.db
      .prepare(
        `INSERT INTO harnesses (id, name, type, mode, status, bridge_adapter, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           status = excluded.status,
           updated_at = excluded.updated_at`
      )
      .run(
        harness.id,
        harness.name,
        harness.type,
        harness.mode,
        harness.status,
        harness.bridgeAdapter,
        JSON.stringify(harness.config ?? {}),
        new Date().toISOString(),
        new Date().toISOString()
      );
  }

  updateHarnessStatus(id: string, status: HarnessStatus): void {
    this.db
      .prepare('UPDATE harnesses SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
  }

  listTasks(): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks ORDER BY created_at DESC')
      .all() as TaskRow[];
    return rows.map(mapTask);
  }

  getTask(id: string): Task | undefined {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;
    return row ? mapTask(row) : undefined;
  }

  insertTask(task: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks (
          id, workspace_id, type, status, input, output, assigned_harness_id,
          created_at, updated_at, token_input, token_output, duration_ms,
          requires_approval
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, ?)`
      )
      .run(
        task.id,
        task.workspaceId,
        task.type,
        task.status,
        JSON.stringify(task.input ?? {}),
        task.output ? JSON.stringify(task.output) : null,
        task.assignedHarnessId ?? null,
        task.createdAt,
        task.updatedAt,
        task.status === 'waiting_approval' ? 1 : 0
      );
  }

  updateTask(task: Task): void {
    this.db
      .prepare(
        `UPDATE tasks SET
          status = ?, input = ?, output = ?, assigned_harness_id = ?,
          updated_at = ?, token_input = ?, token_output = ?, duration_ms = ?
         WHERE id = ?`
      )
      .run(
        task.status,
        JSON.stringify(task.input ?? {}),
        task.output ? JSON.stringify(task.output) : null,
        task.assignedHarnessId ?? null,
        task.updatedAt,
        task.tokenUsage?.input ?? 0,
        task.tokenUsage?.output ?? 0,
        task.durationMs ?? null,
        task.id
      );
  }

  insertLog(taskId: string, stream: LogStream, text: string): void {
    this.db
      .prepare(
        `INSERT INTO task_logs (task_id, stream, text, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(taskId, stream, text, new Date().toISOString());
  }

  listLogs(taskId: string): TaskLog[] {
    const rows = this.db
      .prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY id')
      .all(taskId) as Array<{
      id: number;
      task_id: string;
      stream: string;
      text: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      stream: row.stream as LogStream,
      text: row.text,
      createdAt: row.created_at
    }));
  }

  insertEvent(event: TaskEvent): void {
    this.db
      .prepare(
        `INSERT INTO task_events (task_id, type, from_status, to_status, trigger, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.taskId,
        event.type,
        event.fromStatus ?? null,
        event.toStatus ?? null,
        event.trigger,
        event.createdAt ?? new Date().toISOString()
      );
  }

  listEvents(taskId: string): TaskEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY id')
      .all(taskId) as Array<{
      id: number;
      task_id: string;
      type: string;
      from_status: string | null;
      to_status: string | null;
      trigger: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      type: row.type,
      fromStatus: row.from_status ?? undefined,
      toStatus: row.to_status ?? undefined,
      trigger: row.trigger,
      createdAt: row.created_at
    }));
  }
}
