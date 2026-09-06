# 🧪 产品体验与缺陷报告 - CodeCompass v0.21.0 · Round 3

> 体验日期：2026-09-05 ｜ 体验者：产品深度体验官（三画像：新手 / 核心玩家 / 破坏性用户）
> 报告路径：`产品体验报告/产品体验报告-Round3.md` ｜ 证据截图：`产品体验报告/ui-shots/r3-*.png`（46 张）

---

## 1. 体验总览 (Executive Summary)

* **体验角色**：新用户冷启动 → 核心玩家全功能走底 → 破坏性用户（狂点/快速切库/极端输入/窄视口压榨）
* **健康指数**：🟡 严重交互受阻（3 项 P1，零 P0；桌面核心链路质量高，但演进推演与架构差异各有一条"开箱必错"的路径，移动端/窄视口下顶栏大面积不可点）
* **核心体感**：桌面 1280px 下我把 6 个 Tab、命令面板、双主题、Tour、导入导出、追踪/排障全链路、SSE 流卡、刷新回放全部走了一遍，零控制台崩溃，状态一致性好——这一层已经相当成熟。但作为新用户，我在"演进推演"里输入产品自己推荐给我的示例句，得到的是一次必现的管线报错；我在"架构差异"里什么都不改直接点运行，得到的是一屏原始 git 报错；我把窗口缩到平板宽度，"演进推演"这个主推功能 Tab 就点不到了。三个问题都不是偶发，是确定性复现，且都处在产品最想展示的门面上。

* **本轮零控制台报错**（全部主路径），SSE 流、hydrate 回放、inspector 联动均正常；下述缺陷均为功能/布局层问题。

---

## 2. 缺陷与体验问题清单 (Defect Items)

### 🔴 [R3-Bug-01] [演进推演/进化引擎] EXTEND 管线对 route 类符号必现 "Attach point not found"，且自带示例输入 100% 失败

* **严重级别**：P1-严重
* **问题类别**：功能缺陷
* **复现环境**：隔离实例 `http://127.0.0.1:48731`（`--data-dir cc-data-r3`，v0.21.0）；仓库 verify-routes（Java shop，`repo-8e91ea0a-…`）；Chromium 1234；桌面 1280×800 与 375×667 均可复现；API 直连同样复现（≥4 次确定性复现）

#### 🐾 严格复现步骤
1. 打开 `/`，下拉选择仓库 **verify-routes**。
2. 点击 `[data-testid=tab-evolve]` 进入"演进推演"。
3. 在意图输入框（placeholder 即"给订单模块加 Excel 导出"）输入 `add Excel export to OrderController`（该 Controller 是此仓库真实的路由类）。
4. 点击 `[data-testid=evolve-run]`，等待管线走完 target_resolve。
5. 或直接 API：`curl -X POST http://127.0.0.1:48731/api/repos/repo-8e91ea0a-d684-45ee-a409-e2689ced551f/evolve -H "Content-Type: application/json" -d '{"intent":"add Excel export to OrderController"}'`。

#### ⚖️ 现象比对
* **实际现象 (Actual)**：target_resolve 阶段 LLM 已解析出目标并给出 score 100 的 alternatives，但管线仍以 error 事件终止；卡片落为 `⚠ + intent + "Attach point not found: OrderController"`。中文泛称意图（"给订单模块加 Excel 导出"）同样必失败：`Attach point not found: 订单模块`。**该仓库上 EXTEND 路径没有一条能走通**。
* **预期行为 (Expected)**：`OrderController` 在索引中的 kind 是 `route`，应被类级候选白名单收录并完成锚定，走完 EXTEND 管线产出 done 卡（cc-self 仓库上 done 卡结构正常，见 ui-shots/r3-35/36）；泛称无精确匹配时应给出"未锚定目标 + alternatives"引导而非直接终止。

#### 🔍 疑似根因与线索
* **疑似文件/位置**：`services/control-plane/src/module-evolution-engine.ts:861` `runExtend()` 的类级候选白名单只认 `kind: 'service' | 'class'`，而 `OrderController` 索引为 `kind='route'`（`repository`/`mapper` 类符号疑似同样遗漏，待确认）；意图 echo 显示 LLM 解析实际成功，失败发生在引擎侧候选筛选。
* **加重因素**：`apps/repoqa-web/src/components/EvolutionView.tsx:426` 空态 placeholder 即 `给订单模块加 Excel 导出`——在任何仓库上照抄这句话都必然失败，等于产品亲手把新用户推进第一个坑。
* **已验证的正面面**：失败原因文本对用户可见（最新失败卡默认展开即显示 error `<p>`，历史卡点击"展开"后可见；`useEvolutionSession.ts:356-363` 与 `EvolutionView.tsx:365` 链路完整）——**不是静默失败**。
* **次级线索（P3）**：失败卡经刷新 hydrate 后丢失 intentEcho（`http.ts:655-663` `saveWorkbenchCard` 未持久化 echo），用户刷新后看不到"当初解析到了什么目标、匹配度多少"，削弱自诊断能力。

