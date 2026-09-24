/**
 * Ticket 03 — M4 发布前核验：从【打包产物】而不是工作树验证一行命令的接入路径。
 *
 * 用法（先 `npm pack --pack-destination <dir>`，再在干净目录 `npm install <tgz>`）：
 *   node <repo>/scripts/smoke/packed-mcp-handshake.mjs <installDir> <repoToIndex>
 *
 * 做三件事：initialize → tools/list（断言 17 工具）→ tools/call list_repos，
 * 全部走子进程 stdio（JSON-RPC 行），即 M4「干净机器抄一行命令完成 MCP 握手」的本地等价物。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [installDir, repoPath] = process.argv.slice(2);
if (!installDir || !repoPath) {
  console.error('usage: packed-mcp-handshake.mjs <installDir> <repoToIndex>');
  process.exit(2);
}

// Resolve the entry the way npm does: from the installed package's own `bin`
// field. Going through `node_modules/.bin` would exercise a shell shim, not the
// declared entry point (and node cannot parse the sh shim).
const packageRoot = path.join(installDir, 'node_modules', '@codecompass', 'cli');
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const binRelative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.codecompass;
if (!binRelative) throw new Error('installed package declares no `codecompass` bin');
const bin = path.join(packageRoot, binRelative);
if (!fs.existsSync(bin)) throw new Error(`declared bin does not exist in the package: ${binRelative}`);
console.log(`[client] resolved bin: ${binRelative}`);
const child = spawn(process.execPath, [bin, 'mcp', repoPath], { cwd: installDir });

let buffer = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.error('[client] non-JSON stdout line (protocol violation):', line.slice(0, 120));
      process.exit(1);
    }
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});
child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

function send(payload) {
  return new Promise((resolve) => {
    pending.set(payload.id, resolve);
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  });
}
/** A notification has no `id` and no response — awaiting one hangs the client. */
function notify(payload) {
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

const result = {};
try {
  const init = await send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'packed-smoke', version: '1' } }
  });
  result.serverVersion = init?.result?.serverInfo?.version;
  result.instructionsPresent = typeof init?.result?.instructions === 'string' && init.result.instructions.length > 0;
  notify({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const list = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const tools = (list?.result?.tools ?? []).map((tool) => tool.name);
  result.toolCount = tools.length;

  const repos = await send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'codecompass_list_repos', arguments: {} }
  });
  result.listReposOk = repos?.result !== undefined && repos.error === undefined;
  result.listReposPayloadBytes = JSON.stringify(repos?.result ?? null).length;
} finally {
  child.kill();
}

console.log(JSON.stringify(result, null, 2));
if (result.toolCount !== 17) {
  console.error(`FAIL: expected 17 tools, got ${result.toolCount}`);
  process.exit(1);
}
if (!result.listReposOk) {
  console.error('FAIL: list_repos did not answer');
  process.exit(1);
}
console.log('packed handshake OK');
