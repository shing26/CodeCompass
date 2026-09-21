#!/usr/bin/env node
/**
 * Issue 14 (评估维 E-M10) — deliberately NON-conformant stdio MCP server.
 *
 * Exists so the conformance suite's "runnable against any implementation" claim
 * is proven by behaviour, not asserted: running the suite against this server
 * MUST report violations (the gate asserts that in CI). Violations planted:
 *
 *   1. initialize omits `capabilities.tools`;
 *   2. tools/list returns a tool with an EMPTY description;
 *   3. an unknown tool name returns a SUCCESS envelope instead of an error;
 *   4. a type-mismatched argument is accepted (no validation at all);
 *   5. missing required arguments are accepted.
 *
 * Protocol only — no CodeCompass code, no dependency on the repo under test.
 */
import readline from 'node:readline';

const TOOLS = [
  {
    name: 'bad_tool',
    description: '', // violation 2
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  }
];

/**
 * Two violation modes so each conformance assertion can be disproven on its own:
 *   --mode=handshake (default): omits capabilities.tools (assertion A dies, and
 *     the suite legitimately stops — a session without a handshake is invalid);
 *   --mode=tools: handshakes correctly, then violates the tools surface
 *     (empty description / silent success on unknown tool / no validation),
 *     which lets assertions B/C/D/E/F be exercised.
 */
const mode = (process.argv.find((arg) => arg.startsWith('--mode=')) ?? '--mode=handshake').split('=')[1];

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (message.id === undefined) return; // notification

  if (message.method === 'initialize') {
    const result = { protocolVersion: '2024-11-05', serverInfo: { name: 'bad-mcp', version: '0' } };
    // violation 1 only in handshake mode; tools mode must survive the handshake
    if (mode !== 'tools') result.capabilities = {};
    else result.capabilities = { tools: {} };
    send({ jsonrpc: '2.0', id: message.id, result });
    return;
  }
  if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } });
    return;
  }
  if (message.method === 'tools/call') {
    // violations 3/4/5: everything succeeds, nothing is validated
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'ok' }], isError: false } });
    return;
  }
  send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } });
});
rl.on('close', () => process.exit(0));
