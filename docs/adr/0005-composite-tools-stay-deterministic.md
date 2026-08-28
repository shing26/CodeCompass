---
status: accepted
---

# 复合 Agent 工具保持确定性，LLM 只做编排叙述

v0.8 计划书原稿把"4 层穿透探查"与"LLM 推理"混在同一层，且要求新建 `agent/react-engine.ts` 重写约 200 行 ReAct 循环。核实发现 ReAct 循环已在 `repoqa-llm.ts`（`runReActAgent`）落地。决定：`codecompass_diagnose` / `codecompass_refactor_plan` 做成纯确定性图谱查询（零 LLM、可单测、可重放，输出与索引一一对应），复用既有 ReAct 循环只负责编排工具调用、生成叙述性 rootCauseSummary 与可选补丁。理由：真理之源红线（ADR-0002）要求链路追踪 100% 可审计，LLM 参与 会破坏可重放性与单测性；代价是 LLM 不参与"发现"，漏检场景只能靠图谱能力增强解决。替代方案（新建 agent/ 目录重写循环、工具内直接调 LLM）被否。
