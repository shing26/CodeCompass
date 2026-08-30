import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MCP_TOOLS } from './repoqa-mcp';

/**
 * v0.8.0 — Zero-config MCP installer. Writes the CodeCompass stdio MCP server
 * entry into the host IDE's own configuration file so Agent clients pick the
 * tools up without manual editing or repeated permission prompts.
 *
 * Design constraints:
 * - Merge, never clobber: unrelated keys and other MCP servers are preserved.
 * - Idempotent: re-running with an identical entry reports changed=false and
 *   does not touch the file.
 * - Backup before write: `<config>.bak-<timestamp>` keeps the previous state.
 * - Per-IDE schema: Cursor supports an `autoApprove` allowlist on the entry;
 *   ZCode nests servers under `mcp.servers` with a `type: 'stdio'` marker;
 *   Claude Desktop uses a plain `mcpServers` map.
 */

export type IdeId = 'cursor' | 'zcode' | 'claude' | 'windsurf' | 'cline' | 'roo';

export interface IdeSpec {
  id: IdeId;
  label: string;
  /** Absolute default config path for the current platform/user. */
  configPath: string;
  /** Cursor-style tool allowlist that suppresses per-call permission prompts. */
  supportsAutoApprove: boolean;
}

export const INSTALL_IDES: IdeId[] = ['cursor', 'zcode', 'claude', 'windsurf', 'cline', 'roo'];

