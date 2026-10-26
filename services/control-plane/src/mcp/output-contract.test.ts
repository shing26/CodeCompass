import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  STATIC_ANALYSIS_BREAK_DYNAMIC,
  STATIC_ANALYSIS_BREAK_EXTERNAL,
  STATIC_ANALYSIS_BREAK_UNRESOLVED
} from '../../../../packages/contracts/src/index';
import { buildVerificationReceipt, extractEvidence } from './output-contract';

/** 真实临时目录做物理存在性校验——回执的判据是文件系统事实，不是内存断言。 */
function fixture(files: string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'output-contract-'));
  for (const file of files) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'fixture');
  }
  return root;
}

describe('extractEvidence', () => {
  it('collects anchors from nested hops with JSON paths', () => {
    const value = {
      hops: [
        { file: 'src/A.ts', line: 3, status: 'VERIFIED' },
        { filePath: 'src/B.java', lineStart: 10, status: 'BREAK' }
      ],
      note: 'plain text is ignored'
    };
    const { anchors, breakMarkers } = extractEvidence(value);
    expect(anchors).toEqual([
      { file: 'src/A.ts', line: 3, path: 'hops[0]' },
      { file: 'src/B.java', line: 10, path: 'hops[1]' }
    ]);
    expect(breakMarkers).toEqual({ BREAK: 1 });
  });

  it('counts bare string markers inside arrays and marks EXTERNAL/DYNAMIC', () => {
    const { breakMarkers } = extractEvidence({ steps: ['BREAK', 'EXTERNAL'], mode: 'DYNAMIC' });
    expect(breakMarkers).toEqual({ BREAK: 1, EXTERNAL: 1, DYNAMIC: 1 });
  });

  /* v1.5.1 票 01 — trace hop 的断口是 break:true + 整句 reason（线上真形态），
   * 不是裸枚举值。此前按等值匹配，断口最密的那类载荷反而读数为空。 */
  it('counts a real trace break hop by the marker class in its sentence reason', () => {
    const { breakMarkers } = extractEvidence({
      hops: [
        { file: 'src/A.ts', method: 'a', line: 3, break: true, reason: STATIC_ANALYSIS_BREAK_DYNAMIC },
        { file: 'src/B.ts', method: 'b', line: 9, break: true, reason: STATIC_ANALYSIS_BREAK_EXTERNAL },
        { file: 'src/C.ts', method: 'c', line: 11, break: true, reason: STATIC_ANALYSIS_BREAK_UNRESOLVED },
        // 断口可能带 HTTP 变体后缀（repoqa-callchain.ts:616）——归类不得因此失手。
        {
          file: 'src/D.ts',
          method: 'd',
          line: 13,
          break: true,
          reason: `${STATIC_ANALYSIS_BREAK_DYNAMIC} HTTP GET /api/x`
        },
        // 无 reason 的断口仍是断口：归入裸 BREAK。
        { file: 'src/E.ts', method: 'e', break: true }
      ]
    });
    expect(breakMarkers).toEqual({ DYNAMIC: 2, EXTERNAL: 1, UNRESOLVED: 1, BREAK: 1 });
  });

  it('does not count a resolved hop (no break flag) as a break marker', () => {
    const { breakMarkers } = extractEvidence({
      hops: [{ file: 'src/A.ts', method: 'a', line: 3, status: 'VERIFIED' }]
    });
    expect(breakMarkers).toEqual({});
  });
});

describe('buildVerificationReceipt', () => {
  it('returns VERIFIED when every anchor file exists under the root', async () => {
    const root = fixture(['src/A.ts']);
    const receipt = await buildVerificationReceipt({
      tool: 'codecompass_trace_call_chain',
      value: { hops: [{ file: 'src/A.ts', line: 1 }] },
      root
    });
    expect(receipt.verdict).toBe('VERIFIED');
    expect(receipt.anchorsChecked).toBe(1);
    expect(receipt.anchorsMissing).toEqual([]);
    expect(receipt.engineVersion).toBeTruthy();
  });

  it('returns ANCHORS_MISSING with path-annotated diagnostics for dead anchors', async () => {
    const root = fixture(['src/A.ts']);
    const receipt = await buildVerificationReceipt({
      tool: 'codecompass_diagnose',
      value: { layers: [{ file: 'src/A.ts' }, { file: 'src/gone.java', line: 7 }] },
      root
    });
    expect(receipt.verdict).toBe('ANCHORS_MISSING');
    expect(receipt.anchorsMissing).toEqual([
      { path: 'layers[1]', file: 'src/gone.java', line: 7 }
    ]);
    expect(receipt.diagnostics[0]).toMatchObject({
      path: 'layers[1]',
      code: 'ANCHOR_FILE_MISSING'
    });
  });

  it('returns UNCHECKED when anchors exist but no root is available', async () => {
    const receipt = await buildVerificationReceipt({
      tool: 'codecompass_trace_call_chain',
      value: { hops: [{ file: 'src/A.ts', line: 1 }] }
    });
    expect(receipt.verdict).toBe('UNCHECKED');
  });

  it('returns NO_EVIDENCE for payloads without anchors — a deterministic statement', async () => {
    const receipt = await buildVerificationReceipt({
      tool: 'codecompass_list_repos',
      value: { repos: [{ id: 'r1', status: 'ready' }] },
      root: 'X:/none'
    });
    expect(receipt.verdict).toBe('NO_EVIDENCE');
    expect(receipt.anchorsChecked).toBe(0);
  });
});
