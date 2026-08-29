---
status: accepted
---

# Story Beats 只落在自包含工件端，Web 端推 v1.0

分步演播带（Story Beats）在导出的单文件 HTML 中以内联 JS 状态机实现（Prev/Next + 代码切片联动）；Web 驾驶舱端不做。理由：Web 端接入需要 SSE/API 把 diagnose/evolve 的步骤数据传给前端，而现有 ChatMessage 协议没有步骤概念——这是一次协议扩展，与 v0.9 的其余交付正交；工件端自包含、离线、可随 PR 归档，已承载演播的全部价值。代价：同一份诊断在 Web 上看不到演播带；将来若做，需新增协议字段并把该组件落在 Canvas 侧（v0.8 深链契约不变）。
