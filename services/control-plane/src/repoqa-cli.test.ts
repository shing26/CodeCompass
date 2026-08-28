import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitMcpStdioError, parseArgs, runCli, type CliRunResult } from './cli';
import { resolveWebDist } from './server';

const openSpy = vi.fn();

afterEach(() => {
  openSpy.mockClear();
});

describe('Issue 16 CLI arg parsing', () => {
  it('parses a positional target path', () => {
    const result = parseArgs(['C:/repos/petclinic']);
    expect(result).toEqual({
      ok: true,
      args: {
        targetPath: 'C:/repos/petclinic',
        noBrowser: false,
        noWatch: false,
        doctorJson: false,
        dryRun: false,
        failOnBreak: false,
        failOnAuthImpact: false,
        help: false,
        version: false,
        failOnImpact: false
      }
    });
  });

  it('parses flags in any position', () => {
    const result = parseArgs(['--no-browser', '--port', '43210', '--data-dir', 'D:/data', '/repo']);
    expect(result).toMatchObject({
      ok: true,
      args: {
        targetPath: '/repo',
        port: 43210,
        dataDir: 'D:/data',
        noBrowser: true
      }
    });
  });

  it('supports --flag=value syntax', () => {
    const result = parseArgs(['--port=43999', '/repo']);
    expect(result).toMatchObject({ ok: true, args: { port: 43999, targetPath: '/repo' } });
  });

  it('parses --no-watch as an opt-out of hot reload', () => {
    const result = parseArgs(['--no-watch', '/repo']);
    expect(result).toMatchObject({ ok: true, args: { noWatch: true, targetPath: '/repo' } });
  });

  it('parses the context command with a query and optional repo path', () => {
    expect(parseArgs(['context', 'listOrders', 'C:/repos/petclinic'])).toMatchObject({
      ok: true,
      args: {
        command: 'context',
        contextQuery: 'listOrders',
        targetPath: 'C:/repos/petclinic'
      }
    });
  });

  it('honours --help and --version', () => {
    expect(parseArgs(['--help'])).toMatchObject({ ok: true, args: { help: true } });
    expect(parseArgs(['-v'])).toMatchObject({ ok: true, args: { version: true } });
  });

  it('rejects unknown options, bad ports and extra positionals', () => {
    expect(parseArgs(['--bogus']).ok).toBe(false);
    expect(parseArgs(['--port']).ok).toBe(false);
    expect(parseArgs(['--port', 'abc']).ok).toBe(false);
    expect(parseArgs(['--port', '999999']).ok).toBe(false);
    expect(parseArgs(['a', 'b']).ok).toBe(false);
    expect(parseArgs(['--', 'a', 'b']).ok).toBe(false);
  });
});

