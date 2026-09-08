import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer, type McpDeps } from '../repoqa-mcp.js';
import type { ToolSummary, ToolCallOutcome } from './types.js';
import type { SessionLogger } from './log.js';

function extractPayload(result: unknown): unknown {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) return result;
  const text = content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function rawText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

/**
 * Chat-merge Q3: the编排层 talks to the engine over the SAME MCP protocol as
 * external consumers, but via InMemoryTransport — in-process, zero subprocess
 * (自闭环消灭), and the 17-tool surface is served by the production handler
 * code (dual-surface parity by construction).
 *
 * The client serves ALL indexed repos: there is no per-repo `connect` — the
 * chat session binds a repoId (`setSessionRepo`) and the fallback/currentRepo
 * carries it into tool calls.
 */
export class InProcessMcpClient {
  private client?: Client;
  private tools: ToolSummary[] = [];
  private currentRepoId = '';

  constructor(
    private readonly mcpDeps: McpDeps,
    private readonly log: SessionLogger,
    private readonly onServerLog: (line: string) => void = () => {},
  ) {}

  get connected(): boolean {
    return this.client !== undefined;
  }

  /** Engine port semantics: the "current repo" is the repoId bound to the
   * active chat session (fallback routing reads it). */
  get currentRepo(): string {
    return this.currentRepoId;
  }

  set currentRepo(repoId: string) {
    this.currentRepoId = repoId;
  }

  get toolCount(): number {
    return this.tools.length;
  }

  get toolNames(): string[] {
    return this.tools.map((t) => t.name);
  }

  get toolsDetail(): readonly ToolSummary[] {
    return this.tools;
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const server = createMcpServer(this.mcpDeps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // Server side must be listening before the client sends the initialize
    // handshake — InMemory transport has no replay buffer (order swap = hang).
    await server.connect(serverTransport);
    const client = new Client({ name: 'compass-copilot', version: MCP_CLIENT_VERSION });
    this.client = client;
    try {
      await client.connect(clientTransport);
      const listing = await client.listTools();
      this.tools = (listing.tools ?? []).map((t) => ({
        name: t.name,
        description: (t.description ?? '').split('\n')[0],
        inputSchema: t.inputSchema,
      }));
      this.log.write('chat_mcp_ready', { toolCount: this.tools.length });
    } catch (err) {
      this.client = undefined;
      this.log.write('chat_mcp_failed', { error: String(err) });
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // already gone
      }
    }
    this.client = undefined;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallOutcome> {
    if (!this.client) throw new Error('chat MCP not initialized');
    const known = this.tools.some((t) => t.name === name);
    if (!known) throw new Error(`unknown tool "${name}" — surface may have changed`);
    const t0 = Date.now();
    const result = await this.client.callTool({ name, arguments: args });
    this.log.write('tool_result', { tool: name, ms: Date.now() - t0, ok: true });
    return { payload: extractPayload(result), raw: rawText(result), ms: Date.now() - t0 };
  }

  async health(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
}

const MCP_CLIENT_VERSION = '0.1.0';
