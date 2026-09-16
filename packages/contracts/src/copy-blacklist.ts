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
 *
 * 本表只装中文退役词（全文扫、含注释）。英文 chrome 词禁入——Watcher/
 * Evolution 之类与代码标识符同形，全文扫=全仓自燃；英文词走下方
 * USER_COPY_ENGLISH_RETIRED（区域扫），两表不同物勿合并（G8 终核）。
 */
export const USER_COPY_BLACKLIST: readonly string[] = [
  '推演卡',
  '拆除计划',
  '约定冲突',
  '架构指标',
  '智能体对话',
  '读侧',
  '写侧',
  // v0.30 G5 表 B 退役批（销词同 commit 纪律，双端扫描根全文扫）
  '惯例嗅探',
  '演进推演',
  '落位',
  '锚定',
  '波及',
  '孤岛',
  '工件',
  '拓扑收敛',
  '图谱投射',
  '意图解析',
  '跨语言桥接',
  'AST 提取',
  '解析 AST',
  '2-Hop',
  '物理锚点'
];

/**
 * v0.30 票 01 增补（review P2-4）——英文 chrome 退役词表（D8 第二层）。
 * 判据是「用户文案区域」（字符串字面量 / JSX 文本节点），非全文：
 * 同形标识符免疫由区域收集保证。web copy-guard 与 cp 服务端哨共读本表，
 * 杜绝英文层复刻中文层曾治过的「双表分叉」病。
 * 词面 G3 起随退役填入（整词直写：本包在扫描根外）。
 * 不收录清单：「Agent 上下文」markdown 导出（ArchitectureDeltaView/CiGateView
 * 复制给 IDE agent 的机器面，英文属契约）与内部枚举/标识符（role 值
 * 'Caller' 等，展示层已映中文）。
 */
export const USER_COPY_ENGLISH_RETIRED: readonly string[] = [
  'Watcher',
  'Import repo',
  'Import or clone repo',
  'Import source',
  'Select a repo',
  'Choose a repo',
  'Loading repos',
  'Loading file',
  'Loading tours',
  'Loading dashboard',
  'Loading',
  'No tours available',
  'Quick Tours',
  'More Tours',
  'Hide More Tours',
  'No file open',
  'Click a diagram node',
  'Tech Stack',
  'Architecture Scale',
  'Config Topology',
  'Symbols',
  'Collapse',
  'Expand',
  'Source trace',
  'Base ref',
  'Head ref',
  'Git URL',
  'Cancel',
  'Cloning',
  'Importing',
  'Clone & import',
  'Indexing',
  'Workbench views',
  'Rules Masked',
  'Clean',
  'Cyber',
  'Step'
];
