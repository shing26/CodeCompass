# 05 — Monaco inspector with code:// deep links, glow and nav stack

**What to build:** 开发者点击 Mermaid 图节点或源码卡片后，Inspector 面板打开对应文件：通过 `GET /api/repos/:id/file/raw?path=` 加载源码到只读 Monaco，定位到目标行区间，首次跳转时触发 1.5s glow 高亮（amber 装饰），breadcrumb/标题更新并 push 进导航栈；Inspector 支持后退/前进。统一 `code://` handler 在此 ticket 落地：解析 `code://<FilePath>#<StartLine>-<EndLine>` 并路由到 Inspector。

**Blocked by:** 01 — Workbench scaffold and repo connect; 04 — Source trace drawer with anchored code cards

**Status:** done

- [x] 解析 `code://` 深链并打开对应文件（404/路径错误时有友好提示，不崩溃）
- [x] 文件加载后滚动到目标行，首次跳转触发 glow 高亮（重复跳转不重复 glow）
- [x] 导航栈：每次跳转入栈，back/forward 可往返
- [x] 组件测试覆盖：深链解析、文件请求 mock、glow 触发时机、导航栈行为

## Comments

### 2026-08-21 implementation
- `App.tsx` 接入 `useInspector(client, repoId)`；Canvas `onNavigate`（MermaidDiagram 节点点击 + SourceTraceDrawer 源码卡片，均走 `code://` parse 后回调）统一路由到 `inspector.openFile`。
- `useInspector.ts`：`getFileRaw` 加载 + 模块级 `FILE_CACHE`；`stack/index` 导航栈；`glow` 1.5s 定时清除；repo 切换清空状态与栈；加载失败以错误面板呈现（不崩溃）。
- `Inspector.tsx`：只读 Monaco；glow 由 effect 驱动（`editorReady` + `glow/file` 依赖），每次跳转/后退/前进重新定位高亮，不再只在首次 onMount 触发；`handleMount` 只负责存 editor ref。同时清理了重复的 `import type { editor }` 残留。
- 测试：`useInspector.test.ts`（8 条：加载/缓存/导航栈/错误/无 repo/切换清空/glow 定时清除）、`Inspector.test.tsx`（8 条：空态/loading/错误/语言与内容/glow 触发与清除/未跳转不 glow/重复跳转 re-glow/back-forward）、chat.test 新增 1 条端到端：anchor 卡片点击 → Inspector 加载文件（mock Monaco）。
- 环境修复：`monaco-editor` 只带 `module` 字段（无 main/exports），vite-node 无法解析其入口 —— App/chat/Inspector 三个测试文件统一 `vi.mock('./client/monacoSetup', ...)`（Inspector 测试额外 mock `@monaco-editor/react` 的 default export）；生产构建不受影响。
- 验证：`typecheck` ✓、`npm test` 39 passed（22 → 39）✓、`npm run build` ✓（monaco+mermaid 使 bundle ≈4.4MB，chunk 警告，非 gate，后续动态导入可优化）。