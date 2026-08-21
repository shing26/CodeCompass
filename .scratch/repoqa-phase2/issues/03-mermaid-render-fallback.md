# 03 — Mermaid render with graceful fallback

**What to build:** SSE `mermaid` 事件到达后，开发者能在 Canvas 中看到交互式 Mermaid 图（复用 `mermaid` 库渲染 sequence diagram，节点可点击——点击派发 `code://` 深链 URL，由统一 handler 消费，见 05）；Mermaid 解析失败时降级为带语法高亮的原始代码块，页面不白屏不丢内容（spec 11.3 / NFR-1）。

**Blocked by:** 02 — Quick Tour and SSE streaming chat

**Status:** ready-for-agent

- [x] `mermaid` 事件渲染为可交互图；渲染中显示骨架占位
- [x] 图节点点击派发 `code://<FilePath>#<StartLine>-<EndLine>` 深链
- [x] 非法/解析失败 mermaid 代码降级为代码块展示，不崩溃
- [x] 组件测试覆盖：合法 mermaid → 渲染、非法 mermaid → 降级代码块、点击回调派发正确 URL

## Comments

### 2026-08-21 implementation
- `src/client/mermaidRenderer.ts`：mermaid 初始化 + `render()` 独立成模块（测试可 mock，jsdom 不做真实 SVG 测量）。
- `src/components/MermaidDiagram.tsx`：渲染 SVG；失败降级为代码块（spec NFR-1）；`parseDeepLink` / `parseClickBindings` 解析 `code://` 与 `click Node "code://..."` 绑定；点击文本框名匹配 binding → onNavigate(file, line)。
- `useChat` 支持 `mermaid` 事件（存入 message.diagram）；Canvas 在 assistant bubble 渲染 diagram。
- 注意：后端当前 `traceToMermaid` 输出 `flowchart LR` 且不带 click 指令——深链绑定由前端解析，等到 anchors/trace 数据齐备后 04/05 会完善点击目标。
- 验证：typecheck 通过；`npm test` 19 passed；`npm run build` 成功（mermaid 使 bundle ≈1MB，chunk 警告；后续可动态导入优化，非 gate）。