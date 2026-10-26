# Code review — 2026-10-27（v1.7 工件浏览器验收）

- **fixed point**：`150b4ec`（= 评审时 HEAD；v1.7 改动全部在工作树未提交）
- **范围**：12 个已跟踪文件 diff + 4 个未跟踪新增（门脚本 / fixture 生成器 / ADR-0023 / spec+tickets）
- **方法**：双轴并行 sub-agents（Standards / Spec），互不共享 context；本报告的「处置」由 Lead 复核后给出
- **背景**：v1.7 = 给单文件 HTML 工件加真浏览器验收门（playwright/chromium）、旁车回执、release 接线；门禁由 Lead 先行跑过（typecheck 0 / 控制面 903 / web 433 / bridge 26 / e2e 73-0）

---

## Standards

### Standards findings

- [硬违规] `HANDOFF.md:12` — 收口记录自认「本批未走双轴 code-review（以全量门禁 + 单轴自审代替）」 — 依据 `docs/agents/parallel-collaboration.md:29`「双轴 code-review（fixed point = 上次审完的 commit，**不可省**）」 — 建议：改为引本次双轴结论；先例不能替代成文规则，要豁免先改文档。

- [硬违规] `scripts/smoke/artifact_browser_check.mjs:230,245,272,309` — 4 条检查「找不到目标」即 SKIPPED，而 verdict 只由 FAIL/UNCHECKED 决定（`:340-342`），`assertReceiptShape`（`:490-507`）不校验应有的 check 集：钩子/类名一漂移，门静默 PASS — 依据 ADR-0023 决定 5「禁止门落后于模板——落后会让检查静默变 SKIPPED，那比红更糟」；README:381 对外称「9 条 fail-closed 检查」 — 建议：release 工件声明最低必需 check 集，缺一即 FAIL/UNCHECKED。

- [硬违规] `scripts/smoke/artifact_browser_check.mjs:128` — 静态自包含扫描只认 CSS 类名 `class="offline-warning"` 判 CDN 回退，模板已给 `data-check="offline-warning"`（`export-artifact.ts:181`）却不用（DOM 半面 `:203` 才用） — 依据 ADR-0023 决定 5「被检节点用 data-check 钩子……CSS 类名只作回退」 — 建议：静态半面同样先查钩子。

- [judgement call] `artifact_browser_check.mjs:366-462` — 同一 UNCHECKED 回执字面量重复 4 份；verdict→exit 映射散在 `:342`/`:446` — Duplicated Code / Data Clumps — 抽 `uncheckedReceipt(code,…)` 与 `exitForVerdict()`。

- [judgement call] `artifact_browser_check.mjs:70-82` vs `ui_smoke.mjs:34-46` — `loadChromium` 近逐字复制（仅 null/throw 之差），注释自认「与 ui_smoke.mjs 一致」 — Duplicated Code — 抽 `scripts/smoke/playwright.mjs`（同 `stub-llm.mjs` 先例）。

- [judgement call] `make-artifact-fixtures.mjs:21-58` vs `.github/workflows/release.yml:50-84` — 同一 demo 仓库两份拷贝（`:93` 注释自认「同一条路径」），必漂移 — Duplicated Code — workflow 改调生成器。

- [judgement call] `artifact_browser_check.mjs:217-225` — 用替换而非合并覆盖 `checks[1]`：静态已判 FAIL 的 `ARTIFACT_NOT_SELF_CONTAINED` 被 CDN 回退诊断顶掉，证据丢失 — 改为合并 diagnostics。

- [judgement call] `artifact_browser_check.mjs:30,172,183` — `DIAGRAM_TIMEOUT_MS` 同时当导航/等待总超时（10s），ADR-0023:47 又称「15s 预算」；`:249,283,286` 又用 600/120ms 固定 sleep，与 `:173`「不靠固定 sleep」自相矛盾 — Mysterious Name + 文档不同数 — 改名 `PAGE_TIMEOUT_MS`、ADR 同数、sleep 换 waitForFunction。

