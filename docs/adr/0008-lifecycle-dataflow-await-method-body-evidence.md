---
status: accepted
---

# Lifecycle 与 Dataflow 视图推迟至方法体级证据就绪（v1.0）

v0.9 计划书要求状态机（Lifecycle）与事件流（Dataflow）视图，但现有调用图只记录 calls，不做任何方法体分析：枚举状态迁移检测是全新提取器，`@Async`/`@EventListener`/MQ API 识别为零且 v0.7 已因 Spring 代理调用消歧复杂而明确推迟（`.scratch/v0.7-semantic-canvas/spec.md`）。决定：v0.9 只交付 Architecture 与 Sequence 两个数据已 backed 的视图；Lifecycle/Dataflow 在工件中渲染诚实的 "v1.0" 占位 Tab，绝不依据无证据的猜测生成图（延续 ADR-0002）。代价：本版工件只有两视图；收益：零假数据，占位即 backlog 公示。
