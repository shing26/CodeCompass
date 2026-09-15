# 07：G7 — 命名族文档票（销 V27-2、V27-3、V27-4）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（表 B 文档侧；D1 射程内统一措辞票）。*

Status: open
标签：命名族 / 文档 / 来源：v027 台账 V27-2/3/4。

## 现状

活残留（侦察定版）：agent.ts:19,23 系统提示词「拆除计划」（模型可复述进答案）；README:62 模块演进副驾、:63/:64 下线/挂载推演、:177 1-Hop/Hop、:181「模块演进推演」、:37「架构指标」；ADR-0014/15「模式嗅探」（**正文不改写**，历史记）；CONTEXT:75 惯例嗅探词条、:77 Evolution Workbench 中文含「推演」、:4 版本行滞后 0.26.0；CiGateView ScenarioGuide :288-291 三步旧动线（V27-4）；chat/routes.ts:170 + chat.test:426,479 同词。

## Agent Brief

**Summary:** ①agent.ts 两处改「下线方案」系表述（:19 触发条件保留删除/清理/下线同义词，防工具触发灵敏度回归）；chat.test mock 文案同步；②README 五处按表 A/B/C 人话化（:181 行工具描述对齐现英文 Deprecated 描述的中文人话；:177 Hop 字样→一跳/上下游人话）；③CONTEXT.md：:4 版本行修正、:75 词条改「代码惯例扫描」、:77 词条中文名去「推演」、**新增「用户文案规范（User-Facing Copy）」词条**（中文 chrome + 工程通用语保留 + 机器值走展示映射——把 D3/D4 定案收进 glossary）；④ScenarioGuide 三段化（V27-4）：步骤文案用本战役新词，旧复制命令动线改真实动线；⑤ADR-0014/15 不改正文，本票面登记「历史记录不改写」裁决。
**Acceptance:** ①表 D 第一层黑名单随本票补齐（拆除计划/模式嗅探/架构指标入全表扫，服务端哨覆盖 agent.ts）；②cp 全量绿（agent 提示词改动不触既有行为测试——工具触发逻辑零改动是硬约束）；③web 绿（ScenarioGuide 测试断言同票改）；④README/CONTEXT 与代码实态抽查一致（Reviewer 轴复核）。

## Comments