describe('Issue 16 CLI one-process startup', () => {
  it('starts the stack, imports the target repo and serves API + static SPA', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codecompass-cli-'));
    const repoDir = path.join(tmp, 'repo');
    await makeJavaRepo(repoDir);
    const dataDir = path.join(tmp, 'data');
    const staticDir = path.join(tmp, 'static');
    await fs.mkdir(staticDir, { recursive: true });
    await fs.writeFile(path.join(staticDir, 'index.html'), '<html><body>CLI-STATIC</body></html>');

    const result = await runCli(
      ['--port', '0', '--no-browser', '--data-dir', dataDir, repoDir],
      {
        env: { ...process.env, MHW_STATIC_DIR: staticDir },
        openBrowser: openSpy,
        log: () => undefined
      }
    );

    expect(result.server).not.toBeNull();
    const server = result.server!;
    // --data-dir must be honored (isolated smoke data, not the user's ~/.mhw).
    expect(server.config.dataDir).toBe(dataDir);
    const base = `http://127.0.0.1:${server.port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { status: string };
    expect(healthBody.status).toBe('ok');

    const reposRes = await fetch(`${base}/api/repos`);
    expect(reposRes.status).toBe(200);
    const reposBody = (await reposRes.json()) as { repos: { id: string; name: string; status: string }[] };
    expect(reposBody.repos).toHaveLength(1);
    expect(reposBody.repos[0].status).toBe('ready');

    const root = await fetch(`${base}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('CLI-STATIC');

    // The cockpit deep link serves the SPA and points at the imported repo.
    expect(result.cockpitUrl).toBe(
      `http://localhost:${server.port}/?repo=${encodeURIComponent(reposBody.repos[0].id)}`
    );
    const cockpit = await fetch(result.cockpitUrl!);
    expect(cockpit.status).toBe(200);
    expect(await cockpit.text()).toContain('CLI-STATIC');

    // --no-browser means the opener was never invoked.
    expect(openSpy).not.toHaveBeenCalled();

    await server.close();
  });

  it('auto-opens the browser to the workbench when not using --no-browser', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codecompass-cli-'));
    const dataDir = path.join(tmp, 'data');
    const staticDir = path.join(tmp, 'static');
    await fs.mkdir(staticDir, { recursive: true });
    await fs.writeFile(path.join(staticDir, 'index.html'), '<html>STATIC</html>');

    const result = await runCli(['--port', '0'], {
      env: { ...process.env, MHW_STATIC_DIR: staticDir },
      openBrowser: openSpy,
      log: () => undefined
    });

    expect(result.server).not.toBeNull();
    expect(openSpy).toHaveBeenCalledWith(`http://localhost:${result.server!.port}/`);
    await result.server!.close();
  });

  it('fails with a friendly message instead of crashing when the port is taken', async () => {
    const blocker = http.createServer();
    // Bind without a host so the socket family matches the CLI's default
    // (all interfaces); a 127.0.0.1-only listener does not collide on Windows.
    await new Promise<void>((resolve) => blocker.listen(0, resolve));
    const address = blocker.address() as AddressInfo;
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codecompass-cli-'));
    try {
      let result: CliRunResult | null = null;
      try {
        result = await runCli(
          ['--port', String(address.port), '--no-browser', '--data-dir', path.join(tmp, 'data')],
          { log: () => undefined }
        );
      } catch (err) {
        expect((err as Error).message).toMatch(/already in use/i);
      } finally {
        if (result?.server) await result.server.close();
      }
      // runCli must reject on an occupied port — reaching here is a regression.
      if (result) throw new Error('runCli resolved despite the port being taken');
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it('extracts a Graph RAG context through the context command without a server', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'codecompass-context-'));
    const repoDir = path.join(tmp, 'repo');
    await makeJavaRepo(repoDir);
    const dataDir = path.join(tmp, 'data');
    const lines: string[] = [];

    const result = await runCli(
      ['context', 'hello', '--data-dir', dataDir, repoDir],
      {
        env: { ...process.env },
        log: (line) => lines.push(line)
      }
    );
    expect(result.server).toBeNull();
    expect(lines.join('\n')).toContain('# Agent Context: hello');
    expect(lines.join('\n')).toContain('greet');
  });

  it('resolves the repo web dist from the standard layout when present', () => {
    const resolved = resolveWebDist();
    // Resolves against the checkouts apps/repoqa-web/dist; when it does not
    // exist (CI with no web build) the CLI simply skips static hosting.
    if (!resolved) return;
    expect(resolved.replace(/\\/g, '/')).toMatch(/\/apps\/repoqa-web\/dist$/);
  });
});

describe('v0.6.0 MCP structured error guard', () => {
  it('writes a JSON-RPC error to stdout and never touches stderr', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      emitMcpStdioError(new Error('sqlite ABI mismatch'));
      expect(stdout).toHaveBeenCalledWith(
        '{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"sqlite ABI mismatch"}}\n'
      );
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});

async function makeJavaRepo(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'src', 'main', 'java', 'com', 'demo'), {
    recursive: true
  });
  await fs.writeFile(path.join(root, 'pom.xml'), '<project/>\n');
  await fs.writeFile(path.join(root, 'README.md'), '# Demo\n');
  await fs.writeFile(
    path.join(root, 'src', 'main', 'java', 'com', 'demo', 'App.java'),
    'package com.demo;\npublic class App {\n  private static final String VERSION = "1";\n  public static void main(String[] args) {\n    new Controller().hello();\n  }\n}\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'main', 'java', 'com', 'demo', 'Controller.java'),
    'package com.demo;\n@RestController\npublic class Controller {\n  private final DemoService demoService = new DemoService();\n  public String hello() {\n    return demoService.greet();\n  }\n}\n'
  );
  await fs.writeFile(
    path.join(root, 'src', 'main', 'java', 'com', 'demo', 'DemoService.java'),
    'package com.demo;\n@Service\npublic class DemoService {\n  public String greet() {\n    return "hello";\n  }\n}\n'
  );
  await fs.mkdir(path.join(root, '.git'), { recursive: true });
  await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
}