#### 🤖 编码 Agent 专用修复 Prompt
> **直接喂给 Coding Agent 的修复指令：**
> "修复演进推演 EXTEND 管线对非 service/class 符号的锚定失败，并修正自带示例文案：
> 1. 检查 `services/control-plane/src/module-evolution-engine.ts` 约 861 行 `runExtend()` 的候选白名单：将 `kind` 收录范围从 `'service'|'class'` 扩展为 `'service'|'class'|'route'`，并复核索引器产出的全部 kind 值（repository/mapper/component 等），凡可作为"类级落位点"的一并收录；扩展后重跑候选排序，确保 score 排序逻辑不变。
> 2. 检查 `apps/repoqa-web/src/components/EvolutionView.tsx` 426 行空态 placeholder：改为在本仓库可成功的示例（建议按当前仓库索引动态生成，如取一个真实 route/class 符号名拼示例句），删除『给订单模块加 Excel 导出』这类对泛称仓库必失败的文案。
> 3. （顺手，P3）`saveWorkbenchCard`（`services/control-plane/src/http.ts` 约 655 行）为 error 卡持久化 intentEcho，使刷新回放后失败卡仍展示『目标锚定/alternatives』。
> 4. 验收标准：a) 对 verify-routes 仓库 POST `/evolve` `{intent:"add Excel export to OrderController"}` 走完 EXTEND 全管线并产出 status=done 卡；b) 空态首屏照抄 placeholder 文案能走通；c) 中文泛称意图失败时卡内展示『未锚定目标 + alternatives』而非仅 error；d) 既有 cc-self done 卡回放不受影响（`npm test` 全绿）。"

---

### 🔴 [R3-Bug-02] [架构差异] 默认 base ref 硬编码 `origin/main`，master 分支仓库开箱必 400，报错为原始 git stderr

* **严重级别**：P1-严重
* **问题类别**：功能缺陷（伴生交互反馈问题）
* **复现环境**：隔离实例 48731；cc-self 与 verify-routes 均为 master 分支；桌面 1280×800

#### 🐾 严格复现步骤
1. 选择任一仓库，点击 `[data-testid=tab-delta]` 进入"架构差异"。
2. 不修改任何输入（输入框默认值即 `origin/main`）。
3. 点击 `[data-testid=delta-run]`"运行差异分析"。

#### ⚖️ 现象比对
* **实际现象 (Actual)**：请求 400，页面红色报错，但内容是 git 的原始多行 stderr（`fatal: ambiguous argument 'origin/main'…` 一整块，见 ui-shots/r3-34-delta-result.png）。新用户看到的是一屏 git 内部日志。
* **预期行为 (Expected)**：默认值应指向该仓库实际存在/默认的 ref（本项目为 `master`，或动态取默认分支），默认操作直接出结果；即便失败，也应给出一行可读摘要（"基准分支 origin/main 不存在，当前仓库默认分支为 master"）而非原始 git 输出。
* **对照**：手填 `{base:"HEAD~3", head:"HEAD"}` 后 API 正常返回，UI 完整渲染 impact/broken/added/removed/diagram/markdown（ui-shots/r3-43-delta-ok.png）——成功路径本身是好的，坏在默认值。

#### 🔍 疑似根因与线索
* **疑似文件/位置**：`apps/repoqa-web/src/components/ArchitectureDeltaView.tsx:47` `useState('origin/main')`。
* **接口线索**：`POST /api/repos/:id/architecture-delta`，请求体键名为 `base`/`head`（非 baseRef/headRef）；仓库对象上已有 commit 等元数据，默认分支信息可从 repo 目录或后端补充。

