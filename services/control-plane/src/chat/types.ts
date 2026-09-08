export interface ToolSummary {
  name: string;
  description?: string;
  /** JSON Schema from tools/list — reused verbatim as OpenAI function-calling
   * parameters (dynamic derivation, never hardcoded). */
  inputSchema?: unknown;
}

export interface ToolCallOutcome {
  /** Parsed JSON when the server returned JSON text, else the raw text. */
  payload: unknown;
  raw: string;
  ms: number;
}
