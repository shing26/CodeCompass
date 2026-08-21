# RepoPulse 产品设计评审与优化报告

> 本文档是 grill-with-docs 会话的产物。Product Manager、Behavioral Nudge Engine、Feedback Synthesizer、Sprint Prioritizer 对当前 PRD、技术方案与 HANDOFF 做了两轮交叉评审；本报告记录共识、分歧、决策清单与 Phase 1 优化顺序。原文 `docs/repoqa-prd.md` 与 `docs/repoqa-plan.md` 未被修改。

## 1. 评审摘要

- 日期：2026-08-20
- 输入：`HANDOFF.md`、`docs/repoqa-prd.md`、`docs/repoqa-plan.md`、`CONTEXT.md`
- 参与角色：Product Manager、Behavioral Nudge Engine、Feedback Synthesizer、Sprint Prioritizer
- 方式：Round 1 独立评审，Round 2 互相回应
- 证据策略：允许标注为 `[假设]` 的行业基准；禁止伪造访谈或行为数据

**最高优先级结论**

1. Phase 1 收缩为可验证的“本地 Java 静态 trace 闭环”：AST 符号 + SQLite + SSE + `code://` anchors。
2. Secret masking、`/file/raw` 路径穿越防护、golden dataset 与 eval harness 必须在首次真实 LLM 调用前完成。
3. 删除 `embedding` 状态与“语义检索”表述；Phase 1 只承诺结构化检索。
4. Phase 1 增加最小只读 `repoqa_events` 事件契约，SSE 预留 optional `suggested_action`。
5. TTFP、Self-Service Adoption、mentor 打断减少都改为 pilot 验证项，不做无基线承诺。

## 2. 四角色观点

| 角色 | 总结论 | 最强调的修正 |
|---|---|---|
| Product Manager | 先收缩为 Java 本地静态 trace 闭环，补证据与验收口径，再承诺 Phase 2/3 | PRD 与 plan 的能力承诺不一致；gate 只测工程实现，不测产品结果 |
| Behavioral Nudge Engine | 以最低认知成本完成“导入 → 看懂流程 → 跳到代码 → 继续或停止” | “Ready 之后做什么”是最大行为缺口；单推荐流程替代三卡并列 |
| Feedback Synthesizer | 先测量、可归因、先验证后放量 | 没有证据平面；Golden Dataset 只验证工程正确性，不验证产品价值 |
| Sprint Prioritizer | 先打通可验证的确定性索引与查询闭环，再接入 LLM | masking 与 eval 必须前置；call-edge 和 config 解析难度被低估 |

## 3. Round 2 共识与分歧

**共识**

- Phase 1 范围收敛到本地 Java AST + SQLite + SSE + anchor + masking；GitHub clone、TypeScript、embedding、PNG 导出移出首版。
- `embedding` 状态与“语义检索”在没有实现前不能对外承诺。
- Golden Dataset 先冻结真值、K、失败分类，再调 prompt/tool loop。
- 最小事件契约属于 Phase 1，不属于 Phase 2 UI 工作。
- Phase 2 首屏采用 1 个 Recommended Flow，按“概览 → 图 → 源码 → 下一步”分阶段揭晓。

**分歧与裁决**

| 分歧点 | 各方立场 | 裁决 |
|---|---|---|
| telemetry 深度 | Feedback 倾向完整 schema；Sprint 反对数据墙 | Phase 1 接入最小四类事件（query start/done、tool miss、anchor click、feedback），其余字段 optional |
| config 15 题 | PM/Feedback 倾向从 gate 移除；Sprint 不赞成静默砍掉 | config 桶只在确定性 config key 提取落地后计分，先用已知样例验收 |
| slash command | Nudge 反对作为主入口；Feedback 强调对高频用户仍有用 | 自然语言为首层入口，slash 降级为高级快捷提示 |
| 单推荐流程 | Nudge/PM 支持；Feedback 提醒可能过度收敛 | 构建 1 个 Recommended Flow，并与空白聊天入口做最小对照实验 |
| tech-lead 场景 | PM/Feedback 主张延后产品承诺；Nudge/Sprint 主张保留 reverse dependency 数据 | 延后产品承诺，但保留 symbol/edge，允许后续低成本验证 |
| mock LLM | Sprint 建议先 mock；Feedback 指出 mock 测不出幻觉 | mock 只用于契约 smoke test；golden + masking 就绪后立即跑真实 LLM 回归 |

## 4. Phase 1 优化建议（推荐交付顺序）

0. **契约冻结**：schema-first 补 `repoqa_events` 最小事件契约；SSE 事件固定为 `token / mermaid / anchors / done`，增加 optional `suggested_action`；`embedding` 状态删除或改为 `chunks_search`。
1. **Bootstrap 与基础防护**：接入 `/api/repos`、`/symbols`、SSE query、`/file/raw`，保留 `/health` 与 `/harnesses`。Gate：typecheck/test 通过、POST 返回 201、路径穿越返回 403。
2. **Symbol extraction 基础版**：先提取 class/interface/method/route 注解并持久化。Gate：PetClinic 导入后 `kind=route` 非空，已知符号命中率达标。
3. **Call-edge 解析**：先做同文件显式调用，再以至少一条真实跨层 route chain 为开环里程碑；未解析边显式标记为 Static Analysis Break，禁止补全猜测。
4. **Chunks、配置提取与 masking**：收集 README/MD/Java doc，增加确定性 config key 提取，替换 LIKE-only；masking 做成可单测工具，覆盖 LLM 上下文与前端渲染。
5. **SSE + ReAct skeleton（mock LLM）**：intent routing、tool calling 与事件流先用 mock adapter 打通，验证 SSE 契约顺序。
6. **Golden Dataset + eval harness**：固定 3 个 repo 与 commit；50 题补人工 ground truth anchors、K 口径、匹配规则、失败分类与分桶阈值；route-chain 为第一门槛，config 仅在有配置解析器后计分。
7. **真实 LLM 接入**：从 `.env` 读取 `OPENAI_API_KEY` / `OPENAI_BASE_URL`，无硬编码 URL；prompt 调优只能在第 6 步基线之后进行。

