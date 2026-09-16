# 05：G5 — 黑话清扫（前端+服务端双端，销 V27-11③）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（表 B 全量；D4/D8 双端同改）。*

Status: closed
标签：文案 / 跨端 / 来源：v027 台账 V27-11③。

## 现状

前端可见黑话 ~40 处 + 服务端 worker 中文 stage label（SSE 渲染进 UI）+ agent.ts 系统提示词。侦察实证闸门冲突活例：「演进推演」被 Canvas.test/Sidebar.test 禁出现，EvolutionView STAGE_LABEL 与 worker label 却在用——本票了结。

## Agent Brief

**Summary:** 按表 B 全量替换（意图解析/目标锚定/惯例嗅探/演进推演/图谱投射/拓扑收敛/跨语言桥接/AST 提取/2-Hop/锚定/孤岛/波及/工件/落位/[cite 引导语字样/物理锚点/零幻觉锚定/拆除清单），前端 STAGE_LABEL 与服务端 worker label **双侧同步**；stage **id** 与 payload 字段一律不动；`架构指标` 导出标题原计划本票处理，**已提前由票 03 代偿**（cp 英文哨拦路虎）；`[cite: N]` 机器格式与 rewrite 保留，仅引导语人话化。退役中文词入表 D 第一层，测试注释顺手清。
**Acceptance:** ①表 B 退役词 web+cp 双哨零残留；②cp 650 + web 363 全绿（fixture/断言/注释同票改）；③golden eval 97（e2e gate 内含）零翻车；④e2e 62；⑤docker；⑥UI 冒烟。

## Comments（2026-09-16 实施收口）

- **双端同改清单**：worker.ts 九处 label/phaseLabel（需求理解/目标定位/代码惯例扫描/方案生成/图表生成/代码解析/跨语言关联/结构收敛）↔ EvolutionView STAGE_LABEL 五行 + StatusStepper 三档 label 同步（stage **id** 与 phase 枚举零动，e2e 五阶段序列断言绿为证）。
- **前端用户文案**：波及→影响（受影响 N/canv as 受影响/影响范围/影响树/被影响的调用方→受影响的调用方）、落位→方案系（方案清单/方案·变更/改动目标/落地建议/下线清单）、锚定→定位（目标定位/未定位到目标/逐字可查/精确定位）、孤岛→孤立代码、工件→方案（方案卡/方案流；export-artifact 本工件→本文件）、演进推演→方案生成（含按钮 开始生成方案/追加方案/方案生成中…/会话切换中断句）、意图解析→需求理解、惯例嗅探→代码惯例扫描、图谱投射→图表生成、拓扑收敛→结构收敛、跨语言桥接→跨语言关联、AST 提取→代码解析、解析 AST→正在解析代码结构、2-Hop 关联切片→上下游关联切片、[cite 字样三处引导语人话化（「证据角标」「逐条按证据查证」；ChatView 解析 regex 与后端指令零动，D4）。
- **闸门冲突活例了结**：「演进推演」自此双端绝迹（Canvas.test:86/Sidebar.test:273 负断言拆写存续；EvolutionView/worker 正主换词）——前后端漂移病的一例根治。
- **黑名单扩 14 词**入 contracts（惯例嗅探/演进推演/落位/锚定/波及/孤岛/工件/拓扑收敛/图谱投射/意图解析/跨语言桥接/AST 提取/解析 AST/2-Hop/物理锚点）；扩词后**哨自报 60 处残居全在测试**（fixture label 双侧同步、断言文本更新、注释顺手清、旧名退场数组/regex 拆写构造）——机制闭环：先扩表后清扫，残居无处藏（G1 设计意图实战兑现）。
- 门禁：tsc 四包净（终跑随收口）| web **363** | cp **650**（双哨绿：中文全文扫含注释 + 英文区域扫）| e2e **62/62**（LLM 变量清空对照组；golden eval 97 题内含零翻车）| UI 冒烟 PASS | docker v030g5 构建+/health（见 commit 记录）。
- 留后：agent.ts:19/:23 拆除计划与 :38 拆除清单注释、README/CONTEXT 旧词、ScenarioGuide 步骤文案（CiGateView 三步滞后段）归票 07；mermaid 伪元素 BROKEN（index.css）归票 06。
