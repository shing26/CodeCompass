# 01：A01 — 问现状/要方案定位句落地（tab tooltip + 空态 + 入口名）

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch/v026-mind-split/spec.md`（裁决 Q2/Q8）。*

Status: ready-for-agent
标签：enhancement / P2 / 来源：v0.26 预留 A（问答/演进口心智分离）

## Agent Brief

**Category:** enhancement（文案/引导重排，纯前端）

**用户场景：** 新人第一次打开工作台，在「架构问答」与「规范演进」之间犹豫——两个名字都偏抽象，hover 提示一个说"只读咨询"一个说"生成推演卡"，分不清哪个能问、哪个会给出改动方案，生怕点错就让系统改了代码。修复后：tooltip、画布空态、视图内引导共用同一对定位句「**问现状** →架构问答」「**要方案** →规范演进」，且"引擎只读，改动由你执行"在两侧都能看到，新人 10 秒内能选对入口。

**Summary:** 落地 Q2 定位句到读侧动线全部锚点；读侧命名唯一化（去"助手"、"新对话"→"新会话"）。写侧锚点在 A03，本票不越界。

**Key interfaces:**
- TopBar TABS 的 chat/evolve 两条 title（措辞见 spec 逐面清单 1）
- ChatView 侧栏品牌名、空态引导句（追加底线声明）、会话标题「新对话 ·」→「新会话 ·」
- Canvas 空态 ②③：改「两动词 + 四设施」结构（spec 清单 6）
- DashboardView「提问」按钮：**独立子任务，只改名「查调用链」，接线零变化**（防实施时误动 trace 流）

**Acceptance criteria:**
- [ ] chat/evolve tooltip 按 spec 措辞落地；「读侧/写侧」在用户可见文案零出现
- [ ] ChatView 命名唯一化（架构问答／新会话）+ 空态底线句「引擎只读，改动由你执行」存在断言
- [ ] Canvas 空态含「问现状」「要方案」前置动词结构；375px 不溢出（测试断言文案，截图核对在 A04）
- [ ] （独立子任务）DashboardView 按钮「提问」→「查调用链」，既有 trace 断言零修改通过
- [ ] 触碰测试的文案断言逐条列出并随改；web 全量绿（基线 284 起）

**Out of scope:** PlanCardView（A02）、evolve 内命名族（A03）、Sidebar 改名（A03）。

**Blocked by:** None — can start immediately.

**触碰面声明：** apps/repoqa-web（TopBar/ChatView/Canvas/DashboardView + 对应测试）。零后端。
