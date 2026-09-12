import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_COPY, describeError } from './errorCodes';
import { COPY_BLACKLIST } from './copyBlacklist';
import { NetworkTimeoutError } from './timeout';

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

  it('every table entry is non-empty Chinese guidance (copy-guard adjacent)', () => {
    // R3 review P2-2：词表读 client/copyBlacklist 权威源，与 copy-guard 同表。
    for (const [code, hint] of Object.entries(ERROR_COPY)) {
      expect(hint.length, code).toBeGreaterThan(4);
      for (const word of COPY_BLACKLIST) {
        expect(hint, `${code} contains ${word}`).not.toContain(word);
      }
    }
  });
});
