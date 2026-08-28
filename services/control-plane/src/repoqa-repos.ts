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
  /** Live AST parsing progress while status is `indexing`. */
  indexParsed?: number;
  indexTotal?: number;
  /** v0.5.1 (D1): candidate import roots when the repo trips a size limit. */
  suggestedSubdirs?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RepoSymbolCall {
  /** Calling file (the file where the invocation appears). */
  file: string;
  /** Called method name. */
  method: string;
  /** Call-site line number inside `file`. */
  line?: number;
  /** Receiver variable name (`orderService`, `this`, ...). */
  receiver?: string;
  /** Statically resolved receiver type name, e.g. `OrderService`. */
  receiverType?: string;
  /** True when the receiver could not be typed statically (chains, external calls). */
  dynamic?: boolean;
  /** Issue 25: browser-side HTTP call (`fetch`, `axios`) for cross-language route bridging. */
  http?: { method: string; url: string };
  /** v0.7 — invoked as `go fn(...)` (Goroutine concurrent branch). */
  async?: boolean;
}

export interface RepoSymbol {
  id?: number;
  repoId: string;
  kind:
    | 'class'
    | 'interface'
    | 'method'
    | 'route'
    | 'service'
    | 'repository'
    | 'advice'
    | 'config'
    | 'field'
    | 'mapper'
    | 'sql'
    | 'dependency';
  name: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  signature?: string;
  /** Enclosing class/interface name for methods and fields (Issue 05 cross-file resolution). */
  parentType?: string;
  /** For field symbols: declared type name. */
  type?: string;
  /** For class symbols: implemented interface names. */
  interfaces?: string[];
  /**
   * v0.7 — physical module scope (Maven module / monorepo workspace dir),
   * derived at graph-build time; empty for single-module repos.
   */
  moduleName?: string;
  /** v0.7 — `<module>::[Parent.]Name`, shown when same-name symbols collide. */
  qualifiedName?: string;
  /** Bug-09: URL path rendered for routing symbols (e.g. `/api/owners`). */
  displayPath?: string;
  /**
   * Issue 21: raw annotation texts of the declaration itself (class-level
   * `@Primary` / `@Service("name")`, field `@Autowired` / `@Qualifier("x")` /
   * `@Resource(name=...)`, method-level annotations). Never descends into
   * method bodies. Used for Spring bean disambiguation during call-chain
   * resolution.
   */
  annotations?: string[];
  /** Issue 21: method parameter name → annotation texts (constructor/setter injection points). */
  paramAnnotations?: Record<string, string[]>;
  calls?: RepoSymbolCall[];
}

export interface RepoChunk {
  id?: number;
  repoId: string;
  chunkType: 'comment' | 'readme' | 'docstring';
  content: string;
  filePath?: string;
  lineStart?: number;
}

/** Structured record stored on the local evidence plane (`repoqa_events`). */
export interface RepoQAEvent {
  id: number;
  repoId?: string;
  sessionId?: string;
  eventType: string;
  intent?: string;
  queryStartAt?: string;
  firstTokenAt?: string;
  queryDoneAt?: string;
  anchorClicked: boolean;
  toolMiss?: string;
  feedback?: string;
  failureClass?: string;
  createdAt: string;
}

/** Read-only filters for `listEvents`. */
export interface EventFilters {
  repoId?: string;
  /** Exact type or comma-separated list of types, e.g. `query.start,query.done`. */
  eventType?: string;
  intent?: string;
  limit?: number;
  offset?: number;
}

function mapEvent(row: any): RepoQAEvent {
  return {
    id: row.id,
    repoId: row.repo_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    eventType: row.event_type,
    intent: row.intent ?? undefined,
    queryStartAt: row.query_start_at ?? undefined,
    firstTokenAt: row.first_token_at ?? undefined,
    queryDoneAt: row.query_done_at ?? undefined,
    anchorClicked: Boolean(row.anchor_clicked),
    toolMiss: row.tool_miss ?? undefined,
    feedback: row.feedback ?? undefined,
    failureClass: row.failure_class ?? undefined,
    createdAt: row.created_at
  };
}

function sanitizePaging(
  value: number | undefined,
  fallback: number,
  max: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.min(value, max);
}

