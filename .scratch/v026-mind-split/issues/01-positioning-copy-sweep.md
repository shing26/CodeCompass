# 01：A01 — 问现状/要方案定位句落地（tab tooltip + 空态 + 入口名）

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch/v026-mind-split/spec.md`（裁决 Q2/Q8）。*

Status: closed
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
- [x] chat/evolve tooltip 按 spec 措辞落地；「读侧/写侧」在用户可见文案零出现
- [x] ChatView 命名唯一化（架构问答／新会话）+ 空态底线句「引擎只读，改动由你执行」存在断言
- [x] Canvas 空态含「问现状」「要方案」前置动词结构；375px 不溢出（测试断言文案，截图核对在 A04）
- [x] （独立子任务）DashboardView 按钮「提问」→「查调用链」，既有 trace 断言零修改通过
- [x] 触碰测试的文案断言逐条列出并随改；web 全量绿（312，基线 284 起 + 本票及 A 系列增量）

**Out of scope:** PlanCardView（A02）、evolve 内命名族（A03）、Sidebar 改名（A03）。

**Blocked by:** None — can start immediately.

**触碰面声明：** apps/repoqa-web（TopBar/ChatView/Canvas/DashboardView + 对应测试）。零后端。

## Comments

### 实施记录（2026-09-11，ZCode）

- 四靶面按 spec 清单 1/2/6/7 逐字落地。红线守住：evolve label「规范演进」、ScenarioGuide、EvolutionView、Sidebar、PlanCardView 零触碰（A02/A03 靶面）。
- **实拍发现（超出票面预期）**：`TopBar.tsx` 的 `TABS[].title` 字段自 8ac9bea 改名轮起**从未挂进 DOM**——六条 tooltip 整排是死配置，票面「hover 提示一个说只读咨询」的前提在代码层不成立（tooltip 压根不显示）。本次补 `title={tab.title}` 接线，A01 的定位句才真正 hover 可见。
- 连带后果：接线复活了 topo/metrics 两条同样从未生效的旧 title，其措辞失实（topo 宣称「Mermaid 图」但 Canvas 不渲 Mermaid；metrics 宣称「异常大文件」但仪表盘无此设施）——一并按组件现状修正并立全文哨（review P1-1/P1-2）。Canvas 组件 doc 注释的 Mermaid 残留同根清除。
- 测试：TopBar +2 例（tooltip 全文 + 六条 title 可达性）、ChatView +2 例、Canvas +1 例（存在断言先行，防 indexOf -1 空过）、DashboardView 就地强化、App.test 一处改名。web **312/312**、typecheck 净、控制面零触碰。

### Reviewer-Security 独立审查（有条件通过 → P1×3 全修）

- **[P1-1/P1-2]** topo/metrics 复活 title 失实宣称（见上）——已按实态改措辞 + 全文哨。
- **[P1-3]** Canvas 顺序哨 `indexOf` 空过：缺失项 indexOf 返回 -1 恒小于，动词退场时静默通过——补 `toContain('要方案')`/`toContain('问现状')` 存在性先行，满足 spec 验收门 2。
- **[P2→已修]** ChatView 哨测 querySelector 风格分裂——补 `chat-brand`/`chat-session-title` testid，测试改 getByTestId。
- **[P2→票面已记]** gate tooltip 顺手修（清单未列）：合法（票 15 失实文案顺手修先例，带哨），本行即补记。
- **[P2→移交 A04]** 「查调用链」按钮名实不完全符：接线仅 `setView('topo')` 不自动 trace（spec Q8 括注把"跳拓扑"与"自动 trace"两条链混为一谈；真正自动 trace 在 Top API onTrace 与 chat onNavigate）。旧名「提问」失实更重、新名净改善，本票被明令接线零变化故不改。移交 A04 或后续 polish：(i) 导航措辞「拓扑视图 · 查调用链」，或 (ii) 跳 topo 后自动聚焦（动 App 接线，另立子任务）；代码标识符 `open-chat`/`onOpenChat` 现为坏味道，与 (ii) 一并重命名。
- **判不成立项**：title 不盖可访问名/不随 activeView 漂移（静态模块常量）；读侧四文件黑名单七词零命中、无 snap 残留；glossary「问现状/要方案」词条与两条 tooltip 逐字对表全等。
- **环境提醒**：磁盘 `apps/repoqa-web/dist/` 为旧构建仍含「架构问答助手」——A04 截图核对前**务必重新构建**。
