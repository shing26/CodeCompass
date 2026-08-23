import fs from 'node:fs/promises';
import path from 'node:path';
import type { RepoQARepos, Repo, RepoSymbol, RepoChunk } from './repoqa-repos';
import type { EventBus } from './events';
import type {
  RepoQaAnchor,
  RepoQaTraceHop,
  ServerEvent
} from '../../../packages/contracts/src/index';
import { MAX_FILES, MAX_LINES, scanRepo, detectMavenModules, mavenSourceRoots } from './repoqa-scan';
import { parseJavaFile } from './repoqa-parser';
import { extractConfigSymbols, matchConfigSymbols } from './repoqa-config';
import { resolveCallChain } from './repoqa-callchain';
import { maskSensitiveText } from './repoqa-masking';
import {
  capPrompt,
  runReActAgent,
  isLlmConfigured,
  type AgentTool,
  type ReActLLMResult
} from './repoqa-llm';

export type IndexProgressPayload = {
  repoId: string;
  phase: 'cloning' | 'parsing' | 'ready' | 'error';
  detail?: string;
};

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

/**
 * Issue 18 — split an identifier into its lowercase words so natural-language
 * questions can match camelCase / snake_case / kebab-case symbol names:
 * `createOwner` → `['create', 'owner']`, `get_pet_types` → `['get', 'pet', 'types']`.
 */
export function splitIdentifier(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Issue 18 — score how strongly a natural-language sentence mentions a symbol.
 * 0 = no match; higher = stronger. Exact whole-question matches score highest;
 * the phrase containing the exact symbol name, a camelCase word, a prefix and a
 * plain substring rank below in that order. This is a pure helper so the
 * deterministic static path stays fully unit-testable without LLMs.
 */
export function fuzzyMatchScore(question: string, symbolName: string): number {
  const q = question.toLowerCase();
  const name = symbolName.toLowerCase();
  if (!q || !name) return 0;
  if (q === name) return 100;
  if (name.length >= 3 && q.includes(name)) return 90;
  const words = q.match(/[a-z_$][\w$]*/g) ?? [];
  if (words.length === 0) return 0;
  const parts = splitIdentifier(symbolName);
  let best = 0;
  for (const word of words) {
    if (parts.includes(word)) {
      best = Math.max(best, 80);
      continue;
    }
    for (const part of parts) {
      if (word.length >= 3 && part.startsWith(word)) best = Math.max(best, 60);
      if (word.length >= 4 && word.startsWith(part)) best = Math.max(best, 50);
    }
    if (word.length >= 4 && name.includes(word)) best = Math.max(best, 40);
  }
  return best;
}

/**
 * Issue 18 — fuzzy start-symbol lookup used when exact matching fails. Scores
 * are relevance-led: the highest-scoring symbol wins, with production code and
 * method-kind used to break ties (a weak-scoring method never beats a strongly
 * matching route/service/class). Within a 10-point band a method is preferred
 * even over a slightly higher-scoring type, since call-chain traces start at
 * real methods while types normalize to an arbitrary first method.
 */
export function findFuzzyStartSymbol(
  question: string,
  symbols: RepoSymbol[],
  isTestPath: (filePath: string) => boolean
): RepoSymbol | undefined {
  const methodKinds = new Set(['method']);
  const typeKinds = new Set(['class', 'interface', 'route', 'service', 'repository']);
  const candidates: Array<{ symbol: RepoSymbol; prod: boolean }> = [];
  for (const symbol of symbols) {
    if (!methodKinds.has(symbol.kind) && !typeKinds.has(symbol.kind)) continue;
    candidates.push({ symbol, prod: !isTestPath(symbol.filePath) });
  }
  // Relevance-led ranking with a narrow method preference band: a method whose
  // score is within 10 points of a type/route symbol still wins, because
  // call-chain traces start at real methods while types normalize to an
  // arbitrary first method. Outside that band the higher score always wins
  // (a weak method never beats a strongly matching service/class).
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: fuzzyMatchScore(question, candidate.symbol.name)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      const prodDiff = (b.candidate.prod ? 1 : 0) - (a.candidate.prod ? 1 : 0);
      if (prodDiff !== 0) return prodDiff;
      const aIsMethod = methodKinds.has(a.candidate.symbol.kind);
      const bIsMethod = methodKinds.has(b.candidate.symbol.kind);
      if (aIsMethod && !bIsMethod && a.score >= b.score - 10) return -1;
      if (bIsMethod && !aIsMethod && b.score >= a.score - 10) return 1;
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return (bIsMethod ? 1 : 0) - (aIsMethod ? 1 : 0);
    });
  return ranked[0]?.candidate.symbol;
}

