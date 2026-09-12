/**
 * v0.27-B R3（review P2-2）—— 文案黑名单权威词表，copy-guard 与 errorCodes
 * 自查共读这一张（此前两表分叉：自查抄漏两词=静默漂移的第二事实源）。
 * 全部拆分构造：本文件会被 copy-guard 全文扫描，整词字面量=当场自燃。
 * 增删词只动这里；语义见 copy-guard.test.ts 头注与 v0.26-A spec 验收门 1。
 */
export const COPY_BLACKLIST: readonly string[] = [
  '推演' + '卡',
  '拆除' + '计划',
  '约定' + '冲突',
  '架构' + '指标',
  '智能体' + '对话',
  '读' + '侧',
  '写' + '侧'
];
