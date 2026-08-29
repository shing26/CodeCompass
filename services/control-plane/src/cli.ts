import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { startServer, type RunningServer } from './server';
import {
  runMcpServer,
  type McpTransportFactory
} from './repoqa-mcp';
import { analyzeDiff, evaluateDiffPolicy, renderMarkdown } from './repoqa-diff';
import { loadConfig } from './config';
import { openDb, ensureDefaultWorkspace, backupDb } from './db';
import { EventBus } from './events';
import { RepoQARepos } from './repoqa-repos';
import { RepoQAWorker } from './repoqa-worker';
import { extractSubgraphContext } from './repoqa-graphrag';
import { runDoctor, renderDoctorText, defaultDataDir } from './doctor';
import { INSTALL_IDES, installIdeConfig, type IdeId } from './installer';
import { runDiagnose } from './diagnose-engine';
import { runBlastRadius } from './blast-radius';
import { runDomainRadar } from './domain-radar-engine';
import { runModuleEvolution } from './module-evolution-engine';
import { renderArtifactHtml, writeArtifactFile, locateMermaidScript } from './export-artifact';

export const VERSION = '0.8.0';

export interface CliArgs {
  /** Subcommand (`mcp` starts the stdio MCP server, `diff` analyzes a PR). */
  command?:
    | 'mcp'
    | 'diff'
    | 'pr-summary'
    | 'context'
    | 'doctor'
    | 'install'
    | 'diagnose'
    | 'refactor-plan'
    | 'export'
    | 'radar'
    | 'evolve';
  /** Positional `codecompass [path]` — local repo directory to import. */
  targetPath?: string;
  /** `codecompass context <query> [repoPath]` — start-symbol query. */
  contextQuery?: string;
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
  /** Issue 29: fail `pr-summary` when affected routes exceed this limit. */
  maxAffectedRoutes?: number;
  /** Issue 29: fail `pr-summary` when a modified symbol breaks the chain. */
  failOnBreak: boolean;
  /** Issue 29: fail `pr-summary` on impacted unauthenticated sensitive routes. */
  failOnAuthImpact: boolean;
  /** `codecompass install --ide <ide>` — target IDE config. */
  installIde?: string;
  /** `codecompass install --dry-run` — preview without writing. */
  dryRun: boolean;
  /** `codecompass install --repo <path>` — repo the MCP entry indexes. */
  installRepo?: string;
  /** `codecompass refactor-plan --change-type <t>` (default SIGNATURE_CHANGE). */
  changeType?: 'SIGNATURE_CHANGE' | 'REMOVAL' | 'LOGIC_REFACTOR';
  /** `codecompass evolve --intent <deprecate|extend>`. */
  evolveIntent?: 'DEPRECATE' | 'EXTEND';
  /** `codecompass evolve --target <module|symbol>`. */
  evolveTarget?: string;
  port?: number;
  dataDir?: string;
  noBrowser: boolean;
  noWatch: boolean;
  /** `codecompass doctor --json` — structured health report. */
  doctorJson: boolean;
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
  codecompass context <query> [repoPath]
  codecompass diagnose <symbol|route> [repoPath]
  codecompass refactor-plan <symbol> [repoPath] [--change-type <t>]
  codecompass export <symbol|route> [repoPath] [--file <out.html>]
  codecompass radar [query] [repoPath]
  codecompass evolve --intent <deprecate|extend> --target <module|symbol> [repoPath]
  codecompass doctor [--data-dir <path>] [--json]
  codecompass install --ide <cursor|zcode|claude|all> [--repo <path>] [--dry-run]

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
  context <query>       Extract a Graph RAG agent context around the resolved
                        start symbol: 1-hop callers, 1-3 hop callees, class
                        skeletons, token pruning and credential masking.
                        [repoPath] defaults to the current directory.
  diagnose <symbol>     Deterministic cross-stack root-cause traversal
                        (frontend → router → service → data mapper). Accepts
                        a method name or "METHOD /route/path". Prints a JSON
                        DiagnoseResult with layer-annotated chain steps.
  refactor-plan <symbol>
                        Deterministic blast-radius plan: direct/indirect
                        callers, impacted routes and frontend components,
                        risk level and migration steps. Prints JSON.
  export <symbol>       Render the diagnose result as a single self-contained
                        HTML artifact (inlined mermaid runtime, chain steps,
                        code slices) for offline review and PR archiving.
  radar [query]         Domain panorama: hub nodes (degree + deterministic
                        PageRank), top external APIs, persistence layer and,
                        with a query, the top-3 intent anchor symbols.
                        Prints JSON.
  evolve                Module evolution planning. --intent deprecate emits
                        orphaned public code (fixed-point cascade) and a
                        teardown checklist; --intent extend emits the attach
                        point, transaction boundaries and a decoupling
                        pattern with code scaffolds. Prints JSON.
  doctor                Diagnose Node/SQLite ABI, control-plane port, data
                        directory and Local LLM (Ollama) health. Exits 1 on a
                        fatal check failure.
  install --ide <id>    Write the CodeCompass stdio MCP server entry into the
                        host IDE's own MCP config (Cursor ~/.cursor/mcp.json
                        with a tool auto-approve allowlist, ZCode CLI config,
                        Claude Desktop). Merges idempotently, backs up the
                        previous file, and resolves the Node runtime absolute
                        path automatically. "--ide all" configures every
                        supported IDE.

