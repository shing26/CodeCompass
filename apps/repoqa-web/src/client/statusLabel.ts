/**
 * v0.30 票 04（表 C，grill D4）——机器枚举值 → 展示层人话标签。
 *
 * 铁律：payload/SSE/MCP 的契约值一律不动，本表只是「进用户眼睛前最后一步」
 * 的显示映射；未知值原样透传（安全降级，绝不吞渲染）。与 closeout gate 的
 * VERIFIED/BREAK/SUSPECT marker 判定零冲突（哨看 payload，本表只喂 JSX 文本）。
 */
export const STATUS_LABEL: Readonly<Record<string, string>> = {
  VERIFIED: '已验证',
  BREAK: '断链',
  SUSPECT: '存疑',
  PASS: '通过',
  FAIL: '未通过',
  BROKEN: '断链',
  LOW: '低风险',
  MEDIUM: '中风险',
  HIGH: '高风险',
  EXTEND: '扩展挂载',
  DEPRECATE: '安全下线',
  CREATE: '新增',
  MODIFY: '修改',
  DELETE: '删除',
  CONTROLLER: '控制器',
  SERVICE: '服务',
  ENTITY: '实体',
  // v1.2 票 08（R4-7）— 雷达枢纽 role 的第三个规范值，此前原样透传英文。
  DATA_MAPPER: '数据映射',
  return_wrapping: '返回值包装',
  interface_impl_style: '接口实现风格',
  base_class: '基类约定',
  di_style: '依赖注入风格',
  package_layout: '包结构布局',
  'injection-cycle': '注入环',
  impl: '实现',
  single: '单文件',
  interface: '接口',
  // v1.2 票 02 — 体检五桶（引擎 title 是英文句子，展示层只用本映射；
  // 「零静态调用者」是事实陈述，禁「死代码/可安全删除」类语义判断——v0.21 红线）。
  orphanedPublic: '零静态调用者',
  hubs: '变更影响枢纽',
  oversized: '超大方法',
  deepChains: '深调用链',
  oversizedFiles: '超大文件',
  // v1.2.x（R4-14）— chunk 类型展示映射：检索命中的徽章曾恒显「readme」
  // （.md 结构化切分后全部入 readme 型），用户无法区分文档片段与代码注释。
  readme: '文档',
  docstring: '代码注释'
};

export function statusLabel(value: string): string {
  return STATUS_LABEL[value] ?? value;
}