#### 🤖 编码 Agent 专用修复 Prompt
> **直接喂给 Coding Agent 的修复指令：**
> "修复架构差异默认 ref 硬编码与报错呈现：
> 1. `apps/repoqa-web/src/components/ArchitectureDeltaView.tsx` 47 行：默认值不再硬编码 `origin/main`。优先从仓库元数据读取默认分支（如无则在 GET `/api/repos` 列表或 repo 对象上补 `defaultBranch` 字段，后端从 git symbolic-ref 获取）；取不到时输入框置空并以 placeholder 提示『如 HEAD~3 或 origin/master』。
> 2. 后端（`http.ts` architecture-delta 处理器）捕获 git stderr 时向前端返回结构化错误 `{message, detail}`：message 为一行可读摘要（基准分支不存在/仓库无提交等），detail 保留原始输出供折叠展开。
> 3. 验收标准：a) master 分支仓库进入页面直接点"运行差异分析"能出结果或得到单行友好报错；b) 填入不存在的 ref 时 UI 显示单行摘要，原始 stderr 折叠可见；c) `{"base":"HEAD~3","head":"HEAD"}` 成功路径回归不受影响。"

---

### 🔴 [R3-Bug-03] [顶栏/移动端适配] <≈1100px 视口下右侧操作簇向左溢出，遮挡 Tab 导航、汉堡按钮；375px 下侧栏抽屉无法打开

* **严重级别**：P1-严重
* **问题类别**：视觉适配（hit-test 层遮挡，非纯视觉）
* **复现环境**：Chromium 1234，视口 375×667 / 768 / 1024（1280 正常）；真实手机/平板浏览器同理——手指点中的是覆盖层而非按钮

#### 🐾 严格复现步骤
1. 打开应用并选中任一仓库，将视口宽度调至 375px（DevTools 设备模拟或窄窗口）。
2. 试图点击顶栏"架构指标/排障"等前几个 Tab → 点不中。
3. 试图点击左上角 ☰ 打开侧栏抽屉 → 点不中（Playwright 真实点击 30s 超时，日志显示被 `⋯` 按钮拦截 58 次）。
4. 768px 视口点击"CI 门禁""演进推演"Tab；1024px 视口点击"演进推演"Tab → 同样点不中。

#### ⚖️ 现象比对（elementFromPoint 实测遮挡地图）
* **实际现象 (Actual)**：
  * **375px**：隐私胶囊盒子 x=39~198 直接压在 `tab-metrics` 中心 (117,24) 上（elementFromPoint 返回 privacy-pill 的 SPAN）；`⋯` 按钮盒子 x=-1~31 压住 ☰（x=8~39）；`topbar-copy-context` 右缘 391 超出视口被裁；此时点 `⋯` 弹出的 more-menu 锚定在屏幕外的按钮上，整窗弹出在 x=-160（3/4 在屏外）。
  * **768px**：`tab-evolve`、`tab-gate` 中心命中 privacy-pill。
  * **1024px**：`tab-evolve` 中心命中 privacy-pill。
  * **1280px**：全部干净（阈值约在 1024–1280 之间，精确断点待确认）。
  * 即：**最常见的平板竖/横屏与手机宽度下，主推功能"演进推演"都无法用鼠标/手指点到**。
* **预期行为 (Expected)**：任意视口宽度下每个 Tab 中心 elementFromPoint 命中该 Tab 自身，☰ 可真实点击，顶栏无越界元素；窄视口下 Tab 收进横向滚动条或下拉。

#### 🔍 疑似根因与线索
* **疑似文件/位置**：`apps/repoqa-web/src/components/TopBar.tsx:138` `header` 为单行 `flex h-12`；中间 `workbench-tabs`（6 个 `whitespace-nowrap` 中文 Tab，`shrink-0`，实测宽约 367px）夹在左右两个 `flex-1 min-w-0` 区块之间；右簇（⋯32 + 隐私胶囊159 + 主题51 + 复制上下文126 ≈ 380px）`justify-end`，容器被压到 0 宽后内容**从盒子左侧溢出**铺到 Tab 栏与 ☰ 上。
* **旁证**：375px 下页面 `scrollWidth=375` 无横向滚动可救（内容被裁剪/重叠，而非可滚出）；除顶栏外，拓扑/门禁/演进页内容区无横向溢出（inspector 的 right=694 为关闭态藏屏外，属正常，不计）。

#### 🤖 编码 Agent 专用修复 Prompt
> **直接喂给 Coding Agent 的修复指令：**
> "修复 TopBar 在窄视口（<1100px）下的溢出遮挡：
> 1. `apps/repoqa-web/src/components/TopBar.tsx`：a) 允许 header 换行（`flex-wrap`）或在 `lg` 以下把 `workbench-tabs` 移到 header 下方独立一行并加 `overflow-x-auto`；b) `sm` 以下右簇收纳——隐私胶囊收缩为仅色点（隐藏文字）、『复制 Agent 上下文』缩为图标按钮或移入 `⋯` 菜单，确保右簇总宽 ≤ 可用空间；c) more-menu 使用 `fixed` 定位并对齐视口右缘（`right-2`），不再锚定可能溢出的父级。
> 2. 验收标准（Playwright elementFromPoint 断言）：在 375/768/1024 视口下，6 个 `tab-*` 按钮中心点命中元素均为自身或其后代；`sidebar-toggle` 中心点命中自身；`more-menu` boundingBox 完全在视口内；`document.scrollWidth === viewportWidth`；1280px 下现有布局不回归。"

