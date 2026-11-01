# 03 — 索引进度 notifications/progress 转发

Status: done

ADR-0016 轮询契约不变,补一条 best-effort 推送通道:

- `McpDeps` 增加可选 `eventBus?: EventBus`(单测不注入 → 密闭不写盘不发通知)
- `mcpIndexRepo` 收到 `_meta.progressToken` 且 eventBus 可用时,订阅 `repoqa.index.progress`,按 repoId 过滤后转发为 `notifications/progress`(`progress: percent, total: 100, message: phaseLabel + detail`)
- 索引 promise settle(含失败)后 `progress: 100` 收尾并退订;监听器抛错不得影响事件总线(EventBus 已兜)
- registerPlain 把 SDK `extra` 透传为 handler 第二参(其余 16 工具忽略)

诚实边界写进注释:通知晚于 index_repo 响应,客户端可能忽略;轮询仍是权威路径。
