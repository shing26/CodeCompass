import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
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