export class RepoQAWorker {
  private running = new Map<string, AbortController>();

  constructor(
    private repoqa: RepoQARepos,
    private eventBus: EventBus
  ) {}

  async indexRepo(input: {
    localPath: string;
    branch?: string;
    /** Bug-10: user-supplied display name; empty falls back to the basename. */
    name?: string;
  }): Promise<{ repo: Repo; created: boolean }> {
    const localPath = path.resolve(input.localPath);
    const rootStat = await fs.stat(localPath).catch(() => null);
    if (!rootStat?.isDirectory()) {
      throw new Error(`local path is not a directory: ${input.localPath}`);
    }

    const name =
      input.name?.trim() || (localPath.split(/[\\/]/).filter(Boolean).pop() ?? 'local');
    const upsert = this.repoqa.upsertByLocalPath({
      name,
      localPath,
      branch: input.branch
    });
    const repoId = upsert.repo.id;
    const taskId = `index-${repoId}`;
    const controller = new AbortController();
    this.running.set(taskId, controller);

    try {
      if (!controller.signal.aborted) {
        this.repoqa.updateRepoStatus(repoId, 'idle', 0, 0);
        this.repoqa.clearRepoData(repoId);
      }

      this.broadcast(taskId, {
        type: 'repoqa.index.progress',
        payload: { repoId, phase: 'parsing', detail: 'Resolving local repo...' }
      } as any);
      this.repoqa.updateRepoStatus(repoId, 'indexing');
      this.broadcast(taskId, {
        type: 'repoqa.index.progress',
        payload: { repoId, phase: 'parsing', detail: 'Scanning files and counting lines...' }
      } as any);

      const stats = await scanRepo(localPath);
      if (stats.fileCount > MAX_FILES) {
        throw new Error(
          `repo exceeds ${MAX_FILES} files (found ${stats.fileCount}); import a submodule or repo root instead`
        );
      }
      if (stats.lineCount > MAX_LINES) {
        throw new Error(
          `repo exceeds ${MAX_LINES} lines (found ${stats.lineCount}); import a submodule or repo root instead`
        );
      }

      // Issue 15: multi-module Maven detection (parent pom `<modules>`); the
      // recursive scan below already covers every module's sources with
      // repo-root-relative paths, this just lifts the module layout out of the
      // repo so it is visible on the evidence plane.
      const modules = await detectMavenModules(localPath);
      const moduleSummary =
        modules.length > 0
          ? `, ${modules.length} Maven module${modules.length === 1 ? '' : 's'} (${modules.map((m) => m.name).join(', ')})`
          : '';

      this.repoqa.saveFiles(repoId, localPath, stats.files);
      const { symbols, skipped } = await this.parseRepo(repoId, localPath, stats.files);
      if (skipped.length > 0) {
        this.repoqa.recordEvent({
          repoId,
          eventType: 'repoqa.index.warning',
          feedback: JSON.stringify({
            skippedFiles: skipped.length,
            files: skipped.map((entry) => ({ file: entry.file, error: entry.error }))
          })
        });
      }
      const configSymbols = await extractConfigSymbols(repoId, localPath, stats.files);
      const chunks = await this.extractChunks(repoId, localPath, stats.files);
      const allSymbols = [...symbols, ...configSymbols];
      this.repoqa.upsertSymbols(allSymbols);
      this.repoqa.upsertChunks(chunks);
      this.repoqa.updateRepoStatus(repoId, 'ready', stats.fileCount, allSymbols.length);
      if (modules.length > 0) {
        const sourceRoots = await mavenSourceRoots(localPath, modules);
        this.repoqa.recordEvent({
          repoId,
          eventType: 'repoqa.modules.detected',
          feedback: JSON.stringify({
            moduleCount: modules.length,
            modules: modules.map((module) => ({ name: module.name, pomPath: module.pomPath })),
            sourceRoots
          })
        });
      }
      this.broadcast(taskId, {
        type: 'repoqa.index.progress',
        payload: {
          repoId,
          phase: 'ready',
          detail: `Indexed ${stats.fileCount} files, ${stats.lineCount} lines${moduleSummary}`
        }
      } as any);
      this.broadcast(taskId, {
        type: 'repoqa.index.done',
        payload: {
          repoId,
          status: 'ready',
          fileCount: stats.fileCount,
          symbolCount: allSymbols.length
        }
      } as any);

      return { repo: this.repoqa.getRepo(repoId)!, created: upsert.created };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.repoqa.updateRepoStatus(repoId, 'error', undefined, undefined, message);
      this.broadcast(taskId, {
        type: 'repoqa.index.error',
        payload: { error: message }
      } as any);
      return { repo: this.repoqa.getRepo(repoId)!, created: upsert.created };
    } finally {
      this.running.delete(taskId);
    }
  }

