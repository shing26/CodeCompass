import path from 'node:path';
import fs from 'node:fs/promises';
import type { RepoSymbol } from './repoqa-repos';
import {
  buildCallIndex,
  CallResolver,
  symbolIdentity,
  type SymbolIndex
} from './repoqa-callchain';
import { estimateTokenCount } from './repoqa-llm';
import { maskSensitiveText } from './repoqa-masking';

/**
 * Issue 28 — AST Graph RAG subgraph extractor.
 *
 * Given a deterministic start symbol (resolved by the worker through
 * `resolveStartSymbolForQuery`), this module walks the in-memory symbol graph
 * in both directions: 1-Hop Caller and 1..3 Hop Callee. Extracted method
 * bodies are folded into class skeletons where possible, pruned against a
 * token budget with a priority queue, and every emitted code chunk passes
 * through the 13-pattern credential masking engine.
 */

export const DEFAULT_MAX_TOKENS = 6000;
export const DEFAULT_MAX_CALLER_DEPTH = 1;
export const DEFAULT_MAX_CALLEE_DEPTH = 3;

/** Headers/skeleton overhead reserved out of the token budget. */
const RESERVED_OVERHEAD_TOKENS = 120;

export interface SubgraphContextOptions {
  /** Soft output budget in estimated tokens. Default 6000. */
  maxTokens?: number;
  /** Caller hops to include. Default 1. */
  maxCallerDepth?: number;
  /** Callee hops to include. Default 3. */
  maxCalleeDepth?: number;
  /** Repo root used to resolve symbol file paths when `readFile` is absent. */
  root?: string;
  /** Injectable source reader (tests); defaults to fs on `root`-relative paths. */
  readFile?: (filePath: string) => Promise<string>;
  /** Reuse an existing call index to avoid rebuilding it. */
  index?: SymbolIndex;
}

export type SubgraphDirection = 'start' | 'caller' | 'callee';

export interface SubgraphNodeSummary {
  name: string;
  file: string;
  line: number;
  distance: number;
  direction: SubgraphDirection;
  tokens: number;
}

export interface SubgraphContextResult {
  start: { name: string; file: string; line: number };
  nodes: SubgraphNodeSummary[];
  tokenCount: number;
  truncated: boolean;
  prunedCount: number;
  text: string;
}

interface GraphNode {
  symbol: RepoSymbol;
  distance: number;
  direction: SubgraphDirection;
}

interface CandidateNode {
  node: GraphNode;
  code: string;
  tokens: number;
}

/** Minimal max-heap used by the token-pruning pass (higher priority first). */
class MaxHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parent]) <= 0) break;
      [this.items[index], this.items[parent]] = [this.items[parent], this.items[index]];
      index = parent;
    }
  }

  private sinkDown(index: number): void {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let largest = index;
      if (left < this.items.length && this.compare(this.items[left], this.items[largest]) > 0) {
        largest = left;
      }
      if (right < this.items.length && this.compare(this.items[right], this.items[largest]) > 0) {
        largest = right;
      }
      if (largest === index) break;
      [this.items[index], this.items[largest]] = [this.items[largest], this.items[index]];
      index = largest;
    }
  }
}

function effectiveStart(
  symbols: RepoSymbol[],
  start: RepoSymbol,
  index: SymbolIndex
): RepoSymbol | undefined {
  if (start.kind === 'method') return start;
  const info = index.types.get(start.name);
  if (info) {
    const methods = [...info.methods.values()]
      .flat()
      .sort((a, b) => (a.lineStart ?? 0) - (b.lineStart ?? 0));
    if (methods.length > 0) return methods[0];
  }
  return symbols.find((symbol) => symbol.kind === 'method');
}

function collectCallees(
  start: RepoSymbol,
  maxDepth: number,
  resolver: CallResolver
): GraphNode[] {
  const nodes: GraphNode[] = [{ symbol: start, distance: 0, direction: 'start' }];
  const visited = new Set<string>([symbolIdentity(start)]);
  const queue: Array<{ symbol: RepoSymbol; distance: number }> = [
    { symbol: start, distance: 0 }
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.distance >= maxDepth) continue;
    for (const call of current.symbol.calls ?? []) {
      const resolved = resolver.resolve(current.symbol, call);
      if (!('target' in resolved)) continue;
      const target = resolved.target;
      const id = symbolIdentity(target);
      if (visited.has(id)) continue;
      visited.add(id);
      const next = { symbol: target, distance: current.distance + 1, direction: 'callee' as const };
      nodes.push(next);
      queue.push({ symbol: target, distance: next.distance });
    }
  }
  return nodes;
}

function collectCallers(
  start: RepoSymbol,
  maxDepth: number,
  symbols: RepoSymbol[],
  resolver: CallResolver
): GraphNode[] {
  if (maxDepth <= 0) return [];
  const nodes: GraphNode[] = [];
  for (const caller of resolver.reverseCallers(start)) {
    const symbol = symbols.find(
      (candidate) =>
        candidate.kind === 'method' &&
        candidate.filePath === caller.file &&
        candidate.name === caller.method &&
        candidate.lineStart === caller.line
    );
    if (symbol) nodes.push({ symbol, distance: 1, direction: 'caller' });
  }
  return nodes;
}