/** Map a repo_symbols row (incl. Issue 21 annotation columns) to a RepoSymbol. */
function mapSymbolRow(row: any): RepoSymbol {
  return {
    id: row.id,
    repoId: row.repo_id,
    kind: row.kind,
    name: row.name,
    filePath: row.file_path,
    lineStart: row.line_start ?? undefined,
    lineEnd: row.line_end ?? undefined,
    signature: row.signature ?? undefined,
    parentType: row.parent_type ?? undefined,
    type: row.type_name ?? undefined,
    interfaces: row.interfaces ? JSON.parse(row.interfaces) : undefined,
    displayPath: row.display_path ?? undefined,
    annotations: row.annotations ? JSON.parse(row.annotations) : undefined,
    paramAnnotations: row.param_annotations ? JSON.parse(row.param_annotations) : undefined,
    calls: row.calls ? JSON.parse(row.calls) : undefined
  };
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
  index_parsed: number;
  index_total: number;
  created_at: string;
  updated_at: string;
}): Repo {
  const indexing = row.status === 'indexing' && row.index_total > 0;
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
    ...(indexing
      ? { indexParsed: row.index_parsed, indexTotal: row.index_total }
      : {}),
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
    /** Issue 19: remote URL for cloned repos; local imports omit it. */
    repoUrl?: string;
  }): { repo: Repo; created: boolean } {
    const existing = this.findByLocalPath(input.localPath);
    if (existing) {
      const now = new Date().toISOString();
      // Bug-10: re-importing the same path refreshes the display name too
      // (the worker computes the final name before calling this method).
      // Issue 19: COALESCE keeps the recorded remote URL when a later
      // re-import (e.g. the worker's own upsert) does not carry one.
      this.db
        .prepare(
          `UPDATE repos SET name = ?, branch = ?, local_path = ?, repo_url = COALESCE(?, repo_url), updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.name,
          input.branch ?? existing.branch,
          input.localPath,
          input.repoUrl ?? null,
          now,
          existing.id
        );
      return { repo: this.getRepo(existing.id)!, created: false };
    }
    const id = `repo-${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO repos (id, name, repo_url, local_path, branch, status, file_count, symbol_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'idle', 0, 0, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.repoUrl ?? null,
        input.localPath,
        input.branch ?? 'main',
        now,
        now
      );
    return { repo: this.getRepo(id)!, created: true };
  }

  updateRepoStatus(
    id: string,
    status: Repo['status'],
    fileCount?: number,
    symbolCount?: number,
    error?: string,
    progress?: { parsed: number; total: number }
  ): void {
    const now = new Date().toISOString();
    const cur = this.getRepo(id);
    if (!cur) return;
    this.db
      .prepare(
        `UPDATE repos SET status = ?, error = ?, file_count = COALESCE(?, file_count),
          symbol_count = COALESCE(?, symbol_count),
          index_parsed = COALESCE(?, index_parsed),
          index_total = COALESCE(?, index_total),
          updated_at = ?
         WHERE id = ?`
      )
      .run(
        status,
        status === 'error' ? (error ?? null) : null,
        fileCount ?? cur.fileCount,
        symbolCount ?? cur.symbolCount,
        progress?.parsed ?? null,
        progress?.total ?? null,
        now,
        id
      );
  }

  /** Issue 30: update live file/symbol counters without touching status. */
  updateRepoCounts(repoId: string, fileCount: number, symbolCount: number): void {
    this.db
      .prepare(
        `UPDATE repos SET file_count = ?, symbol_count = ?, updated_at = ? WHERE id = ?`
      )
      .run(fileCount, symbolCount, new Date().toISOString(), repoId);
  }

  clearRepoData(repoId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM repo_symbols WHERE repo_id = ?').run(repoId);
      this.db.prepare('DELETE FROM repo_chunks WHERE repo_id = ?').run(repoId);
      this.db.prepare('DELETE FROM repo_files WHERE repo_id = ?').run(repoId);
    });
    tx();
  }

  deleteRepo(repoId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM repoqa_events WHERE repo_id = ?').run(repoId);
      this.db.prepare('DELETE FROM repo_symbols WHERE repo_id = ?').run(repoId);
      this.db.prepare('DELETE FROM repo_chunks WHERE repo_id = ?').run(repoId);
      this.db.prepare('DELETE FROM repo_files WHERE repo_id = ?').run(repoId);
      this.db.prepare('DELETE FROM repos WHERE id = ?').run(repoId);
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

  addRepoFile(repoId: string, filePath: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO repo_files (repo_id, path) VALUES (?, ?)')
      .run(repoId, filePath);
  }

  removeRepoFile(repoId: string, filePath: string): void {
    this.db
      .prepare('DELETE FROM repo_files WHERE repo_id = ? AND path = ?')
      .run(repoId, filePath);
  }

  countFiles(repoId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM repo_files WHERE repo_id = ?')
      .get(repoId) as { count: number };
    return row.count;
  }

  countSymbols(repoId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM repo_symbols WHERE repo_id = ?')
      .get(repoId) as { count: number };
    return row.count;
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
    // Optional since Issue 09: eval harness events (`eval.run`, `eval.bucket`)
    // are written without a real repo (column is nullable, mapEvent is optional).
    repoId?: string;
    eventType: string;
    sessionId?: string;
    intent?: string;
    queryStartAt?: string;
    firstTokenAt?: string;
    queryDoneAt?: string;
    anchorClicked?: boolean;
    toolMiss?: string;
    feedback?: string;
    failureClass?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO repoqa_events (
          repo_id, session_id, event_type, intent, query_start_at, first_token_at,
          query_done_at, anchor_clicked, tool_miss, feedback, failure_class, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.repoId ?? null,
        input.sessionId ?? null,
        input.eventType,
        input.intent ?? null,
        input.queryStartAt ?? null,
        input.firstTokenAt ?? null,
        input.queryDoneAt ?? null,
        input.anchorClicked ? 1 : 0,
        input.toolMiss ?? null,
        input.feedback ?? null,
        input.failureClass ?? null,
        new Date().toISOString()
      );
  }

  listEvents(filters: EventFilters = {}): { events: RepoQAEvent[]; total: number } {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.repoId) {
      where.push('repo_id = ?');
      params.push(filters.repoId);
    }
    if (filters.eventType) {
      // Comma-separated list of event types is allowed for convenience.
      const types = filters.eventType
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean);
      if (types.length > 0) {
        where.push(`event_type IN (${types.map(() => '?').join(', ')})`);
        params.push(...types);
      }
    }
    if (filters.intent) {
      where.push('intent = ?');
      params.push(filters.intent);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS count FROM repoqa_events ${whereSql}`).get(...params) as {
        count: number;
      }
    ).count;
    const limit = sanitizePaging(filters.limit, 100, 500);
    const offset = sanitizePaging(filters.offset, 0, Number.MAX_SAFE_INTEGER);
    const rows = this.db
      .prepare(
        `SELECT * FROM repoqa_events ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[];
    return {
      events: rows.map(mapEvent),
      total
    };
  }

  upsertSymbols(symbols: RepoSymbol[]): void {
    if (symbols.length === 0) return;
    const del = this.db.prepare('DELETE FROM repo_symbols WHERE repo_id = ?');
    const tx = this.db.transaction(() => {
      del.run(symbols[0].repoId);
      this.insertSymbolRows(symbols);
    });
    tx();
  }

  /** Issue 30: replace only one file's symbols during a hot reload. */
  replaceFileSymbols(repoId: string, filePath: string, symbols: RepoSymbol[]): void {
    const tx = this.db.transaction(() => {
      this.deleteSymbolsForFile(repoId, filePath);
      this.insertSymbolRows(symbols);
    });
    tx();
  }

  deleteSymbolsForFile(repoId: string, filePath: string): void {
    this.db
      .prepare('DELETE FROM repo_symbols WHERE repo_id = ? AND file_path = ?')
      .run(repoId, filePath);
  }

  private insertSymbolRows(symbols: RepoSymbol[]): void {
    if (symbols.length === 0) return;
    const insert = this.db.prepare(
      `INSERT INTO repo_symbols (repo_id, kind, name, file_path, line_start, line_end, signature, calls, parent_type, type_name, interfaces, display_path, annotations, param_annotations)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of symbols) {
      insert.run(
        s.repoId,
        s.kind,
        s.name,
        s.filePath,
        s.lineStart ?? null,
        s.lineEnd ?? null,
        s.signature ?? null,
        s.calls ? JSON.stringify(s.calls) : null,
        s.parentType ?? null,
        s.type ?? null,
        s.interfaces ? JSON.stringify(s.interfaces) : null,
        s.displayPath ?? null,
        s.annotations ? JSON.stringify(s.annotations) : null,
        s.paramAnnotations ? JSON.stringify(s.paramAnnotations) : null
      );
    }
  }

  listSymbols(repoId: string, kind?: string): RepoSymbol[] {
    let sql = 'SELECT * FROM repo_symbols WHERE repo_id = ?';
    const params: any[] = [repoId];
    if (kind) {
      sql += ' AND kind = ?';
      params.push(kind);
    }
    return this.db.prepare(sql).all(...params).map(mapSymbolRow);
  }

  upsertChunks(chunks: RepoChunk[]): void {
    if (chunks.length === 0) return;
    const del = this.db.prepare('DELETE FROM repo_chunks WHERE repo_id = ?');
    const tx = this.db.transaction(() => {
      del.run(chunks[0].repoId);
      this.insertChunkRows(chunks);
    });
    tx();
  }

  /** Issue 30: replace only one file's chunks during a hot reload. */
  replaceFileChunks(repoId: string, filePath: string, chunks: RepoChunk[]): void {
    const tx = this.db.transaction(() => {
      this.deleteChunksForFile(repoId, filePath);
      this.insertChunkRows(chunks);
    });
    tx();
  }

  deleteChunksForFile(repoId: string, filePath: string): void {
    this.db
      .prepare('DELETE FROM repo_chunks WHERE repo_id = ? AND file_path = ?')
      .run(repoId, filePath);
  }

  private insertChunkRows(chunks: RepoChunk[]): void {
    if (chunks.length === 0) return;
    const insert = this.db.prepare(
      `INSERT INTO repo_chunks (repo_id, chunk_type, content, file_path, line_start)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const c of chunks) {
      insert.run(c.repoId, c.chunkType, c.content, c.filePath ?? null, c.lineStart ?? null);
    }
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
    return this.db.prepare(sql).all(...params).map(mapSymbolRow);
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


/**
 * v0.7 — Module Scope: derive each symbol's physical module from its path and
 * annotate `moduleName`/`qualifiedName` when the repo actually spans multiple
 * modules. Purely view-time (SQLite rows stay untouched); single-module repos
 * are left bare so ordinary projects never grow noisy prefixes.
 *
 * Rules:
 *  - module = first path segment, except under generic grouping dirs
 *    (`apps/`, `packages/`, `libs/`, `services/`, `modules/`, `projects/`,
 *    `src/`) where the second segment is the module — `apps/web/...` → `web`,
 *    `order-service/src/main/java/...` → `order-service`.
 *  - annotation only fires when ≥2 distinct modules are present.
 */
export const GENERIC_GROUP_DIRS = new Set([
  'apps',
  'packages',
  'libs',
  'services',
  'modules',
  'projects',
  'src'
]);

export function moduleOfPath(filePath: string): string | undefined {
  const segments = filePath.split(/[\/]/).filter(Boolean);
  if (segments.length < 2) return undefined;
  const first = segments[0].toLowerCase();
  if (GENERIC_GROUP_DIRS.has(first)) {
    return segments.length >= 3 ? segments[1] : undefined;
  }
  return segments[0];
}

export function applyModuleScopes(symbols: RepoSymbol[]): void {
  const modules = new Set<string>();
  for (const symbol of symbols) {
    const moduleName = moduleOfPath(symbol.filePath);
    if (moduleName) modules.add(moduleName);
  }
  if (modules.size < 2) return;
  for (const symbol of symbols) {
    const moduleName = moduleOfPath(symbol.filePath);
    if (!moduleName) continue;
    symbol.moduleName = moduleName;
    symbol.qualifiedName = `${moduleName}::${symbol.parentType ? `${symbol.parentType}.` : ''}${symbol.name}`;
  }
}
