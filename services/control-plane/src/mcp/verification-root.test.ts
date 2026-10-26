import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { receiptRootFromRepoPath } from './repoqa-mcp';

/**
 * v1.6.1 票 01（评审 L3）— 回执的仓库根不得替调用方猜。
 * 只有 codecompass_get_pr_impact 声明了 repoPath；其余工具拿到同名参数必须忽略，
 * 否则任意路径都能改写锚点校验的基准。
 */
describe('receiptRootFromRepoPath', () => {
  it('accepts repoPath for get_pr_impact — the only tool that declares it', () => {
    expect(receiptRootFromRepoPath('codecompass_get_pr_impact', { repoPath: 'D:/repos/demo' })).toBe(
      path.resolve('D:/repos/demo')
    );
  });

  it('ignores repoPath on every other tool', () => {
    for (const tool of ['codecompass_scan', 'codecompass_trace_call_chain', 'codecompass_diagnose']) {
      expect(receiptRootFromRepoPath(tool, { repoPath: 'D:/repos/elsewhere' })).toBeUndefined();
    }
  });

  it('returns undefined for missing, blank or non-string repoPath', () => {
    expect(receiptRootFromRepoPath('codecompass_get_pr_impact', {})).toBeUndefined();
    expect(receiptRootFromRepoPath('codecompass_get_pr_impact', { repoPath: '   ' })).toBeUndefined();
    expect(receiptRootFromRepoPath('codecompass_get_pr_impact', { repoPath: 42 })).toBeUndefined();
  });
});