Arguments:
  path                  Local repository directory to import, then open the
                        browser straight to its cockpit dashboard.

Options:
  --port <number>       HTTP port (default: MHW_CP_PORT or 43110)
  --data-dir <dir>      Data directory (default: MHW_DATA_DIR or ~/.mhw)
  --no-browser          Do not auto-open the browser
  --no-watch            Disable FS watcher hot reload for ready repos
  --ide <id>            With install: cursor | zcode | claude | all
  --repo <path>         Repository directory for install / diagnose /
                        refactor-plan / export (default: current directory)
  --dry-run             With install: preview the config write without touching disk
  --json                With doctor, emit a structured JSON report
  --output <fmt>        Diff report format: markdown | json (default: markdown)
  --file <path>         Write the diff report to a file instead of stdout
  --fail-on-impact      With pr-summary, exit 2 when impact is detected
  --max-affected-routes <n>
                        With pr-summary, exit 1 when more than n routes are affected
  --fail-on-break       With pr-summary, exit 1 on modified symbols unreachable from routes
  --fail-on-auth-impact With pr-summary, exit 1 on impacted sensitive routes without auth
  --help, -h            Show this help
  --version, -v         Print version
`;

/** Parse argv (node-style, no binary name). Unknown flags → error. */
export function parseArgs(argv: string[]): ParseResult {
  const args: CliArgs = {
    noBrowser: false,
    noWatch: false,
    doctorJson: false,
    dryRun: false,
    failOnBreak: false,
    failOnAuthImpact: false,
    help: false,
    version: false,
    failOnImpact: false
  };

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

  /** Assign one positional of `codecompass context <query> [repoPath]`. */
  const assignContextPositional = (arg: string): boolean => {
    if (args.contextQuery === undefined) {
      args.contextQuery = arg;
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
      } else if (isQueryCommand(args.command)) {
        if (!assignContextPositional(arg)) return { ok: false, error: `Unexpected extra argument: ${arg}` };
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
    if (arg === '--fail-on-break') {
      args.failOnBreak = true;
      continue;
    }
    if (arg === '--fail-on-auth-impact') {
      args.failOnAuthImpact = true;
      continue;
    }
    if (arg === '--no-browser') {
      args.noBrowser = true;
      continue;
    }
    if (arg === '--no-watch') {
      args.noWatch = true;
      continue;
    }
    if (arg === '--json') {
      args.doctorJson = true;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    const inline = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : undefined;
    const flag = inline !== undefined ? arg.slice(0, arg.indexOf('=')) : arg;

    if (flag === '--ide') {
      const { value, next } = nextValue(i, flag, inline);
      i = next;
      if (value === undefined || value === '') {
        return { ok: false, error: '--ide expects cursor | zcode | claude | all' };
      }
      args.installIde = value;
      continue;
    }
    if (flag === '--repo') {
      const { value, next } = nextValue(i, flag, inline);
      i = next;
      if (value === undefined || value === '') {
        return { ok: false, error: '--repo expects a repository directory path' };
      }
      args.installRepo = value;
      continue;
    }
    if (flag === '--change-type') {
      const { value, next } = nextValue(i, flag, inline);
      i = next;
      if (value !== 'SIGNATURE_CHANGE' && value !== 'REMOVAL' && value !== 'LOGIC_REFACTOR') {
        return { ok: false, error: '--change-type expects SIGNATURE_CHANGE | REMOVAL | LOGIC_REFACTOR' };
      }
      args.changeType = value;
      continue;
    }
    if (flag === '--intent') {
      const { value, next } = nextValue(i, flag, inline);
      i = next;
      if (value !== 'deprecate' && value !== 'extend') {
        return { ok: false, error: '--intent expects deprecate | extend' };
      }
      args.evolveIntent = value.toUpperCase() as 'DEPRECATE' | 'EXTEND';
      continue;
    }
    if (flag === '--target') {
      const { value, next } = nextValue(i, flag, inline);
      i = next;
      if (value === undefined || value === '') {
        return { ok: false, error: '--target expects a module name/directory or a symbol' };
      }
      args.evolveTarget = value;
      continue;
    }

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
    if (flag === '--max-affected-routes') {
      const { value, next } = nextValue(i, flag, inline);
      i = next;
      if (value === undefined || !/^\d+$/.test(value)) {
        return { ok: false, error: '--max-affected-routes expects a non-negative integer' };
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) {
        return { ok: false, error: `--max-affected-routes out of range: ${value}` };
      }
      args.maxAffectedRoutes = parsed;
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
        (
          arg === 'mcp' ||
          arg === 'diff' ||
          arg === 'pr-summary' ||
          arg === 'context' ||
          arg === 'doctor' ||
          arg === 'install' ||
          arg === 'diagnose' ||
          arg === 'refactor-plan' ||
          arg === 'export' ||
          arg === 'radar' ||
          arg === 'evolve'
        )
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
    if (args.command === 'context' || args.command === 'diagnose' || args.command === 'refactor-plan' || args.command === 'export' || args.command === 'radar') {
      if (!assignContextPositional(arg)) {
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

interface ContextCommandOptions {
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  repoPath: string;
  query: string;
  log: (line: string) => void;
}

/** Query-style commands share the `<query> [repoPath]` positional shape. */
function isQueryCommand(command: CliArgs['command']): boolean {
  return (
    command === 'context' ||
    command === 'diagnose' ||
    command === 'refactor-plan' ||
    command === 'export' ||
    command === 'radar'
  );
}

/** Build a Mermaid flowchart from a diagnose chain (BROKEN steps red). */
function chainMermaid(result: ReturnType<typeof runDiagnose>): string {
  const lines = ['flowchart LR'];
  result.verifiedChain.forEach((step, i) => {
    const label = `${step.layer}: ${step.symbol}`;
    lines.push(`  n${i}["${label.replace(/"/g, "'")}"]${step.status === 'BROKEN' ? ':::broken' : ''}`);
    if (i > 0) lines.push(`  n${i - 1} --> n${i}`);
  });
  lines.push('  classDef broken stroke:#f7768e,stroke-width:2px,color:#f7768e;');
  return lines.join('\n');
}