### 最严重问题

门把「找不到目标」当 SKIPPED，而 verdict 只看 FAIL——ADR 明令禁止的「静默变 SKIPPED」正是这道门的默认退路。

---

## Spec

### Spec findings

- [wrong] `scripts/smoke/artifact_browser_check.mjs:300` — story-beats 判绿条件是 `after.label !== initial.label || after.counter !== initial.counter`，counter 动即 PASS；spec 要求「点 Next 后 `.beat-label` 文本变化」——label 卡死（正是 v1.4 事故）会被判绿。建议强制 label 必须变。

- [partial] `artifact_browser_check.mjs:233,237,265,302,317` — 所有 `selector` 是硬编码 CSS 串（`pre.mermaid`/`.beat-bar`），从不记录是否命中 `data-check`，也不指向具体节点（spec 示例为 `.mermaid:nth-of-type(2)`）；票 05 要求「回执的 `selector` 记录实际命中的形态」，完成定义要求「诊断精确到 check + selector」。建议回填实际命中节点。

- [partial] `artifact_browser_check.mjs:490-507`、`519-530` — 「回执自己也要有门」只有结构断言函数，self-test 从不喂畸形回执，也不验 checks 数量/唯一性；票 03 明文「结构自检对构造的畸形回执能判红」「checks 数量与被检项一致」（自审修掉的重复 id 正属此类）。建议补负例。

- [partial] `artifact_browser_check.mjs:247-262` — lazy-view 固定 600ms 单次读数，无 `waitForFunction`/超时；票 02 要求「`waitForFunction` 等 mermaid 渲染（上限 10s，超时记 `CHECK_TIMEOUT`）」。慢渲染会被误判 `VIEW_NOT_RENDERED`。

- [partial] `artifact_browser_check.mjs:230,245,309` — svg-rendered / lazy-view / deeplink 各增一个 spec 未授权的 SKIPPED 出口；spec 决策 4「`skipped` 只允许出现在明确的 N/A 项」，表内只有 story-beats 有 N/A。`diagram/svg-rendered` 无可见容器即 SKIPPED = 静默绿，正撞 ADR-0023 决定 5「静默变 SKIPPED⋯比红更糟」。建议判 FAIL/UNCHECKED。

- [partial] `artifact_browser_check.mjs:308-318` — 无 `.deeplink` 元素直接 SKIPPED，缺 spec 的回退「（或首个 `a[href^="http"]`）」。

- [wrong] `HANDOFF.md:12` 记 900，`CHANGELOG.md:36` / `README.md:381` 记 903，同一「本机实跑」实数互斥；票 06 要求「全量门禁复跑并记录实数」。

- [scope-creep] `CHANGELOG.md:30-32` 收录 v1.6.1「回执仓库根收窄」、`README.md:326` 改写 npm 上架事实；非本批 9 检查/回执/完成定义所需，spec 文件面「不触碰」未授权，票 06 的 README 范围只列「版本串 / ADR 表 / 质量门禁 / 路线图 / Known Limitations」。

### 最严重问题

回执结构门没有畸形回执负例、又留下未经授权的 SKIPPED 出口——门号称 fail-closed，但「门自身失效」与「钩子失效后静默变 SKIPPED」两条仍会绿，恰是 ADR-0023 自己判定「比红更糟」的失效模式。

---

## 处置（Lead 复核后）

