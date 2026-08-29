import { describe, expect, it } from 'vitest';
import {
  edgeAnnotationsForTrace,
  escapeMermaidLabel,
  trimMermaidGraph,
  type TraceHopView
} from './mermaidGraph';

function graph(nodeCount: number): string {
  const lines = ['flowchart LR'];
  for (let i = 1; i < nodeCount; i += 1) {
    lines.push(`  n${i}[node ${i}] --> n${i + 1}[node ${i + 1}]`);
  }
  lines.push('  click n1 "code://src/a.java#1"');
  return lines.join('\n');
}

describe('trimMermaidGraph (v0.7)', () => {
  it('leaves small graphs untouched', () => {
    const code = graph(10);
    const result = trimMermaidGraph(code, 60);
    expect(result.code).toBe(code);
    expect(result.stats).toEqual({
      totalNodes: 10,
      shownNodes: 10,
      hiddenNodes: 0,
      collapsedEdges: 0
    });
  });

  it('caps nodes, drops out-of-cap edges and appends an aggregate node', () => {
    const result = trimMermaidGraph(graph(120), 60);
    expect(result.stats.totalNodes).toBe(120);
    expect(result.stats.hiddenNodes).toBe(60);
    expect(result.stats.shownNodes).toBe(61); // kept 60 + aggregate
    expect(result.code).toContain('ccx_aggregate');
    expect(result.code).toContain('⋯ +60 已聚合');
    // Kept edges survive; beyond-cap edges are collapsed.
    expect(result.code).toContain('n1[node 1] --> n2[node 2]');
    expect(result.code).not.toContain('n119[node 119] -->');
    // Click bindings for dropped nodes are removed, kept ones survive.
    expect(result.code).toContain('click n1');
    expect(result.code).not.toContain('click n119');
    expect(result.stats.collapsedEdges).toBeGreaterThan(0);
  });
});

describe('escapeMermaidLabel (v0.10 Stage 1)', () => {
  it('neutralizes bracket and quote characters that terminate mermaid labels', () => {
    expect(escapeMermaidLabel('OwnerController')).toBe('OwnerController');
    expect(escapeMermaidLabel('PostController#like')).toBe('PostController#like');
    expect(escapeMermaidLabel('find(owner)')).toBe('find(owner)');
    expect(escapeMermaidLabel('a[b]')).toBe('a(b)');
    expect(escapeMermaidLabel('a"b')).toBe("a'b");
    expect(escapeMermaidLabel('中文路径')).toBe('中文路径');
  });
});

describe('edgeAnnotationsForTrace (v0.10 Stage 1)', () => {
  const hop = (partial: Partial<TraceHopView>): TraceHopView => ({
    symbol: 'noop',
    status: 'VERIFIED',
    ...partial
  });

  it('derives an edge view for every hop transition', () => {
    const trace = [
      hop({ symbol: 'A' }),
      hop({ symbol: 'B', status: 'BROKEN' }),
      hop({ symbol: 'C', httpMethod: 'POST' }),
      hop({ symbol: 'D', async: true })
    ];
    expect(edgeAnnotationsForTrace(trace)).toEqual([
      { broken: true },
      { broken: false, httpMethod: 'POST' },
      { broken: false, async: true }
    ]);
  });

  it('returns an empty list for fewer than two hops', () => {
    expect(edgeAnnotationsForTrace([])).toEqual([]);
    expect(edgeAnnotationsForTrace([hop({ symbol: 'A' })])).toEqual([]);
  });

  it('keeps a plain verified edge free of semantic flags', () => {
    const trace = [hop({ symbol: 'A' }), hop({ symbol: 'B' })];
    expect(edgeAnnotationsForTrace(trace)).toEqual([{ broken: false }]);
  });
});
