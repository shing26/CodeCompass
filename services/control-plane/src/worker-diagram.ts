import type { RepoSymbol } from './repoqa-repos';
import type { RepoQaTraceHop } from '../../../packages/contracts/src/index';
import type { LayerInstruction } from './repoqa-llm';
import { resolveCallChain, type SymbolIndex } from './repoqa-callchain';
import { buildTours } from './repoqa-tours';
import { classifyConfigKey, isSensitiveConfigKey } from './repoqa-dashboard';
import type { DiagramSession, SessionGraphEdge } from './worker-helpers';

/**
 * V27-30 (B3 increment 3) — diagram-rendering collaborator extracted from
 * RepoQAWorker verbatim (ADR-0013 / Issue 10 / Issue 24 surfaces). The old
 * cluster of eight private/public methods touched worker state in exactly two
 * places (symbol-graph index lookup and start-symbol resolution shared with
 * the query pipeline); both arrive through the narrow DiagramContext seam,
 * so every method here is a pure function of its arguments plus that context.
 */

export interface DiagramContext {
  /** Call-chain index for a repo (worker delegates to getSymbolGraph). */
  symbolIndexFor(repoId: string): SymbolIndex;
  /** Start-symbol resolution, same path the query pipeline uses. */
  findStartSymbol(
    question: string,
    symbols: RepoSymbol[],
    explicitStart?: { name: string; file: string }
  ): RepoSymbol | undefined;
}

export class WorkerDiagram {
  constructor(private readonly ctx: DiagramContext) {}

  traceToMermaid(
    trace: RepoQaTraceHop[],
    startName: string,
    annotations?: Record<string, string>
  ): string {
    const lines = ['flowchart LR'];
    const names = [startName, ...trace.slice(1).map((hop) => hop.method)];
    for (let index = 0; index < names.length - 1; index += 1) {
      const hop = trace[index + 1];
      // v0.7 — break markers take precedence; async hops get an [async] edge
      // label so Goroutine dispatch stays visible in the deterministic chain.
      const label = hop?.break
        ? (hop.reason ?? 'break').replace(/[\[\]]/g, '')
        : hop?.async
          ? 'async'
          : undefined;
      const edge = label ? `-->|${label}|` : '-->';
      lines.push(`  ${names[index]}[${names[index]}] ${edge} ${names[index + 1]}[${names[index + 1]}]`);
    }
    // Issue 10: code:// deep-link every node to its source location so the
    // frontend can jump from the diagram to the Inspector.
    const nodes = [
      { name: startName, hop: trace[0] },
      ...trace.slice(1).map((hop, index) => ({ name: names[index + 1], hop }))
    ];
    for (const { name, hop } of nodes) {
      if (hop?.file && typeof hop.line === 'number') {
        lines.push(`  click ${name} "code://${hop.file}#${hop.line}"`);
      }
    }
    // Issue 24 / ADR-0013: model annotations ride along as mermaid comments —
    // they never touch geometry, edges or click bindings. Keys that do not
    // name a node of this diagram are dropped (existence enforced here).
    if (annotations) {
      for (const { name } of nodes) {
        const note = annotations[name];
        if (note) lines.push(`  %% note ${name}: ${note}`);
      }
    }
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Issue 24 / ADR-0013 — layer-instruction rendering.
   *
   * The model may only request diagrams via a structured instruction; every
   * edge below is harvested from this session's deterministic tool results
   * (trace_call_chain / diagnose_chain rows) or rendered by a fixed engine
   * renderer (config topology, onboarding tours). Model-painted mermaid is
   * stripped in finalizeAgentResult and never reaches a payload.
   * ------------------------------------------------------------------ */

  /** Physical hop harvested from one session tool result row. */
  collectSessionEdges(result: unknown, edges: SessionGraphEdge[]): number {
    let added = 0;
    if (Array.isArray(result)) {
      for (const item of result) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const row = item as Record<string, unknown>;
        const file =
          typeof row.file === 'string'
            ? row.file
            : typeof row.filePath === 'string'
              ? row.filePath
              : undefined;
        const method =
          typeof row.method === 'string'
            ? row.method
            : typeof row.symbol === 'string'
              ? row.symbol
              : undefined;
        const line = Number(row.line);
        if (!file || !method || !Number.isFinite(line) || line <= 0) continue;
        edges.push({ file, method, line: Math.trunc(line) });
        added += 1;
      }
      return added;
    }
    if (result && typeof result === 'object') {
      // diagnose_chain returns { verifiedChain: [...] } — same row shape.
      const chain = (result as Record<string, unknown>).verifiedChain;
      if (Array.isArray(chain)) added += this.collectSessionEdges(chain, edges);
    }
    return added;
  }

