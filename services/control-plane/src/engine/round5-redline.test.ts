import { describe, expect, it } from 'vitest';
import { buildCallIndex, resolveCallChain } from './repoqa-callchain';
import { buildDashboard } from './repoqa-dashboard';
import { runScan } from '../scan-engine';
import { normalizeCitationMarkers } from '../chat/agent';
import type { RepoSymbol } from '../ingest/repoqa-repos';

/**
 * v1.2.x（Round5 红线 ①②③）——回归锁。
 *
 * 修前 `effectiveStart` 末行是 `symbols.find(s => s.kind === 'method')`：入口无法
 * 静态起始时取「仓库里第一个方法符号」当链路起点。自仓 64 个 route 符号只有 6 个
 * 带 calls，其余 58 个（91%）全部返回同一条伪造链
 * `AnswerBody (VERIFIED) → useState (BROKEN)`——一个与被请求路由毫无关系的前端
 * React 组件，却同时污染 MCP diagnose / trace_call_chain、仪表盘 Top API 的 hops、
 * 体检 deepChains 桶与 CLI。
 *
 * **这些用例在修前是红的**（本仓 785 项存量测试无一覆盖该路径——这是它们全绿的
 * 真正原因，不是「修后仍然正确」）。断言基准独立于被测源：符号表在此显式构造，
 * 不从索引读、不复用引擎自己的排序结果。
 */

function route(name: string, calls: Array<{ method: string; file: string; line: number }>): RepoSymbol {
  return {
    symbolId: `${name}#route`,
    name,
    kind: 'route',
    filePath: 'services/control-plane/src/routes/x.ts',
    lineStart: 10,
    lineEnd: 20,
    calls
  } as unknown as RepoSymbol;
}

function method(name: string, filePath: string, line: number, calls: Array<{ method: string; file: string; line: number }> = []): RepoSymbol {
  return {
    symbolId: `${name}#${filePath}:${line}`,
    name,
    kind: 'method',
    filePath,
    lineStart: line,
    lineEnd: line + 3,
    calls
  } as unknown as RepoSymbol;
}

describe('Round5 红线 ① — 入口无法静态起始时不猜链路', () => {
  // 「无关的」第一个方法符号：修前它会被无端端上链并标 VERIFIED。
  const decoy = method('AnswerBody', 'apps/repoqa-web/src/components/ChatView.tsx', 198, [
    { method: 'useState', file: 'apps/repoqa-web/src/components/ChatView.tsx', line: 209 }
  ]);
  // 真正的目标路由：Express 内联处理体，静态图谱没有它的出边。
  const emptyRoute = route('GET /api/repos', []);

  it('returns an empty chain instead of borrowing the first method in the repo', () => {
    const trace = resolveCallChain([decoy, emptyRoute], emptyRoute, 6);
    expect(trace).toEqual([]);
    expect(trace.some((hop) => hop.method === 'AnswerBody')).toBe(false);
  });

  it('leaves a real chain untouched (the fix is not "give up on tracing")', () => {
    const leaf = method('helper', 'services/control-plane/src/ingest/x.ts', 50);
    const entry = method('runScan', 'services/control-plane/src/scan-engine.ts', 193, [
      { method: 'helper', file: 'services/control-plane/src/ingest/x.ts', line: 52 }
    ]);
    const trace = resolveCallChain([decoy, entry, leaf], entry, 6);
    expect(trace.map((hop) => hop.method)).toEqual(['runScan', 'helper']);
  });

  it('dashboard still lists the entry (it is a true fact) but with an empty hop list', () => {
    const dashboard = buildDashboard({
      repoId: 'repo-1',
      repoName: 'demo',
      symbols: [decoy, emptyRoute]
    });
    const entry = dashboard.topApis.find((a) => a.name === 'GET /api/repos');
    expect(entry).toBeDefined();
    expect(entry!.hops).toEqual([]);
    expect(entry!.depth).toBe(0);
  });

  it('scan deepChains stays empty and its note explains why (no false "all clear")', () => {
    const symbols = [decoy, emptyRoute];
    const scan = runScan({
      repoId: 'repo-1',
      repoName: 'demo',
      symbols,
      index: buildCallIndex(symbols),
      baseUrl: 'http://127.0.0.1:43110'
    });
    const bucket = scan.buckets.find((b) => b.id === 'deepChains')!;
    expect(bucket.items).toHaveLength(0);
    expect(bucket.note ?? '').toMatch(/Empty is usually a data boundary/);
  });
});

describe('Round5 红线 ③ — 引用标记归一（换供应商暴露的协议脆弱性）', () => {
  it('rewrites every observed model variant to the single canonical form', () => {
    expect(normalizeCitationMarkers('事实【2】在此')).toBe('事实[cite:2]在此');
    expect(normalizeCitationMarkers('事实[^2]在此')).toBe('事实[cite:2]在此');
    expect(normalizeCitationMarkers('事实[2]在此')).toBe('事实[cite:2]在此');
    expect(normalizeCitationMarkers('事实 [cite: 2] 在此')).toBe('事实 [cite:2] 在此');
    expect(normalizeCitationMarkers('事实（cite: 2）在此')).toBe('事实[cite:2]在此');
  });

  it('leaves the canonical form and ordinary markdown alone', () => {
    expect(normalizeCitationMarkers('已有 [cite:3] 不变')).toBe('已有 [cite:3] 不变');
    // markdown 链接含文字与 URL，不是裸数字引用——不得被改写
    expect(normalizeCitationMarkers('见 [ADR-0018](docs/adr/)')).toBe('见 [ADR-0018](docs/adr/)');
    expect(normalizeCitationMarkers('数组 a[0] 与 b[12]')).toBe('数组 a[0] 与 b[12]');
  });
});
