# Code Review — v1.4.0（2026-10-19）

> 范围：`be2089d..9c7adfd`（42 文件改动 + 12 新文件）｜ 形态：独立 agent 只读评审（安全轴 + 契约轴），附可复现实证（tsx 直调引擎、jsdom 装载产物、CLI `parseArgs` 真跑、mermaid 11.17 dist 源码核对）｜ 裁决：**GO WITH NOTES**（0 P0 / 2 P1 / 11 P2）

## P1（已在本 tag 内修复）

| # | 问题 | 证据 | 修法 |
|---|---|---|---|
| P1-1 | mermaid `securityLevel: 'loose'` + 仓库内容进入标签 = 存储型 XSS（既有缺陷、本批扩大利用面） | `client/mermaidRenderer.ts` loose；`MermaidDiagram.tsx` `dangerouslySetInnerHTML`；mermaid 11.17 loose 跳过 DOMPurify（`chunk-DU6HZSFF.mjs:5096-5108`、`mermaid.core.mjs:1360`）；Express 路由符号名 = 源码字符串字面量原文 | 切 `strict`（点击导航是 DOM 事件代理，不依赖 mermaid 回调）；标签生成侧同步剥 `<>`（纵深防御） |
| P1-2 | 单文件 HTML 报告的两个懒加载视图实际不可用 | Sequence 源与 Story Beats JSON 被 `escapeHtml` 写进 `<script type="text/plain">` / `<script type="application/json">`——script 是 raw-text，实体不解码；jsdom 实证 `JSON.parse` 首行抛、Sequence 拿到 `P0-&gt;&gt;P1` | Sequence 源改 `<textarea hidden readonly>`（RCDATA）；Beats JSON 只把 `<` 转成 `\u003c`；补结构级测试 |

## P2（9 条已修 / 2 条登记）

| # | 问题 | 处置 |
|---|---|---|
| P2-1 | CLI `--output --file x` 吞旗标、`-f --up` 取错值、纯空白 `-f` 静默降级 | ✅ 修复：`nextValue` 拒绝 `-` 开头值（内联 `--flag=value` 逃生）；`-f` trim 校验 |
| P2-2 | 片段报文 100kb 全局解析器先于 100KB 源码检查拒绝，给错错误码 | ✅ 修复：`/api/snippets/graph` 前置 1MB JSON 解析；引擎字节上限照旧 |
| P2-3 | 新出库面只掩码 mermaid 文本，未按既有 `maskEventPayload` 整包掩码 | ✅ 修复：整包 `maskEventPayload` |
| P2-4 | 示例项目每次点击无条件覆盖用户修改 | ✅ 修复：内容哈希 stamp（落在索引目录外），内容未变不重写；补测试 |
| P2-5 | `sampleFileTarget` 只做词法越界检查，不解析符号链接 | ⏸ 登记（前提：本机用户已能写 dataDir 且自造软链） |
| P2-6 | HTML 导出用 Host 头造深链，绕过 `cockpitBaseUrl` 单一权威 | ✅ 修复：`baseUrl: cockpitBaseUrl()` |
| P2-7 | `decodeURIComponent` 畸形转义抛异常 | ✅ 修复：try/catch 回落原文 |
| P2-8 | 子图返回轨迹只存名字，跨出半径后文件路径落空 | ✅ 修复：轨迹存 `{name,file,line}`，缺文件时不打开编辑器 |
| P2-9 | 跨源下 `x-artifact-warning` 不可读 | ✅ 修复：CORS `Access-Control-Expose-Headers` |
| P2-10 | `ParsedDeepLink` 重复声明（声明合并）；4 处换行被吞 | ◐ 重复声明已清；换行格式卫生登记 |
| P2-11 | trace 深度触底节点被误标 `shown-above` | ✅ 修复：仅子树真展开过才标注 |

## 误报说明（已核查、非缺陷）

- 示例端点双击无索引竞态（`upsertByLocalPath` → `updateRepoStatus` 之间无 await，进程内单线程）。
- 片段截断不产生悬空边（边按 `kept` 双端过滤，`droppedNodes` 计算正确）。
- `--up 06` 被拒正确（6 > 5）。
- 聚合节点无入边出边，不可能拖出悬空边。
- `readSnippet` 的路径拼接未引入新的越界面（file 来自索引、root 来自仓库行）。

## 未验证/边界

- 评审未覆盖真实 chromium 渲染（P1-1 的 strict 切换已由单测与构建覆盖，语义由 mermaid 源码确证；UI 级冒烟建议在发布前补跑 `scripts/smoke/ui_smoke.mjs`）。
- CORS 通配为既有本机形态（README 已声明控制面无鉴权、默认 loopback），不属本批引入。
