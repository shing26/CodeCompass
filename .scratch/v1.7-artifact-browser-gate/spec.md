# v1.7 — 工件浏览器验收（Artifact Browser Gate）

Status: done（2026-10-26 收口；立项裁决：全部默认——CI 不跑、回执随 release 资产、ADR-0023 / v1.7.0）

## 定位（ADR-0021 通道 A 论证）

本批回答的误报类别：**「交付成功」是未经浏览器验证的断言**——工具/CI/发布页说「工件已生成」，
读者打开却白屏、图不出现、切页无反应、Story Beats 点了不动。它不涉及代码关系主张，但属于
同一条红线：v1.3「让工具停止编造」、v1.5「交付也可验证」都只覆盖到工具返回体或字符串断言，
而**唯一离开引擎环境、直达读者桌面的交付物（单文件 HTML 工件）至今没有任何一道浏览器门**。

- **不是产品面扩张**：无新 MCP 工具，17 个 `codecompass_*` 工具输入签名与返回体结构零变化
  （ADR-0020/0021）；无新 Web 面。产出 = 一个本地脚本 + 一份旁车回执 + release 流程里的一步。
- **证据（事故驱动）**：
  - v1.4 两条 P1 都是浏览器层事故：① mermaid `loose` → `strict`（存储型 XSS）；
    ② Sequence/Story Beats 把转义写进 raw-text `<script>`，**功能实际不可用**却全部门禁绿
    （HANDOFF v1.4 段、`docs/reports/code-review-2026-10-19.md`）。
  - 现有最深断言是字符串：`scripts/e2e/closeout_gate.py:1794-1802`（`"mermaid" in content`
    + `<!DOCTYPE html>`）、同文件 `:1900-1904`（v0.9 多视图断言）；
    `services/control-plane/src/export-artifact.test.ts` 同样全是 `toContain`。
  - v1.5 的 verification 回执只覆盖 MCP 返回体（`.scratch/v1.5-deliverable-verification/spec.md`），
    工件侧只有「内嵌重放入口」一条文本；v1.5.1 又修了回执读数，说明**回执本身也需要门**。
- **外部参考（借位置，不借规模）**：archify 的 `finalize` 回执声称四门全过——
  validate + deliver + strict check + **真实浏览器 browser-check**，且「非零退出永不算成功」
  （`archify/references/delivery-contract.md`、`archify/SKILL.md` 步骤 4/5）。
  本批只借「浏览器门的位置 + 回执形态 + fail-closed 退出码」，不借其图型 DSL、渲染器与交付锁。

## 背景与度量

| 门 | 位置 | 能抓 | 抓不到 |
|---|---|---|---|
| 单测 | `export-artifact.test.ts` | 转义、标签存在、无死占位 | 渲染结果、JS 运行、交互 |
| e2e | `closeout_gate.py:1794-1904` | CLI 退出码、文件存在、字符串包含 | 同上 |
| UI smoke | `scripts/smoke/ui_smoke.mjs` | Web 工作台真实前端 | **工件是独立 HTML，不经过 Web 前端** |
| v1.5 回执 | `mcp/output-contract.ts` | MCP 返回体锚点 | 工件 DOM |

**先红方案（票 01 硬前置）**：用 `dist/cli.js export` 生成 good 工件（复用
`release.yml:45-85` 的内嵌 demo 仓），复制后分别注入三种破坏——残缺 mermaid
（`flowchart LR / A -->`）、删 `VIEWS_JS`、删 `STORY_BEATS_JS`——得到三份 bad 工件。
现有全部门对 bad 仍绿 = 缺口可复现，再写门。

**时间预算**：单工件 < 15s（本地 chromium cache 复用，见 `readme-shots.mjs:377-399`）；
release 门新增 ≤ 1 min。**实测**：单工件 1.8–2.0s（3.58MB 内联工件，chromium headless）。

## 决策（草案）

1. **门在脚本层，不在 `codecompass export` 运行时**。新增
   `scripts/smoke/artifact_browser_check.mjs`，`file://` 直接打开工件；playwright 动态 import，
   沿用 `ui_smoke.mjs:12-15` 的接缝（`SMOKE_PW_MODULE` / `SMOKE_CHROMIUM_PATH`）与
   `:34-46` 的 loader。理由：CLI 是纯离线确定性工具，playwright 不能成为它的运行时依赖。
2. **fail-closed + UNCHECKED ≠ PASS**。退出码 `0=PASS / 1=FAIL / 2=UNCHECKED`。
   无 playwright、浏览器启动失败、检查超时、工件不可读 → UNCHECKED 并在诊断写明原因；
   任何消费方（CI 步骤、发布说明、README）不得把 2 当绿。
3. **回执写旁车，不写进工件**：默认 `<artifact>.browser-check.json`（`--out` 可覆盖），
   工件字节不变（可继续做 sha256 归档）。回执与 v1.5 `VerificationReceipt` 同族但**不复用类型**：
   事实面不同（返回体锚点 vs 工件 DOM），合并会让两个消费者互相误读。
