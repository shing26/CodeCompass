import type { RepoSymbol } from './ingest/repoqa-repos';
import type { SymbolIndex } from './engine/repoqa-callchain';
import type { DiagnoseResult } from '../../../packages/contracts/src/index';
import { runDiagnose } from './diagnose-engine';
import { renderArtifactHtml, deriveBadges } from './export-artifact';

/**
 * v1.4 票 07 — one shared "diagnose result → single-file HTML report" builder.
 *
 * The CLI (`codecompass export`) and the Web endpoint
 * (`GET /api/repos/:id/export/html`) must produce the same artifact from the
 * same engine result; keeping the template assembly in two places is how the
 * two surfaces drift apart. Ordering here is fixed: diagnose first, then
 * render — never the other way around.
 */

export interface DiagnoseArtifactInput {
  repoId: string;
  repoName: string;
  entrySymbol: string;
  symbols: RepoSymbol[];
  index: SymbolIndex;
  /** Cockpit base URL for the deep link inside the report. */
  baseUrl: string;
  /** Repo root enabling code snippets in chain steps. */
  snippetRoot?: string;
  /** v1.5 票 03 — 锚点所属 commit（repo.commit），写进工件的重放校验块。 */
  commit?: string;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface DiagnoseArtifact {
  html: string;
  traceId: string;
  result: DiagnoseResult;
}

/** Deterministic mermaid flowchart of a diagnose chain (BROKEN steps red). */
export function chainMermaid(result: DiagnoseResult): string {
  const lines = ['flowchart LR'];
  result.verifiedChain.forEach((step, i) => {
    const label = `${step.layer}: ${step.symbol}`;
    lines.push(
      `  n${i}["${label.replace(/"/g, "'")}"]${step.status === 'BROKEN' ? ':::broken' : ''}`
    );
    if (i > 0) lines.push(`  n${i - 1} --> n${i}`);
  });
  lines.push('  classDef broken stroke:#f7768e,stroke-width:2px,color:#f7768e;');
  return lines.join('\n');
}

/** Deterministic sequence diagram of a diagnose chain (v0.9 Sequence view). */
export function chainSequence(result: DiagnoseResult): string {
  const lines = ['sequenceDiagram'];
  result.verifiedChain.forEach((step, i) => {
    const pid = `P${i}`;
    lines.push(`  participant ${pid} as ${step.symbol} (${step.layer})`);
    if (i > 0) {
      lines.push(`  P${i - 1}->>${pid}: ${step.status === 'BROKEN' ? 'broken call' : 'call'}`);
    }
    if (step.status === 'BROKEN') {
      lines.push(`  Note over ${pid}: ${step.diagnosticNotes ?? 'static analysis break'}`);
    }
  });
  return lines.join('\n');
}

export function buildDiagnoseArtifact(input: DiagnoseArtifactInput): DiagnoseArtifact {
  const result = runDiagnose({
    repoId: input.repoId,
    entrySymbol: input.entrySymbol,
    symbols: input.symbols,
    index: input.index,
    baseUrl: input.baseUrl,
    snippetRoot: input.snippetRoot
  });
  const chainText = result.verifiedChain
    .map(
      (step, i) =>
        `${i + 1}. [${step.status}] ${step.layer} ${step.symbol} — ${step.filePath}:${step.line}` +
        (step.diagnosticNotes ? `\n   ${step.diagnosticNotes}` : '')
    )
    .join('\n');
  const html = renderArtifactHtml({
    title: `Diagnose: ${result.entrySymbol}`,
    repoName: input.repoName,
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
    mermaid: chainMermaid(result),
    sequence: chainSequence(result),
    // CONTEXT.md: badges are dependency/config keyword evidence, not
    // decoration — feed indexed dependency/config symbol names only.
    badges: deriveBadges(
      input.symbols
        .filter((symbol) => symbol.kind === 'dependency' || symbol.kind === 'config')
        .map((symbol) => symbol.name)
        .join(' ')
    ),
    storyBeats: result.verifiedChain.map((step, i) => ({
      label: `Step ${i + 1}: ${step.layer} ${step.symbol}`,
      detail:
        `${step.status} — ${step.filePath}:${step.line}` +
        (step.diagnosticNotes ? ` — ${step.diagnosticNotes}` : ''),
      ...(step.codeSnippet ? { code: step.codeSnippet } : {})
    })),
    summary: result.rootCauseSummary,
    deepLink: result.cockpitDeepLink,
    replay: {
      repoId: input.repoId,
      ...(input.commit ? { commit: input.commit } : {}),
      command: `codecompass export "${input.entrySymbol}"`
    },
    sections: [
      { heading: 'Chain', body: chainText, kind: 'code' },
      ...result.verifiedChain
        .filter((step) => step.codeSnippet)
        .slice(0, 4)
        .map((step) => ({
          heading: `${step.symbol} (${step.filePath}:${step.line})`,
          body: step.codeSnippet!,
          kind: 'code' as const
        }))
    ]
  });
  return { html, traceId: result.traceId, result };
}
