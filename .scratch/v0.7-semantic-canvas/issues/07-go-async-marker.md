# 07: Go [async] 标记

Status: ready-for-agent

## 问题

GoAdapter 零处引用 `GoStatement`：`go worker.process(msg)` 的调用边正常存在（rebuttal：链不断），但无任何异步语义标记，读图者不知道这是并发分支。`go func(){...}()` 匿名闭包本无目标可连，闭包体内调用记到外层函数——维持现状。

## 任务

1. tree.iterate 识别 `GoStatement` 节点，其内部 CallExpression 产生的调用边打 `async: true`（调用边结构最小扩展，同步 contracts 若需）。
2. 调用链 mermaid 中 async 边显示 `[async]` 标签（复用现有 `-->|label|` 机制）；子图/卡片有对应视觉标记（文案即可，如 `go` 前缀徽标）。
3. 单测：`go worker.process(msg)` 边带 async 标记；普通调用边不受影响。

## 验收

- 单测绿；gate 的 Go fixture 加 `go` 语句并断言 async 边存在。
