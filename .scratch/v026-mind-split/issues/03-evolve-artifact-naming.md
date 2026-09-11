# 03：A03 — 演进侧工件命名族（惯例归一 / 推演卡退场 / Sidebar 中文）

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch/v026-mind-split/spec.md`（裁决 Q4/Q5/Q8）；glossary 惯例归一（Pattern Ingestion→惯例嗅探）与工件卡族已钉。*

Status: ready-for-agent
标签：enhancement / P2 / 来源：v0.26 预留 A

## Agent Brief

**Category:** enhancement（写侧命名族统一，纯前端文案）

**用户场景：** 用户按 tooltip 学到「检查代码**约定**冲突」，进了视图看到的却是「**惯例**清单/**惯例**冲突」；步骤卡说「生成防误删**推演卡**」，产出区标题是「**工件卡**·落位方案·死代码级联·变更清单」四家之言；从侧栏进又先撞到英文节标题 `Evolution` 和第三种门牌「演进推演工作台」。同屏多词=每次都要重新猜谁是谁。修复后：冲突语系只留「惯例」、集合词只留「工件卡」、卡型名=glossary 四段、「推演」只剩动词岗、侧栏门牌与 tab 同名——写侧动线一词一义。

**Summary:** Q4/Q5 裁决的写侧落地 + Q8 的 Sidebar 改名；「规范演进」视图名本身保留（品牌词豁免）。

**Key interfaces:**
- EvolutionView：ScenarioGuide 步骤②「约定冲突」→「惯例冲突」、步骤③→四段规范名+底线句；「变更清单」→「落位表·变更」；副行/追问句工件卡族核对
- TopBar evolve tooltip：「生成防误删推演卡」→「产出含风险清单的工件卡，引擎只读」
- Sidebar：节标题 `Evolution`→「规范演进」；按钮「演进推演工作台」→「规范演进」；**不**新增 chat 入口

**Acceptance criteria:**
- [ ] 用户可见文案内「推演卡」「约定冲突」grep 零命中（变量名/CHECK 约束字符串不受限）
- [ ] evolve 视图内卡型名与 glossary 四段一一对应；「落位表」出现、「变更清单」退场
- [ ] Sidebar 中文门牌，与 tab label 完全一致（测试断言）
- [ ] 触碰测试逐条随改；web 全量绿

**Out of scope:** 读侧文案（A01）、PlanCardView（A02）、`conventionConflict` 等后端契约字段名（冻结）。

**Blocked by:** None — can start immediately。

**触碰面声明:** apps/repoqa-web（EvolutionView/TopBar/Sidebar + 测试）。零后端。
