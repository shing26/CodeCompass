import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer, type RunningServer } from './server';

export const VERSION = '0.2.0-beta';

export interface CliArgs {
  /** Positional `codecompass [path]` — local repo directory to import. */
  targetPath?: string;
  port?: number;
  dataDir?: string;
  noBrowser: boolean;
  help: boolean;
  version: boolean;
}

export type ParseResult =
  | { ok: true; args: CliArgs }
  | { ok: false; error: string };

export const USAGE = `codecompass v${VERSION} — one-process full-stack CodeCompass workbench

Usage:
  codecompass [options] [path]

Arguments:
  path                  Local repository directory to import, then open the
                        browser straight to its cockpit dashboard.

Options:
  --port <number>       HTTP port (default: MHW_CP_PORT or 43110)
  --data-dir <dir>      Data directory (default: MHW_DATA_DIR or ~/.mhw)
  --no-browser          Do not auto-open the browser
  --help, -h            Show this help
  --version, -v         Print version
`;

/** Parse argv (node-style, no binary name). Unknown flags → error. */
export function parseArgs(argv: string[]): ParseResult {
  const args: CliArgs = { noBrowser: false, help: false, version: false };

  const nextValue = (i: number, flag: string, inline?: string): { value?: string; next: number } => {
    if (inline !== undefined) return { value: inline, next: i };
    const value = argv[i + 1];
    if (value === undefined) return { next: i + 1 };
    return { value, next: i + 1 };
  };

  let positionalOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (positionalOnly) {
      if (args.targetPath !== undefined) return { ok: false, error: `Unexpected extra argument: ${arg}` };
      args.targetPath = arg;
      continue;
    }
    if (arg === '--') {
      positionalOnly = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      args.version = true;
      continue;
    }
    if (arg === '--no-browser') {
      args.noBrowser = true;
      continue;
    }

    const inline = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : undefined;
    const flag = inline !== undefined ? arg.slice(0, arg.indexOf('=')) : arg;

    if (flag === '--port') {
      const { value, next } = nextValue(i, flag, inline);
      i = next;
      if (value === undefined || !/^\d+$/.test(value)) {
        return { ok: false, error: '--port expects a positive integer' };
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65535) {
        return { ok: false, error: `--port out of range: ${value}` };
      }
      args.port = parsed;
      continue;
    }
    if (flag === '--data-dir') {
      const { value, next } = nextValue(i, flag, inline);
      i = next;
      if (value === undefined || value === '') {
        return { ok: false, error: '--data-dir expects a directory path' };
      }
      args.dataDir = value;
      continue;
    }
    if (arg.startsWith('-')) {
      return { ok: false, error: `Unknown option: ${arg}` };
    }
    if (args.targetPath !== undefined) {
      return { ok: false, error: `Unexpected extra argument: ${arg}` };
    }
    args.targetPath = arg;
  }

  return { ok: true, args };
}

/** Open a URL in the platform default browser; never throws. */
export function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // opening a browser is best-effort — never crash the server over it
  }
}

export interface CliContext {
  /** Environment handed to loadConfig; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Browser opener; injectable for tests. Defaults to openBrowser. */
  openBrowser?: (url: string) => void;
  /** Log output; defaults to console.log. */
  log?: (line: string) => void;
}

export interface CliRunResult {
  server: RunningServer | null;
  /** URL that would have been opened (null when no browser launch needed). */
  cockpitUrl: string | null;
}

/**
 * Run the CLI. Starts the one-process stack (and imports `targetPath` when
 * given), then auto-opens the browser to the cockpit unless --no-browser.
 * Resolves with the running server so callers/tests can close() it; help and
 * version resolve immediately with server=null.
 */
export async function runCli(argv: string[], ctx: CliContext = {}): Promise<CliRunResult> {
  const log = ctx.log ?? ((line: string) => console.log(line));
  const open = ctx.openBrowser ?? openBrowser;

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    throw new Error(`${parsed.error}\n\n${USAGE}`);
  }
  const args = parsed.args;
  if (args.help) {
    log(USAGE.trimEnd());
    return { server: null, cockpitUrl: null };
  }
  if (args.version) {
    log(VERSION);
    return { server: null, cockpitUrl: null };
  }

  const env = { ...(ctx.env ?? process.env) };
  if (args.dataDir) env.MHW_DATA_DIR = args.dataDir;

  let running: RunningServer;
  try {
    running = await startServer({
      env,
      port: args.port,
      onListening: (port) => log(`CodeCompass running on http://localhost:${port}`)
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      throw new Error(
        `Port ${args.port ?? '43110'} is already in use — is another CodeCompass/control-plane instance running?\n` +
          `Stop it, or start on another port with --port (e.g. codecompass --port 43200).`
      );
    }
    throw err;
  }

  let repoId: string | null = null;
  if (args.targetPath) {
    const localPath = path.resolve(args.targetPath);
    log(`Importing repo: ${localPath}`);
    const result = await running.worker.indexRepo({ localPath });
    repoId = result.repo?.id ?? null;
    if (result.repo?.status === 'ready') {
      log(`Repo ready: ${result.repo.name} (${result.repo.id})`);
    } else {
      log(
        `Repo import finished with status "${result.repo?.status ?? 'unknown'}": ` +
          `open the workbench and check the repo list`
      );
    }
  }

  const cockpitUrl = `http://localhost:${running.port}/${repoId ? `?repo=${encodeURIComponent(repoId)}` : ''}`;
  if (!args.noBrowser) {
    open(cockpitUrl);
    log(`Opened browser: ${cockpitUrl}`);
  } else if (repoId) {
    log(`Cockpit URL: ${cockpitUrl}`);
  } else {
    log(`Workbench URL: http://localhost:${running.port}/`);
  }
  return { server: running, cockpitUrl };
}

export async function main(argv = process.argv.slice(2), ctx: CliContext = {}): Promise<void> {
  const result = await runCli(argv, ctx);
  if (!result.server) return;
  const shutdown = async () => {
    await result.server!.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const isEntry =
  process.env.CODECOMPASS_CLI === '1' ||
  (typeof require !== 'undefined' && require.main === module) ||
  process.argv.some((arg) => arg.replace(/\\/g, '/').endsWith('/src/cli.ts'));

if (isEntry) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}