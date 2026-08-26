import path from 'node:path';
import { watch, readdirSync, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Repo } from './repoqa-repos';
import type { RepoQAWorker } from './repoqa-worker';
import type { EventBus } from './events';
import type { ServerEvent } from '../../../packages/contracts/src/index';
import { isIgnoredDir } from './repoqa-scan';

export interface RepoWatcherOptions {
  /** Coalescing window before a changed file is re-parsed (default 300ms). */
  debounceMs?: number;
}

function toFilename(value: string | Buffer | null): string | undefined {
  if (value === null) return undefined;
  return Buffer.isBuffer(value) ? value.toString('utf8') : value;
}

/**
 * Issue 30 — local realtime index refresh. Watches one indexed repo, ignores
 * the same directories as the scanner (`node_modules`, `target`, `.venv`,
 * ...), debounces bursts of FS events and hands each surviving file to the
 * worker's incremental reparse/remove path. Every applied change is then
 * broadcast as `repo_updated` over the server's WebSocket.
 */
export class RepoWatcher {
  private rootWatcher: FSWatcher | null = null;
  private dirWatchers = new Map<string, FSWatcher>();
  private pending = new Map<string, true>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private rescanTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly debounceMs: number;

  constructor(
    private readonly repo: Repo,
    private readonly worker: RepoQAWorker,
    private readonly eventBus: EventBus,
    options: RepoWatcherOptions = {}
  ) {
    this.debounceMs = options.debounceMs ?? 300;
  }

  start(): void {
    if (this.closed || this.rootWatcher || this.dirWatchers.size > 0) return;
    try {
      this.rootWatcher = watch(
        this.repo.localPath,
        { recursive: true },
        (event, filename) => this.handleEvent(this.repo.localPath, filename)
      );
    } catch {
      this.startDirectoryWatchers();
    }
  }

  /** Process every pending path now; resolves when the queue drains. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      const pending = [...this.pending.keys()];
      this.pending.clear();
      for (const relative of pending) this.enqueue(relative);
    }
    await this.queue;
  }

  close(): void {
    this.closed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.rescanTimer) {
      clearTimeout(this.rescanTimer);
      this.rescanTimer = null;
    }
    this.pending.clear();
    this.rootWatcher?.close();
    this.rootWatcher = null;
    for (const watcher of this.dirWatchers.values()) watcher.close();
    this.dirWatchers.clear();
  }

  private handleEvent(baseDir: string, filename: string | Buffer | null): void {
    if (this.closed) return;
    const name = toFilename(filename);
    if (name === undefined) return;
    const absolute = path.isAbsolute(name) ? name : path.join(baseDir, name);
    const relative = path.relative(this.repo.localPath, absolute).split(path.sep).join('/');
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
    if (!this.isRelevant(relative)) return;

    this.pending.set(relative, true);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  private isRelevant(relative: string): boolean {
    return !relative.split('/').some((segment) => isIgnoredDir(segment));
  }

  private enqueue(relative: string): void {
    this.queue = this.queue
      .then(() => this.process(relative))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[repoqa-watcher] ${this.repo.id} ${relative}: ${message}`);
      });
  }

  private async process(relative: string): Promise<void> {
    if (this.closed) return;
    const absolute = path.join(this.repo.localPath, ...relative.split('/'));
    let isFile = false;
    try {
      isFile = (await stat(absolute)).isFile();
    } catch {
      isFile = false;
    }
    if (isFile) {
      const result = await this.worker.reparseFile(this.repo.id, absolute);
      this.emit(result.action, [result.file]);
      return;
    }
    // Directory create/rename events carry no symbol payload; deleting a
    // directory itself is harmless (child files produce their own events).
    const result = await this.worker.removeFile(this.repo.id, absolute);
    this.emit(result.action, [result.file]);
  }

  private emit(action: 'update' | 'remove', files: string[]): void {
    this.eventBus.emit({
      type: 'repo_updated',
      payload: { repoId: this.repo.id, files, action, ts: Date.now() }
    } as ServerEvent);
  }

  /** Fallback for platforms/filesystems without recursive fs.watch. */
  private startDirectoryWatchers(): void {
    this.watchDir(this.repo.localPath);
    this.rescanDirs();
  }

  private watchDir(dir: string): void {
    if (this.closed || this.dirWatchers.has(dir)) return;
    let watcher: FSWatcher;
    try {
      watcher = watch(dir, (event, filename) => {
        this.handleEvent(dir, filename);
        if (event === 'rename') this.scheduleRescan();
      });
    } catch {
      return;
    }
    watcher.on('error', () => this.dirWatchers.delete(dir));
    this.dirWatchers.set(dir, watcher);
  }

  private scheduleRescan(): void {
    if (this.closed) return;
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = null;
      this.rescanDirs();
    }, this.debounceMs);
  }

  private rescanDirs(): void {
    if (this.closed) return;
    const dirs: string[] = [];
    const stack = [this.repo.localPath];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !isIgnoredDir(entry.name)) {
          stack.push(path.join(dir, entry.name));
        }
      }
      dirs.push(dir);
    }
    for (const dir of dirs) this.watchDir(dir);
    for (const [dir, watcher] of this.dirWatchers) {
      if (!dirs.includes(dir)) {
        watcher.close();
        this.dirWatchers.delete(dir);
      }
    }
  }
}
