import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  codecompassToolNames,
  installIdeConfig,
  mergeCodecompassEntry,
  renderServerEntry,
  resolveIdeSpecs,
  type IdeId
} from './installer';
import { MCP_TOOLS } from './repoqa-mcp';

/**
 * v0.8.0 — Zero-config installer. Pins the per-IDE config shapes, the
 * idempotent merge semantics, backup-before-write and --dry-run behavior.
 */

const NODE = process.execPath;
const CLI = 'D:/tools/codecompass/dist/cli.js';
const REPO = 'D:/work/demo-repo';
/** installIdeConfig resolves the repo path, which normalizes slashes on win32. */
const REPO_ABS = path.resolve(REPO);

async function tmpHome(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-install-'));
}

function entryFor(ide: IdeId): Record<string, unknown> {
  return renderServerEntry(ide, { command: NODE, args: [CLI, 'mcp', REPO_ABS] });
}

describe('renderServerEntry', () => {
  it('shapes entries per IDE schema (zcode stdio marker, cursor allowlist)', () => {
    expect(entryFor('zcode')).toEqual({
      type: 'stdio',
      command: NODE,
      args: [CLI, 'mcp', REPO_ABS]
    });
    const cursor = entryFor('cursor') as { command?: string; autoApprove?: string[] };
    expect(cursor.command).toBe(NODE);
    expect(cursor.autoApprove).toEqual(codecompassToolNames());
    expect(cursor.autoApprove).toEqual(MCP_TOOLS.map((tool) => tool.name));
    const claude = entryFor('claude') as Record<string, unknown>;
    expect(Object.keys(claude).sort()).toEqual(['args', 'command']);
  });
});

describe('mergeCodecompassEntry', () => {
  it('preserves unrelated keys and other servers', () => {
    const existing = {
      otherSetting: true,
      mcpServers: {
        other: { command: 'other-cmd' }
      }
    };
    const { next, changed } = mergeCodecompassEntry('cursor', existing, entryFor('cursor'));
    expect(changed).toBe(true);
    expect(next.otherSetting).toBe(true);
    expect((next.mcpServers as Record<string, unknown>).other).toEqual({ command: 'other-cmd' });
  });

  it('is idempotent when the entry already matches', () => {
    const { next } = mergeCodecompassEntry('claude', {}, entryFor('claude'));
    const second = mergeCodecompassEntry('claude', next, entryFor('claude'));
    expect(second.changed).toBe(false);
  });

  it('nests zcode entries under mcp.servers', () => {
    const existing = { plugins: { enabled: true } };
    const { next, changed } = mergeCodecompassEntry('zcode', existing, entryFor('zcode'));
    expect(changed).toBe(true);
    expect(next.plugins).toEqual({ enabled: true });
    const servers = ((next.mcp as Record<string, unknown>).servers ?? {}) as Record<
      string,
      unknown
    >;
    expect(servers.codecompass).toEqual(entryFor('zcode'));
  });
});

describe('installIdeConfig', () => {
  it('creates a new zcode config and is idempotent on re-run', async () => {
    const home = await tmpHome();
    try {
      const first = await installIdeConfig({
        ide: 'zcode',
        repoPath: REPO,
        home,
        nodePath: NODE,
        cliPath: CLI
      });
      expect(first.changed).toBe(true);
      expect(first.existed).toBe(false);

      const written = JSON.parse(
        await fs.readFile(path.join(home, '.zcode', 'cli', 'config.json'), 'utf8')
      );
      expect(
        ((written.mcp as Record<string, unknown>).servers as Record<string, unknown>).codecompass
      ).toEqual(entryFor('zcode'));

      const second = await installIdeConfig({
        ide: 'zcode',
        repoPath: REPO,
        home,
        nodePath: NODE,
        cliPath: CLI
      });
      expect(second.changed).toBe(false);
      expect(second.existed).toBe(true);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('merges into an existing config, backs it up and preserves other servers', async () => {
    const home = await tmpHome();
    try {
      const cursorDir = path.join(home, '.cursor');
      await fs.mkdir(cursorDir, { recursive: true });
      const configPath = path.join(cursorDir, 'mcp.json');
      await fs.writeFile(
        configPath,
        JSON.stringify({ mcpServers: { other: { command: 'other-cmd' } } }),
        'utf8'
      );

      const result = await installIdeConfig({
        ide: 'cursor',
        repoPath: REPO,
        home,
        nodePath: NODE,
        cliPath: CLI
      });
      expect(result.changed).toBe(true);
      expect(result.backupPath).toBeTruthy();

      const backed = JSON.parse(await fs.readFile(result.backupPath as string, 'utf8'));
      expect(Object.keys(backed.mcpServers)).toEqual(['other']);

      const written = JSON.parse(await fs.readFile(configPath, 'utf8'));
      expect(Object.keys(written.mcpServers).sort()).toEqual(['codecompass', 'other']);
      expect(written.mcpServers.codecompass.autoApprove).toEqual(codecompassToolNames());
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('dry-run previews without writing and never creates files', async () => {
    const home = await tmpHome();
    try {
      const lines: string[] = [];
      const result = await installIdeConfig({
        ide: 'claude',
        repoPath: REPO,
        home,
        appData: path.join(home, 'AppData', 'Roaming'),
        nodePath: NODE,
        cliPath: CLI,
        dryRun: true,
        log: (line) => lines.push(line)
      });
      expect(result.changed).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(lines.join('\n')).toContain('dry-run');

      const claudeDir = path.join(home, 'AppData', 'Roaming', 'Claude');
      await expect(fs.access(claudeDir)).rejects.toThrow();
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it('resolves per-platform claude config path and rejects corrupt configs', async () => {
    const home = await tmpHome();
    try {
      const specs = resolveIdeSpecs(home, path.join(home, 'AppData', 'Roaming'));
      expect(specs.claude.configPath).toContain('Claude');
      expect(specs.cursor.configPath).toBe(path.join(home, '.cursor', 'mcp.json'));

      const claudeDir = specs.claude.configPath;
      await fs.mkdir(path.dirname(claudeDir), { recursive: true });
      await fs.writeFile(claudeDir, '{not json', 'utf8');
      await expect(
        installIdeConfig({
          ide: 'claude',
          repoPath: REPO,
          home,
          appData: path.join(home, 'AppData', 'Roaming'),
          nodePath: NODE,
          cliPath: CLI
        })
      ).rejects.toThrow(/Cannot parse/);
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