  async *queryRepo(input: {
    repoId: string;
    question: string;
    mode?: 'architecture' | 'call-chain' | 'environment';
    /** Explicit trace start supplied by the frontend (Top API click): the
     * exact (name, file) of the clicked symbol. Prevents same-name ambiguity —
     * e.g. a production method and a test helper with an identical name. */
    start?: { name: string; file: string };
  }): AsyncGenerator<ServerEvent> {
    const repo = this.repoqa.getRepo(input.repoId);
    if (!repo) throw new Error('Repo not found');
    if (repo.status !== 'ready') {
      throw new Error(`Repo is not ready (${repo.status})`);
    }
    const queryStartAt = new Date().toISOString();
    this.repoqa.recordEvent({
      repoId: repo.id,
      eventType: 'query.start',
      intent: input.mode ?? 'architecture',
      queryStartAt
    });

    const symbols = this.repoqa.listSymbols(repo.id);
    // Issue 10: configuration can come from process.env or a local `.env`
    // (REPOQA_LLM_BASE / REPOQA_LLM_URL / REPOQA_LLM_API_KEY / REPOQA_LLM_MODEL).
    const llmConfigured = isLlmConfigured(process.env);
    const gatesPassed =
      process.env.REPOQA_GATES_PASSED === '1' ||
      process.env.REPOQA_EVAL_PASSED === '1';
    if (
      llmConfigured &&
      gatesPassed &&
      input.mode !== 'call-chain' &&
      input.mode !== 'environment'
    ) {
      const startedAt = Date.now();
      let firstTokenMs: number | undefined;
      const real = await this.runReActLoop(
        repo.id,
        input.question,
        symbols,
        (ms) => {
          if (firstTokenMs === undefined) firstTokenMs = ms;
        }
      );
      const latency = firstTokenMs ?? Date.now() - startedAt;
      if (latency > 1500) {
        this.repoqa.recordEvent({
          repoId: repo.id,
          eventType: 'query.failure',
          failureClass: 'latency-gate-exceeded'
        });
        throw new Error('Latency gate exceeded (1.5s)');
      }
      const anchors: RepoQaAnchor[] = [];
      for (const anchor of real.anchors ?? []) {
        if (await this.isValidAnchor(repo, anchor)) anchors.push(anchor);
      }
      const answer = maskSensitiveText(real.answer ?? 'No answer from LLM.');
      const routeForAction =
        symbols.find((symbol) => symbol.kind === 'route') ??
        symbols.find((symbol) => symbol.kind === 'method') ??
        symbols[0];
      const suggestedAction = routeForAction ? `Trace ${routeForAction.name}` : undefined;
      const tokens = answer.match(/\S+(?:\s+)?/g) ?? [answer];
      for (const token of tokens) {
        yield { type: 'repoqa.query.token', payload: { token } };
      }
      if (real.mermaid) {
        yield { type: 'repoqa.query.mermaid', payload: { mermaid: real.mermaid } };
      }
      if (anchors.length > 0) {
        yield { type: 'repoqa.query.anchors', payload: { anchors } };
      }
      this.repoqa.recordEvent({
        repoId: repo.id,
        eventType: 'query.done',
        intent: input.mode ?? 'architecture',
        queryStartAt,
        // Issue 08: persist first-token latency on the evidence plane.
        firstTokenAt:
          firstTokenMs !== undefined
            ? new Date(startedAt + firstTokenMs).toISOString()
            : undefined,
        queryDoneAt: new Date().toISOString()
      });
      yield {
        type: 'repoqa.query.done',
        payload: {
          answer,
          mermaid: real.mermaid,
          anchors,
          suggestedAction
        }
      };
      return;
    }

    const isCallChain = input.mode === 'call-chain';
    let trace: RepoQaTraceHop[] | undefined = [];
    let candidateAnchors: RepoQaAnchor[] = [];
    let mermaid: string | undefined;
    let route: RepoSymbol | undefined;
    let environmentKeyCount = 0;
    let environmentChunkCount = 0;
    let environmentEvidence: string[] = [];

    if (isCallChain) {
      const start = this.findStartSymbol(input.question, symbols, input.start);
      if (start) {
        trace = resolveCallChain(symbols, start);
        candidateAnchors = trace
          .filter((hop) => !hop.break && hop.line)
          .map((hop) => ({
            file: hop.file,
            line: hop.line!,
            symbol: hop.method
          }));
        mermaid = this.traceToMermaid(trace, start.name);
      } else {
        this.repoqa.recordEvent({
          repoId: repo.id,
          eventType: 'tool.miss',
          intent: input.mode,
          toolMiss: 'call-chain start symbol not found'
        });
      }
    } else if (input.mode === 'environment') {
      const configs = matchConfigSymbols(
        input.question,
        symbols.filter((symbol) => symbol.kind === 'config')
      );
      const chunks = this.repoqa.searchChunks(repo.id, input.question);
      environmentKeyCount = configs.length;
      environmentChunkCount = chunks.length;
      // Issue 06: precise file + line + key evidence, values never included.
      environmentEvidence = configs.slice(0, 12).map(
        (symbol) => `- ${symbol.name} @ ${symbol.filePath}:${symbol.lineStart ?? 1}`
      );
      candidateAnchors = configs.map((symbol) => ({
        file: symbol.filePath,
        line: symbol.lineStart ?? 1,
        symbol: symbol.name
      }));
      route = configs[0];
      trace = undefined;
      mermaid = undefined;
    } else {
      route =
        symbols.find((symbol) => symbol.kind === 'route') ??
        symbols.find((symbol) => symbol.kind === 'method') ??
        symbols[0];
      const method = symbols.find(
        (symbol) => symbol.kind === 'method' && symbol.name !== route?.name
      );
      candidateAnchors = [route, method]
        .filter((symbol): symbol is RepoSymbol => Boolean(symbol))
        .map((symbol) => ({
          file: symbol.filePath,
          line: symbol.lineStart ?? 1,
          symbol: symbol.name
        }));
      mermaid =
        route && method
          ? (() => {
              const routeLine = typeof route.lineStart === 'number' ? route.lineStart : 1;
              const methodLine = typeof method.lineStart === 'number' ? method.lineStart : 1;
              // Issue 10: the frontend matches clicked label text to the click
              // binding key, so node IDs must equal their labels (as in
              // traceToMermaid) for code:// deep links to work.
              return [
                'flowchart LR',
                `  ${route.name}[${route.name}]`,
                `  ${method.name}[${method.name}]`,
                `  ${route.name} --> ${method.name}`,
                `click ${route.name} "code://${route.filePath}#${routeLine}"`,
                `click ${method.name} "code://${method.filePath}#${methodLine}"`
              ].join('\n');
            })()
          : undefined;
      trace =
        route && method
          ? [
              { file: route.filePath, method: route.name, line: route.lineStart ?? 1 },
              { file: method.filePath, method: method.name, line: method.lineStart ?? 1 }
            ]
          : undefined;
    }

    const anchors: RepoQaAnchor[] = [];
    for (const anchor of candidateAnchors) {
      if (await this.isValidAnchor(repo, anchor)) anchors.push(anchor);
    }

    const rawAnswer =
      input.mode === 'environment'
        ? (() => {
            const base = `Found ${environmentKeyCount} config keys and ${environmentChunkCount} matching chunks.`;
            return environmentEvidence.length > 0
              ? `${base}\n\nMatched key evidence:\n${environmentEvidence.join('\n')}`
              : base;
          })()
        : (() => {
            // Issue 05: surface the break marker textually so deterministic
            // call-chain queries never look like silent success.
            const breakHop = trace?.find((hop) => hop.break);
            const chainLines =
              trace && trace.length > 0
                ? trace
                    .map(
                      (hop, index) =>
                        `${index + 1}. ${hop.method} @ ${hop.file}:${hop.line ?? '?'}`
                    )
                    .join('\n')
                : undefined;
            const breakNote = breakHop?.reason ? `\n\n${breakHop.reason}` : '';
            if (input.mode === 'call-chain' && chainLines) {
              return `调用链分析（问题「${input.question}」）：\n${chainLines}${breakNote}`;
            }
            if (chainLines) {
              return `静态分析（问题「${input.question}」）：识别到入口 ${trace![0].method} 与下游调用：\n${chainLines}${breakNote}`;
            }
            return `静态分析（问题「${input.question}」）：未解析到可追踪的调用链。`;
          })();
    const answer = maskSensitiveText(rawAnswer);
    const tokens = answer.match(/\S+(?:\s+)?/g) ?? [answer];

    for (const token of tokens) {
      yield { type: 'repoqa.query.token', payload: { token } };
    }
    if (mermaid) yield { type: 'repoqa.query.mermaid', payload: { mermaid } };
    if (anchors.length > 0) {
      yield { type: 'repoqa.query.anchors', payload: { anchors } };
    }
    const suggestedAction =
      route ? `Trace ${route.name}` :
      anchors.length > 0 ? `Inspect ${anchors[0].symbol}` : undefined;
    this.repoqa.recordEvent({
      repoId: repo.id,
      eventType: 'query.done',
      intent: input.mode ?? 'architecture',
      queryStartAt,
      queryDoneAt: new Date().toISOString()
    });
    yield {
      type: 'repoqa.query.done',
      payload: {
        answer,
        mermaid,
        anchors,
        trace,
        suggestedAction
      }
    };
  }

