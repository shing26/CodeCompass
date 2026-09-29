# Issue 01 — IA 还原：TopBar 5 一级 + 体检面骨架 + 响应式收纳

> 波次：波 1 ｜ 状态：**已落地（2026-09-29）** ｜ 优先级：P0 ｜ 依赖：线级前置（v1.1.0 已发版 ✅）｜ 依据：spec D3

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
- 2026-09-29 **落地**：
  - **一级导航 3→5**（`TopBar TABS`）：chat / **topo（代码拓扑，回归一级）** / gate / delta / **scan（体检）**；旧标签原样复用（「代码拓扑」v0.30 G3 已过哨文案）。「体检」title 显式写红线语义——「引擎只报确定性事实，语义判断交给对话」。
  - **metrics 一跳可达**：more 菜单（⋯）新增「架构仪表盘」入口（`menu-metrics`）→ `onSelectView('metrics')`；`mode=metrics` 深链契约零改动（DashboardView 仍由 else 分支渲染）。
  - **`?mode=scan` 深链**：`viewFromMode` 增量 + URL 同步 effect 增 `view==='scan' → mode=scan`；**选库前 scan 有自己的「未选库」态**——App 分支把 scan 置于 `noRepo` 兜底**之前**（深链不再走「inert behind the topo guide」例外路径），`activeView` 相应放行 scan（tab-scan 未选库时也高亮一致）。
  - **ScanHealthView 骨架**：未选库 / 索引中（indexing/cloning/parsing）/ error / 就绪空态四态（票面三态 + error 引导「重新索引」为顺手补全）；空态文案即票 02 预告（五桶 + 精度态势 + 红线声明）；红线断言入组件测试（不出现「可安全删除/死代码」）。
  - **响应式收纳（任务 5）**：核实 Round 3 Bug-03 换行机制已在位（<1280px tabs 独立成行 `w-full flex-wrap`，≥1280px 单行；右簇 xl 收缩、more-menu 有 fixed backdrop）——5 tab 直接受益，**零新增布局代码**；375px 截图走查归票 07 收口 Round4（ui-shots 本地不入库）。
  - **验收**：① App.test 5 tab + topo 回归断言（点击即回画布）+ topo 恢复后反转票 05 的「无页签」断言；② `?mode=scan` 选库前（未选库态）/后（就绪态）一致生效 + URL 存活断言；`mode=metrics/evolve/incident/diff` 既有断言零回归；③ 截图走查归 Round4（上述）；④ copy-guard 双哨绿（web 355 全绿含 copy-guard）+ UI 冒烟 PASS（18 步，含 v1.1.0 冒烟修复的深链切回）；⑤ 零服务端 diff（纯 web 面，cp/e2e 豁免留痕）。
  - 门禁：web **355/355**（347+8）、build 净、UI 冒烟 PASS；控制面/e2e 零 diff 豁免。
