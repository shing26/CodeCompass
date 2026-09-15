import { describe, expect, it } from 'vitest';
import { STATUS_LABEL, statusLabel } from './statusLabel';

/**
 * v0.30 票 04——表 C 映射哨：钉死展示文案，并保证契约值本体绝不进本表语义
 * （未知值透传，前端永不吞渲染）。
 */
describe('statusLabel (v0.30 ticket 04, table C)', () => {
  it('maps every machine enum surfaced to a human badge', () => {
    expect(statusLabel('VERIFIED')).toBe('已验证');
    expect(statusLabel('BREAK')).toBe('断链');
    expect(statusLabel('SUSPECT')).toBe('存疑');
    expect(statusLabel('PASS')).toBe('通过');
    expect(statusLabel('FAIL')).toBe('未通过');
    expect(statusLabel('BROKEN')).toBe('断链');
    expect(statusLabel('LOW')).toBe('低风险');
    expect(statusLabel('MEDIUM')).toBe('中风险');
    expect(statusLabel('HIGH')).toBe('高风险');
    expect(statusLabel('EXTEND')).toBe('扩展挂载');
    expect(statusLabel('DEPRECATE')).toBe('安全下线');
    expect(statusLabel('CONTROLLER')).toBe('控制器');
    expect(statusLabel('SERVICE')).toBe('服务');
    expect(statusLabel('ENTITY')).toBe('实体');
  });

  it('passes unknown values through (safe degradation, never blank)', () => {
    expect(statusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(statusLabel('')).toBe('');
  });

  it('the label set itself contains no retired blacklist word', () => {
    // 表 C 新词自检：映射值不得含 v0.30 退役中文词。拆分构造防自燃
    // （本文件在 copy-guard 全文扫射程内，整词字面量=当场命中）。
    const retired = ['波' + '及', '落' + '位', '锚' + '定', '孤' + '岛', '工' + '件', '推' + '演', '嗅' + '探', '架构' + '指标'];
    for (const label of Object.values(STATUS_LABEL)) {
      for (const word of retired) expect(label).not.toContain(word);
    }
  });
});
