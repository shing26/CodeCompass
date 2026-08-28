import { describe, expect, it } from 'vitest';
import { trimMermaidGraph } from './mermaidGraph';

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
