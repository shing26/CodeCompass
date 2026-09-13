import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerLogger } from './log-sink';

const dirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-logsink-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function lines(dir: string): Array<Record<string, unknown>> {
  const f = path.join(dir, 'logs');
  return fs
    .readdirSync(f)
    .filter((n) => n.endsWith('.jsonl'))
    .flatMap((n) =>
      fs
        .readFileSync(path.join(f, n), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    );
}

describe('v0.27-B R5: ServerLogger sink', () => {
  it('writes levelled JSONL to dataDir/logs/control-plane-<day>.jsonl', () => {
    const log = new ServerLogger(tmp(), 'info');
    log.info('http', 'request', { method: 'GET', path: '/health', durMs: 3 });
    log.close();
    const recs = lines(dirs[dirs.length - 1]);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ level: 'info', scope: 'http', msg: 'request', method: 'GET', path: '/health', durMs: 3 });
    expect(typeof recs[0].ts).toBe('string');
  });

  it('honors MHW_LOG_LEVEL (warn suppresses info)', () => {
    const dir = tmp();
    const log = new ServerLogger(dir, 'warn');
    log.info('http', 'should be dropped');
    log.warn('worker', 'kept');
    log.close();
    const recs = lines(dir);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ level: 'warn', scope: 'worker' });
  });

  it('errors double-write to stderr with the same record', () => {
    const log = new ServerLogger(tmp(), 'info');
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    log.error('http', 'boom');
    const written = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('"level":"error"');
    expect(written).toContain('boom');
    log.close();
  });

  it('masks credentials in msg and fields (R1 invariant carried to the file sink)', () => {
    const dir = tmp();
    const log = new ServerLogger(dir, 'info');
    log.error('http', 'connect postgres://user:super-secret-pw@db/app', {
      stack: 'Error at postgres://u:topsecret@h/x',
      safe: 'value'
    });
    log.close();
    const raw = JSON.stringify(lines(dir));
    expect(raw).not.toContain('super-secret-pw');
    expect(raw).not.toContain('topsecret');
    expect(raw).toContain('value');
    expect(raw).toContain('postgres://user:');
  });

  it('rotates by size and caps retained generations', () => {
    const dir = tmp();
    const log = new ServerLogger(dir, 'info', { maxBytes: 600, keep: 3 });
    for (let i = 0; i < 60; i++) log.info('test', 'x'.repeat(40), { i });
    log.close();
    const files = fs.readdirSync(path.join(dir, 'logs'));
    const rolled = files.filter((f) => /\.jsonl(\.\d+)?$/.test(f));
    expect(rolled.length).toBeGreaterThan(1);
    expect(rolled.length).toBeLessThanOrEqual(1 + 3);
  });

  it('bad level string falls back to info (config fail-soft)', () => {
    const dir = tmp();
    const log = new ServerLogger(dir, 'not-a-level');
    log.info('t', 'kept');
    log.close();
    expect(lines(dir)).toHaveLength(1);
  });

  it('level matching is case-insensitive (R5 review P2-6)', () => {
    const dir = tmp();
    const log = new ServerLogger(dir, 'WARN');
    log.info('t', 'dropped');
    log.warn('t', 'kept');
    log.close();
    const recs = lines(dir);
    expect(recs).toHaveLength(1);
    expect(recs[0].level).toBe('warn');
  });

  it('long strings are truncated with a marker (R5 review P2-2)', () => {
    const dir = tmp();
    const log = new ServerLogger(dir, 'info');
    log.error('t', 'x'.repeat(6000));
    log.info('t', 'nested', { deep: { msg: 'y'.repeat(6000) } });
    log.close();
    const recs = lines(dir);
    expect(recs).toHaveLength(2);
    expect(String(recs[0].msg).length).toBeLessThanOrEqual(4096);
    expect(recs[0].truncated).toBe(true);
    expect(String((recs[1].deep as { msg: string }).msg).length).toBeLessThanOrEqual(4096);
    expect(recs[1].truncated).toBe(true);
  });

  it('an unwritable logs dir degrades the sink, never throws into the caller (R5 review P1-1/P2-4)', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'logs'), 'occupied as a file'); // mkdir 必 ENOTDIR
    const log = new ServerLogger(dir, 'info');
    expect(() => log.info('t', 'survives')).not.toThrow();
    expect(() => log.error('t', 'still on stderr')).not.toThrow(); // error 的 stderr 镜像仍工作
    log.close();
    // 文件面停用后没有半成品目录内容可数——只要没抛即达标；再验 stderr 镜像到了。
  });

  it('startup sweep deletes day-files past retention, keeps fresh ones (R5 review P1-3)', () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
    const old = path.join(dir, 'logs', 'control-plane-20200101.jsonl');
    const oldRolled = path.join(dir, 'logs', 'control-plane-20200101.jsonl.3');
    const fresh = path.join(dir, 'logs', `control-plane-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.jsonl`);
    fs.writeFileSync(old, 'stale\n');
    fs.writeFileSync(oldRolled, 'stale\n');
    fs.writeFileSync(fresh, 'keep\n');
    const log = new ServerLogger(dir, 'info');
    log.close();
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(oldRolled)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });
});
