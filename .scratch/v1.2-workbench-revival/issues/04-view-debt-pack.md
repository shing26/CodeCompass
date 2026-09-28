# Issue 04 — 视图小债包（V27-16 / V27-6 / V27-7 / V27-5）

> 波次：波 1（排票 01 后段）｜ 状态：ready-for-agent ｜ 优先级：P1 ｜ 依赖：票 01（topo/gate 面还原后顺手做）｜ 依据：spec D4；台账源 `.scratch/v027-backlog.md` 各行（冻结标注随本票解除）

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
