# 02：A02 — 方案摘要卡重塑（Plan Digest + CTA 跳演进）

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch/v026-mind-split/spec.md`（裁决 Q3）；glossary 已钉 Plan Digest 词条。*

Status: ready-for-agent
标签：enhancement / P2 / 来源：v0.26 预留 A

## Agent Brief

**Category:** enhancement（前端组件重塑 + 1 条接线）

**用户场景：** 用户在「架构问答」问"这个仓库哪里最值得改"，答案流里冒出一张带勾选框的「🧹 拆除计划」卡——只读免责声明只有 12 字藏在卡片角落，用户以为系统要开始拆代码，慌了；另一面老用户想顺着方案去演进工作台，也没有路。修复后：该卡以「**方案摘要**」名义出现、头部常驻「引擎只读，改动由你执行」、右下角「在规范演进中展开 →」一键跳进 evolve——问答里的方案输出从尴尬点变成两视图的桥。

**Summary:** PlanCardView 更名 + 底线声明常驻头部 + 新增可选 prop `onOpenEvolution`（CTA），App 组合层接 `goEvolution`；勾选行为语义不变（本地追踪）。

**Key interfaces:**
- PlanCardView：卡名「拆除计划」→「方案摘要」；底线句从内部小字升为头部常驻行；CTA 按钮（无回调时不渲染，保 3 处既有渲染点测试零改动）
- ChatView → PlanCardView 传递链：`planCards` 载荷协议零变化（CM-01 卡片化 v2 资产冻结）
- App.tsx 接线：`onOpenEvolution={goEvolution}`（RepoContext 已有）

**Acceptance criteria:**
- [ ] 「拆除计划」在用户可见文案 grep 零命中；「方案摘要」出现
- [ ] 底线句常驻头部（非折叠/非角落）断言
- [ ] 组合测试：问答答案含 plan 卡 → 点 CTA → view 切到 evolve
- [ ] 勾选框本地追踪行为回归通过；done.payload.planCards 契约零变化（无控制面 diff）
- [ ] web 全量绿

**Out of scope:** 摘卡/协议裁剪（Q3 已裁）、evolve 侧文案（A03）。

**Blocked by:** None — can start immediately（与 A01/A03 并行；App.tsx 触碰面此票独占）。

**触碰面声明：** apps/repoqa-web（PlanCardView/ChatView/App.tsx + 测试）。零后端。
