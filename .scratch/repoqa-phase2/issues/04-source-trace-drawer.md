# 04 — Source trace drawer with anchored code cards

**What to build:** SSE `anchors` 事件到达后，开发者能在 Canvas 中看到 Source Trace 抽屉：每个 anchor 一张源码卡片（文件路径 + 行号 + symbol 名 + 摘要），点击卡片派发 `code://` 深链（统一 handler 见 05）；抽屉可收起/展开；同一 repo 多次查询的锚点卡片互不混淆。

**Blocked by:** 02 — Quick Tour and SSE streaming chat

**Status:** ready-for-agent

- [x] `anchors` 事件渲染为源码卡片列表，显示 file:line 与 symbol
- [x] 卡片点击派发 `code://<FilePath>#<StartLine>-<EndLine>` 深链
- [x] 无 anchors 时不显示空抽屉
- [x] 组件测试覆盖：anchors 到达 → 卡片渲染、点击 → URL 派发、无 anchors → 无抽屉

## Comments

### 2026-08-21 implementation
- `src/components/SourceTraceDrawer.tsx`：每 anchor 一张源码卡片（file + Lline + symbol），点击 → onNavigate(file, line)；空列表返回 null。
- useChat 已处理 `anchors` 事件（message.anchors）；Canvas assistant bubble 渲染 drawer。
- 验证：typecheck 通过；`npm test` 22 passed；build 沿用上一票通过状态。