  /** Sink wired into the ReAct loop: harvest edges, mark failed tools. */
  harvestDiagramSession(
    session: DiagramSession,
    toolName: string,
    result: unknown
  ): void {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const error = (result as Record<string, unknown>).error;
      if (typeof error === 'string' && error) session.failedTools.add(toolName);
    }
    this.collectSessionEdges(result, session.edges);
  }

  /**
   * ADR-0013: the ONLY path from a layer instruction to a payload diagram.
   * call_chain requires provable session edges (and a clean session — any
   * failed tool call voids the chain); config_topo / tour are fixed engine
   * renderers over the symbol table. Returns undefined when nothing can be
   * proven — the engine never invents geometry to satisfy an instruction.
   */
  renderLayerInstruction(
    instruction: LayerInstruction,
    repo: { id: string; name: string },
    symbols: RepoSymbol[],
    session: DiagramSession
  ): string | undefined {
    if (instruction.kind === 'call_chain') {
      if (session.failedTools.size > 0) return undefined;
      return this.renderCallChainDiagram(instruction, repo.id, symbols, session.edges);
    }
    if (instruction.kind === 'config_topo') {
      return this.renderConfigTopoDiagram(instruction, symbols);
    }
    return this.renderTourDiagram(instruction, repo, symbols);
  }

  private renderCallChainDiagram(
    instruction: LayerInstruction,
    repoId: string,
    symbols: RepoSymbol[],
    edges: SessionGraphEdge[]
  ): string | undefined {
    let start: RepoSymbol | undefined;
    for (const name of instruction.focus ?? []) {
      start = this.ctx.findStartSymbol(name, symbols);
      if (start) break;
    }
    if (!start) {
      // No resolvable focus: fall back to the first session edge that pins a
      // symbol in the index — still engine-derived, never model-drawn.
      for (const edge of edges) {
        start =
          symbols.find((symbol) => symbol.name === edge.method) ??
          symbols.find(
            (symbol) =>
              `${symbol.parentType ? `${symbol.parentType}.` : ''}${symbol.name}` === edge.method
          );
        if (start) break;
      }
    }
    if (!start) return undefined;
    const trace = resolveCallChain(symbols, start, 4, this.ctx.symbolIndexFor(repoId));
    if (trace.length < 2) return undefined;
    const collapse = instruction.collapse ?? trace.length;
    const capped = trace.slice(0, Math.max(2, Math.min(collapse, trace.length)));
    return this.traceToMermaid(capped, start.name, instruction.annotations);
  }

  private renderConfigTopoDiagram(
    instruction: LayerInstruction,
    symbols: RepoSymbol[]
  ): string | undefined {
    const configs = symbols.filter(
      (symbol) => symbol.kind === 'config' && !symbol.name.includes(':')
    );
    const focus = instruction.focus ?? [];
    // ADR-0013: focus that matches nothing renders nothing — never the full
    // topology as a consolation prize, never invented keys.
    const selected = (
      focus.length > 0 ? configs.filter((symbol) => focus.includes(symbol.name)) : configs
    ).slice(0, Math.max(1, Math.min(instruction.collapse ?? 12, 30)));
    if (selected.length === 0) return undefined;
    const lines = ['flowchart LR'];
    const usedIds = new Set<string>();
    const nodeIdOf = (raw: string): string => {
      let id = raw.replace(/[^A-Za-z0-9_]/g, '_');
      while (usedIds.has(id)) id = `${id}_x`;
      usedIds.add(id);
      return id;
    };
    const groupIds = new Map<string, string>();
    for (const symbol of selected) {
      const id = nodeIdOf(symbol.name);
      const sensitive = isSensitiveConfigKey(symbol.name);
      lines.push(`  ${id}["${sensitive ? `${symbol.name} (sensitive)` : symbol.name}"]`);
      lines.push(`  click ${id} "code://${symbol.filePath}#${symbol.lineStart ?? 1}"`);
      const group = classifyConfigKey(symbol.name);
      if (!groupIds.has(group)) {
        const gid = nodeIdOf(`group_${group}`);
        groupIds.set(group, gid);
        lines.push(`  ${gid}["${group}"]`);
      }
      lines.push(`  ${id} --> ${groupIds.get(group)}`);
    }
    const mermaid = lines.join('\n');
    const annotations = instruction.annotations;
    if (!annotations || Object.keys(annotations).length === 0) return mermaid;
    const nodeIds = this.mermaidNodeIds(mermaid);
    const notes = Object.entries(annotations).filter(([key]) => nodeIds.has(key));
    return notes.length === 0
      ? mermaid
      : `${mermaid}\n${notes.map(([key, text]) => `  %% note ${key}: ${text}`).join('\n')}`;
  }

  private renderTourDiagram(
    instruction: LayerInstruction,
    repo: { id: string; name: string },
    symbols: RepoSymbol[]
  ): string | undefined {
    const tours = buildTours({ repoId: repo.id, repoName: repo.name, symbols });
    if (tours.length === 0) return undefined;
    const focusId = instruction.focus?.[0];
    // ADR-0013: an unknown tour id renders nothing; no focus → main-flow.
    const matched = focusId ? tours.find((tour) => tour.id === focusId) : undefined;
    if (focusId && !matched) return undefined;
    const picked = matched ?? tours.find((tour) => tour.id === 'main-flow') ?? tours[0];
    const annotations = instruction.annotations;
    if (!annotations || Object.keys(annotations).length === 0) return picked.mermaid;
    const nodeIds = this.mermaidNodeIds(picked.mermaid);
    const notes = Object.entries(annotations).filter(([key]) => nodeIds.has(key));
    return notes.length === 0
      ? picked.mermaid
      : `${picked.mermaid}\n${notes.map(([key, text]) => `  %% note ${key}: ${text}`).join('\n')}`;
  }

  /** Identifier tokens of a diagram body (clicks / quoted strings / comments excluded). */
  private mermaidNodeIds(code: string): Set<string> {
    const withoutStrings = code.replace(/"([^"]*)"/g, '');
    const body = withoutStrings
      .split('\n')
      .filter((line) => !/^\s*%%/.test(line) && !/^\s*click\s/i.test(line))
      .join('\n');
    const ids = new Set<string>();
    for (const match of body.matchAll(/[A-Za-z_][\w]*/g)) ids.add(match[0]);
    return ids;
  }
}