4. **检查项 9 条，逐项 fail-closed**（`skipped` 只允许出现在明确的 N/A 项，且回执里写原因）。
   release 工件加 `--require-full`：任何 SKIPPED 直接判 `CHECK_SKIPPED`（2026-10-27 双轴评审后补）。
5. **不做**：像素/截图比对、视觉质量评估、语义正确性（锚点是否真存在于仓库 = v1.5 回执的事）、
   性能、a11y 全量、外部网络可达性。

## 检查项

| id | 断言 | 事故来源 |
|---|---|---|
| `artifact/readable` | 文件可读、UTF-8、含 `<!DOCTYPE html>` | 空文件/写坏 |
| `artifact/self-contained` | 无 `<script src="http…">` / `<link href="http…">`；无 `.offline-warning`（CDN 回退标记） | 工件脱网即废 |
| `diagram/svg-rendered` | 每个 `.mermaid` 容器内 `svg` 存在且 `getBoundingClientRect()` 宽高 > 0；页面文本不含 `Syntax error` | v1.4 零宽渲染 |
| `diagram/lazy-view` | 点击 `[data-view="sequence"]` 后其容器内出现非零宽 `svg` | v0.9 lazy render 事故点 |
| `story-beats/step` | 存在 `.beat-bar` 时：点 Next 后 `.beat-label` 文本变化、点 Prev 回到边界；不存在时 `skipped` | v1.4 Story Beats 实际不可用 |
| `deeplink/non-empty` | `.deeplink a[href]`（或首个 `a[href^="http"]`）href 非空、scheme ∈ {http, https}；不请求 | 深链静默失效（v1.4 修过同类） |
| `runtime/no-pageerror` | `pageerror` 计数 0 | 脚本异常导致交互死 |
| `runtime/no-console-error` | console `error` 计数 0 | 同上 |
| `runtime/no-network` | 页面发起的外部请求（非 `file:`/`data:`）计数 0，请求一律 abort 并记录 | 内联失败偷偷走 CDN |

第 9 条与 `artifact/self-contained` 互补：一条静态扫标记，一条运行时抓行为。

## 回执 schema（草案）

```json
{
  "schema": "codecompass/artifact-browser-check@1",
  "engineVersion": "1.7.0",
  "checkedAt": "2026-10-26T12:00:00.000Z",
  "verdict": "PASS",
  "artifact": {
    "path": "dist-release/architecture-artifact.html",
    "bytes": 212345,
    "sha256": "…"
  },
  "browser": {
    "name": "chromium",
    "version": "1228",
    "viewport": { "width": 1440, "height": 900 },
    "offline": true
  },
  "checks": [
    { "id": "artifact/readable", "status": "PASS", "evidence": { "bytes": 212345 } },
    { "id": "diagram/svg-rendered", "status": "PASS",
      "evidence": { "containers": 2, "rendered": 2, "minWidth": 412, "minHeight": 96 } }
  ],
  "diagnostics": [
    { "check": "diagram/svg-rendered", "code": "DIAGRAM_SVG_EMPTY",
      "selector": ".mermaid:nth-of-type(2)", "message": "container has no svg after 10s" }
  ],
  "durationMs": 4321
}
```

- `verdict`：任一 check `FAIL` → `FAIL`；否则若存在 UNCHECKED 条件（无浏览器/超时/内部错误）→
  `UNCHECKED`；否则 `PASS`。
- `status` ∈ `PASS | FAIL | UNCHECKED | SKIPPED`（SKIPPED 只用于明确的 N/A，且必须带
  `evidence.reason`）。
- 诊断码：`ARTIFACT_UNREADABLE` / `ARTIFACT_NOT_SELF_CONTAINED` / `MERMAID_CDN_FALLBACK` /
  `DIAGRAM_SVG_EMPTY` / `DIAGRAM_SYNTAX_ERROR` / `VIEW_NOT_RENDERED` / `STORY_BEATS_STUCK` /
  `DEEPLINK_EMPTY` / `PAGE_ERROR` / `CONSOLE_ERROR` / `EXTERNAL_REQUEST` / `CHECK_TIMEOUT` /
  `BROWSER_UNAVAILABLE` / `INTERNAL_ERROR` / `DIAGRAM_TARGET_MISSING` / `CHECK_SKIPPED`。
- UNCHECKED 路径额外携带一条 `runtime/browser`（或 `runtime/internal`）检查项，写明拿不到结论的原因。
- 回执**只陈述本次观测**：不含「工件正确」的结论，README/发布说明引用时必须带上
  `verdict` 与 `checks` 计数，禁止只写「已通过验收」。

## 文件面（开线声明）

- `scripts/smoke/artifact_browser_check.mjs`（新）+ `scripts/smoke/make-artifact-fixtures.mjs`（新，
  只提交生成器，不提交产物）
