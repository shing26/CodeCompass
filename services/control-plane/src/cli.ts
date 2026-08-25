import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { startServer, type RunningServer } from './server';
import {
  runMcpServer,
  type McpTransportFactory
} from './repoqa-mcp';
import { analyzeDiff, renderMarkdown } from './repoqa-diff';

export const VERSION = '0.3.5';

export interface CliArgs {
  /** Subcommand (`mcp` starts the stdio MCP server, `diff` analyzes a PR). */
  command?: 'mcp' | 'diff' | 'pr-summary';
  /** Positional `codecompass [path]` — local repo directory to import. */
  targetPath?: string;
  /** `codecompass diff <base> <head> [repoPath]` — base git ref. */
  diffBase?: string;
  /** `codecompass diff <base> <head> [repoPath]` — head git ref. */
  diffHead?: string;
  /** Diff report format; default markdown. */
  diffOutput?: 'markdown' | 'json';
  /** Write the diff report to a file instead of stdout. */
  diffFile?: string;
  /** Exit 2 from `pr-summary` when PR impact is detected. */
  failOnImpact: boolean;
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
  codecompass mcp [options] <path>
  codecompass diff [options] <base> <head> [repoPath]
  codecompass pr-summary [options] <base> <head> [repoPath]

Subcommands:
  mcp <path>            Start a Model Context Protocol (MCP) stdio server. The
                        repository at <path> is indexed first; Agent clients
                        then call /api-style tools over JSON-RPC (tools/list,
                        tools/call) without any HTTP listener.
  diff <base> <head>    Analyze a PR's architecture impact: which Java classes
                        and methods changed, which @RestController API entries
                        are affected (reverse reachability), and which config
                        keys changed. Prints a Markdown report; use
                        --output=json for structured JSON and --file=report.md
                        to write it to disk. [repoPath] defaults to the
                        current directory. Read-only: never touches the
                        working tree or .git metadata.
  pr-summary <base> <head>
                        Same read-only PR impact analysis as diff, shaped
                        for CI consumption: supports --fail-on-impact to exit
                        non-zero when affected APIs/config changes are found.

Arguments:
  path                  Local repository directory to import, then open the
                        browser straight to its cockpit dashboard.

Options:
  --port <number>       HTTP port (default: MHW_CP_PORT or 43110)
  --data-dir <dir>      Data directory (default: MHW_DATA_DIR or ~/.mhw)
  --no-browser          Do not auto-open the browser
  --output <fmt>        Diff report format: markdown | json (default: markdown)
  --file <path>         Write the diff report to a file instead of stdout
  --fail-on-impact      With pr-summary, exit 2 when impact is detected
  --help, -h            Show this help
  --version, -v         Print version
`;

/** Parse argv (node-style, no binary name). Unknown flags → error. */
export function parseArgs(argv: string[]): ParseResult {
  const args: CliArgs = { noBrowser: false, help: false, version: false, failOnImpact: false };

  const nextValue = (i: number, flag: string, inline?: string): { value?: string; next: number } => {
    if (inline !== undefined) return { value: inline, next: i };
    const value = argv[i + 1];
    if (value === undefined) return { next: i + 1 };
    return { value, next: i + 1 };
  };

  /** Assign one positional of `codecompass diff <base> <head> [repoPath]`. */
  const assignDiffPositional = (arg: string): boolean => {
    if (args.diffBase === undefined) {
      args.diffBase = arg;
      return true;
    }
    if (args.diffHead === undefined) {
      args.diffHead = arg;
      return true;
    }
    if (args.targetPath === undefined) {
      args.targetPath = arg;
      return true;
    }
    return false;
  };

  let positionalOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (positionalOnly) {
      if (args.command === 'diff' || args.command === 'pr-summary') {
        if (!assignDiffPositional(arg)) return { ok: false, error: `Unexpected extra argument: ${arg}` };
      } else if (args.targetPath !== undefined) {
        return { ok: false, error: `Unexpected extra argument: ${arg}` };
      } else {
        args.targetPath = arg;
      }
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
    if (arg === '--fail-on-impact') {
      args.failOnImpact = true;
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
    if (flag === '--output') {
      const { value, next } = nextValue(i, flag, inline);
      i = next;
      if (value !== 'markdown' && value !== 'json') {
        return { ok: false, error: '--output expects "markdown" or "json"' };
      }
      args.diffOutput = value;
      continue;
    }
    if (flag === '--file') {
      const { value, next } = nextValue(i, flag, inline);
      i = next;
      if (value === undefined || value === '') {
        return { ok: false, error: '--file expects a report file path' };
      }
      args.diffFile = value;
      continue;
    }
    if (arg.startsWith('-')) {
      return { ok: false, error: `Unknown option: ${arg}` };
    }
    if (
      args.command === undefined &&
      args.targetPath === undefined &&
      (arg === 'mcp' || arg === 'diff' || arg === 'pr-summary')
    ) {
      args.command = arg;
      continue;
    }
    if (args.command === 'diff' || args.command === 'pr-summary') {
      if (!assignDiffPositional(arg)) {
        return { ok: false, error: `Unexpected extra argument: ${arg}` };
      }
      continue;
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
  /** Injectable MCP transport for tests; defaults to stdio. */
  mcpTransport?: McpTransportFactory;
}

export interface CliRunResult {
  server: RunningServer | null;
  /** URL that would have been opened (null when no browser launch needed). */
  cockpitUrl: string | null;
  /** Optional process exit code for non-server CLI commands (e.g. pr-summary). */
  exitCode?: number;
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

  if (args.command === 'diff' || args.command === 'pr-summary') {
    // Issue 22/Phase 5: `codecompass diff` / `codecompass pr-summary` — PR 架构
    // 影响面透视。纯只读分析（git 对象），不启动 HTTP server。
    if (!args.diffBase || !args.diffHead) {
      const commandName = args.command === 'diff' ? 'diff' : 'pr-summary';
      throw new Error(`codecompass ${commandName} requires <base> and <head>\n\n${USAGE}`);
    }
    const repoPath = path.resolve(args.targetPath ?? process.cwd());
    const report = await analyzeDiff({
      repoPath,
      base: args.diffBase,
      head: args.diffHead
    });
    const rendered =
      args.diffOutput === 'json' ? JSON.stringify(report, null, 2) : renderMarkdown(report);
    if (args.diffFile) {
      const outPath = path.resolve(args.diffFile);
      await fs.writeFile(outPath, rendered, 'utf8');
      log(`Impact report written to ${outPath}`);
    } else {
      log(rendered);
    }
    if (args.command === 'pr-summary') {
      const hasImpact =
        report.affectedApis.length > 0 ||
        report.configChanges.length > 0 ||
        report.uncovered.length > 0;
      return {
        server: null,
        cockpitUrl: null,
        exitCode: args.failOnImpact && hasImpact ? 2 : 0
      };
    }
    return { server: null, cockpitUrl: null };
  }

  if (args.command === 'mcp') {
    // Issue 20: `codecompass mcp <path>` — index the target repo, then serve
    // the MCP protocol on stdio until the Agent client disconnects. No HTTP
    // listener is started; its lifecycle is fully owned by runMcpServer.
    const mcpEnv = { ...(ctx.env ?? process.env) };
    if (args.dataDir) mcpEnv.MHW_DATA_DIR = args.dataDir;
    // Stdio carries the MCP protocol itself; production progress logs go to
    // stderr so stdout stays a pure newline-delimited JSON message stream.
    const mcpLog = ctx.log ?? ((line: string) => console.error(line));
    await runMcpServer({
      targetPath: args.targetPath,
      env: mcpEnv,
      log: mcpLog,
      transportFactory: ctx.mcpTransport
    });
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
  if (result.exitCode) process.exitCode = result.exitCode;
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
