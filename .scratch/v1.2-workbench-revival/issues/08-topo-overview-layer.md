# Issue 08 — 拓扑概览层：让「代码拓扑」首屏回答「这仓库结构是什么」

> 波次：Round4 缺陷批 P2 收尾 ｜ 状态：**已落地（2026-10-01）** ｜ 优先级：P1（新手最大流失点） ｜ 依赖：票 01 ✅ ｜ 依据：Round4 走查 R4-7；双轨制自查：**零 MCP 改动**（复用 `/dashboard` 与 `/radar` 两个既有端点）

## 1. 病灶实测（推翻票面初稿的假设）

初稿写的是「拓扑主画布近乎空白」。进代码核实后**前提被推翻**：

- `ChatRuntimeContext.tsx:139-155` 有「改造 2 (zero-click value)」——进入 topo 时**自动对首条 Top API 发起一次确定性 call-chain**。所以画布并不空，QA 看到的 `步骤 1/5 POST /api/jobs/{job_id}/refresh` 正是本仓首条 Top API。
- 真病灶是两条，比「空白」严重：
  1. **首屏被一条用户没要求的样本链路占满**，而它对「这仓库是什么」零回答（2109 符号 → 1-2 张孤立卡片）；
  2. 该链路**无任何来源标注**——它是别的视图（仪表盘/问答）或自动逻辑留下的产物，画布自己不解释（走查原文「来历不明」）。
- 而能回答这个问题的数据**一直都在**：`GET /api/repos/:id/dashboard`（技术栈 / 10 项规模 / Top API 入口）与 `GET /api/repos/:id/radar`（枢纽符号 / 持久层实体）。dashboard 的渲染器 `DashboardView` 自 R4-13 起被藏进「⋯ 更多操作 → 架构仪表盘」，**一级导航里恰好没有一个视图首屏回答结构问题**。

## 2. 设计（grill 裁决 + 未答项取默认）

1. **形态＝概览层 + 钻取**（grill Q1 用户选定）：画布顶部常驻「这仓库是什么」，链路降为下半部分的下钻结果。否决「首屏导览层」（仍是说明书不是答案）与「画布改结构总览」（工作量与深链语义重做）。
2. **数据源＝双源 + 强制共享子组件**（grill Q2 用户未答，取推荐默认）：`dashboard`（规模 + Top API 入口）+ `radar`（枢纽）。**不是两个渲染器各写一遍**——`ScaleBlock` / `TopApiBlock` / `HighlightChips` 三块从 `DashboardView` 原样抽出，两处共用（票 09/10 单表派生的同一条纪律：同一概念只能有一处实现）。
3. **零新增端点**：dashboard 走 App 的 `useDashboard` 全局数据（只透传，不重复请求）；radar 空 query 即可运行（服务端已有 `(repoId, query)` 60s TTL 缓存）。符合 ADR-0020 的 Web 面边界。
4. **不废自动链路，只给它自报家门**：保留「零点击价值」，但链路区上方加来源标注（`auto-topapi` → 「自动示例：首条 Top API」）。停用它是更彻底的方案，但那是行为删除，风险高于收益，留作触发线。
5. **文案红线**：枢纽只写确定性度数（「被调 118 · 调用 94」），不写「核心业务」「应该先看」；PageRank 小数只进 `title` 备查（v0.30 去极客化：工程通用语保留）。`DATA_MAPPER` 补进 `statusLabel` 单一映射表（此前原样透传英文）。

## 3. 验收

1. 组件测试：概览层渲染规模/枢纽/持久层、枢纽与入口各截 5 条并明示省略数、两源互不牵连（radar 挂 → 规模入口仍在；dashboard 挂 → 枢纽仍在）、未索引仓不渲染空壳、两种下钻分别回调。
2. Canvas 测试：四种来源标注各显名；无链路时不出现来源行；数据三件套未接时不渲染概览层。
3. UI 冒烟新增 1a 段（真 chromium 首屏）：概览层可见、枢纽列表可见、自动示例链路带来源标注。
4. 全量门禁：web 单测 390、e2e 73、冒烟 PASS。

## Comments

- 2026-10-01 立项（grill-me R4-7）：Q1 形态选定；Q2 数据源与其后各项用户未答，按推荐默认推进并全部记档，可逐条推翻。
- 2026-10-01 **落地**：
  - **共享子组件**（`components/overview/`）：`ScaleBlock`（10 项规模网格 + `SCALE_ORDER` 单一落点）、`TopApiBlock`（`limit` 收敛概览侧，`hidden` 明示「另有 N 个入口未展示——完整清单见架构仪表盘」）、`HighlightChips`；`DashboardView` 改为消费三者（其 `SCALE_ORDER`/入口列表/高亮组原样删除，无第二实现）。
  - **`RepoOverview.tsx`**：框架高亮 + 结构规模 + Top API 入口（limit 5）+ 枢纽 Top5 + 持久层计数；两个数据源各自独立失败态，互不牵连；未 ready 仓直接不渲染。
  - **`Canvas`**：概览层插在深链横幅与链路卡之间；`trace-origin` 行只在有链路时出现；空态引导文案改为「先看结构规模与枢纽符号、再点进去看调用链」。
  - **`ChatRuntimeContext`**：新增 `traceSymbol(name)`（枢纽点击与 ChatView 证据角标共用一条 call-chain，删掉 App 里那段重复提交逻辑）与 `traceOrigin` 状态（`chat` / `dashboard-entry` / `overview-hub` / `auto-topapi`）。
  - **`statusLabel`** 补 `DATA_MAPPER: '数据映射'`。
  - **验收**：组件 8 + Canvas 4 条新用例；冒烟 1a 三步（真 chromium 首屏，概览/枢纽/来源标注全过）；web 390/390、e2e 73/73、冒烟 PASS。
  - **未做（留触发线）**：停用自动示例链路；概览层的枢纽接入 `?focus=` 深链；枢纽的 file/line 直跳（radar `hubNodes` 不带 `filePath`，当前只能走 call-chain）。