- `services/control-plane/src/export-artifact.ts`（仅票 05 需要稳定钩子时加 `data-check` 属性；
  票 06 清 `:291` 的 `CodeCompass v0.9` 硬编码）
- `.github/workflows/release.yml`（新增一步，复用 UI smoke 已装的 chromium；回执随 release 资产）
- 共享区（CHANGELOG / README / HANDOFF / CONTEXT / 版本五处）：**只在收口票 06 一次性动**
  （`docs/agents/parallel-collaboration.md` 铁律）
- **不触碰**：17 个工具输入 schema、`packages/contracts` 镜像类型、mermaid 版本、
  `scripts/e2e/closeout_gate.py` 既有断言（只增不删；本批不新增 e2e 断言）

## 票清单

- 01 先红：fixture 生成器 + 三种 bad 工件 + 现有门对 bad 全绿的证据（done）
- 02 检查项实现：9 条 fail-closed + `--self-test`（done，4/4）
- 03 回执与退出码：旁车写入、schema 结构断言、UNCHECKED=2 的语义（done）
- 04 接线：release 门新增一步 + 回执随工件发布（done）
- 05 稳定检查钩子：`data-check` 属性（done，实测选择器脆弱，按计划加钩子而非 wontfix）
- 06 ADR-0023 + 收口：验收边界、版本五处 1.7.0、CHANGELOG、README Known Limitations、
  HANDOFF 门禁实数、`:291` 硬编码版本串清除（done）

## 完成定义

- good 工件在真 Chromium 下 PASS：mermaid SVG 非零宽、lazy view 可渲染、Story Beats 可步进、
  深链非空、0 pageerror / 0 console error / 0 外部请求；
- 三种 bad 工件各自 FAIL，且诊断精确到 `check` + `selector`（先红证据留档）；
- 无 playwright 环境 → UNCHECKED、退出码 2、不得冒充绿；
- release.yml 新步骤失败即 release 红；回执 `<artifact>.browser-check.json` 随 release 资产发布；
- e2e 断言数不减少（仍 ≥ 73/0），单测 / typecheck 全绿；
- 回执有结构断言（仿 v1.5.1 教训：回执自己也要有门）；
- 版本五处 1.7.0 + CHANGELOG `[1.7.0]` + README Known Limitations 新增一条
  「浏览器门只验可渲染/可交互，不验工件正文语义正确性」。

## 风险与裁决项

- **R1 CI 是否也跑**：默认只在 release 门跑（CI 无 chromium 安装步骤，约 350MB；e2e 保持纯进程级）。
  若以后要 CI，另开票，不在本批。
- **R2 外部 404 白名单**：不需要——脚本不请求网络，深链只验非空与 scheme。
- **R3 file:// 与脚本执行**：工件无 CSP、mermaid 已内联；`file://` 下无跨域 fetch，现有 reader 已验证。
  若未来加 CSP/integrity，本门需同步（写进 ADR-0023 的「门与工件同源演进」条款）。
- **R4 回执与 v1.5 回执的关系**：两张回执不合并、命名区分（`verification` vs
  `artifactBrowserCheck`），README 同一节分两段写。
- **R5 `:291` 硬编码 `CodeCompass v0.9`**：评审 `docs/reports/code-review-2026-10-26.md:65` 已登记，
  属工件元数据里的假事实，随票 06 清（改为 import `VERSION`，补一条断言）。
- **R6 版本预占**：**v1.7.0**；固定点 = v1.6.0 收口 commit `2f9207a`（tag 待打，开工前复核）。
  开工前按 parallel-collaboration 步骤 1 再核一次 CHANGELOG 顶部，确认未被抢号。

## Comments

- 2026-10-26 立项草案（Lead 起草，未经用户裁决）：来源 = archify 参考价值评估的第 1 条结论
  （借其 `finalize` 的真实浏览器门与回执形态，不借图型/交付锁）。起草时未跑门；票 01 先红是硬前置。
- 2026-10-26 裁决：用户「全部默认」——CI 不跑（release-only）、回执随 release 资产发布、
  ADR-0023 / v1.7.0 预占确认。
- 发布执行清单：`.scratch/v1.7-artifact-browser-gate/release-checklist.md`
  （提交 → tag/Release → npm → 文档回写 → 回退）。
- 2026-10-26 收口：全部票 01–06 完成，门禁 typecheck 0 / 控制面 903 / web 433 /
  bridge 26 / e2e 73-0 / 工件门自检 4/4；release 流模拟 PASS（回执 engineVersion=1.7.0）。
  2026-10-27 双轴 code-review 完成（fixed point `150b4ec`，报告 `docs/reports/code-review-2026-10-27.md`）：
  Standards 8 条（3 硬违规）/ Spec 8 条；硬违规与可修项已随本批修（`--require-full`、
  模板漂移判红、label 判定、回执负例、selector 回填），重复实现类 3 项 deferred；
  复核证据：真实 release 工件 `--require-full` PASS 9/9，构造钩子漂移工件 FAIL 退出 1。