function sliceSourceLines(content: string, symbol: RepoSymbol): string {
  const start = symbol.lineStart ?? 1;
  const end = symbol.lineEnd ?? start;
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return '';
  return lines
    .slice(Math.max(0, start - 1), Math.min(lines.length, Math.max(end, start)))
    .join('\n');
}

function priorityOf(node: GraphNode): number {
  if (node.direction === 'start') return 1000;
  if (node.direction === 'caller') return 500;
  return 400 - node.distance * 100; // 1→300, 2→200, 3→100
}

function truncateText(text: string, maxTokens: number): { text: string; truncated: boolean } {
  const maxChars = Math.max(0, maxTokens * 4);
  if (text.length <= maxChars) return { text, truncated: false };
  const cut = text.slice(0, maxChars);
  const newline = cut.lastIndexOf('\n');
  return {
    text: cut.slice(0, newline > maxChars * 0.5 ? newline : maxChars),
    truncated: true
  };
}

interface ClassSkeleton {
  name: string;
  symbol: RepoSymbol | undefined;
  methods: RepoSymbol[];
}

function buildClassSkeletons(
  symbols: RepoSymbol[],
  selected: GraphNode[]
): ClassSkeleton[] {
  const byName = new Map<string, ClassSkeleton>();
  for (const node of selected) {
    const parentType = node.symbol.parentType;
    if (!parentType) continue;
    let skeleton = byName.get(parentType);
    if (!skeleton) {
      const symbol = symbols.find(
        (candidate) =>
          candidate.name === parentType &&
          (candidate.kind === 'class' ||
            candidate.kind === 'interface' ||
            candidate.kind === 'service' ||
            candidate.kind === 'repository' ||
            candidate.kind === 'route')
      );
      skeleton = { name: parentType, symbol, methods: [] };
      byName.set(parentType, skeleton);
    }
    if (!skeleton.methods.includes(node.symbol)) skeleton.methods.push(node.symbol);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function renderSkeleton(skeleton: ClassSkeleton): string {
  const header = skeleton.symbol?.signature ?? `class ${skeleton.name}`;
  const lines = [header, '  {'];
  for (const method of skeleton.methods) {
    const signature = method.signature ?? `${method.name}()`;
    lines.push(`    + ${signature}  // @ ${method.filePath}:${method.lineStart ?? 1}`);
  }
  lines.push('  }');
  return lines.join('\n');
}

function renderNodeSections(nodes: GraphNode[], codeByNode: Map<string, string>): string[] {
  const sections: string[] = [];
  for (const node of nodes) {
    const code = codeByNode.get(symbolIdentity(node.symbol)) ?? '';
    if (!code.trim()) continue;
    sections.push(
      [
        `### ${node.symbol.name} @ ${node.symbol.filePath}:${node.symbol.lineStart ?? 1}`,
        '```text',
        code,
        '```'
      ].join('\n')
    );
  }
  return sections;
}

/**
 * Build the agent-ready Graph RAG context for a start symbol. Deterministic:
 * same symbols, same start and same budget produce the same text.
 */
export async function extractSubgraphContext(
  symbols: RepoSymbol[],
  start: RepoSymbol,
  options: SubgraphContextOptions = {}
): Promise<SubgraphContextResult> {
  const maxTokens = Math.max(1, options.maxTokens ?? DEFAULT_MAX_TOKENS);
  const maxCallerDepth = Math.max(0, options.maxCallerDepth ?? DEFAULT_MAX_CALLER_DEPTH);
  const maxCalleeDepth = Math.max(0, options.maxCalleeDepth ?? DEFAULT_MAX_CALLEE_DEPTH);
  const index = options.index ?? buildCallIndex(symbols);
  const started = effectiveStart(symbols, start, index);
  if (!started) {
    return {
      start: {
        name: start.name,
        file: start.filePath,
        line: start.lineStart ?? 1
      },
      nodes: [],
      tokenCount: 0,
      truncated: false,
      prunedCount: 0,
      text: '# Agent Context: no resolvable start method'
    };
  }

  const resolver = new CallResolver(symbols, index);
  const graphNodes = [
    ...collectCallees(started, maxCalleeDepth, resolver),
    ...collectCallers(started, maxCallerDepth, symbols, resolver)
  ];

  const seen = new Set<string>();
  const uniqueNodes = graphNodes.filter((node) => {
    const id = symbolIdentity(node.symbol);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const fileCache = new Map<string, string>();
  const readSource = async (filePath: string): Promise<string> => {
    const cached = fileCache.get(filePath);
    if (cached !== undefined) return cached;
    let content = '';
    try {
      content = options.readFile
        ? await options.readFile(filePath)
        : await fs.readFile(path.join(options.root ?? '.', filePath), 'utf8');
    } catch {
      // A missing/unreadable file keeps the node's summary but contributes no code.
    }
    fileCache.set(filePath, content);
    return content;
  };

  const candidates: CandidateNode[] = [];
  for (const node of uniqueNodes) {
    const content = await readSource(node.symbol.filePath);
    const code = maskSensitiveText(sliceSourceLines(content, node.symbol));
    candidates.push({ node, code, tokens: estimateTokenCount(code) });
  }

  // Priority-queue pruning: start always fits; callers/callees are consumed in
  // deterministic priority order (start > callers > nearer callees), with
  // smaller snippets preferred on ties.
  const startCandidate = candidates.find((candidate) => candidate.node.direction === 'start');
  const effectiveBudget = Math.max(1, maxTokens - RESERVED_OVERHEAD_TOKENS);
  let remaining = effectiveBudget;
  let truncated = false;
  let prunedCount = 0;
  const selected: CandidateNode[] = [];

  if (startCandidate) {
    if (startCandidate.tokens > effectiveBudget) {
      startCandidate.code = startCandidate.code.slice(0, effectiveBudget * 4);
      startCandidate.tokens = estimateTokenCount(startCandidate.code);
      truncated = true;
    }
    selected.push(startCandidate);
    remaining = Math.max(0, remaining - startCandidate.tokens);
  }

  const heap = new MaxHeap<CandidateNode>((a, b) => {
    const priorityDiff = priorityOf(a.node) - priorityOf(b.node);
    if (priorityDiff !== 0) return priorityDiff;
    return b.tokens - a.tokens;
  });
  for (const candidate of candidates) {
    if (candidate === startCandidate) continue;
    heap.push(candidate);
  }
  while (heap.size > 0) {
    const candidate = heap.pop()!;
    if (candidate.tokens > remaining) {
      prunedCount += 1;
      truncated = true;
      continue;
    }
    selected.push(candidate);
    remaining -= candidate.tokens;
  }

  const ordered = [...selected].sort((a, b) => {
    const order: Record<SubgraphDirection, number> = { start: 0, caller: 1, callee: 2 };
    const directionDiff = order[a.node.direction] - order[b.node.direction];
    if (directionDiff !== 0) return directionDiff;
    const distanceDiff = a.node.distance - b.node.distance;
    if (distanceDiff !== 0) return distanceDiff;
    return (
      a.node.symbol.filePath.localeCompare(b.node.symbol.filePath) ||
      (a.node.symbol.lineStart ?? 0) - (b.node.symbol.lineStart ?? 0)
    );
  });

  const skeletons = buildClassSkeletons(symbols, ordered.map((candidate) => candidate.node));
  const codeByNode = new Map(
    ordered.map((candidate) => [symbolIdentity(candidate.node.symbol), candidate.code])
  );
  const sections = renderNodeSections(
    ordered.map((candidate) => candidate.node),
    codeByNode
  );
  const skeletonText = skeletons
    .map(
      (skeleton) =>
        `### ${skeleton.name} @ ${skeleton.symbol?.filePath ?? ''}:${skeleton.symbol?.lineStart ?? ''}` +
        `\n\`\`\`text\n${renderSkeleton(skeleton)}\n\`\`\``
    )
    .join('\n\n');

  const entry = `# Agent Context: ${started.name}\n\n## Entry\n- ${started.name} @ ${started.filePath}:${started.lineStart ?? 1}`;
  const callers = ordered.filter((candidate) => candidate.node.direction === 'caller');
  const callees = ordered.filter((candidate) => candidate.node.direction === 'callee');
  const callerLines = callers
    .map(
      (candidate) =>
        `- ${candidate.node.symbol.name} @ ${candidate.node.symbol.filePath}:${candidate.node.symbol.lineStart ?? 1}`
    )
    .join('\n');
  const calleeLines = callees
    .map(
      (candidate, index) =>
        `${index + 1}. ${candidate.node.symbol.name} @ ${candidate.node.symbol.filePath}:${candidate.node.symbol.lineStart ?? 1} (${candidate.node.distance}-hop)`
    )
    .join('\n');

  const parts = [
    entry,
    `## Callers (${maxCallerDepth} hop)`,
    callerLines || '- (none)',
    `## Callees (1-${maxCalleeDepth} hops)`,
    calleeLines || '- (none)',
    '## Code',
    skeletonText,
    sections.join('\n\n')
  ];
  const rawText = maskSensitiveText(parts.filter(Boolean).join('\n\n'));
  const capped = truncateText(rawText, maxTokens);
  const nodes = ordered.map((candidate) => ({
    name: candidate.node.symbol.name,
    file: candidate.node.symbol.filePath,
    line: candidate.node.symbol.lineStart ?? 1,
    distance: candidate.node.distance,
    direction: candidate.node.direction,
    tokens: candidate.tokens
  }));

  return {
    start: {
      name: started.name,
      file: started.filePath,
      line: started.lineStart ?? 1
    },
    nodes,
    tokenCount: estimateTokenCount(capped.text),
    truncated: truncated || capped.truncated,
    prunedCount,
    text: capped.text
  };
}