  /** Test paths (src/test, test/java) rarely carry the chain the user asked
   * about — a production method wins over a same-named test helper. */
  private isTestPath(filePath: string): boolean {
    const p = filePath.replace(/\\/g, '/').toLowerCase();
    return p.includes('/test/') || p.includes('/src/test') || p.includes('test/java');
  }

  private findStartSymbol(
    question: string,
    symbols: RepoSymbol[],
    explicitStart?: { name: string; file: string }
  ): RepoSymbol | undefined {
    // Explicit start (Top API click) wins: exact file+name first, then a
    // production-code name match, so the trace never starts from a sibling
    // symbol in a test class.
    if (explicitStart?.name && explicitStart.file) {
      const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
      const exact = symbols.find(
        (symbol) =>
          symbol.name.toLowerCase() === explicitStart.name.toLowerCase() &&
          norm(symbol.filePath) === norm(explicitStart.file)
      );
      if (exact) return exact;
      const byName = symbols.find(
        (symbol) =>
          symbol.name.toLowerCase() === explicitStart.name.toLowerCase() &&
          !this.isTestPath(symbol.filePath)
      );
      if (byName) return byName;
    }
    const words = question.toLowerCase().match(/[a-z_$][\w$]*/g) ?? [];
    const prodSymbols = symbols.filter((symbol) => !this.isTestPath(symbol.filePath));
    // Issue 05: allow tracing from a route/service/repository/class symbol too;
    // resolveCallChain normalizes the type into its first method.
    const typeKinds = new Set(['class', 'interface', 'route', 'service', 'repository']);
    const find = (list: RepoSymbol[], kinds: Set<string>, word: string) =>
      list.find((symbol) => kinds.has(symbol.kind) && symbol.name.toLowerCase() === word);
    for (const word of words) {
      const match = find(prodSymbols, new Set(['method']), word);
      if (match) return match;
    }
    for (const word of words) {
      const match = find(symbols, new Set(['method']), word);
      if (match) return match;
    }
    // Issue 18: fuzzy extraction runs before the exact type/route lookups so
    // natural-language phrasing like "创建 owner 的方法" starts from a real
    // method (createOwner) instead of the type whose name is a word in the
    // question (class Owner normalizes to an arbitrary first method).
    const fuzzy = findFuzzyStartSymbol(question, symbols, (filePath) => this.isTestPath(filePath));
    if (fuzzy) return fuzzy;
    for (const word of words) {
      const match = find(prodSymbols, typeKinds, word);
      if (match) return match;
    }
    for (const word of words) {
      const match = find(symbols, typeKinds, word);
      if (match) return match;
    }
    return (
      prodSymbols.find((symbol) => symbol.kind === 'method') ??
      symbols.find((symbol) => symbol.kind === 'method')
    );
  }

