---
status: accepted
---

# 工件浏览器验收：只回答「能不能用」，不冒充「对不对」

## 背景

- v1.5 把「交付也可验证」做到了 MCP 返回体（verification 回执），但**单文件 HTML 工件**
  仍是唯一没有浏览器门的交付物：门禁最深处是字符串断言——
  `scripts/e2e/closeout_gate.py:1794-1802`（`"mermaid" in content` + `<!DOCTYPE html>`）、
  同文件 `:1900-1904`（v0.9 多视图断言）、`export-artifact.test.ts` 全为 `toContain`。
- v1.4 的两条 P1 都是浏览器层事故：mermaid `loose` → `strict`（存储型 XSS）、
  Sequence/Story Beats 把转义写进 raw-text `<script>` 导致**实际不可用**。
  两条都是人工评审发现的，不是门发现的。
- 外部参考：archify 的 `finalize` 回执声称四门全过（validate / deliver / strict check /
  真实浏览器 browser-check），非零退出永不算成功。本批只借门的形态与回执纪律，
  不借其图型 DSL、渲染器与交付锁。
- 本批立项时用四份 fixture 复核缺口（`scripts/smoke/make-artifact-fixtures.mjs`）：
  good 与三份 bad（残缺 mermaid / 删懒渲染脚本 / 删演播带脚本）在旧门下**全部为绿**，
  在真实 Chromium 里三份 bad 分别表现为语法错误图、切页无图、步进死。

## 决定

1. **门的回答边界**：可渲染 / 可交互 / 无运行时错误 / 无外部依赖 = 门的问题；
   **正文语义是否正确不是**（锚点是否真实存在、结论是否正确由引擎测试与 v1.5 回执负责）。
   门与回执都不得出现「工件正确」这类结论句。
2. **fail-closed 三态退出码**：`0=PASS / 1=FAIL / 2=UNCHECKED`。无 playwright、浏览器起不来、
   超时、工件读不到、内部错误一律 UNCHECKED；**UNCHECKED 永不算成功**，release / README /
   发布说明都不得把 2 当绿。
3. **门在脚本层，不进 `codecompass export`**：playwright 不得成为 CLI 的运行时依赖。
   门只在 release 跑（chromium 复用 UI smoke 已装版本）；CI 不跑（安装成本约 350MB，
   e2e 保持纯进程级）。这是成本裁决，改判需要新 ADR。
4. **回执写旁车、不写进工件**：`<artifact>.browser-check.json`（schema
   `codecompass/artifact-browser-check@1`），工件字节不变、可继续 sha256 归档；
   回执随 release 资产发布，让「可校验的交付」跟工件一起走。
   与 v1.5 的 `VerificationReceipt` 同族但**不复用类型**：前者是返回体锚点事实，
   后者是工件 DOM 事实，合并会让两个消费者互相误读。
5. **门与工件同源演进**：被检节点用 `data-check` 钩子（视图 / 图容器 / 演播带 / 深链 /
   重放 / CDN 回退标记），CSS 类名只作回退；工件模板、内联方式、CSP 变化时检查项必须同步。
   禁止门落后于模板——落后会让检查静默变 SKIPPED，那比红更糟。release 工件以
   `--require-full` 跑：任何 SKIPPED 直接判 `CHECK_SKIPPED`，模板声称有图但 DOM 无可见容器判
   `DIAGRAM_TARGET_MISSING`（2026-10-27 双轴评审 Standards 轴 P1 的落地；本地单跑保留真实 N/A 的 SKIPPED）。
6. **已知边界**：门不证明工件在任何浏览器、任何网络条件下都可用；回执只陈述
   「chromium headless + 离线 + file:// 这一次观测」。这是刻意的窄声称。

## 后果

- 每次 release 增加一次浏览器启动（本机实测单工件 1.8–2.0s，远低于 15s 预算）与一份旁车资产；
  e2e 断言数与 CI 时间不变。
- 工件模板新增 `data-check` 属性（字节变化，无语义变化）；单测只增断言。
- 门红时先修工件；不得靠放宽阈值（`>4px`、10s）或加 SKIP 换绿——阈值是事故下限，不是质量目标。
- 将来若工件加 CSP/SRI、改内联方式或换渲染器，本 ADR 决定 5 会先以 FAIL/UNCHECKED 暴露，
  而不是静默通过。
