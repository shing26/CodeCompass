export interface ChatToolInfo {
  name: string;
  description?: string;
  /** JSON Schema from tools/list — reused verbatim as OpenAI function-calling
   * parameters (dynamic derivation, never hardcoded). */
  inputSchema?: unknown;
}

/**
 * Dynamic autoApprove derivation: the IDE-side approval list must follow
 * tools/list, never a hardcoded list — the CodeCompass surface grew
 * 15 → 17 tools within two releases and will keep moving.
 */
export function deriveAutoApprove(tools: readonly ChatToolInfo[]): string[] {
  return tools.map((t) => t.name).sort();
}