  private traceToMermaid(trace: RepoQaTraceHop[], startName: string): string {
    const lines = ['flowchart LR'];
    const names = [startName, ...trace.slice(1).map((hop) => hop.method)];
    for (let index = 0; index < names.length - 1; index += 1) {
      const hop = trace[index + 1];
      const label = hop?.break ? (hop.reason ?? 'break').replace(/[\[\]]/g, '') : undefined;
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
    return lines.join('\n');
  }

  private async runReActLoop(
    repoId: string,
    question: string,
    symbols: RepoSymbol[],
    onFirstToken?: (latencyMs: number) => void
  ): Promise<ReActLLMResult> {
    // Issue 10: the ReAct loop now lives in the adapter (repoqa-llm.ts).
    // Tools expose deterministic repo intelligence; masking happens both on the
    // outgoing prompt and inside the repoqa-masking tool.
    return runReActAgent({
      question,
      context: this.buildReActContext(repoId, question, symbols),
      tools: this.buildAgentTools(symbols),
      env: process.env,
      onFirstToken
    });
  }

  /** Prebuilt deterministic context: indexed symbols + evidence chunks. */
  private buildReActContext(
    repoId: string,
    question: string,
    symbols: RepoSymbol[]
  ): string {
    const symbolLines = symbols
      .slice(0, 200)
      .map(
        (symbol) =>
          `${symbol.name} (${symbol.kind} @ ${symbol.filePath}:${symbol.lineStart ?? 1})`
      )
      .join('\n');
    const chunkLines = this.repoqa
      .searchChunks(repoId, question)
      .slice(0, 30)
      .map((chunk) => `${chunk.filePath ?? '?'}: ${chunk.content.slice(0, 200)}`)
      .join('\n');
    return capPrompt(`Indexed symbols:\n${symbolLines}\nEvidence chunks:\n${chunkLines}`);
  }

  /** Issue 10: Agent Tools wired into the ReAct loop. */
  private buildAgentTools(symbols: RepoSymbol[]): AgentTool[] {
    return [
      {
        name: 'trace_call_chain',
        description:
          'Resolve the call chain starting from a method/route/class name (e.g. "hello"). Returns ordered hops with file, method, line and break markers.',
        parameters: 'query: string',
        execute: (args) => {
          const query = String(args.query ?? args.symbol ?? '');
          if (!query) return { error: 'query is required' };
          const start = this.findStartSymbol(query, symbols);
          if (!start) return { error: `start symbol not found for "${query}"` };
          const trace = resolveCallChain(symbols, start);
          return trace.map((hop) => ({
            file: hop.file,
            method: hop.method,
            line: hop.line ?? null,
            break: hop.break === true,
            reason: hop.reason ?? null
          }));
        }
      },
      {
        name: 'get_config_evidence',
        description:
          'Find configuration keys (YAML/properties/pom). Returns key paths with file:line locations, NEVER the secret values.',
        parameters: 'key: string',
        execute: (args) => {
          const key = String(args.key ?? args.query ?? '');
          const configs = symbols.filter((symbol) => symbol.kind === 'config');
          const matched = key ? matchConfigSymbols(key, configs) : configs;
          return matched.slice(0, 30).map((symbol) => ({
            key: symbol.name,
            file: symbol.filePath,
            line: symbol.lineStart ?? 1
          }));
        }
      },
      {
        name: 'repoqa-masking',
        description:
          'Mask sensitive content (passwords, tokens, API keys, private keys) in arbitrary text before it is shown to users.',
        parameters: 'text: string',
        execute: (args) => maskSensitiveText(String(args.text ?? ''))
      }
    ];
  }

  cancel(taskId: string) {
    this.running.get(taskId)?.abort();
    this.running.delete(taskId);
  }

  private broadcast(taskId: string, event: ServerEvent) {
    this.eventBus.emit({ ...event, taskId } as any);
  }

  private async parseRepo(
    repoId: string,
    root: string,
    files: string[]
  ): Promise<{ symbols: RepoSymbol[]; skipped: Array<{ file: string; error: string }> }> {
    const symbols: RepoSymbol[] = [];
    const skipped: Array<{ file: string; error: string }> = [];
    for (const filePath of files.filter((file) => file.endsWith('.java'))) {
      try {
        symbols.push(...(await parseJavaFile(filePath, repoId, root)));
      } catch (error) {
        // Dogfooding (Issue 17): real-world Java repos routinely contain edge
        // syntax our parser cannot cover (e.g. class literals inside annotation
        // arguments). A single unparseable file must not abort the whole import —
        // skip it, surface a warning event, and keep the rest of the repo.
        const relative = path.relative(root, filePath).split(path.sep).join('/');
        const detail = error instanceof Error ? error.message : String(error);
        skipped.push({ file: relative, error: detail });
      }
    }
    return { symbols, skipped };
  }

  private async isValidAnchor(
    repo: Repo,
    anchor: RepoQaAnchor
  ): Promise<boolean> {
    const root = path.resolve(repo.localPath);
    const resolved = path.resolve(root, anchor.file);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
    try {
      const realRoot = await fs.realpath(root);
      const realResolved = await fs.realpath(resolved);
      const realRelative = path.relative(realRoot, realResolved);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return false;
      const stat = await fs.stat(realResolved);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private async extractChunks(
    repoId: string,
    root: string,
    files: string[]
  ): Promise<RepoChunk[]> {
    const chunks: RepoChunk[] = [];
    let masked = false;
    for (const filePath of files) {
      const fileName = path.basename(filePath).toLowerCase();
      const relativePath = path.relative(root, filePath).split(path.sep).join('/');
      if (fileName.startsWith('readme') || fileName.endsWith('.md')) {
        const content = await fs.readFile(filePath, 'utf8').catch(() => '');
        const maskedContent = maskSensitiveText(content);
        if (maskedContent !== content) masked = true;
        if (maskedContent.trim()) {
          chunks.push({
            repoId,
            chunkType: 'readme',
            content: maskedContent.slice(0, 4000),
            filePath: relativePath,
            lineStart: 1
          });
        }
        continue;
      }

      if (filePath.endsWith('.java')) {
        const content = await fs.readFile(filePath, 'utf8').catch(() => '');
        const javadoc = content.match(/\/\*\*[\s\S]*?\*\//g) ?? [];
        for (const block of javadoc) {
          const maskedBlock = maskSensitiveText(block);
          if (maskedBlock !== block) masked = true;
          chunks.push({
            repoId,
            chunkType: 'docstring',
            content: maskedBlock.slice(0, 4000),
            filePath: relativePath,
            lineStart: lineNumberAt(content, content.indexOf(block))
          });
        }
      }
    }
    if (masked) {
      this.repoqa.recordEvent({ repoId, eventType: 'masking.applied' });
    }
    return chunks;
  }

}
