import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * v0.6.0 — `codecompass doctor`: one-shot environment/runtime/ABI/data/Local
 * LLM self-diagnostics. All checks are read-only except a temp probe file in
 * the data directory, which is removed immediately.
 */

export type DoctorCheckStatus = 'ok' | 'warning' | 'error';

export interface DoctorCheckResult {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  message: string;
  detail?: string;
}

export interface DoctorReport {
  schemaVersion: 1;
  status: DoctorCheckStatus;
  durationMs: number;
  checks: DoctorCheckResult[];
}

export interface RunDoctorOptions {
  dataDir?: string;
  port?: number;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export const NODE_MIN_MAJOR = 24;
export const FREE_DISK_MIN_MB = 500;
export const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags';

function majorMinor(version: string): { major: number; minor: number } {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number(part) || 0);
  return { major, minor };
}

async function checkNodeVersion(): Promise<DoctorCheckResult> {
  const version = process.versions.node;
  const { major } = majorMinor(version);
  if (major >= NODE_MIN_MAJOR) {
    return {
      id: 'node',
      label: 'Node.js Runtime',
      status: 'ok',
      message: `Node ${version} satisfies >= ${NODE_MIN_MAJOR}.0.0`
    };
  }
  return {
    id: 'node',
    label: 'Node.js Runtime',
    status: 'error',
    message: `Node ${version} is below ${NODE_MIN_MAJOR}.0.0`,
    detail: 'Upgrade Node to match NODE_MODULE_VERSION 137 before running CodeCompass.'
  };
}

async function checkSqlite(): Promise<DoctorCheckResult> {
  try {
    const db = new Database(':memory:');
    try {
      const mode = db.pragma('journal_mode = WAL', { simple: true }) as string;
      db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT)');
      db.prepare('INSERT INTO probe (value) VALUES (?)').run('ok');
      const row = db.prepare('SELECT value FROM probe WHERE id = 1').get() as {
        value: string;
      };
      if (row?.value !== 'ok') throw new Error('read/write probe mismatch');
      return {
        id: 'sqlite',
        label: 'SQLite Native ABI',
        status: 'ok',
        message: `WAL probe ok (journal_mode=${mode})`,
        detail: 'Memory DB read/write round-trip passed.'
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      id: 'sqlite',
      label: 'SQLite Native ABI',
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      detail: 'Reinstall native modules for the current Node ABI.'
    };
  }
}

async function checkPort(port: number): Promise<DoctorCheckResult> {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    return {
      id: 'port',
      label: 'Port Availability',
      status: 'error',
      message: `Invalid port ${port}`
    };
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port }, () => {
        server.close(() => resolve());
      });
    });
    return {
      id: 'port',
      label: 'Port Availability',
      status: 'ok',
      message: `Port ${port} is bindable`
    };
  } catch {
    return {
      id: 'port',
      label: 'Port Availability',
      status: 'error',
      message: `Port ${port} is already in use or cannot be bound`
    };
  }
}

async function checkDataDir(dataDir: string): Promise<DoctorCheckResult> {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    const probe = path.join(dataDir, `.doctor-probe-${process.pid}`);
    await fs.writeFile(probe, 'ok', 'utf8');
    const read = await fs.readFile(probe, 'utf8');
    await fs.rm(probe, { force: true });
    if (read !== 'ok') throw new Error('read/write probe mismatch');

    let freeMb: number | undefined;
    try {
      const statfs = await fs.statfs(dataDir);
      freeMb = Number((statfs.bavail * statfs.bsize) / (1024 * 1024));
    } catch {
      freeMb = undefined;
    }
    if (freeMb !== undefined && freeMb < FREE_DISK_MIN_MB) {
      return {
        id: 'data-dir',
        label: 'Data Directory',
        status: 'warning',
        message: `${dataDir} is writable but only ${Math.floor(freeMb)} MB free`,
        detail: `CodeCompass wants >= ${FREE_DISK_MIN_MB} MB free.`
      };
    }
    return {
      id: 'data-dir',
      label: 'Data Directory',
      status: 'ok',
      message:
        freeMb !== undefined
          ? `${dataDir} writable, ${Math.floor(freeMb)} MB free`
          : `${dataDir} writable`
    };
  } catch (error) {
    return {
      id: 'data-dir',
      label: 'Data Directory',
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function checkOllama(
  fetchImpl: typeof fetch
): Promise<DoctorCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetchImpl(OLLAMA_TAGS_URL, {
      signal: controller.signal
    });
    if (!response.ok) {
      return {
        id: 'ollama',
        label: 'Local LLM Health',
        status: 'warning',
        message: `Ollama responded ${response.status}`
      };
    }
    const body = (await response.json()) as { models?: Array<{ name: string }> };
    const models = body.models ?? [];
    if (models.length === 0) {
      return {
        id: 'ollama',
        label: 'Local LLM Health',
        status: 'warning',
        message: 'Ollama is running but no models are installed'
      };
    }
    return {
      id: 'ollama',
      label: 'Local LLM Health',
      status: 'ok',
      message: `Ollama ready (${models.length} models: ${models
        .slice(0, 3)
        .map((model) => model.name)
        .join(', ')}${models.length > 3 ? '...' : ''})`
    };
  } catch {
    return {
      id: 'ollama',
      label: 'Local LLM Health',
      status: 'warning',
      message: 'Ollama not reachable on localhost:11434'
    };
  } finally {
    clearTimeout(timer);
  }
}

export function defaultDataDir(): string {
  return process.env.MHW_DATA_DIR || path.join(os.homedir(), '.mhw');
}

export async function runDoctor(
  options: RunDoctorOptions = {}
): Promise<DoctorReport> {
  const startedAt = Date.now();
  const port = options.port ?? Number(process.env.MHW_CP_PORT ?? 43110);
  const dataDir = path.resolve(options.dataDir ?? defaultDataDir());
  const fetchImpl = options.fetchImpl ?? fetch;
  const checks = await Promise.all([
    checkNodeVersion(),
    checkSqlite(),
    checkPort(port),
    checkDataDir(dataDir),
    checkOllama(fetchImpl)
  ]);
  const status: DoctorCheckStatus = checks.some((check) => check.status === 'error')
    ? 'error'
    : checks.some((check) => check.status === 'warning')
      ? 'warning'
      : 'ok';
  return {
    schemaVersion: 1,
    status,
    durationMs: Date.now() - startedAt,
    checks
  };
}

export function renderDoctorText(report: DoctorReport): string {
  const lines = [
    `CodeCompass doctor — ${report.status} (${report.durationMs}ms)`,
    ...report.checks.map(
      (check) =>
        `[${check.status.toUpperCase()}] ${check.label}: ${check.message}${
          check.detail ? ` — ${check.detail}` : ''
        }`
    )
  ];
  return lines.join('\n');
}
