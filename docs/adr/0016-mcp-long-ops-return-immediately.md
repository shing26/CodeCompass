---
status: accepted
---

# MCP 长操作立即返回，客户端轮询观测

## 背景

v0.17.0 的 `codecompass_index_repo` 是同步契约：handler 内完成 clone（≤60s）+ 全量 AST 索引后才返回 `ready`。真实 agent 会话（BossHunter 反馈）中，MCP 客户端的 stdio 工具调用普遍有 30–60s 超时——大仓库索引必然撞墙；更糟的是 clone+索引期间 repo 行尚未建立，客户端断连后 `list_repos` 里什么都不剩，agent 只能猜。

HTTP 面早已是异步模式（`POST /api/repos/clone` 返回 202 + 轮询），MCP 面当时没有沿用。

## 决定

1. **MCP 长操作立即返回**：`codecompass_index_repo` 的同步部分只做校验、clone（≤60s 上限）与 localPath 前置门禁；repo 行建立后即刻返回 `{repoId, status: 'indexing', pollHint}`，索引 fire-and-forget。
2. **状态机轮询观测**：agent 用 `codecompass_list_repos` 轮询至 `ready` 或 `error`；`error` 行携带根因摘要。
3. **同步失败不落库**：clone 失败、URL 非法、localPath 不存在/不可读——一律在 repo 行创建前抛错，不产生僵尸 `indexing` 记录。
4. **幽灵索引防线**：后台索引在两处数据表写入点（`saveFiles` 前、`upsertSymbols/upsertChunks` 前）断言 repo 行仍存在；被中途删除的索引静默终止，不复活孤儿数据。`codecompass_remove_repo` 在 `indexing` 状态下直接拒绝（与 `DELETE /api/repos/:id` 的 409 同语义）。

## 理由

- **30s/60s stdio 超时是现实约束**：Cursor/Claude Desktop 等宿主对 MCP 工具调用有硬超时，同步等待大索引等于功能性不可用。立即返回把"调用必须在超时内完成"与"索引可以跑多久"解耦。
- **失败可见性**：同步前置失败直接抛错（agent 立刻看到）；后台失败写 `error` + 根因到行上（轮询可见）。两条失败路径都不需要猜。
- **与 HTTP 面统一**：同一个 worker 状态机（idle/indexing/ready/error）服务两个入口，不再维护两套时序语义。
- **代价**：小仓库也要多一次轮询往返；接受——正确性优先于少一次调用。

## 影响

- `codecompass_index_repo` 契约变更（v0.17 同步 → v0.18 异步），是破坏性变更，工具 description 与 e2e 冒烟同步更新。
- 后续新增的任何 MCP 长操作（>5s 预期）都必须遵循"立即返回 + 轮询"模式，不得再引入同步等待契约。
