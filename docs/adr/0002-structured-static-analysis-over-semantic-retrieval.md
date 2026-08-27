---
status: accepted
---

# Phase 1 承诺结构化静态分析，不承诺语义检索

当前 plan 的事件流包含 `embedding` 状态与语义检索相关表述，但实现只有 AST 提取、SQLite 与 LIKE 搜索，没有 embedding 模型和召回评估。决定：Phase 1 删除 `embedding` 状态与“语义检索”对外表述，只承诺确定性 AST 符号、调用边、锚点与关键词/chunk 检索；embedding 只有在 golden dataset 证明关键词检索无法达到验收阈值后再引入。理由：不能向用户展示不存在的能力，且结构化检索更容易逐条验证和审计；代价是自然语言召回更弱，需要用精确检索、别名与配置 key 提取来补偿。
