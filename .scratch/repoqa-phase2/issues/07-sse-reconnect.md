# 07 — SSE reconnect resilience

**What to build:** 开发者网络抖动导致 SSE 断开时，已渲染内容不丢失，前端自动重连（最多 3 次指数退避），重连后后端继续推送剩余事件；重连失败达到上限时展示明确错误状态与手动重试入口，页面不白屏。

**Blocked by:** 02 — Quick Tour and SSE streaming chat

**Status:** done

- [x] 断开后已渲染 token/mermaid/anchors 全部保留
- [x] 自动重连 ≤ 3 次指数退避；失败后显示错误状态 + 手动重试
- [x] 组件测试覆盖：断开 → 内容保留且重连、重连失败 → 错误状态（注入 fake SSE client）

## Comments

### 2026-08-21 spec
- spec NFR-1 / plan §11.3：SSE 重连入 Phase 2 gate。

### 2026-08-21 implementation
- `RepoQAClient.ts` QueryStream：接管 EventSource 的重连循环——`onerror` 时 `safeClose()` 旧连接（抑制浏览器静默重连）→ 按 `base * 2^(attempt-1)`（默认 500ms）退避重开同一 URL，至多 `maxReconnectAttempts=3` 次；3 次后发 `{kind:'permanent'}` 并 finish。`done`/`repoqa.query.error` 后立即 close source，避免后端 `res.end()` 的 EOF 被 EventSource 当成断线触发虚假重连（真实后端下的隐藏 bug）。新增导出类型 `StreamError = transient|permanent`；构造器注入 `reconnectBaseMs`/`maxReconnectAttempts` 便于测试。`close()` 清理退避定时器。
- `useChat.ts`：新 `reconnecting` 状态与 `retry()`。transient 错误：仅重置 in-flight 助理气泡（text/diagram/anchors 清空）供重放，完成过的气泡不受影响——因后端 query 无 resume、重连会从头重放，不清空会重复 token；permanent 错误：error + break 标记 + 手动重试入口；重试复用最后提问、不新增 user 气泡。重构共享 `attachStream()` 供 submit/retry 复用。
- `Canvas.tsx`：`streaming && reconnecting` 时显示 `reconnecting-indicator`（"连接中断，正在自动重连…"）；error 行加 `retry-query` 重试按钮。
- 测试：`RepoQAClient.test.ts` 新增 4 条（退避重开并继续收流、预算耗尽 → permanent、close 取消待开、done 后 EOF 不重连）；`chat.test.tsx` 新增 2 条（transient：完成气泡保留 + 重连指示 + 重放恢复；permanent：break-marker + 错误 + 手动重试单 user 气泡重跑成功）。
- 全套 55 测试通过 + typecheck ✓ + build ✓。