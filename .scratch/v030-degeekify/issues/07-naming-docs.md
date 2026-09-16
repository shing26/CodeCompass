# 07：G7 — 命名族文档票（销 V27-2、V27-3、V27-4）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（表 B 文档侧；D1 射程内统一措辞票）。*

Status: closed
标签：命名族 / 文档 / 来源：v027 台账 V27-2/3/4。

## Agent Brief

**Summary:** agent.ts「拆除计划」改「下线方案」系表述（触发条件保留同义词防灵敏度回归）；README 五处人话化；CONTEXT 词条修订+新增「用户文案规范」；ScenarioGuide 三段化；ADR 正文不动登记裁决；「拆除清单」入黑名单、cp 挂账清零（销词同 commit）。
**Acceptance:** ①双哨零残居；②cp 全量绿（工具触发逻辑零改动）；③web 绿；④README/CONTEXT 与代码实态一致（Reviewer 轴复核）。

## Comments（2026-09-16 实施收口）

- **agent.ts 系统提示词（V27-2 主案）**：:19 触发条件「演进或拆除计划」→「演进或安全下线方案」并**显式列同义词**（拆除/删除/清理/下线同样触发——工具调用灵敏度零回归的保险写法）；:23 「给基于证据的拆除计划」→「下线方案」；:26 「一次性执行拆除」→「一次性执行下线」。chat/routes.ts:170、chat/chat.test.ts:426/479（mock 文案）、RepoQAClient.ts:872（web 侧注释）同词族清理。**V27-2 病灶根除**：模型不再可能把「拆除计划」复述进答案（提示词面），copy-guard 封条继续拦 web 侧回潮。
- **黑名单与挂账**：「拆除清单」「受波及」入 contracts 共享表；cp 哨 PENDING_RETIREMENT **清零**（「拆除计划」随本票销——销词与摘挂账同 commit 纪律第二次实战兑现）；灵敏度自证改为内存注入构造（PENDING 空后不再依赖活文案，含「现行文案已无该词」反证断言）。
- **README 五处**：:37 架构指标→结构规模（人话枚举）、:62 节名去「副驾」（与 CHANGELOG 历史名区分：CHANGELOG **不改**，历史记录不改写惯例）、:63/:64 安全下线推演/扩展挂载推演→安全下线分析/扩展挂载分析、:177 1-Hop/1~3 Hop→上游 1 层调用方+下游 1~3 层被调方、:179 受波及→受影响、:181 「模块演进推演」→「模块演进（已弃用，由 plan_evolution 接替）」与 MCP 注册表现状对齐。**裁决记录**：:178 VERIFIED/BROKEN/SUSPECT 保留——工具输出契约值字面，README 工具表面向集成者属机器面（D3/D4 同哲学）。
- **CONTEXT 词条八改一增**：状态头补 0.29.0/0.30.0 版本叙事；Blast Radius/Live Trace Strip/Candidate Scan/Gate Run/Intent→Artifact/问现状要方案/Physical Anchor 六条随用户文案改名对齐（受影响/步骤/落地建议/方案卡/精确定位注记/影响树）；Pattern Ingestion 词条改「代码惯例扫描」附曾用名注记；Evolution Workbench 改「规范演进」与 UI tab 对齐；**新增「用户文案规范（User-Facing Copy）」词条**（D3/D4/D8 定案收编 glossary：中文 chrome+通用语保留+机器值展示映射+双哨同表+同 commit 纪律）。**ADR-0014/0015 正文「模式嗅探」不改**——ADR 是决策历史，改写=篡改现场；术语演化由词条曾用名注记承载。
- **ScenarioGuide 三段化（V27-4）**：CiGateView 导览旧「复制命令为主」三步改为真实动线（配置基线→本地运行落史回看→复制命令对接 CI/CD），与 v0.26-B 三段化后的控件一致；EvolutionView 三步 G5 已同步新词。
- 门禁：双哨绿（web 7/7、cp 5/5，残居归零）| web **363** | cp **650**（工具触发行为零改动为硬验收，全绿证）| tsc 四包净 | dist 重建 | e2e **62/62**（LLM 清空对照组）| UI 冒烟 + docker v030g7（结果见 commit）。
- 补记：G5 push（a1c5f23）与 G6 push（328737d）的 CI 全绿含 docker-build job——G5 本地 registry EIDLETIMEOUT 判瞬时网络坐实，容器面双票均有 CI 凭据。
