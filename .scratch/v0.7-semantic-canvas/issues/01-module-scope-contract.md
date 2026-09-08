# 01: Module Scope 契约（moduleName/qualifiedName 全链路）

Status: ready-for-agent

## 问题

多模块仓库（Maven 多模块、TS monorepo `apps/*`/`packages/*`）中同名类/函数在符号树、画布、MCP 返回中均为裸名，无模块上下文。根因：`ExtractedSymbol`（packages/contracts/src/repoqa.ts:22-30）与 `RepoSymbol`（services/control-plane/src/repoqa-repos.ts:42-82）无 moduleName/qualifiedName 字段；`detectMavenModules` 结果只发事件不进符号（repoqa-worker.ts:398）。

## 任务

1. 契约：`ExtractedSymbol`/`RepoSymbol` 增加可选 `moduleName?: string` 与 `qualifiedName?: string`（`<module>::<Name>`），向后兼容。
2. 推导：JavaAdapter 按 source root 相对 `detectMavenModules` 的模块目录得 moduleName（worker 传入）；TS/Python/Go 适配器按仓库顶层目录（`apps/web`、`packages/core` 的 `web`/`core`）推导；单模块仓库 moduleName 为空（不展示）。
3. 展示：Sidebar 符号行/Canvas 焦点标签/Inspector 在同名符号存在歧义时显示 qualifiedName（无歧义保持裸名）；MCP symbols 类返回带字段。
4. e2e gate 断言：polyglot fixture 中符号带 moduleName（如 `web`）。

## 验收

- 构造双模块同名类 fixture：符号树与调用链节点能区分 `order::ConfigService` 与 `user::ConfigService`；单测覆盖推导逻辑与前端歧义展示。

## Comments

- 2026-08-28：落地为**视图时标注**（worker `setSymbolGraph` 调 `applyModuleScopes`），
  不改 SQLite 行与 `ExtractedSymbol` 契约——单模块仓库零噪音，多模块仓库（≥2 个不同
  模块）自动注入。`/symbols` 端点从 DB 行切换为图符号，使标注（及隐式接口
  `interfaces`）对 UI/MCP 可见。前端 Sidebar 对同名冲突符号显示
  `module::Name`（`useDuplicateNames`），唯一名保持裸名。Canvas/Inspector 的
  anchor 驱动标签仍为裸名（后端 hop 契约不带 module），记录为后续增强。

- 2026-08-28（code-review 记录）：模块推导为通用启发式（首段；`apps/packages/libs/
  services/modules/projects/src` 视为分组目录取第二段），非逐 Maven module 精确匹配；
  单模块仓（含仅 `src/main/java` 布局）不标注。已知边缘：根模块 + 子模块混布时根模块
  符号会标为 `main`。缓存一致性：apply* 同步进 `getSymbolGraph` cache-miss 路径
  （code-review 指出冷启动丢标注，已修）。
