# Issue 04 — 视图小债包（V27-16 / V27-6 / V27-7 / V27-5）

> 波次：波 1（排票 01 后段）｜ 状态：**已落地（2026-09-29）** ｜ 优先级：P1 ｜ 依赖：票 01 ✅ ｜ 依据：spec D4；台账源 `.scratch/v027-backlog.md` 各行（冻结标注随本票解除）

## 1. 四件（每件一个可断言验收）

### ① V27-16 topo 首屏自动 trace 选题
- 现状：选题偏技术侧（本仓选中内部 query 路由而非核心业务，computer-use 走查 D6 实证）。
- 做法：候选改 dashboard `topApis` / inDegree hub 优先，纯内部路由降级；无候选不硬凑（「不编步骤」纪律，v0.31 票 17 先例）。
- 验收：选题来源可断言（本仓跑一次，选中的是 hub/topApi 符号而非纯内部路由；用例内固定）。

### ② V27-6 风险色族跨视图统一
- 现状：同「风险」概念两套配色——gate 树红/橙/灰 vs ArchitectureDeltaView 黄/蓝/绿。
- 做法：统一语义 token（沿 Badge tone 族；v0.30 G4 的 Badge/CountPill 双件是唯一权威），两视图同概念同色。
- 验收：组件测试断言两视图同 risk 级渲出同 token；快照/testid 集合比对沿 G4 工艺。

### ③ V27-7 gate run 渲染上限
- 现状：超大 run 的 impactedApis 全量进 DOM（gate 运行史子表不受 `maxAffectedRoutes` 截断）。
- 做法：slice + 尾行「…N 条」计数；纯前端防护，服务端零动。
- 验收：>N 条夹具渲染断言（DOM 行数 ≤ 上限且尾行计数正确）。

### ④ V27-5「查调用链」名实升级（半件收尾）
- 现状：按钮跳 topo 后不聚焦目标；`open-chat`/`onOpenChat` 标识符名实不符（AskDock 落地后入口孤岛前提已消）。
- 做法：跳 topo 复用 deep-link `?focus=` 聚焦链路；标识符重命名（纯内部）。
- 验收：点击后 focus 生效断言；grep 零 `open-chat` 残留。

## 2. 搭车（P3 可裁）

- `saveWorkbenchCard` error 卡 echo 持久化（Round3 `:41`）——**若票 02 未顺手收**则归此票，二收一即可，不重复做。

## 3. 通用验收

- `npm run test:web` 全量绿；UI 冒烟绿；copy-guard 双哨绿；零服务端 diff（③ 为纯前端 slice，cp/e2e 豁免留痕）。

## Comments

- 2026-09-28 立项（grill D4「视图小债包」打包解冻；四件皆台账在册小票，各自独立可断言，允许拆单提交）。
- 2026-09-29 **四件全落地**（含一处根因修正——④的实因比走查记录更深）：
  - **① V27-16（修在引擎侧，根因比 D6 记录更糟）**：probe 实测 self 仓 topApis 前 5 **全是 `USE *` 中间件挂载符号**（http-error.test.ts 测试文件 + http.ts），D6 记录的「内部 query 路由」只是表象。修法 = `repoqa-dashboard.ts::apiEntryCandidates` 两处降噪：测试路径过滤（复用 `isTestPath`）+ `USE` 挂载点排除（v0.31 票 17 引入的中间件链符号不是 API 入口；**注意首修漏网**——`calls>0` 第一条件仍放行带边的 USE，已补显式排除并用例钉住）。修后 topApis 首位 = `GET /api/chat/status`（真实 API）。属「同一工具输出更准」（双轨制允许）；web 侧零改动（自动 trace 读的就是 topApis[0]）。**「inDegree hub 优先」变体未做**：dashboard 载荷无逐符号 inDegree，需契约加法——触发线：若路径规则在真实仓库被证不足，再立契约票。
  - **② V27-6**：`riskTone` 提公共到 `ui/Badge`（唯一 tone 权威旁），delta 视图弃黄/蓝/绿裸类改 `Badge + riskTone`（红/橙/灰）——顺带修了它渲染**英文原值**而非 `statusLabel` 中文映射的同期缺陷；跨视图同概念同色 + 同文案。断言升级（原文 `getByText('HIGH')` → 中文 + text-danger）。
  - **③ V27-7**：gate 运行史影响树 `slice(0, 50)` + 尾行「…其余 N 条未展开（共 M 条受影响路）」；数据层零改动，纯 DOM 防护；60 条夹具用例钉住（50 分支 + 尾行计数）。
  - **④ V27-5**：名实升级——「查调用链」按钮从 `onOpenChat`（只切视图）改为 `onTraceTop`（**复用行点击的 handleTrace**：跳拓扑 + 确定性聚焦首条 Top API；无候选退化纯切视图）；标识符全面重命名（`open-chat`→`open-trace-top`，props/tests 同步）——V27-5 台账两半（名实 + 重命名）一次清偿。
  - 门禁：web **356/356**（355+1 新截断测）、cp **771/771**（770+1 引擎测）、eval 9 桶 100%、typecheck 净、e2e **72/72**、UI 冒烟 PASS；probe 留档 `.scratch/v1.2-workbench-revival/probe-topapis.ts`（可复跑前后对照）。
  - **搭车项**：`saveWorkbenchCard` error 卡 echo 持久化（Round3 `:41`）已在 v1.1 票 02 评估时顺手收（当时未动——**本票亦未动**：该 P3 属服务端 workbench 路由，与视图小债包不同面；留在 v1.2 台账，若票 02 体检数据面动 workbench 路由时顺手收）。