**Phase 1 DoD**

- `npm run typecheck`、`npm run test` 通过。
- 本地 Java 仓库可导入、状态可恢复，重复导入/reindex 不产生脏数据。
- 3,000 files / 500K LOC 上限生效，超限引导缩小子模块或明确报错。
- SSE 依次返回 `token / mermaid / anchors / done`，失败分类与 break 原因可追踪。
- 真实 LLM 调用前 masking 与路径穿越回归测试全部通过。
- Golden 指标按分桶输出，不再只给总分。

## 5. Phase 2/3 优化建议

**Phase 2**

- 首屏只有 1 个 Recommended Flow，另收“更多 Tours”；不展示三卡并列。
- 自然语言按钮为主入口，slash command 只作为高级快捷方式。
- 答案按“业务概览 → 图 → 源码卡片 → 下一步”分阶段揭晓；首次跳转后再触发 Monaco glow。
- 完成后给一个可量化 micro-win 和显式 off-ramp，但不得用成功 toast 掩盖 Static Analysis Break。
- SSE 重连、Mermaid 降级、`code://` 深链与 Monaco 定位纳入 Phase 2 gate。

**Phase 3**

- Onboarding Dashboard 作为一屏简报：技术栈 → 1 条关键调用链 → 核心 API → 环境依赖 → 导出。
- commit-hash cache 优先于 PNG/PDF export；export 只在用户证据证明有高频导出诉求后投入。
- 只展示配置 key 名与是否存在，不展示值或本地绝对路径。
- Phase 3 gate 改为 5–10 人 pilot outcome（任务完成率、mentor 求助数、anchor 跳转、改问与放弃率），取消“100% journeys 无需 mentor”指标。

## 6. 决策清单

| 决策 | 状态 | 关键理由 |
|---|---|---|
| 本地 Java AST + SQLite + SSE + anchor 闭环 | accept | 最小可信底座，先于一切用户侧承诺 |
| Secret masking 与路径穿越防护先于 LLM/渲染 | accept | 泄漏不可逆，成本低收益高 |
| Golden Dataset/eval 先于 prompt 调优 | accept | 没有冻结真值就无法归因 |
| `embedding` 状态与语义检索 | reject（Phase 1） | 当前无实现，不能展示不存在的状态 |
| config 15 题无解析器时计入 gate | reject | LIKE 无法稳定通过；改为确定性 key 提取后恢复 |
| GitHub clone、TypeScript、embedding、PNG export | defer | 收益未验证，且放大首版范围 |
| slash command 作为新手主入口 | reject | 新开发者不应先学命令语法 |
| 概览 / 图 / 源码 / Monaco 同时全量展开 | reject | 首次使用认知负荷过高 |
| “100% journeys 无需 mentor”指标 | reject | 未定义基线、样本与对照组 |
| 确定性 call-chain 作为已验证差异点 | needs-validation | 重载、继承、Spring proxy、MyBatis 仍需 ground truth 证明 |
| TTFP / Self-Service Adoption | needs-validation | 需要 5–10 人 pilot 与可计算事件 |
| 单一 Recommended Flow 与文案 | needs-validation | 方向合理，是否优于空白聊天需对照实验 |
| Day 1/3/7/14 节奏 | needs-validation | 需要真实回访与继续行为数据 |
| tree-sitter CLI 方案 | needs-validation | 需在 3 个目标 repo 验证解析率，失败则 JavaParser 兜底 |
| latency 口径 | 统一 | 本地 LLM 目标 ≤1.2s、硬门槛 ≤1.5s；Phase 2 单独测浏览器渲染延迟 |

## 7. 证据缺口与验证计划

**证据缺口**

- 无新开发者访谈、现场观察或支持工单，README 考古与 mentor 被打断属于 `[假设]`。
- 无 TTFP 历史基线、PR 归因口径、repo 难度校正与最小样本定义。
- 无 mentor intervention 事件；沉默不能定义为 self-service 成功。
- Golden Dataset 无冻结题目、ground truth、K 与匹配规则。
- 无 embedding 模型与召回评估；LIKE 检索对 config 问题的效果未验证。
- 无 tree-sitter CLI 版本、解析成功率和目标仓库覆盖数据。
- 无锚点点击、首次源码跳转、改问、放弃等前端行为数据。

**验证计划**

- Phase 1：eval harness 固定 repo/commit，输出按 route-chain/config/architecture 分桶的 Recall@K、line hallucination、valid anchor rate、first-token latency 与失败分类。
- Phase 2：5–10 人 pilot 采集 completed_trace、first anchor jump、question revised、mentor 求助、答案自评与放弃位置；Recommended Flow 与空白聊天对照。
- Phase 3：pilot outcome gate，不把 `<200ms re-open` 或“功能可执行”当作产品成功。

## 8. 输出与后续

- 新增 ADR：`docs/adr/0001-repopulse-read-only-local-first.md`、`0002-structured-static-analysis-over-semantic-retrieval.md`、`0003-security-gates-before-llm.md`、`0004-golden-dataset-before-prompt-tuning.md`。
- 术语已追加到 `CONTEXT.md` 的 RepoPulse Glossary。
- 原 `docs/repoqa-prd.md` 与 `docs/repoqa-plan.md` 未改动；决策确认后可据此另行落版优化稿。
