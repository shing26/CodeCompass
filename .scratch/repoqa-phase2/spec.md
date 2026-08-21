# CodeCompass Phase 2 — Three-Pane Web Workbench (RepoPulse)

**Status:** ready-for-agent
**Source:** HANDOFF.md §4–5, docs/repoqa-plan.md §10, docs/repoqa-review.md §5
**Scope:** Phase 2 前端 Workbench；仅消费 Phase 1 已就绪的 RepoQA API，不改后端。

---

## Problem Statement

Phase 1 已经交付了本地 Java 静态 trace 闭环：repo 导入、AST symbols、确定性 call-chain、SSE 结构化应答（token/mermaid/anchors/done）、secret masking、事件平面与 golden eval。但这些能力目前只有 curl 级别的验证，开发者没有可视界面：他们看不到 route 列表、看不懂调用链图、无法从答案直接跳到源码行。新开发者仍然需要手动考古，mentor 仍然被打断。

Phase 2 要解决的是**体验问题**：把已验证的静态 trace 能力变成开发者真正愿意使用的三面板工作台，让"导入 → 看懂流程 → 跳到代码 → 继续或停止"这条路径的认知成本降到最低。

## Solution

构建一个三面板 Web 工作台（Vite + React 19 + TypeScript + Tailwind + Monaco + Mermaid），位于 `apps/repoqa-web/`：

- **TopBar**：repo 选择器（+ 本地导入）、索引状态 stepper、预留导出入口。
- **Sidebar**：Quick Tours 列表（首屏仅 1 个 Recommended Flow + 收起的 More Tours）、route 列表、symbol 树。
- **Canvas**：聊天流（Markdown 渲染）、Mermaid 图、Source Trace 抽屉（anchors 源码卡片）、micro-win 与 off-ramp。
- **Inspector**：Monaco 只读编辑器，支持 `code://` 深链跳转、行 glow 高亮、导航后退/前进栈。

交互流程：用户选择/导入 repo → 点击 Recommended Quick Tour（或自然语言提问）→ 前端建立 SSE 连接到 `GET /api/repos/:id/query` → 按阶段揭晓：业务概览 → Mermaid 图 → 源码卡片 → 下一步建议 → 点击 diagram 节点或源码卡片 → `code://` 深链 → Inspector 打开文件并高亮行 → 可继续提问或选择下一个 tour。

## User Stories

1. As a 新开发者, I want 首屏只看到 1 个 Recommended Flow（外加收起的 More Tours）, so that 我不需要面对三个并列卡片的决策负担。
2. As a 新开发者, I want 点击 Recommended Flow 就能自动发起一次对话, so that 我不用学习 slash command 也能看懂一条调用链。
3. As a 新开发者, I want 用自然语言提问（而不是 slash command）, so that 入口符合直觉；slash command 只作为高级快捷方式存在。
4. As a 新开发者, I want 答案按"业务概览 → 图 → 源码卡片 → 下一步"四阶段依次揭晓, so that 我逐步建立理解而不是一次被塞满。
5. As a 新开发者, I want SSE 断线时已渲染的内容保留且自动重连（最多 3 次退避）, so that 网络抖动不会丢进度。
6. As a 新开发者, I want Mermaid 解析失败时降级为带语法高亮的原始代码块, so that 图坏了也不会白屏或丢失内容。
7. As a 新开发者, I want 点击 diagram 节点跳转到准确的源码行, so that 我能立刻看到真实代码。
8. As a 新开发者, I want 点击源码卡片（anchors）在 Inspector 中打开对应文件并高亮目标行, so that 代码证据落在真实 file:line。
9. As a 新开发者, I want 首次跳转后才触发 Monaco glow 动画, so that 高亮不会在尚未跳转时干扰阅读。
10. As a 新开发者, I want Inspector 支持后退/前进导航栈, so that 我能回到上一个查看过的源码位置。
11. As a 新开发者, I want 一条 trace 完成后得到一个可量化的 micro-win（如"已确认 3 个锚点"）和显式 off-ramp, so that 我明确知道这一条流程走完了、可以继续或停止。
12. As a 新开发者, I want Static Analysis Break 被明确标记而不是被成功 toast 掩盖, so that 我知道调用链在哪断了、不会误以为分析完整。
13. As a 开发者, I want 从 TopBar 导入本地 repo 并看到索引状态 stepper（cloning/parsing/ready/error）, so that 我知道导入进度。
14. As a 开发者, I want Sidebar 展示 route 列表和 symbol 树, so that 我可以按需浏览已知入口。
15. As a 开发者, I want 同一 repo 内可连续追问, so that 我能逐步收敛问题。
16. As a 开发者, I want 在 repo 未选（空状态）时界面有清晰引导, so that 我不会卡在不知道该干嘛。

