# Issue 24 — Evolution Workbench(架构演进推演台)

## 决策依据
- ADR-0012(accepted):只读架构雷达与演进顾问定位;Intent→Artifact 交互模型;Artifact Stream 按 (repoId, commit) 隔离;Incident 收编专用控制台。
- ADR-0013(accepted):图谱几何由确定性引擎垄断渲染,LLM 只出结构化图层指令(图型/focus/折叠/注释);否决边级校验与主张分级。
- ADR-0014(accepted):Pattern Ingestion 三层契约(引擎惯例清单[锚点+覆盖率] / 引擎落位表 / LLM 骨架标注 llm-generated);仲裁 = 近邻优先、全局多数兜底、披露强制、不出双变体。
- ADR-0015(accepted):自由文本意图入口(LLM 单次意图解析 + 引擎意图锚点落地);Issue 24/25 打包方案。
- Dual-Surface 确认(2026-09-01):MCP 感知面 v1 冻结为现有 8 工具;MCP 永不内置 LLM 编排;Web 与 MCP 消费同一份引擎输出。

## 已核实的现状锚点(实现时以此为准)
- `repoqa-llm.ts` `finalizeAgentResult`:mermaid 走 `sanitizeMermaidClicks`(仅 click 格式过滤,**边不校验**——ADR-0013 迁移期缺口,本 Issue 修复);`CODE_LINK_MMERMAID_GUIDE` 需改写为图层指令规范。
- 引擎渲染白名单(ADR-0013):`repoqa-worker.ts` `traceToMermaid`(trace hop 物理建图)、驾驶舱配置拓扑(Issue 12)、Tour 路线(Issue 11)。新图型必须先落引擎。
- `module_evolution`(repoqa-worker.ts buildAgentTools):EXTEND(挂载点+事务边界+解耦脚手架)与 DEPRECATE(固定点级联孤立死代码+清理清单)已存在,无 Pattern Ingestion 消费。
- `domain_radar` 意图锚点:模糊匹配链 + doc-chunk 证据 + 图排名增益,零 embedding——ADR-0015 意图解析的目标落地用它。
- eval:`repoqa-eval.ts` bucket 三指标(幻觉率/Recall/锚点有效率),`bucketPasses` 发布 gate;incident bucket 75 题冻结中(勿动已冻结题)。
- MCP:`repoqa-mcp.ts` 8 工具、对 LLM 层零 import(已核实);本 Issue **不动 MCP**。

## Tickets
- `issues/01-diagram-layer-contract.md` — 图层指令契约:ReAct 产出契约改 `diagram: {kind, focus, collapse, annotations}`;引擎侧新渲染分发器(白名单图型);finalizeAgentResult 剥离模型 mermaid;prompt 指南改写;eval 自绘 mermaid 断言项下线 + 新增"边全部来自 Call Edge"断言。
- `issues/02-pattern-ingestion-engine.md` — 惯例嗅探引擎(复合工具,零 LLM):v1 嗅探轴(统一返回包装/接口-实现风格/Base 类与 DTO 惯例/DI 风格/包路径惯例);每条断言带锚点+覆盖率;近邻优先→全局多数仲裁 + 强制披露结构。
- `issues/03-evolution-pipeline.md` — EXTEND/DEPRECATE 消费 Pattern Ingestion:落位表(包路径/注入点/事务边界)与惯例清单一致性引擎自查;DEPRECATE 清单照旧(不受嗅探影响);骨架仍由 LLM 生成但输入改为惯例清单,标注 llm-generated。
- `issues/04-evolution-view.md` — Evolution Workbench 视图 v1:意图框(自由文本)→ 意图解析回显(resolved target + 备选,披露不反问)→ 四段工件卡(惯例清单/落位表/死代码清单/风险 Checklist);卡片入 Artifact Stream;深链与 code:// 跳转接 Inspector。
- `issues/05-artifact-stream.md` — Artifact Stream 会话形态:工件卡时间线替换聊天流;(repoId, commit) 隔离;追问 = 新意图投递。
- `issues/06-gate-and-docs.md` — eval 新 bucket(意图解析命中率/惯例锚定正确率)+ 幻觉率 gate 扩展到边级 + 全量回归 + CONTEXT/CHANGELOG。

## 非目标(v1 明确不做)
- 不动 MCP 工具面(演进类工具归 Issue 25)。
- 不改 IncidentView(工件流收编归 Issue 25)。
- 不做跨仓库记忆、不接 APM、不产 patch(红线沿用)。
- 不动 eval 已冻结的 75 题 incident/architecture 等 bucket 题面(只增新 bucket)。

## Open Questions(实现中回填)
- 图层指令的 `kind` 枚举 v1 集合(call_chain / config_topo / tour 之外是否需要 blast 图?)——Ticket 01 定。
- 嗅探轴的 TypeScript 侧 v1 子集(现有工程 Java 为主)——Ticket 02 定。
- 意图解析 eval 的题面来源(从冻结 75 题库复用意图句式)——Ticket 06 定。