| # | 轴 | finding | 处置 |
|---|---|---|---|
| S1 | Standards | HANDOFF 自认未走双轴评审（硬违规） | **已修**：本次即双轴评审；HANDOFF 改为引本报告 |
| S2 | Standards | 目标失踪即 SKIPPED、门静默 PASS（硬违规） | **已修**：新增 `--require-full`（release 用；任何 SKIPPED 判 `CHECK_SKIPPED`）；模板声称有图却无可见容器判 `DIAGRAM_TARGET_MISSING`；self-test 以 require-full 跑 |
| S3 | Standards | 静态自包含只认类名、不用钩子（硬违规） | **已修**：`data-check="offline-warning"` 优先 |
| S4 | Standards | UNCHECKED 回执字面量重复 4 份 | **deferred**：纯整形，4 处分支语义不同（浏览器缺失/启动失败/内部错误/不可读），抽取收益低于改动风险；登记为下次触碰该文件时的顺手清理 |
| S5 | Standards | `loadChromium` 与 ui_smoke 近重复 | **deferred**：两脚本错误语义不同（null vs throw），抽公共件需同时改 ui_smoke；本批不扩大 release 门风险面 |
| S6 | Standards | fixture demo 仓与 release.yml 重复 | **deferred**：release workflow 故意自包含（tag 构建不依赖脚本行为）；已在两处注释互指，漂移风险接受并登记 |
| S7 | Standards | 覆盖 `checks[1]` 丢静态诊断 | **已修**：改为合并 diagnostics |
| S8 | Standards | 超时常量命名/固定 sleep 自相矛盾 | **部分修**：lazy-view 的 600ms 固定等待改为 `waitForFunction`（10s 上限）；剩余 120ms 点击 settle 保留（DOM 同步 click 的稳定等待，不是渲染等待）；常量改名未做（deferred） |
| P1 | Spec | story-beats 只看 counter 变化 | **已修**：PASS 必须 `.beat-label` 文本变化 |
| P2 | Spec | selector 硬编码、不记录命中形态 | **已修**：回执/诊断回填实际命中的 selector（钩子或回退） |
| P3 | Spec | 回执无畸形负例 | **已修**：self-test 增加 3 个负例（重复 id / 未知诊断码 / verdict 不一致），并校验 id 唯一 |
| P4 | Spec | lazy-view 固定 600ms | **已修**：`waitForFunction` 等非零 SVG（10s 超时） |
| P5 | Spec | 未经授权的 SKIPPED 出口 | **部分修**：release 一律 `--require-full`；本地单跑保留「确实没有该区块」的 SKIPPED（无法从 DOM 区分漂移与 N/A，故由 release 契约兜底） |
| P6 | Spec | deeplink 缺 `a[href^="http"]` 回退 | **已修**：回退链补齐 |
| P7 | Spec | HANDOFF 900 vs CHANGELOG/README 903 互斥 | **已修**：统一为 903/72（本机实跑；HEAD 的 v1.6.1 修正带入 +3 tests / +1 file） |
| P8 | Spec | scope creep：CHANGELOG v1.6.1 条目、README npm 事实改写 | **不成立（refuted）**：这两处是并行线（v1.6.1 收编）与用户明确要求的 README 事实修正，非本批作者引入；保留并在此说明 |

### 复核证据（修复后重跑）

- `--self-test`：good PASS / bad-syntax / bad-lazy / bad-beats 各自精确红 + 3 个回执负例 caught，全绿；
- 真实 release 工件（CLI export 产物）`--require-full`：**PASS 9/9**，1.5s；
- 构造「钩子与类名同时漂移」的工件：`--require-full` → **FAIL**（`CHECK_SKIPPED`/目标缺失路径生效），退出 1；不带 flag 时保留 1 个 SKIPPED（本地容忍，release 不允许）。

---

## 两轴小结

- **Standards**：8 条（3 硬违规 + 5 judgement call）。最严重 = 门把「找不到目标」当 SKIPPED，静默 PASS 违反 ADR-0023 自设红线；3 条硬违规已修，judgement 修 2 / deferred 3。
- **Spec**：8 条（2 wrong + 5 partial + 1 scope-creep）。最严重 = 回执门缺畸形负例、且留下未经授权的 SKIPPED 出口；6 项已修、1 项部分修（由 release `--require-full` 兜底）、1 项 refuted。
