# 01 — Workbench scaffold and repo connect

**What to build:** 开发者能打开工作台页面，从一个空状态出发：看到 TopBar（repo 选择器 + 导入入口 + 索引状态 stepper）、空状态引导；能通过输入本地路径导入一个 repo（复用后端 `POST /api/repos`），导入后 TopBar 显示仓库名与实时索引状态（cloning / parsing / ready / error，复用 `GET /api/repos`、`GET /api/repos/:id`）；索引失败时明确显示 error 原因。这是整个 Phase 2 的地基：Vite + React + TypeScript + Tailwind 应用骨架、布局 shell（TopBar/Sidebar/Canvas/Inspector 四区域占位）与 RepoQAClient。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [x] `npm run typecheck` 与 `npm run test`（app 内）通过；应用可 `vite dev` 启动
- [x] 空状态页面不是死屏：有明确文案引导导入 repo
- [x] 通过 UI 导入本地路径后，TopBar 出现仓库名，索引状态从 cloning/parsing 走到 ready
- [x] 索引 error 时状态 stepper 显示 error 与 detail
- [x] 组件测试覆盖：导入表单提交调用 client、repo ready 后 TopBar 渲染仓库信息（mock REST 注入）

## Comments

### 2026-08-21 implementation
- 搭建 `apps/repoqa-web`：Vite 6 + React 19 + TS + Tailwind 3；vitest 3 + RTL + jsdom 测试 seam（vitest 2→3 升级解决 vite 6 类型冲突）。
- `src/client/RepoQAClient.ts`：REST（list/get/import/symbols/fileRaw）+ `QueryStream`（EventSource 包装）依赖注入 seam；`resolveBaseUrl` 默认 `http://localhost:43110`，可被 `VITE_REPOQA_API_BASE` 覆盖，不硬编码端口。
- `src/hooks/useRepoCatalog.ts`：repos 列表/选择/导入/轮询（active 状态 1.5s 轮询，terminal 后停止）。
- 组件：TopBar（repo selector + 导入 dialog + StatusStepper）、Sidebar/Canvas/Inspector 三面板占位、空状态引导。
- 验证：`npm run typecheck` 通过；`npm test` 6 passed；`npm run build` 成功（dist 产出）。