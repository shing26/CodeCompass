import { describe, expect, it } from 'vitest';
import type { RepoSymbol } from './repoqa-repos';
import { WorkerDiagram } from './worker-diagram';
import type { DiagramSession } from './worker-helpers';

/**
 * V27-30 (B3 increment 3) — direct contract pins for the diagram
 * collaborator extracted out of RepoQAWorker. The worker suites cover these
 * paths through SSE streams; these tests pin the ADR-0013 invariants at the
 * unit boundary so future moves cannot silently relax them.
 */

function makeRepoSymbol(partial: Partial<RepoSymbol>): RepoSymbol {
  return {
    id: 1,
    repoId: 'r1',
    kind: 'method',
    name: 'm',
    filePath: 'a.ts',
    lineStart: 1,
    lineEnd: 3,
    signature: null,
    calls: null,
    ...partial
  } as RepoSymbol;
}

function newDiagram(): WorkerDiagram {
  return new WorkerDiagram({
    symbolIndexFor: () => ({ callers: new Map(), callees: new Map() } as never),
    findStartSymbol: (question, symbols) => symbols.find((s) => s.name === question)
  });
}

describe('WorkerDiagram (B3-3 extraction pins)', () => {
  it('traceToMermaid: deterministic chain with click bindings and annotation filtering', () => {
    const mermaid = newDiagram().traceToMermaid(
      [
        { file: 'a.ts', line: 1, method: 'A' },
        { file: 'b.ts', line: 2, method: 'B' },
        { file: 'c.ts', line: 3, method: 'C', break: true, reason: 'reflection' }
      ],
      'A',
      { A: 'entry', NoSuchNode: 'dropped' }
    );
    expect(mermaid.split('\n')[0]).toBe('flowchart LR');
    expect(mermaid).toContain('A[A] --> B[B]');
    expect(mermaid).toContain('B[B] -->|reflection| C[C]');
    expect(mermaid).toContain('click C "code://c.ts#3"');
    expect(mermaid).toContain('%% note A: entry');
    expect(mermaid).not.toContain('NoSuchNode'); // annotations only on real nodes
  });

  it('renderLayerInstruction(call_chain): any failed tool voids the diagram (ADR-0013)', () => {
    const diagram = newDiagram();
    const session: DiagramSession = { edges: [], failedTools: new Set(['call_chain']) };
    diagram.harvestDiagramSession(session, 'call_chain', { error: 'boom' });
    expect(
      diagram.renderLayerInstruction(
        { kind: 'call_chain', focus: ['A'] },
        { id: 'r1', name: 'repo' },
        [makeRepoSymbol({ name: 'A' })],
        session
      )
    ).toBeUndefined();
  });

  it('renderLayerInstruction(config_topo): focus matching nothing renders nothing, never full topology', () => {
    const diagram = newDiagram();
    const symbols = [makeRepoSymbol({ kind: 'config', name: 'server.port', filePath: 'app.yml' })];
    const session: DiagramSession = { edges: [], failedTools: new Set() };
    const out = diagram.renderLayerInstruction(
      { kind: 'config_topo', focus: ['no.such.key'] },
      { id: 'r1', name: 'repo' },
      symbols,
      session
    );
    expect(out).toBeUndefined();
    const hit = diagram.renderLayerInstruction(
      { kind: 'config_topo', focus: ['server.port'] },
      { id: 'r1', name: 'repo' },
      symbols,
      session
    );
    expect(hit).toContain('server_port');
    expect(hit).toContain('code://app.yml#1');
  });

  it('collectSessionEdges: counts rows and follows verifiedChain; skips malformed rows', () => {
    const diagram = newDiagram();
    const edges: { file: string; method: string; line: number }[] = [];
    expect(
      diagram.collectSessionEdges(
        [
          { file: 'a.ts', method: 'A', line: 2.7 },
          { nofile: true },
          { file: 'b.ts', symbol: 'B', line: 0 }
        ],
        edges
      )
    ).toBe(1);
    expect(edges[0]).toEqual({ file: 'a.ts', method: 'A', line: 2 });
    expect(
      diagram.collectSessionEdges({ verifiedChain: [{ file: 'c.ts', method: 'C', line: 3 }] }, edges)
    ).toBe(1);
    expect(edges).toHaveLength(2);
  });
});