/** Boot the analysis stack for one-shot commands (context/diagnose/refactor-plan). */
async function withAnalysisStack<T>(
  options: { env?: NodeJS.ProcessEnv; dataDir?: string; repoPath: string; log: (line: string) => void },
  fn: (ctx: { repoqa: RepoQARepos; worker: RepoQAWorker; repoId: string; localPath: string }) => Promise<T>
): Promise<T> {
  const env = { ...(options.env ?? process.env) };
  if (options.dataDir) env.MHW_DATA_DIR = options.dataDir;
  const config = loadConfig(env);
  await backupDb(config.dbPath);
  const db = openDb(config.dbPath);
  ensureDefaultWorkspace(db, config.dataDir);
  const repoqa = new RepoQARepos(db);
  repoqa.resetInterrupted();
  const worker = new RepoQAWorker(repoqa, new EventBus());

  try {
    const normalizedTarget = path.resolve(options.repoPath);
    const existing = repoqa.listRepos().find((repo) => {
      try {
        return path.resolve(repo.localPath).toLowerCase() === normalizedTarget.toLowerCase();
      } catch {
        return false;
      }
    });
    let repo = existing?.status === 'ready' ? existing : undefined;
    if (!repo) {
      options.log(`CodeCompass: indexing ${normalizedTarget}`);
      const result = await worker.indexRepo({ localPath: normalizedTarget });
      repo = result.repo;
    }
    return await fn({
      repoqa,
      worker,
      repoId: repo.id,
      localPath: repo.localPath
    });
  } finally {
    db.close();
  }
}

/** `codecompass context <query> [repoPath]` — one-shot Graph RAG extraction. */
async function runContextCommand(options: ContextCommandOptions): Promise<void> {
  await withAnalysisStack(options, async ({ repoId, worker, localPath }) => {
    const resolution = worker.resolveStartSymbolForQuery(repoId, options.query);
    if (!resolution) {
      throw new Error(`Start symbol not found: ${options.query}`);
    }
    const graph = worker.getSymbolGraph(repoId);
    const context = await extractSubgraphContext(graph.symbols, resolution.symbol, {
      root: localPath,
      index: graph.index
    });
    options.log(context.text);
  });
}

