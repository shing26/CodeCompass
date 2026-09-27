# Issue 05 — Web 收敛 6 → 3（**条件票**）

> Spec：`.scratch/v031-precision/spec.md` §1.2（冻结面）、§1.3（待裁决项）
> 波次：视裁决择机 ｜ 依赖：无 ｜ 状态：**✅ 落地（2026-09-27）**

## 目标

把 Web 工作台从 6 个一级页签收敛为 3 个，其余降为深链页面——**只减不增**，让「演示厅」定位落到结构上。

## 现状证据

`apps/repoqa-web/src/components/TopBar.tsx:51-60` 的 `TABS`：

| id | 现状标签 | 处置 |
|---|---|---|
| `chat` | 架构问答 | **保留一级**（问现状 = A 线唯一面向人的入口） |
| `delta` | Diff 影响面 | **保留一级**（架构差异 = 面向 PR 的核心动作） |
| `gate` | 变更审计 | **保留一级**（门禁 = B 线延伸的展示面） |
| `topo` | 代码拓扑 | 降为深链页面（调用链走查仍在，从证据卡/深链进入） |
| `metrics` | 架构仪表盘 | 降为深链页面（Overview 信息可由 chat 与 side 面板承接） |
| `evolve` | 规范演进 | 降为深链页面（演进工作台保留能力，不占一级导航） |

## 约束（硬）

- **深链契约零改**：`cockpitLink` / `navSeq` / `open-chat` 等既有深链路径必须全部可达（`RepoContext` 的 view-sync 逻辑与注释见 `HANDOFF` 约定）。
- **不新增任何 UI 特性**；不趁机做视觉/文案调整（`copy-guard` 双哨维持现状即可）。
- 前端源文件数与代码量**净减**为验收方向（迁走的页签若产生孤儿组件，一并删）。
- 受影响的单测随行迁移；web 363 基线全绿。

## 验收

- [x] 一级导航 3 项（页签组件内 `TABS` 长度 = 3，`grep -c "id: '"` 留证；chat/gate/delta）
- [x] 三个降级页面深链可达：topo = `?repo=X&focus=Y`（默认视图 + 证据卡/侧栏进入）；metrics = `?mode=metrics`；evolve = `?mode=evolve`（侧栏入口保留）。**App.test 两条深链用例留证**（URL-as-truth 选库后落点断言）
- [x] web 单测全绿（347）；**净减 −454 行**（含 4 个 test-only 组件 + 其测试出库：EvidenceCard/Markdown/SourceTraceDrawer/StackTraceInput，verdicts 移除候选兑现）；grep 零残留
- [x] 无新增 UI 特性、无新文案战役（diff 面自查；EvolutionView 头部仅**搬迁**既有「要方案」定位句——页签降级后句子的新锚点，copy-guard 封条同步）
- 补充：`viewFromMode` 与 URL 同步 effect 增量识别 `mode=metrics` / `mode=evolve`（纯增量，既有 mode 语义零改）——否则降级页签的深链在选库前被 URL 同步 effect 抹掉（实测发现，正是"深链契约零改"要防的那类暗坑）

## 备注

本票是唯一「面向人」的减法动作：它服务的不是 A 线精度，而是**定位清晰度**（v0.26–v0.30 的教训）。若用户裁决为「资产优先」，本票直接关闭并在总账留痕，不影响其余票。
