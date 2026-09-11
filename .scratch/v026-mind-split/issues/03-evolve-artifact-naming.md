# 03：A03 — 演进侧工件命名族（惯例归一 / 推演卡退场 / Sidebar 中文）

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch/v026-mind-split/spec.md`（裁决 Q4/Q5/Q8）；glossary 惯例归一（Pattern Ingestion→惯例嗅探）与工件卡族已钉。*

Status: closed
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

## Comments

### 实施记录（2026-09-11，ZCode）

- EvolutionView：落位方案→**落位表**、死代码级联(N)→**死代码清单(N)**、风险与建议→**风险 Checklist**、变更清单→**落位表·变更**（后按 review P1 改按 intentType 收口，见下）、ScenarioGuide ②**惯例冲突** ③ spec 清单 4 逐字（含底线句）。
- Sidebar：节标题 `Evolution`→「规范演进」、按钮「演进推演工作台」→「规范演进」（与 tab label 同文，Q8 令）；未新增 chat 入口。
- CONTEXT.md glossary：`Pattern Ingestion（模式嗅探）`→`（惯例嗅探）` 销 v0.26 grill 遗留。
- 测试：EXTEND 用例补四段名正断言 + 全树旧名负断言 + ScenarioGuide ②③独立正断言；DEPRECATE 用例补「拆除清单」断言；Sidebar 新 describe（testid 直断）。web **317/317** 连续两轮绿（中间一次 Node OOM/env flake，重跑自证；C 盘满，TMPDIR 指 D 盘）、typecheck 净。
- **票面失效项勘正**：Key interfaces 列「TopBar evolve tooltip：生成防误删推演卡→…」——A01 已按 spec 清单 1 把 evolve tooltip 整句换成定位句（无推演卡），本票对 TopBar 零触碰成立。
- **豁免判定登记**（review 复核全绿）：`STAGE_LABEL.pipeline='演进推演'` 属 Q5 阶段名白名单；但 **spec 括注「第五阶段名」有出入——演进推演实为第 4 阶段**（intent_parse/target_resolve/convention_scan/pipeline/diagram），且该 label 走 SSE payload（服务端契约，零后端约束不动）。括注按事实记此，代码不动。

### Reviewer-Security 独立审查（阻断 ship → 全项处置）

- **[P1] `落位表·变更` 泄漏 DEPRECATE 面**：checklist 区标题硬编码，DEPRECATE 的 DELETE 拆除清单顶着「落位表」名号——恰是票面用户场景点名的"同屏多词"病灶。修：`intentType === 'DEPRECATE' ? '拆除清单' : '落位表·变更'`（spec Q5 原文只给 EXTEND 语境名，DEPRECATE 侧按 ADR-0006「清理 Checklist」语取「拆除清单」）+ 正/负断言入 DEPRECATE 用例。
- **[P2] 视觉层**：`风险 Checklist` 的 h3 带 `uppercase` → 浏览器实际渲染「CHECKLIST」与 glossary 混排失配，jsdom 测不到——去 uppercase，登记进 A04 截图核对清单专项。
- **[P2] 负断言作用域**：全树 not.toMatch 保留 + ScenarioGuide 步骤②③独立正向断言补齐。
- **[P2] Sidebar 测试结构耦合**：`closest('section')?.querySelector('h2')` null 时假通过——节标题补 `sidebar-evolution-head` testid 直断。
- **[P2] 移交登记（不阻断）**：MCP 工具 `codecompass_module_evolution` description 与 `README.md:179` 的「模块演进推演」不在本票（触碰面=apps/repoqa-web），随下次文档票统一；`docs/adr/0014,0015` 的「模式嗅探」残留同移交。

### 验收 checkbox

- [x] 用户可见文案内「推演卡」「约定冲突」grep 零命中（命中仅剩哨测负断言正则与代码标识符）
- [x] evolve 视图内卡型名与 glossary 四段一一对应；「落位表」出现、「变更清单」退场（EXTEND 落位表·变更 / DEPRECATE 拆除清单，按 intentType 收口）
- [x] Sidebar 中文门牌，与 tab label 完全一致（测试断言）
- [x] 触碰测试逐条随改；web 全量绿（317）