/**
 * v0.6.0 (D-MCP-1) — fatal MCP failures must leave stdout as a valid JSON-RPC
 * stream. A raw stderr write breaks the handshake for Agent clients, so the
 * error is emitted as a structured error payload before the process exits.
 */
export function emitMcpStdioError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32603, message }
    })}\n`
  );
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
    const policy =
      args.command === 'pr-summary'
        ? evaluateDiffPolicy(report, {
            maxAffectedRoutes: args.maxAffectedRoutes,
            failOnBreak: args.failOnBreak,
            failOnAuthImpact: args.failOnAuthImpact
          })
        : undefined;
    if (policy) report.policy = policy;
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
        exitCode:
          policy?.status === 'FAIL' ? 1 : args.failOnImpact && hasImpact ? 2 : 0
      };
    }
    return { server: null, cockpitUrl: null };
  }

  if (args.command === 'context') {
    if (!args.contextQuery) {
      throw new Error(`codecompass context requires <query>\n\n${USAGE}`);
    }
    await runContextCommand({
      env: ctx.env,
      dataDir: args.dataDir,
      repoPath: args.targetPath ?? process.cwd(),
      query: args.contextQuery,
      log
    });
    return { server: null, cockpitUrl: null };
  }

  if (args.command === 'doctor') {
    const report = await runDoctor({
      dataDir: args.dataDir,
      port: args.port
    });
    if (args.doctorJson) {
      log(JSON.stringify(report, null, 2));
    } else {
      log(renderDoctorText(report));
    }
    return {
      server: null,
      cockpitUrl: null,
      exitCode: report.status === 'error' ? 1 : 0
    };
  }

  if (args.command === 'diagnose' || args.command === 'refactor-plan') {
    if (!args.contextQuery) {
      throw new Error(
        `codecompass ${args.command} requires a <symbol> (or "METHOD /route/path" for diagnose)\n\n${USAGE}`
      );
    }
    const env = { ...(ctx.env ?? process.env) };
    const baseUrl = `http://localhost:${loadConfig(env).port}`;
    await withAnalysisStack(
      {
        env: ctx.env,
        dataDir: args.dataDir,
        repoPath: args.installRepo ?? args.targetPath ?? process.cwd(),
        log
      },
      async ({ repoId, worker, localPath }) => {
        const graph = worker.getSymbolGraph(repoId);
        const result =
          args.command === 'diagnose'
            ? runDiagnose({
                repoId,
                entrySymbol: args.contextQuery!,
                symbols: graph.symbols,
                index: graph.index,
                baseUrl,
                snippetRoot: localPath
              })
            : runBlastRadius({
                repoId,
                targetSymbol: args.contextQuery!,
                changeType: args.changeType ?? 'SIGNATURE_CHANGE',
                symbols: graph.symbols,
                index: graph.index,
                baseUrl
              });
        log(JSON.stringify(result, null, 2));
      }
    );
    return { server: null, cockpitUrl: null };
  }

  if (args.command === 'export') {
    if (!args.contextQuery) {
      throw new Error(
        `codecompass export requires a <symbol> (or "METHOD /route/path")\n\n${USAGE}`
      );
    }
    const env = { ...(ctx.env ?? process.env) };
    const baseUrl = `http://localhost:${loadConfig(env).port}`;
    await withAnalysisStack(
      {
        env: ctx.env,
        dataDir: args.dataDir,
        repoPath: args.installRepo ?? args.targetPath ?? process.cwd(),
        log
      },
      async ({ repoId, worker, localPath, repoqa }) => {
        const repo = repoqa.getRepo(repoId)!;
        const graph = worker.getSymbolGraph(repoId);
        const result = runDiagnose({
          repoId,
          entrySymbol: args.contextQuery!,
          symbols: graph.symbols,
          index: graph.index,
          baseUrl,
          snippetRoot: localPath
        });
        const chainText = result.verifiedChain
          .map(
            (step, i) =>
              `${i + 1}. [${step.status}] ${step.layer} ${step.symbol} — ${step.filePath}:${step.line}` +
              (step.diagnosticNotes ? `\n   ${step.diagnosticNotes}` : '')
          )
          .join('\n');
        const html = renderArtifactHtml({
          title: `Diagnose: ${result.entrySymbol}`,
          repoName: repo.name,
          generatedAt: new Date().toISOString(),
          mermaid: chainMermaid(result),
          summary: result.rootCauseSummary,
          deepLink: result.cockpitDeepLink,
          sections: [
            { heading: 'Chain', body: chainText, kind: 'code' },
            ...result.verifiedChain
              .filter((step) => step.codeSnippet)
              .slice(0, 4)
              .map((step) => ({
                heading: `${step.symbol} (${step.filePath}:${step.line})`,
                body: step.codeSnippet!,
                kind: 'code' as const
              }))
          ]
        });
        const outPath =
          args.diffFile ?? `codecompass-diagnose-${result.traceId}.html`;
        if (!locateMermaidScript()) {
          log('Warning: local mermaid runtime not found — the artifact falls back to CDN and will not render offline.');
        }
        const written = writeArtifactFile(html, outPath);
        log(`Artifact written to ${written}`);
      }
    );
    return { server: null, cockpitUrl: null };
  }

  if (args.command === 'evolve') {
    if (!args.evolveIntent || !args.evolveTarget) {
      throw new Error(
        'codecompass evolve requires --intent <deprecate|extend> and --target <module|symbol>\n\n' +
          USAGE
      );
    }
    const env = { ...(ctx.env ?? process.env) };
    const baseUrl = `http://localhost:${loadConfig(env).port}`;
    await withAnalysisStack(
      {
        env: ctx.env,
        dataDir: args.dataDir,
        repoPath: args.installRepo ?? args.targetPath ?? process.cwd(),
        log
      },
      async ({ repoId, worker }) => {
        const graph = worker.getSymbolGraph(repoId);
        const result = runModuleEvolution({
          repoId,
          intentType: args.evolveIntent!,
          targetSymbolOrModule: args.evolveTarget!,
          symbols: graph.symbols,
          index: graph.index,
          baseUrl
        });
        log(JSON.stringify(result, null, 2));
      }
    );
    return { server: null, cockpitUrl: null };
  }

  if (args.command === 'radar') {
    const env = { ...(ctx.env ?? process.env) };
    await withAnalysisStack(
      {
        env: ctx.env,
        dataDir: args.dataDir,
        repoPath: args.installRepo ?? args.targetPath ?? process.cwd(),
        log
      },
      async ({ repoId, repoqa, worker }) => {
        const query = args.contextQuery?.trim() || undefined;
        const graph = worker.getSymbolGraph(repoId);
        const chunkHitFiles = query
          ? repoqa
              .searchChunks(repoId, query)
              .map((chunk) => chunk.filePath)
              .filter((file): file is string => Boolean(file))
          : undefined;
        const result = runDomainRadar({
          repoId,
          ...(query ? { query } : {}),
          symbols: graph.symbols,
          index: graph.index,
          ...(chunkHitFiles ? { chunkHitFiles } : {})
        });
        log(JSON.stringify(result, null, 2));
      }
    );
    return { server: null, cockpitUrl: null };
  }

  if (args.command === 'install') {
    const ide = args.installIde;
    if (!ide) {
      throw new Error('codecompass install requires --ide <cursor|zcode|claude|all>\n\n' + USAGE);
    }
    const targets: IdeId[] =
      ide === 'all' ? [...INSTALL_IDES] : [ide as IdeId];
    if (ide !== 'all' && !INSTALL_IDES.includes(targets[0])) {
      throw new Error(`Unknown IDE: ${ide} (expected cursor | zcode | claude | all)`);
    }
    const repoPath = args.installRepo ?? args.targetPath ?? process.cwd();
    for (const target of targets) {
      await installIdeConfig({
        ide: target,
        repoPath,
        dryRun: args.dryRun,
        log
      });
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
    let guardEmitted = false;
    const fatal = (error: unknown) => {
      if (guardEmitted) return;
      guardEmitted = true;
      emitMcpStdioError(error);
      setImmediate(() => process.exit(1));
    };
    process.once('uncaughtException', fatal);
    process.once('unhandledRejection', fatal);
    try {
      await runMcpServer({
        targetPath: args.targetPath,
        env: mcpEnv,
        log: mcpLog,
        transportFactory: ctx.mcpTransport
      });
      return { server: null, cockpitUrl: null };
    } catch (error) {
      fatal(error);
      return { server: null, cockpitUrl: null, exitCode: 1 };
    } finally {
      process.removeListener('uncaughtException', fatal);
      process.removeListener('unhandledRejection', fatal);
    }
  }

  const env = { ...(ctx.env ?? process.env) };
  if (args.dataDir) env.MHW_DATA_DIR = args.dataDir;

  let running: RunningServer;
  try {
    running = await startServer({
      env,
      port: args.port,
      watch: !args.noWatch,
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
