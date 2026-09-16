# 06：G6 — styles.css 全迁清零（销 V27-11⑤，D7）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（D7：全迁清零；U1 遗留迁移窗）。*

Status: closed
标签：视觉 / 债务清零 / 来源：v0.27 台账 V27-11⑤。

## 现状

styles.css 85 行 4 段：plan 卡（.plan-risk/.plan-action 三对红橙绿 rgba 绕 token）、`.chat-starter` 死胶囊、starter 网格、scenario 导览（#fff）；index.css 两处 shadow 字面量复刻 accent。

## Agent Brief

**Summary:** 4 段全量迁 Tailwind 语义类，styles.css 销号；mermaid 伪元素角标中文随本票；shadow-neon 改 token 引用。
**Acceptance:** ①styles.css 不存在；②web 全量绿（class 断言同票改）；③实拍对比（G8 集中）；④e2e/冒烟绿。

## Comments（2026-09-16 实施收口）

- **销号**：`styles.css`（85 行）删除，main.tsx import 摘除并改注（全仓视觉语言自此只剩 index.css 一套 token 源）；`.chat-starter` 旧胶囊段+重复 `.chat-starters` 死定义经查零消费直接消失（starter 现形=grid 段迁移目标）。
- **迁移**：PlanCardView 整卡（card/head/risk/action/progress/bottomline/note/group/item/cta 十类）→Tailwind + Badge 双件复用（risk-high/medium/low 与 action-delete/modify/create 的 rgba 硬编码色就此退场，改走 danger/warning/success token——**自动跟双主题**，旧 rgba 三色是 cyber 主题下的错色残留）；勾选态 `done` class→`line-through opacity-60`；ScenarioGuide 三类→Tailwind；ChatView starter 卡网格+chat-model summary→Tailwind（13.5/12.5/12/11px 旧值收进 text-xs/micro 语义档）。
- **index.css 顺刀**：`.ccx-node-broken` 伪元素 `content:'BROKEN'`→`'断链'`（表 C 同词，G4 移交项兑现）；伪元素角标 9px→10px（D5 同档）；`--shadow-neon` 双主题定义去 accent 字面量复刻，改 `rgb(var(--color-accent)/α)` 引用；styles.css 语义别名层（--accent/--text/--muted/--danger/--warn/--ok/--border/--panel-2 八枚）经查唯一消费者即 styles.css，随其退役删除（A02 时代补定义的双源病灶收口）。
- **测试联动 3 处**：PlanCardView.test `.plan-card-head/.plan-card/.plan-progress` querySelector→getByTestId（新 testid 补挂，选择器语义等价迁移）；`.done` class 断言→`line-through`。其余 class 断言零存在（全量 363/363 绿为证）。dist CSS grep 旧类名 0 残留。
- **留注**：`chat-hint/chat-msg/chat-side` 等聊天骨架 hook class 无样式定义（纯锚点，v0.27-UI 票 01 起即如此）——不属本票 styles.css 清零射程，登记不动。
- 门禁：tsc 净 | web 363 | vite build 成（dist CSS 零旧类）| UI 冒烟 PASS。**e2e/docker/cp 豁免**（纯 web 面，零服务端 diff）。实拍 before/after 随 G8 集中兑现。
