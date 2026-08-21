import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Repos } from './repos';

export interface Repo {
  id: string;
  name: string;
  repoUrl?: string;
  localPath: string;
  branch: string;
  status: 'idle' | 'indexing' | 'ready' | 'error';
  error?: string;
  fileCount: number;
  symbolCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RepoSymbol {
  id?: number;
  repoId: string;
  kind: 'class' | 'interface' | 'method' | 'route' | 'service' | 'repository' | 'config' | 'field';
  name: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  signature?: string;
  calls?: Array<{ file: string; method: string }>;
}

export interface RepoChunk {
  id?: number;
  repoId: string;
  chunkType: 'comment' | 'readme' | 'docstring';
  content: string;
  filePath?: string;
  lineStart?: number;
}

function mapRepo(row: {
  id: string;
  name: string;
  repo_url: string | null;
  local_path: string;
  branch: string;
  status: string;
  error: string | null;
  file_count: number;
  symbol_count: number;
  created_at: string;
  updated_at: string;
}): Repo {
  return {
    id: row.id,
    name: row.name,
    repoUrl: row.repo_url ?? undefined,
    localPath: row.local_path,
    branch: row.branch,
    status: row.status as Repo['status'],
    error: row.error ?? undefined,
    fileCount: row.file_count,
    symbolCount: row.symbol_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class RepoQARepos {
  constructor(private db: Database.Database) {}

  listRepos(): Repo[] {
    const rows = this.db.prepare('SELECT * FROM repos ORDER BY updated_at DESC').all() as any[];
    return rows.map(mapRepo);
  }

  getRepo(id: string): Repo | undefined {
    const row = this.db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as any;
    return row ? mapRepo(row) : undefined;
  }

  createRepo(input: {
    id: string;
    name: string;
    repoUrl?: string;
    localPath: string;
    branch?: string;
  }): Repo {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO repos (id, name, repo_url, local_path, branch, status, file_count, symbol_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'idle', 0, 0, ?, ?)`
      )
      .run(
        input.id,
        input.name,
        input.repoUrl ?? null,
        input.localPath,
        input.branch ?? 'main',
        now,
        now
      );
    return this.getRepo(input.id)!;
  }

  findByLocalPath(localPath: string): Repo | undefined {
    const row = this.db
      .prepare('SELECT * FROM repos WHERE local_path = ? LIMIT 1')
      .get(localPath) as any;
    return row ? mapRepo(row) : undefined;
  }

  upsertByLocalPath(input: {
    name: string;
    localPath: string;
    branch?: string;
  }): { repo: Repo; created: boolean } {
    const existing = this.findByLocalPath(input.localPath);
    if (existing) {
      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE repos SET branch = ?, local_path = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(input.branch ?? existing.branch, input.localPath, now, existing.id);
      return { repo: this.getRepo(existing.id)!, created: false };
    }
    const id = `repo-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO repos (id, name, repo_url, local_path, branch, status, file_count, symbol_count, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, 'idle', 0, 0, ?, ?)`
      )
      .run(id, input.name, input.localPath, input.branch ?? 'main', now, now);
    return { repo: this.getRepo(id)!, created: true };
  }

  updateRepoStatus(
    id: string,
    status: Repo['status'],
    fileCount?: number,
    symbolCount?: number,
    error?: string
  ): void {
    const now = new Date().toISOString();
    const cur = this.getRepo(id);
    if (!cur) return;
    this.db
      .prepare(
        `UPDATE repos SET status = ?, error = ?, file_count = COALESCE(?, file_count),
          symbol_count = COALESCE(?, symbol_count), updated_at = ?
         WHERE id = ?`
      )
      .run(
        status,
        status === 'error' ? (error ?? null) : null,
        fileCount ?? cur.fileCount,
        symbolCount ?? cur.symbolCount,
        now,
        id
      );
  }

  clearRepoData(repoId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM repo_symbols WHERE repo_id = ?').run(repoId);
      this.db.prepare('DELETE FROM repo_chunks WHERE repo_id = ?').run(repoId);
      this.db.prepare('DELETE FROM repo_files WHERE repo_id = ?').run(repoId);
    });
    tx();
  }

  saveFiles(repoId: string, root: string, files: string[]): void {
    if (files.length === 0) return;
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO repo_files (repo_id, path) VALUES (?, ?)'
    );
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM repo_files WHERE repo_id = ?').run(repoId);
      for (const file of files) {
        insert.run(repoId, path.relative(root, file).split(path.sep).join('/'));
      }
    });
    tx();
  }

  isFileIndexed(repoId: string, filePath: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM repo_files WHERE repo_id = ? AND path = ?')
      .get(repoId, filePath) as { '1': number } | undefined;
    return Boolean(row);
  }

  resetInterrupted(): void {
    this.db
      .prepare(`UPDATE repos SET status = 'idle', updated_at = ? WHERE status = 'indexing'`)
      .run(new Date().toISOString());
  }

  recordEvent(input: {
    repoId: string;
    eventType: string;
    sessionId?: string;
    intent?: string;
    queryStartAt?: string;
    queryDoneAt?: string;
    anchorClicked?: boolean;
    toolMiss?: string;
    feedback?: string;
    failureClass?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO repoqa_events (
          repo_id, session_id, event_type, intent, query_start_at, query_done_at,
          anchor_clicked, tool_miss, feedback, failure_class, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.repoId,
        input.sessionId ?? null,
        input.eventType,
        input.intent ?? null,
        input.queryStartAt ?? null,
        input.queryDoneAt ?? null,
        input.anchorClicked ? 1 : 0,
        input.toolMiss ?? null,
        input.feedback ?? null,
        input.failureClass ?? null,
        new Date().toISOString()
      );
  }

  upsertSymbols(symbols: RepoSymbol[]): void {
    if (symbols.length === 0) return;
    const insert = this.db.prepare(
      `INSERT INTO repo_symbols (repo_id, kind, name, file_path, line_start, line_end, signature, calls)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const del = this.db.prepare('DELETE FROM repo_symbols WHERE repo_id = ?');
    const tx = this.db.transaction(() => {
      del.run(symbols[0].repoId);
      for (const s of symbols) {
        insert.run(
          s.repoId,
          s.kind,
          s.name,
          s.filePath,
          s.lineStart ?? null,
          s.lineEnd ?? null,
          s.signature ?? null,
          s.calls ? JSON.stringify(s.calls) : null
        );
      }
    });
    tx();
  }

  listSymbols(repoId: string, kind?: string): RepoSymbol[] {
    let sql = 'SELECT * FROM repo_symbols WHERE repo_id = ?';
    const params: any[] = [repoId];
    if (kind) {
      sql += ' AND kind = ?';
      params.push(kind);
    }
    return this.db.prepare(sql).all(...params).map((row: any) => ({
      id: row.id,
      repoId: row.repo_id,
      kind: row.kind,
      name: row.name,
      filePath: row.file_path,
      lineStart: row.line_start ?? undefined,
      lineEnd: row.line_end ?? undefined,
      signature: row.signature ?? undefined,
      calls: row.calls ? JSON.parse(row.calls) : undefined
    }));
  }

  upsertChunks(chunks: RepoChunk[]): void {
    if (chunks.length === 0) return;
    const insert = this.db.prepare(
      `INSERT INTO repo_chunks (repo_id, chunk_type, content, file_path, line_start)
       VALUES (?, ?, ?, ?, ?)`
    );
    const del = this.db.prepare('DELETE FROM repo_chunks WHERE repo_id = ?');
    const tx = this.db.transaction(() => {
      del.run(chunks[0].repoId);
      for (const c of chunks) {
        insert.run(c.repoId, c.chunkType, c.content, c.filePath ?? null, c.lineStart ?? null);
      }
    });
    tx();
  }

  searchChunks(repoId: string, query: string, limit = 20): RepoChunk[] {
    const rows = this.db
      .prepare(`SELECT * FROM repo_chunks WHERE repo_id = ? AND content LIKE ? LIMIT ?`)
      .all(repoId, `%${query.replace(/%/g, '%%')}%`, limit) as any[];
    return rows.map((row) => ({
      id: row.id,
      repoId: row.repo_id,
      chunkType: row.chunk_type,
      content: row.content,
      filePath: row.file_path,
      lineStart: row.line_start
    }));
  }

  findSymbol(repoId: string, name: string, kind?: string): RepoSymbol[] {
    let sql = 'SELECT * FROM repo_symbols WHERE repo_id = ? AND name = ?';
    const params: any[] = [repoId, name];
    if (kind) {
      sql += ' AND kind = ?';
      params.push(kind);
    }
    return this.db.prepare(sql).all(...params).map((row: any) => ({
      id: row.id,
      repoId: row.repo_id,
      kind: row.kind,
      name: row.name,
      filePath: row.file_path,
      lineStart: row.line_start ?? undefined,
      lineEnd: row.line_end ?? undefined,
      signature: row.signature ?? undefined,
      calls: row.calls ? JSON.parse(row.calls) : undefined
    }));
  }

  getCallChain(
    repoId: string,
    filePath: string,
    methodName: string,
    depth = 3
  ): Array<{ file: string; method: string; line: number }> {
    const sql = `
      WITH RECURSIVE chain(file, method, line, depth) AS (
        SELECT file_path, name, line_start, 1
        FROM repo_symbols
        WHERE repo_id = ? AND file_path = ? AND name = ?
        UNION ALL
        SELECT s.file_path, s.name, s.line_start, c.depth + 1
        FROM chain c
        JOIN repo_symbols s ON s.repo_id = ? AND s.kind = 'method'
          AND json_extract(s.calls, '$') LIKE '%"' || c.method || '"%'
        WHERE c.depth < ?
      )
      SELECT file, method, line FROM chain
    `;
    const rows = this.db.prepare(sql).all(repoId, filePath, methodName, repoId, depth) as any[];
    return rows.map((row) => ({ file: row.file, method: row.method, line: row.line }));
  }
}
