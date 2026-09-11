# 03：B03 — 行内受波及树 + 锚点跳 Inspector（B 系列体验闭环）

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch\v026-gate-history\spec.md`（裁决 Q10；ADR-0013 白名单核对见下）。*

Status: ready-for-agent
标签：feature / P2 / 来源：v0.26 预留 B（受波及树）

> *B02 已 closed（表格宿主就位：CiGateView 三段化 + GateRunRow 类型 + runGate/listGateRuns，web 基线 300）。B03 可开工。*

## Agent Brief

**Category:** feature（树渲染 + 既有导航契约复用）

**用户场景：** 门禁历史表已经能告诉用户"这次 FAIL 波及了 7 条路"，但想知道**哪条路由被谁拖下水**就得自己翻 JSON 或重跑 delta。修复后：展开任意历史行 →「受波及树」两层铺开（路由 → 受影响符号，HIGH 红/MEDIUM 橙/LOW 灰徽章）→ 点任意符号节点，Inspector 直接开对应文件切片（375px 窄屏抽屉同样能弹开）——从"哪条线越界"到"越界代码现场"三次点击内完成。

**Summary:** 消费 `gate_runs.payload_json` 的 `impactedApis`（routeSymbol + affectedBySymbols + riskLevel，与 ArchitectureDeltaView 同源字段族），div 列表两层渲染；零新图形技术（ADR-0013 无涉——不产图，树是结构呈现）。

**Key interfaces:**
- 树数据 = B01 payload_json 直出（表管查询、blob 管回放，Q12 裁决——**不得**要求后端加结构化列）
- 节点点击 → `onNavigate(file, line)` → Inspector `openFile`（票 11 navSeq 契约已保证窄屏复点同文件可开——直接受益，勿重新发明）
- 行展开态本地 state（与 B02 表格行合并渲染）；空 impactedApis / 无 commit 历史行的降级态

**Acceptance criteria:**
- [ ] 展开行 → 树渲染 route→symbols 两层 + 风险徽章着色断言
- [ ] 点击节点 → Inspector 面包屑显示目标 file、glow 行到位；error 行不可展开（无 payload）
- [ ] 375px：从历史行节点跳 Inspector 抽屉弹出（复用票 11 测试模式）
- [ ] 深链回放一致性：同一 run 展开的树与其 commit 流匹配（用 GET ?commit= 过滤取数，不猜）
- [ ] web 全量绿；既有 B02 断言零修改

**Out of scope:** mermaid/图谱化呈现、跨 run 对比视图、导出工件。

**Blocked by:** 02-gate-history-panel（表格宿主先存在）。

**触碰面声明：** apps/repoqa-web（CiGateView + 测试）。零后端。
