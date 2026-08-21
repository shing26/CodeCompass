import fs from 'node:fs/promises';
import path from 'node:path';
import type { RepoQARepos, Repo, RepoSymbol, RepoChunk } from './repoqa-repos';
import type { EventBus } from './events';
import type {
  RepoQaAnchor,
  RepoQaTraceHop,
  ServerEvent
} from '../../../packages/contracts/src/index';
import { MAX_FILES, MAX_LINES, scanRepo } from './repoqa-scan';
import { parseJavaFile } from './repoqa-parser';
import { extractConfigSymbols } from './repoqa-config';
import { resolveCallChain } from './repoqa-callchain';
import { maskSensitiveText } from './repoqa-masking';
import {
  capPrompt,
  completeReAct,
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

export class RepoQAWorker {
  private running = new Map<string, AbortController>();

  constructor(
    private repoqa: RepoQARepos,
    private eventBus: EventBus
  ) {}

  async indexRepo(input: {
    localPath: string;
    branch?: string;
  }): Promise<{ repo: Repo; created: boolean }> {
    const localPath = path.resolve(input.localPath);
    const rootStat = await fs.stat(localPath).catch(() => null);
    if (!rootStat?.isDirectory()) {
      throw new Error(`local path is not a directory: ${input.localPath}`);
    }

    const name = localPath.split(/[\\/]/).filter(Boolean).pop() ?? 'local';
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

      this.repoqa.saveFiles(repoId, localPath, stats.files);
      const symbols = await this.parseRepo(repoId, localPath, stats.files);
      const configSymbols = await extractConfigSymbols(repoId, localPath, stats.files);
      const chunks = await this.extractChunks(repoId, localPath, stats.files);
      const allSymbols = [...symbols, ...configSymbols];
      this.repoqa.upsertSymbols(allSymbols);
      this.repoqa.upsertChunks(chunks);
      this.repoqa.updateRepoStatus(repoId, 'ready', stats.fileCount, allSymbols.length);
      this.broadcast(taskId, {
        type: 'repoqa.index.progress',
        payload: {
          repoId,
          phase: 'ready',
          detail: `Indexed ${stats.fileCount} files, ${stats.lineCount} lines`
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
    const llmUrl = process.env.REPOQA_LLM_URL?.trim();
    const gatesPassed =
      process.env.REPOQA_GATES_PASSED === '1' ||
      process.env.REPOQA_EVAL_PASSED === '1';
    if (
      llmUrl &&
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

    if (isCallChain) {
      const start = this.findStartSymbol(input.question, symbols);
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
      const configs = symbols.filter((symbol) => symbol.kind === 'config');
      const chunks = this.repoqa.searchChunks(repo.id, input.question);
      environmentKeyCount = configs.length;
      environmentChunkCount = chunks.length;
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
          ? `flowchart LR\n  Route[${route.name}]\n  Method[${method.name}]\n  Route --> Method`
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
        ? `Found ${environmentKeyCount} config keys and ${environmentChunkCount} matching chunks.`
        : `Static mock answer for "${input.question}".`;
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

  private findStartSymbol(question: string, symbols: RepoSymbol[]): RepoSymbol | undefined {
    const words = question.toLowerCase().match(/[a-z_$][\w$]*/g) ?? [];
    for (const word of words) {
      const match = symbols.find(
        (symbol) => symbol.kind === 'method' && symbol.name.toLowerCase() === word
      );
      if (match) return match;
    }
    return symbols.find((symbol) => symbol.kind === 'method');
  }

  private traceToMermaid(trace: RepoQaTraceHop[], startName: string): string {
    const lines = ['flowchart LR'];
    const names = [startName, ...trace.slice(1).map((hop) => hop.method)];
    for (let index = 0; index < names.length - 1; index += 1) {
      const edge = trace[index + 1]?.break ? '-->|break|' : '-->';
      lines.push(`  ${names[index]}[${names[index]}] ${edge} ${names[index + 1]}[${names[index + 1]}]`);
    }
    return lines.join('\n');
  }

  private async runReActLoop(
    repoId: string,
    question: string,
    symbols: RepoSymbol[],
    onFirstToken?: (latencyMs: number) => void
  ): Promise<ReActLLMResult> {
    const basePrompt = this.buildReActPrompt(repoId, question, symbols);
    let toolResult = '';
    for (let step = 0; step < 3; step += 1) {
      const prompt = `${basePrompt}\n${
        toolResult ? `Tool result:\n${capPrompt(toolResult, 4000)}\n` : ''
      }Reply with JSON { "answer": "..." } or { "tool": { "name": "...", "args": {...} } }.`;
      const result = await completeReAct(prompt);
      if (result.firstTokenMs !== undefined) onFirstToken?.(result.firstTokenMs);
      if (result.answer) return result;
      if (!result.tool) return { answer: 'LLM did not provide an answer.' };
      toolResult = JSON.stringify(this.executeRepoTool(repoId, result.tool));
    }
    return { answer: 'LLM did not converge to an answer after tool calls.' };
  }

  private buildReActPrompt(
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
    return capPrompt(
      `Question: ${question}\nIndexed symbols:\n${symbolLines}\nEvidence chunks:\n${chunkLines}`
    );
  }

  private executeRepoTool(
    repoId: string,
    tool: { name: string; args: Record<string, unknown> }
  ): unknown {
    switch (tool.name) {
      case 'list_symbols':
        return this.repoqa
          .listSymbols(repoId)
          .map((symbol) => `${symbol.name} ${symbol.kind}`)
          .slice(0, 100);
      case 'search_chunks':
        return this.repoqa.searchChunks(repoId, String(tool.args.q ?? '')).slice(0, 20);
      case 'find_symbol':
        return this.repoqa
          .findSymbol(repoId, String(tool.args.name ?? ''))
          .slice(0, 20);
      case 'get_call_chain':
        return this.repoqa.getCallChain(
          repoId,
          String(tool.args.filePath ?? ''),
          String(tool.args.methodName ?? '')
        );
      default:
        return { error: `unknown tool: ${tool.name}` };
    }
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
  ): Promise<RepoSymbol[]> {
    const symbols: RepoSymbol[] = [];
    for (const filePath of files.filter((file) => file.endsWith('.java'))) {
      symbols.push(...(await parseJavaFile(filePath, repoId, root)));
    }
    return symbols;
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