## Implementation Decisions

- **应用位置**：`apps/repoqa-web/`，独立 Vite 应用；后端 control-plane 保持不动（消费其 API，不修改）。
- **技术栈**：Vite + React 19 + TypeScript + Tailwind CSS + `@monaco-editor/react` + `mermaid`；状态管理用轻量方案（React hooks + context / zustand 二选一，首版避免重依赖）。
- **API base URL**：可配置（默认 `http://localhost:43110`），通过环境变量或启动参数注入，不在代码中硬编码数据目录/端口。
- **SSE 客户端**：原生 `EventSource`（`GET /api/repos/:id/query?question=&mode=`），解析 `token / mermaid / anchors / done / repoqa.query.error` 事件；重连逻辑最多 3 次退避，保留已渲染内容。
- **`code://` 深链协议**：形如 `code://<FilePath>#<StartLine>-<EndLine>`。Mermaid `click` 回调与源码卡片点击都统一走该协议，由单一 handler 解析并路由到 Inspector。
- **渲染顺序**：业务概览（Markdown）→ Mermaid → 源码卡片 — 按到达事件顺序自然揭晓；`anchors` 到达后抽屉展开。
- **Monaco glow**：首次跳转后对 `line_start..line_end` 设置 1.5s amber 装饰；不跳转不触发。
- **micro-win / off-ramp**：`done` 事件后展示（如"已展示 N 个锚点"）+ "继续提问 / 回到顶部" 显式出口；若上下文含 Static Analysis Break 标记（trace 不完整或 error 事件），展示显式 break 标记，不用成功 toast 掩盖。
- **首屏**：repo 未选择时展示空状态 + Recommended Flow 占位；repo 就绪后首屏 1 个 Recommended Flow + 收起 More Tours。
- **Quick Tour 数据**：基于真实 symbols（如第一个 route 或 service 入口）在本仓库侧派生预填问题；不必新增后端 API。若复用现有 `/symbols` 数据不够，可用首个 route 名构造问题。
- **不引入**：不做导出（Phase 3）、不做 onboarding dashboard、不做 commit-hash cache、不改后端 schema。

## Testing Decisions

- **主 seam**：前端组件/集成测试（Vitest + React Testing Library）驱动，mock SSE 与 REST 客户端注入（依赖注入 seam），断言外部可见行为：事件到达 → 渲染顺序、`code://` 点击 → Inspector 打开并请求正确文件、Mermaid 解析失败 → 降级代码块、SSE 断开 → 自动重连且不丢内容。
- **后端已有 prior art**：`services/control-plane/src/repoqa-http.test.ts`（21 条集成测试）已验证 API 契约；Phase 2 不重复测后端，但可加 1 条针对 `apps/repoqa-web` 的端到端 smoke：启动 vite dev → 打开 index → 通过 mock SSE 收到一次完整 query 流。
- **手动验证**：对真实后端跑通 Phase 2 gate：workbench 打开 → 导入 repo → click Quick Tour → diagram 渲染 → click node → Monaco 高亮行。
- 测试文件与被测组件同目录（`<component>.test.tsx`）或 `src/__tests__/`，与现有仓库习惯一致（Phase 1 用 `repoqa-http.test.ts` 同目录）。

## Out of Scope

- Phase 3：Onboarding Dashboard、Markdown/PNG 导出、commit-hash cache、golden CI gate、pilot。
- GitHub clone 入口（后端暂无此能力，本地路径导入即可）。
- 多语言、动态 tracing、写回/重构、协作。
- 后端任何改动（schema/API/worker）。

## Further Notes

- 术语遵循 `CONTEXT.md` RepoPulse Glossary（Anchor、Call Chain、Static Analysis Break、Quick Tour 等）。
- 遵循 ADR：本地优先只读（0001）、结构化静态分析优先（0002）、安全门禁先于 LLM（0003，masking 已在后端完成，前端不新增泄漏面）、golden dataset 先于 prompt 调优（0004）。
- 未解决的 needs-validation 项（单一 Recommended Flow 是否优于空白聊天、Day1/3/7/14 节奏、code:// 定位精度）不在本 spec 内裁决，但 spec 允许 07 之外的最小组件级 smoke 验证 code:// 定位；产品级对照实验留待 pilot。
- 敏感信息：无新增。LLM 配置仍在后端环境变量中；前端不接触任何 secret。