import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { installStdioProtocolGuard } from './repoqa-mcp';

/**
 * v0.8.0 — stdout purity. On the stdio MCP transport stdout is the JSON-RPC
 * message channel; a single stray line from a third-party dependency breaks
 * the handshake for Agent clients. These tests pin the two guarantees:
 * the in-process console guard and the end-to-end protocol stream.
 */

describe('installStdioProtocolGuard', () => {
  it('redirects console.log/info/warn away from stdout', () => {
    installStdioProtocolGuard();
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    // vitest itself intercepts the stderr stream, so assert on the redirect
    // target (console.error) instead of process.stderr.write directly.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      console.log('protocol-polluting line');
      console.info('another one');
      console.warn('and a warning');
      expect(stdoutWrite).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(3);
    } finally {
      stdoutWrite.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('mcp stdio end-to-end purity', () => {
  it(
    'serves initialize + tools/list with stdout carrying only JSON-RPC lines',
    async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'repoqa-stdio-'));
      const repoDir = path.join(tmp, 'repo');
      const dataDir = path.join(tmp, 'data');
      await fs.mkdir(repoDir);
      await fs.mkdir(dataDir);
      await fs.writeFile(
        path.join(repoDir, 'orders.ts'),
        'export function listOrders() { return []; }\n'
      );

      // Vitest runs with the control-plane package as cwd.
      const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
      const cliEntry = path.resolve('src/cli.ts');
      const child = spawn(
        process.execPath,
        [tsxCli, cliEntry, 'mcp', repoDir],
        {
          env: { ...process.env, MHW_DATA_DIR: dataDir, CODECOMPASS_CLI: '1' },
          stdio: ['pipe', 'pipe', 'pipe']
        }
      );

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      // Fail fast when the child dies instead of hanging on stdin writes.
      const exited = new Promise<never>((_, reject) => {
        child.once('exit', (code) =>
          reject(
            new Error(
              `mcp child exited early (code=${code}) stderr=${Buffer.concat(stderrChunks)
                .toString('utf8')
                .slice(-2000)}`
            )
          )
        );
        child.once('error', reject);
      });

      const send = async (payload: Record<string, unknown>) => {
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            child.stdin.write(`${JSON.stringify(payload)}\n`, (error) =>
              error ? reject(error) : resolve()
            );
          }),
          exited
        ]);
      };

      try {
        await send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'vitest', version: '0.0.0' }
          }
        });
        await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

        // Wait until both responses have arrived on stdout.
        const deadline = Date.now() + 45_000;
        let lines: string[] = [];
        while (Date.now() < deadline) {
          lines = Buffer.concat(stdoutChunks)
            .toString('utf8')
            .split('\n')
            .filter((line) => line.trim() !== '');
          const hasInit = lines.some((line) => line.includes('"id":1'));
          const hasTools = lines.some((line) => line.includes('"id":2'));
          if (hasInit && hasTools) break;
          await Promise.race([
            new Promise((resolve) => setTimeout(resolve, 200)),
            exited
          ]);
        }

        // Every stdout line must parse as a JSON-RPC message — no log noise.
        expect(lines.length).toBeGreaterThanOrEqual(2);
        const messages = lines.map((line) => JSON.parse(line));
        expect(messages.every((msg) => msg.jsonrpc === '2.0')).toBe(true);

        const init = messages.find((msg) => msg.id === 1);
        expect(init?.result?.serverInfo?.name).toBe('codecompass');
        const tools = messages.find((msg) => msg.id === 2);
        const toolNames: string[] = (tools?.result?.tools ?? []).map(
          (tool: { name: string }) => tool.name
        );
        expect(toolNames).toContain('codecompass_list_repos');
      } finally {
        child.removeAllListeners('exit');
        child.kill();
        await new Promise<void>((resolve) => child.once('exit', resolve));
        // Windows releases the SQLite handle slightly after process exit.
        await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
      }
    },
    90_000
  );
});
