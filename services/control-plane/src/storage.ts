import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { Task, Harness } from './types';

export class Storage {
  private db: Database.Database;

  constructor(path = 'control-plane.db') {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        workspaceId TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT,
        assignedHarnessId TEXT,
        requiresApproval INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        tokenInput INTEGER DEFAULT 0,
        tokenOutput INTEGER DEFAULT 0,
        durationMs INTEGER
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS harnesses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        bridgeAdapter TEXT NOT NULL,
        config TEXT NOT NULL
      )
    `);
  }

  createTask(task: {
    workspaceId: string;
    type: Task['type'];
    status: Task['status'];
    input: Record<string, unknown>;
    requiresApproval?: boolean;
  }): Task {
    const now = new Date().toISOString();
    const id = randomUUID();
    const full: Task = {
      id,
      workspaceId: task.workspaceId,
      type: task.type,
      status: task.status,
      input: task.input,
      requiresApproval: task.requiresApproval ?? false,
      createdAt: now,
      updatedAt: now,
      tokenInput: 0,
      tokenOutput: 0,
    };
    this.db.prepare(
      'INSERT INTO tasks (id, workspaceId, type, status, input, requiresApproval, createdAt, updatedAt, tokenInput, tokenOutput) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      full.id,
      full.workspaceId,
      full.type,
      full.status,
      JSON.stringify(full.input),
      full.requiresApproval ? 1 : 0,
      full.createdAt,
      full.updatedAt,
      0,
      0
    );
    return full;
  }

  updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>) {
    const now = new Date().toISOString();
    const current = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
    if (!current) return null;

    const next: Task = {
      ...current,
      ...patch,
      updatedAt: now,
      output: patch.output ?? current.output,
      assignedHarnessId: patch.assignedHarnessId ?? current.assignedHarnessId,
      requiresApproval: patch.requiresApproval ?? current.requiresApproval,
      tokenInput: patch.tokenInput ?? current.tokenInput,
      tokenOutput: patch.tokenOutput ?? current.tokenOutput,
      durationMs: patch.durationMs ?? current.durationMs,
    };

    this.db.prepare(
      'UPDATE tasks SET status = ?, updatedAt = ?, output = ?, assignedHarnessId = ?, tokenInput = ?, tokenOutput = ?, durationMs = ? WHERE id = ?'
    ).run(next.status, next.updatedAt, JSON.stringify(next.output), next.assignedHarnessId, next.tokenInput, next.tokenOutput, next.durationMs, id);

    return next;
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return {
      ...row,
      input: JSON.parse(row.input),
      output: row.output ? JSON.parse(row.output) : undefined,
      tokenInput: row.tokenInput ?? 0,
      tokenOutput: row.tokenOutput ?? 0,
    } as Task;
  }

  addHarness(harness: Omit<Harness, 'id'> & { id?: string }): Harness {
    const id = harness.id || randomUUID();
    const record: Harness = { ...harness, id };
    this.db.prepare(
      'INSERT OR REPLACE INTO harnesses (id, name, type, mode, status, bridgeAdapter, config) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(record.id, record.name, record.type, record.mode, record.status, record.bridgeAdapter, JSON.stringify(record.config));
    return record;
  }

  listHarnesses(): Harness[] {
    const rows = this.db.prepare('SELECT * FROM harnesses').all() as any[];
    return rows.map((r) => ({
      ...r,
      config: JSON.parse(r.config),
    })) as Harness[];
  }
}