---

### 🟠 [R3-Bug-04] [顶栏/交互反馈] `⋯` 更多菜单不支持 Esc 关闭，且 backdrop 无焦点管理

* **严重级别**：P2-一般
* **问题类别**：交互反馈
* **复现环境**：桌面 1280×800；同仓库任一

#### 🐾 严格复现步骤
1. 点击顶栏 `⋯`（`[data-testid=more-actions]`）打开更多菜单。
2. 按 `Esc` 键。

#### ⚖️ 现象比对
* **实际现象 (Actual)**：菜单与全屏 `more-menu-backdrop`（`fixed inset-0 z-40`）保持存在，只能靠点击 backdrop 关闭；若此时用户想点页面其他元素，首击会被 backdrop 吞掉。
* **预期行为 (Expected)**：与导入弹窗一致（ImportRepoModal 已支持 Esc），按 Esc 关闭菜单并把焦点还给 `⋯` 按钮。

#### 🔍 疑似根因与线索
* `TopBar.tsx` 中 `menuOpen` 仅有 backdrop onClick 一条关闭路径，无 keydown 监听。

#### 🤖 编码 Agent 专用修复 Prompt
> **直接喂给 Coding Agent 的修复指令：**
> "`TopBar.tsx`：为 `menuOpen` 增加 `useEffect` keydown 监听，`Escape` 时 `setMenuOpen(false)` 并将焦点移回 `[data-testid=more-actions]`。验收：打开菜单按 Esc 后 DOM 中 `more-menu`/`more-menu-backdrop` 消失、焦点在 ⋯ 按钮；连按 Esc 无报错；与 CommandPalette 的 Esc 处理互不冲突。"

---

### 待确认观察（不计入缺陷）

1. **cc-self 仓库 Quick Tours 为空**：`GET /api/repos/:id/tours` 返回 `[]`，左栏无任何 tour 按钮可点（QuickTours 的 `more-tours-toggle`/`tours-retry` 降级 UI 未细验）。本轮实例数据目录为新建（cc-data-r3），可能是 tours 未生成的数据问题而非产品缺陷——Tour 播放器全链路（3 步、步骤跳转、`code://` 联动 inspector、返回）已在 Round1/2 验证通过。**待确认：tours 空态下侧栏是否给出可理解的引导文案。**
2. **PrivacyPill 点击无行为**：`PrivacyPill.tsx` 为纯展示 div（仅 `title` 悬停提示 host），点击无任何响应。胶囊样式与可点按钮一致，新手会尝试点它——列 P3 建议（见下）。

---

## 3. 全量功能覆盖清单 (Functional Coverage)

图例：✅ 已体验 ｜ 🟡 部分体验 ｜ ⛔ 未体验（注明原因）

