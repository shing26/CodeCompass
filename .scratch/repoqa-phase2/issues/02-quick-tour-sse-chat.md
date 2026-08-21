# 02 — Quick Tour and SSE streaming chat

**What to build:** 开发者选择/导入 repo 后，首屏 Sidebar 展示 1 个 Recommended Flow（其余 Quick Tours 收起在 "More Tours" 下，来自 spec 决策：首屏不展示三卡并列）。点击 Recommended Flow 或直接在 Canvas 输入自然语言问题 → 前端建立 SSE 连接到 `GET /api/repos/:id/query?question=&mode=` → `token` 事件按到达顺序追加渲染为 Markdown，`done` 事件结束流并关闭 loading 状态；`repoqa.query.error` 事件以错误状态呈现且不中断页面。Quick Tour 是"基于真实 symbols 派生的预填问题"（例如取第一个 route 构造问题，复用 `GET /api/repos/:id/symbols`）。

**Blocked by:** 01 — Workbench scaffold and repo connect

**Status:** ready-for-agent

- [x] 首屏只有 1 个 Recommended Flow；More Tours 收起可展开
- [x] 点击 Recommended Flow 自动提交问题；自然语言输入框可手动提交
- [x] SSE `token` 事件按序追加为 Markdown，提问后出现 loading 直到 `done`
- [x] repo 未选择时不能发起 query，有明确提示
- [x] repo ready 后 Sidebar 展示 route 列表（kind=route）与 symbol 树（file → class → method 分层），点击可浏览（spec User Story 14）
- [x] 组件测试覆盖：mock SSE 注入，token 到达 → Markdown 渲染、done → 结束、error → 错误状态

## Comments

### 2026-08-21 implementation
- `src/hooks/useChat.ts`：消息列表/streaming/error；submit 创建 QueryStream，token 追加到 assistant 消息，error/done 收尾；repo 切换取消流并清空。
- `src/hooks/useSymbols.ts`：按 repoId 拉全量 symbols + `filterByKind` + `buildSymbolTree`（file → class/interface → members）。
- `src/components/QuickTours.tsx`：1 个 Recommended Flow（首个 route 派生）+ More Tours 收起展开。
- `src/components/Sidebar.tsx`：Quick Tours + Routes 列表 + Symbols 树（可展开）。
- `src/components/Canvas.tsx`：聊天流 + Markdown（react-markdown）+ 输入框；无 repo 时 empty-state（不渲染输入框）。
- 验证：typecheck 通过；`npm test` 12 passed（App 6 + QuickTours 3 + chat 3）；`npm run build` 成功。