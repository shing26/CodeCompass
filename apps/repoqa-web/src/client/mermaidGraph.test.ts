import { describe, expect, it } from 'vitest';
import {
  edgeAnnotationsForTrace,
  stripMermaidFence,
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

describe('stripMermaidFence / 围栏剥离（v1.3.x 修复）', () => {
  // 后端 diff 生成器把图包在 ```mermaid 围栏里（markdown 报告需要围栏），
  // 但 mermaid.render 不认围栏——修复前 Diff「差异图」恒走源码回退态。
  const fenced = '```mermaid\ngraph TD\n    n1["a"]\n    n2["b"]\n    n1 --> n2\n    linkStyle 0 stroke:#f7768e,stroke-width:2px;\n```';

  it('trimMermaidGraph 剥掉围栏后交到渲染链路', () => {
    const result = trimMermaidGraph(fenced, 60);
    expect(result.code).toBe(
      'graph TD\n    n1["a"]\n    n2["b"]\n    n1 --> n2\n    linkStyle 0 stroke:#f7768e,stroke-width:2px;'
    );
    expect(result.stats.totalNodes).toBe(2);
  });

  it('无围栏输入原样返回（Tour chainMermaid / LLM 生成的 mermaid）', () => {
    const bare = 'flowchart LR\n  a --> b';
    expect(trimMermaidGraph(bare, 60).code).toBe(bare);
  });

  it('stripMermaidFence 容忍无闭合围栏与裸 ``` 围栏', () => {
    expect(stripMermaidFence('```mermaid\ngraph TD')).toBe('graph TD');
    expect(stripMermaidFence('```\ngraph TD\n```')).toBe('graph TD');
    expect(stripMermaidFence('flowchart LR')).toBe('flowchart LR');
  });

  it('围栏内嵌 ``` 不会误伤（取首尾围栏）', () => {
    expect(stripMermaidFence('```mermaid\ngraph TD\n  a["x```y"]\n```')).toBe('graph TD\n  a["x```y"]');
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
