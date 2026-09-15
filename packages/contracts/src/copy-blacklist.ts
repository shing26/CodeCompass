/**
 * v0.30 去极客化票 01（grill D8）——用户文案黑名单**跨包共享权威词表**。
 *
 * 双哨同表：web 侧 copy-guard 全文扫（经 client/copyBlacklist 桥）、控制面
 * copy-guard.server.test.ts 直读此表。v0.27-B R3 教训「两表分叉=静默漂移的
 * 第二事实源」自本票跨包生效。
 *
 * 词面此处允许整词书写：本包在两座哨的扫描根（apps/repoqa-web/src 与
 * services/control-plane/src）之外，无自燃通道。
 * 增词纪律（v030 spec 表 D）：词进入本表的同一 commit，其最后一处用户可见
 * 直出必须已被移除——改文案与改哨同 commit。
 */
export const USER_COPY_BLACKLIST: readonly string[] = [
  '推演卡',
  '拆除计划',
  '约定冲突',
  '架构指标',
  '智能体对话',
  '读侧',
  '写侧'
];
