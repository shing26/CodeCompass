---
status: accepted
---

# Lifecycle 与 Dataflow 视图推迟至方法体级证据就绪

> **2026-10-19 更新（地位变更）**：ADR-0008 原把交付点写成「v1.0」。v1.0–v1.4 已连续发布，方法体级 AST 提取始终未立项、触发线（oversized 桶成为残余主因）也未被证据触发——**该日期承诺作废**，工件里的 `Lifecycle (v1.0)` / `Dataflow (v1.0)` 禁用占位已随之移除（禁用 tab 挂四个版本不再是诚实披露，只是噪音）。
> **现状 = 未排期**，触发线：出现**方法体级证据**（状态迁移 / `@Async` / `@EventListener` / MQ API）的真实需求，且该需求进入 MCP 事实面（降低误报或提升精度）——届时另立票并先过 ADR-0002 与 ADR-0008 的口径。

v0.9 计划书要求状态机（Lifecycle）与事件流（Dataflow）视图，但现有调用图只记录 calls，不做任何方法体分析：枚举状态迁移检测是全新提取器，`@Async`/`@EventListener`/MQ API 识别为零且 v0.7 已因 Spring 代理调用消歧复杂而明确推迟（`.scratch/v0.7-semantic-canvas/spec.md`）。决定：v0.9 只交付 Architecture 与 Sequence 两个数据已 backed 的视图；Lifecycle/Dataflow **绝不依据无证据的猜测生成图**（延续 ADR-0002）。代价：工件只有两视图；收益：零假数据。