/** Resolve each IDE's config path for a given HOME/APPDATA (injectable for tests). */
export function resolveIdeSpecs(home: string, appData?: string): Record<IdeId, IdeSpec> {
  const claudeDir =
    process.platform === 'win32'
      ? path.join(appData ?? path.join(home, 'AppData', 'Roaming'), 'Claude')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Claude')
        : path.join(home, '.config', 'Claude');
  // VS Code-family globalStorage (Cline/Roo write MCP config inside it).
  const vscodeGlobal =
    process.platform === 'win32'
      ? path.join(appData ?? path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage')
        : path.join(home, '.config', 'Code', 'User', 'globalStorage');
  return {
    cursor: {
      id: 'cursor',
      label: 'Cursor',
      configPath: path.join(home, '.cursor', 'mcp.json'),
      supportsAutoApprove: true
    },
    zcode: {
      id: 'zcode',
      label: 'ZCode',
      configPath: path.join(home, '.zcode', 'cli', 'config.json'),
      supportsAutoApprove: false
    },
    claude: {
      id: 'claude',
      label: 'Claude Desktop',
      configPath: path.join(claudeDir, 'claude_desktop_config.json'),
      supportsAutoApprove: false
    },
    windsurf: {
      id: 'windsurf',
      label: 'Windsurf',
      configPath: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      supportsAutoApprove: false
    },
    cline: {
      id: 'cline',
      label: 'Cline (VS Code)',
      configPath: path.join(vscodeGlobal, 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json'),
      supportsAutoApprove: true
    },
    roo: {
      id: 'roo',
      label: 'Roo Code (VS Code)',
      configPath: path.join(vscodeGlobal, 'RooVeterinaryInc.roo-cline', 'settings', 'mcp_settings.json'),
      supportsAutoApprove: true
    }
  };
}

/** Deterministic allowlist derived from the registered MCP tool registry. */
export function codecompassToolNames(): string[] {
  return MCP_TOOLS.map((tool) => tool.name);
}

/** The MCP server entry written into every IDE config (shape per IDE). */
export function renderServerEntry(
  ide: IdeId,
  entry: { command: string; args: string[] }
): Record<string, unknown> {
  if (ide === 'zcode') {
    return { type: 'stdio', command: entry.command, args: entry.args };
  }
  if (ide === 'cursor' || ide === 'cline' || ide === 'roo') {
    // Cursor/Cline/Roo share the autoApprove allowlist concept.
    return { command: entry.command, args: entry.args, autoApprove: codecompassToolNames() };
  }
  return { command: entry.command, args: entry.args };
}

/**
 * Idempotent merge: set/replace only the `codecompass` entry, preserving every
 * other key and server. Returns the next config and whether anything changed.
 */
export function mergeCodecompassEntry(
  ide: IdeId,
  existing: unknown,
  entry: Record<string, unknown>
): { next: Record<string, unknown>; changed: boolean } {
  const root =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? ({ ...(existing as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const next: Record<string, unknown> = { ...root };

  if (ide === 'zcode') {
    const mcp = { ...((root.mcp as Record<string, unknown>) ?? {}) };
    const servers = { ...((mcp.servers as Record<string, unknown>) ?? {}) };
    const changed = JSON.stringify(servers.codecompass) !== JSON.stringify(entry);
    servers.codecompass = entry;
    mcp.servers = servers;
    next.mcp = mcp;
    return { next, changed };
  }

  const mcpServers = { ...((root.mcpServers as Record<string, unknown>) ?? {}) };
  const changed = JSON.stringify(mcpServers.codecompass) !== JSON.stringify(entry);
  mcpServers.codecompass = entry;
  next.mcpServers = mcpServers;
  return { next, changed };
}

export interface InstallOptions {
  ide: IdeId;
  /** Repository directory the MCP server indexes on startup. */
  repoPath: string;
  /** Override HOME (tests). */
  home?: string;
  /** Override APPDATA (tests, Windows Claude config). */
  appData?: string;
  /** Node runtime absolute path; defaults to the running process. */
  nodePath?: string;
  /** Control-plane CLI entry (dist/cli.js); defaults to the package build. */
  cliPath?: string;
  /** Preview without writing. */
  dryRun?: boolean;
  /** Write `<config>.bak-<timestamp>` before modifying (default true). */
  backup?: boolean;
  log?: (line: string) => void;
}

export interface InstallResult {
  ide: IdeId;
  configPath: string;
  changed: boolean;
  /** Whether the target file already existed before this run. */
  existed: boolean;
  backupPath: string | null;
  dryRun: boolean;
  entry: { command: string; args: string[] };
}

/** Default control-plane CLI entry: `<package root>/dist/cli.js`. */
export function defaultCliPath(fromDir = path.resolve(__dirname, '..')): string {
  // From src/ the package root is one level up; from dist/ it is the same.
  const candidates = [
    path.resolve(fromDir, 'dist', 'cli.js'),
    path.resolve(fromDir, 'cli.js')
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export async function installIdeConfig(options: InstallOptions): Promise<InstallResult> {
  const home = options.home ?? os.homedir();
  const specs = resolveIdeSpecs(home, options.appData);
  const spec = specs[options.ide];
  const configPath = spec.configPath;
  const log = options.log ?? (() => {});

  const nodePath = options.nodePath ?? process.execPath;
  const cliPath = options.cliPath ?? defaultCliPath();
  const entry = { command: nodePath, args: [cliPath, 'mcp', path.resolve(options.repoPath)] };

  let existed = false;
  let existingRaw: string | null = null;
  try {
    existingRaw = await fs.readFile(configPath, 'utf8');
    existed = true;
  } catch {
    existed = false;
  }

  let existing: unknown = {};
  if (existingRaw !== null) {
    try {
      existing = JSON.parse(existingRaw);
    } catch (error) {
      throw new Error(
        `Cannot parse ${configPath}: ${(error as Error).message}. ` +
          'Fix or remove the file, then re-run codecompass install.'
      );
    }
  }

  const shaped = renderServerEntry(options.ide, entry);
  const { next, changed } = mergeCodecompassEntry(options.ide, existing, shaped);

  const result: InstallResult = {
    ide: options.ide,
    configPath,
    changed,
    existed,
    backupPath: null,
    dryRun: options.dryRun === true,
    entry
  };

  if (!changed) {
    log(`CodeCompass install: ${spec.label} config already up to date (${configPath})`);
    return result;
  }

  if (result.dryRun) {
    log(`CodeCompass install (dry-run): would write ${configPath}`);
    log(JSON.stringify(next, null, 2));
    return result;
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  if (existed && options.backup !== false) {
    const backupPath = `${configPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await fs.copyFile(configPath, backupPath);
    result.backupPath = backupPath;
    log(`CodeCompass install: backed up previous config to ${backupPath}`);
  }
  await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  log(
    `CodeCompass install: ${changed ? 'wrote' : 'updated'} ${spec.label} config (${configPath})` +
      (spec.supportsAutoApprove ? ' with tool auto-approve allowlist' : '')
  );
  return result;
}
