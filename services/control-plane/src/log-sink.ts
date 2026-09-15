import fs from 'node:fs';
import path from 'node:path';
import { maskSensitiveText } from './engine/repoqa-masking';

/**
 * v0.27-B R5 — 服务端最小日志 sink。
 *
 * 评估差距 2 的收口：此前服务端零运行日志（route 抛错只能靠 R1 的 stderr 行），
 * 事故无法事后取证。本 sink：
 *  - `dataDir/logs/control-plane-<YYYYMMDD>.jsonl`，一行一事件（级别
 *    info/warn/error，`MHW_LOG_LEVEL` 控制，大小写不敏感，非法值 fail-soft 到 info）；
 *  - 容量三重防线（R5 review P1-3）：单条 5MB → `.jsonl.1…` 位移保留 5 份 +
 *    跨天 sweep 删除 RETENTION_DAYS 之前的旧日期文件（含 .N）——总占用有上界；
 *  - 写失败永不冒泡（P1-1/P2-4）：构造与 append 全 try/catch，首次失败置 dead
 *    永久停用文件面并 stderr 一次性告知——日志是辅助设施，不许杀主服务
 *    （请求行中间件跑在 res.on('finish') 裸监听器上，throw=uncaughtException）；
 *  - error 双写 stderr（先 stderr 后 append，写盘故障不吞错误可见性）；
 *  - msg 与字符串字段过 `maskSensitiveText` + 4096 截断（R1 不变量延伸到落盘面，
 *    P2-2 防单行超限诱发 rename 风暴）。
 * 只写结构化字段；请求头/请求体永不入内（query 亦排除——R5 review P2-1）。
 * 已知限制（P2-5）：同 dataDir 双进程共写为 best-effort（O_APPEND 保行完整，
 * rotate 竞态可能短暂超封顶），本机工具接受。
 * chat 进程内事件仍走 SessionLogger（独立 jsonl，会话取证语义），两者不混写。
 */

export type LogLevel = 'info' | 'warn' | 'error';
const LEVEL_ORDER: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_KEEP = 5;
const RETENTION_DAYS = 14;
const MAX_STRING_LEN = 4096;

export interface ServerLoggerOptions {
  maxBytes?: number;
  keep?: number;
}

function normalizeLevel(raw: string | undefined): LogLevel {
  const v = raw?.trim().toLowerCase();
  return v === 'warn' || v === 'error' ? v : 'info';
}

function dayStamp(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10).replace(/-/g, '');
}

/** mask + 截断一体（深及嵌套字符串字段）；truncated 标记由调用侧补。 */
function sanitize(value: unknown): { value: unknown; truncated: boolean } {
  let truncated = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const m = maskSensitiveText(v);
      if (m.length > MAX_STRING_LEN) {
        truncated = true;
        return m.slice(0, MAX_STRING_LEN);
      }
      return m;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return { value: walk(value), truncated };
}

export class ServerLogger {
  private readonly dir: string;
  private readonly threshold: number;
  private readonly maxBytes: number;
  private readonly keep: number;
  private bytes = -1;
  private day = dayStamp();
  private dead = false;
  private deadAnnounced = false;

  constructor(dataDir: string, level: string | undefined, opts: ServerLoggerOptions = {}) {
    this.dir = path.join(dataDir, 'logs');
    this.threshold = LEVEL_ORDER[normalizeLevel(level)];
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.keep = opts.keep ?? DEFAULT_KEEP;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch {
      // P2-4：logs 目录不可建（被占为文件/权限）→ 整个文件面降级停用，
      // 绝不带着 ENOENT 进写路径杀请求。
      this.dead = true;
    }
    // R5：启动即清理过期日期文件（重启卫生，也让 sweep 行为可测）。
    if (!this.dead) this.sweepStale();
  }

  get currentFile(): string {
    return path.join(this.dir, `control-plane-${this.day}.jsonl`);
  }

  info(scope: string, msg: string, fields?: Record<string, unknown>): void {
    this.write('info', scope, msg, fields);
  }
  warn(scope: string, msg: string, fields?: Record<string, unknown>): void {
    this.write('warn', scope, msg, fields);
  }
  error(scope: string, msg: string, fields?: Record<string, unknown>): void {
    this.write('error', scope, msg, fields);
  }

  /** 兼容位（同步写无缓冲）；与 SessionLogger 调用习惯对称。 */
  close(): void {}

  private write(level: LogLevel, scope: string, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.threshold) return;
    const msgS = sanitize(msg);
    const fieldsS = fields ? sanitize(fields) : undefined;
    const rec: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      scope,
      msg: msgS.value,
      ...(fieldsS ? (fieldsS.value as Record<string, unknown>) : {})
    };
    if (msgS.truncated || fieldsS?.truncated) rec.truncated = true;
    const line = JSON.stringify(rec) + '\n';
    // P1-1：error 先走 stderr（前台可见性优先），再进文件面；写盘失败不反噬。
    if (level === 'error') {
      try {
        process.stderr.write(line);
      } catch {
        /* never */
      }
    }
    if (this.dead) return;
    const today = dayStamp();
    if (today !== this.day) {
      this.day = today;
      this.bytes = -1;
      this.sweepStale();
    }
    const file = this.currentFile;
    if (this.bytes < 0) {
      try {
        this.bytes = fs.statSync(file).size;
      } catch {
        this.bytes = 0;
      }
    }
    try {
      fs.appendFileSync(file, line);
      this.bytes += Buffer.byteLength(line);
      if (this.bytes >= this.maxBytes) this.rotate();
    } catch (err) {
      this.dead = true; // 永久停用文件面（不做每请求重试风暴）
      if (!this.deadAnnounced) {
        this.deadAnnounced = true;
        try {
          process.stderr.write(
            `[log-sink] file sink disabled: ${err instanceof Error ? err.message : String(err)}\n`
          );
        } catch {
          /* never */
        }
      }
    }
  }

  /** 跨天清理：删除 RETENTION_DAYS 之前的日期文件（含轮转代），失败静默。 */
  private sweepStale(): void {
    try {
      const cutoff = dayStamp(new Date(Date.now() - RETENTION_DAYS * 86_400_000));
      for (const f of fs.readdirSync(this.dir)) {
        const m = /^control-plane-(\d{8})\.jsonl(\.\d+)?$/.exec(f);
        if (m && m[1] < cutoff) {
          try {
            fs.rmSync(path.join(this.dir, f), { force: true });
          } catch {
            /* keep trying others */
          }
        }
      }
    } catch {
      /* dir unreadable — next day tries again */
    }
  }

  /** .jsonl → .jsonl.1 → … 依次位移，保留 keep 代。 */
  private rotate(): void {
    const file = this.currentFile;
    try {
      fs.rmSync(`${file}.${this.keep}`, { force: true });
      for (let gen = this.keep - 1; gen >= 1; gen--) {
        if (fs.existsSync(`${file}.${gen}`)) fs.renameSync(`${file}.${gen}`, `${file}.${gen + 1}`);
      }
      if (fs.existsSync(file)) fs.renameSync(file, `${file}.1`);
      this.bytes = 0;
    } catch {
      // P2-5：轮转失败（Windows 锁文件）不重置计数——重同步真实大小，
      // 下次写再试，避免「bytes=0 → 文件事实上不封顶」。
      try {
        this.bytes = fs.statSync(file).size;
      } catch {
        this.bytes = 0;
      }
    }
  }
}
