# Issue 01 — IA 还原：TopBar 5 一级 + 体检面骨架 + 响应式收纳

> 波次：波 1 ｜ 状态：ready-for-agent ｜ 优先级：P0 ｜ 依赖：线级前置（v1.1 波 2 收口后开工）｜ 依据：spec D3

## 1. 实测（2026-09-28）

- 票 05 后一级导航 = chat/gate/delta 三项；`topo`/`metrics`/`evolve` 走 `viewFromMode` 深链（`RepoContext.tsx:26`，已支持 `mode=metrics/evolve` 增量）。
- `WorkbenchTab = 'topo' | 'metrics' | 'gate' | 'delta' | 'incident' | 'evolve' | 'chat'`（`types.ts:138`）——7 值全保留，收敛只发生在 TopBar/App 层，本票在同层做增量。
- Round3 实证：6 tab 时 TopBar 单行 `flex h-12` 溢出（tabs ~367px + 右簇 ~380px，`docs/reports/产品体验报告-Round3.md:104`）——**5 tab 必复发，响应式收纳是本票必做项不是可选项**（spec D3 推论）。
- 票 05 实测教训在档：`mode=` 深链若不同步保留，「选库前深链被 else 分支抹掉」（`RepoContext.tsx` 票 05 注释）——`mode=scan` 照同一写法做。

## 2. 任务

1. TopBar 一级导航 5 项：chat / topo / gate / delta / **体检**（tab id `'scan'`；中文文案「体检」过 copy-guard 双哨，不在黑话/退役表则放行）。
2. `topo` 恢复一级且为选库默认落点（App.test 既有「lands on the topology workbench」断言保持）。
3. `WorkbenchTab` 增 `'scan'`；`?mode=scan` 深链 + URL 同步 effect（复用票 05 增量模式写法）；`metrics`/`evolve`/`incident` 深链原样保留。
4. metrics 并入 topo：DashboardView 的数据在 topo 内一跳可达（入口形态实现者定：侧栏区块/页内切换均可），`mode=metrics` 深链指向该落点。
5. TopBar 响应式收纳（照 Round3 处方可裁）：`lg` 以下 tabs 移独立行 + `overflow-x-auto`；`sm` 以下右簇收缩（隐私胶囊缩色点、复制上下文缩图标）；more-menu `fixed` 定位。
6. 体检 tab 骨架：空态 / 未选库 / 索引中三态（数据面归票 02，本票只落骨架与空态文案）。

## 3. 验收（机器可验证）

1. App.test：5 个一级 tab 断言 + topo 为选库默认落点断言。
2. 深链回归：`?mode=scan` 在选库前/后都生效（防票 05 教训复发）；`mode=metrics/evolve/incident` 既有断言零回归。
3. 窄屏：375px 视口截图入 `docs/reports/ui-shots/`，tabs 与右簇无溢出（走查留档）。
4. copy-guard 双哨绿；`npm run test:web` 全量绿；UI 冒烟绿。
5. 零服务端 diff（纯 web 面，cp/e2e 豁免留痕沿 v0.30 G 票惯例）。

## Comments

- 2026-09-28 立项（grill D3 定案 5 一级蓝图）。
