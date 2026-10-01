import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_COPY, describeError } from './errorCodes';
import { COPY_BLACKLIST } from './copyBlacklist';
import { NetworkTimeoutError } from './timeout';
import { ERROR_CODE_LIST } from '../../../../packages/contracts/src/index';

describe('v0.27-B R3: error code contract (frontend)', () => {
  it('known code → human hint carrying the original message for debugging', () => {
    const text = describeError(new ApiError('unknown session', 'chat_session_not_found', 404));
    expect(text).toContain(ERROR_COPY.chat_session_not_found);
    expect(text).toContain('原始错误：unknown session');
  });

  it('R2 NetworkTimeoutError maps through the same table', () => {
    const err = new NetworkTimeoutError('http://localhost:43110/api/repos', 15_000);
    const text = describeError(err);
    expect(text).toContain(ERROR_COPY.network_timeout);
    // P2-6：URL 不上文案
    expect(text).not.toContain('/api/repos');
  });

  it('unknown code or plain Error falls back to the raw message (no invented copy)', () => {
    expect(describeError(new ApiError('future thing', 'not_in_table'))).toBe('future thing');
    expect(describeError(new Error('plain boom'))).toBe('plain boom');
    expect(describeError('string boom')).toBe('string boom');
  });

  /* v1.2.x（Round5 跟进）— 传输层失败（Round5 实测：用户看到
     「目录选择失败：Failed to fetch」）。请求连响应都没拿到时没有 `${name} failed:`
     前缀，也没有状态码，只能匹配浏览器各家原文。 */
  it('maps every browser transport rejection to actionable Chinese', () => {
    for (const raw of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
      'Network request failed',
      'The Internet connection appears to be offline.'
    ]) {
      const text = describeError(new Error(raw));
      expect(text, raw).toContain('连不上本地服务');
      expect(text, raw).toContain('npm start');
      // 原始英文保留在后半段供本机排障（与既有 code 分支同一约定）
      expect(text, raw).toContain(raw);
    }
  });

  it('keeps connection-refused distinct from timeout (different remedy)', () => {
    const refused = describeError(new Error('Failed to fetch'));
    const timeout = describeError(new NetworkTimeoutError('http://127.0.0.1:43110/api/x', 15000));
    expect(refused).toContain('没在运行');
    expect(timeout).toContain('已挂起');
  });

  it('every table entry is non-empty Chinese guidance (copy-guard adjacent)', () => {
    // R3 review P2-2：词表读 client/copyBlacklist 权威源，与 copy-guard 同表。
    for (const [code, hint] of Object.entries(ERROR_COPY)) {
      expect(hint.length, code).toBeGreaterThan(4);
      for (const word of COPY_BLACKLIST) {
        expect(hint, `${code} contains ${word}`).not.toContain(word);
      }
    }
  });

  it('ERROR_COPY covers exactly the contracts error-code table (issue 10)', () => {
    // 编译期由 Record<ErrorCode, string> 钉死；这里做运行时镜像断言，
    // 防止有人把类型放宽回 Record<string, string> 后静默漏键。
    const copyKeys = Object.keys(ERROR_COPY).sort();
    expect(copyKeys).toEqual([...ERROR_CODE_LIST].sort());
    expect(copyKeys).toHaveLength(30);
  });
});