| # | 功能 | 状态 | 备注/证据 |
|---|---|---|---|
| 1 | 空态（未选库） | ✅ | ui-shots/r3-01 |
| 2 | 选库/切库（含快速切库、狂点 Tab） | ✅ | r3-29；无竞态崩溃 |
| 3 | 架构拓扑（图渲染、节点、`code://`→inspector） | ✅ | r3-03~05 |
| 4 | 架构指标看板 | ✅ | 桌面+375px |
| 5 | 智能追踪（Top API→trace：consent 允许/取消双分支、SSE 三流卡、trace strip 步进） | ✅ | r3-15~18 |
| 6 | 命令面板 Ctrl+K（搜索/跳转/主题切换） | ✅ | r3-11/12 |
| 7 | Inspector 文件/符号查看与联动 | 🟡 | 联动入口全验；**Monaco 内部编辑能力未深测**（本产品只读场景未覆盖） |
| 8 | 复制 Agent 上下文（脱敏 toast/按钮文案反馈） | ✅ | r3-13 |
| 9 | 主题切换（`data-theme`，cyber/clean） | ✅ | r3-14 |
| 10 | 导出 ONBOARDING.md | ✅ | Round2 亦通过 |
| 11 | 导入弹窗（本地路径预览/坏路径报错/Esc） | ✅ | r3-26/27；**远程 clone URL 未实测**（避免真实联网拉取，隔离实例亦不宜） |
| 12 | 删除仓库（原生 confirm 拦截） | ✅ | r3-28 |
| 13 | 重新索引 | ⛔ | 会重建隔离实例索引、等待成本高；按钮 disabled 态已验证。**未实测完整流程** |
| 14 | 排障（自然语言+堆栈、SSE、evidence 卡→inspector 联动、符号不在索引时的 BREAK/UNRESOLVED 降级） | ✅ | r3-40/41（verify-routes 真实堆栈） |
| 15 | CI 门禁（结果+复制命令） | ✅ | r3-22/33 |
| 16 | 架构差异（成功路径） | ✅ | r3-43；默认路径失败=R3-Bug-02 |
| 17 | 演进推演（done 卡：checklists/placement/alternatives；failed 卡；刷新 hydrate 回放；展开/收起） | ✅ | r3-24/35/36/46；EXTEND 失败=R3-Bug-01 |
| 18 | Correction Pill 备选切换（`evolve-alt-*` 按钮→追加新卡） | 🟡 | DOM 存在已确认；**点击触发新卡的完整闭环未实测**（依赖 Bug-01 修复后的成功锚定） |
| 19 | Quick Tours 播放器（步骤跳转/`code://` 联动/返回） | 🟡 | 播放链路历史轮次 ✅；**本轮 tours 数据为空，空态引导未体验（待确认）** |
| 20 | 索引进度 StatusStepper / Watcher 状态 | 🟡 | 状态点/文案已验；完整索引过程中进度推进未等全程 |
| 21 | 左栏符号类型过滤（symbol-kind-filter） | ⛔ | 未深测（时间盒限制，Round2 亦未覆盖） |
| 22 | 移动端/窄视口 375/768/1024 | ✅ | 本轮新覆盖；发现 R3-Bug-03/04（r3-45~50） |
| 23 | 键盘可达性（Tab 焦点顺序/aria 全量审计） | ⛔ | 仅验证 Esc 关弹窗与 Ctrl+K；**系统性可达性审计未做** |
| 24 | PrivacyPill 点击行为 | ✅ | 无行为（纯展示+title），P3 建议 |
| 25 | consent 隐私确认弹窗（允许/取消/每页会话一次/门控） | ✅ | r3-15/16 |
| 26 | 浏览器 back/forward/reload 状态同步 | ✅ | 含演进卡回放 |
| 27 | SSE 断线自动重连 | ⛔ | 代码有 transient/permanent 分支；**未人为断流实测** |

---

## 4. 体验优化与 Vibe 建议 (UX Polish & Enhancements)

* **[交互微调]** PrivacyPill（"远程模型 · api.\*\*\*.com"）做成可点击：展开一个小浮层显示 LLM host/模式/隐私规则摘要（数据现成），或至少加 `cursor-default` 并弱化按钮感，避免新手"点了没反应"。
* **[文案调优]** 排障/追踪失败类信息统一走"一行摘要 + 可折叠详情"模式（与 R3-Bug-02 修复联动）；原始 git/引擎日志对用户是噪音，对排查是珍宝，折叠起来两者兼得。
* **[状态可视]** 演进失败历史卡收起态只有 ⚠ + intent 截断，建议加红色"失败"徽标或 error 首行摘要（展开已有全文，成本低）。
* **[引导闭环]** 空态 placeholder 与真实能力强耦合——示例句必须来自"当前仓库可成功"的目标（与 R3-Bug-01 修复联动），否则引导即陷阱。
* **[体验冗余]** 窄视口 Tab 栏建议直接采用横向滚动 + 渐隐边缘提示（成本最低的方案），并把"演进推演"在窄屏下前移或置顶，主推功能不该排在遮挡区里。
* **[测试基建建议]** 建议把"elementFromPoint 中心点命中自身"作为 TopBar 的 Playwright 回归断言固化进 CI（本次遮挡视觉上不显眼、截图难以发现，hit-test 断言才是可靠的）。

---

## 附：本轮体验环境

* 被测版本：CodeCompass v0.21.0（2026-09-05 构建）
* 隔离实例：`127.0.0.1:48731`（独立 data-dir `cc-data-r3`，未触碰用户 43110/5173 服务）
* 测试仓库：cc-self（314 文件，master）、verify-routes（Java shop 14 文件，master）
* 工具链：Playwright 1.61 + Chromium 1234（`chromium-1234/chrome-win64/chrome.exe`）
* LLM：用户配置的远程 DeepSeek（flash），经 consent 弹窗门控，全程测试数据、无生产数据操作
