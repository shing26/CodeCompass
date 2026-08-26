# Changelog

## [0.5.0] - 2026-08-27

### Highlights

- **Polyglot AST 解析**：`LanguageAdapter` 抽象层统一 Java、TypeScript/JavaScript、Go、Python 的符号提取与调用边建模，跨语言调用链可在同一个证据面上连通。
- **跨语言契约桥接**：TypeScript/JavaScript 的 `axios` / `fetch` 调用可直接桥接到 Java Spring、Express、Gin/Fiber、FastAPI/Flask 路由，调用链不再止步于前端 API 层。
- **8 大标准 MCP 工具**：新增 `codecompass_get_subgraph_context`，与仓库发现、调用链、看板、配置证据、Tour、反向依赖、PR 影响面共同组成完整 Agent 工具集。
- **Graph RAG 子图提取**：基于 `resolveStartSymbolForQuery` 做 1-Hop Caller + 1~3 Hop Callee 双向检索，类骨架折叠、优先级队列 Token 剪枝与 13 类凭据脱敏，纯本地确定性输出。

### Added

- `services/control-plane/src/repoqa-graphrag.ts`：Graph RAG 子图提取核心算法。
- `LanguageAdapter` 与 `JavaAdapter`、`TypeScriptAdapter`、`GoAdapter`、`PythonAdapter`。
- MCP 工具：`codecompass_list_repos`、`codecompass_reverse_deps`、`codecompass_get_subgraph_context`。
- CLI：`codecompass context <query> [repoPath]` 子命令。
- HTTP：`GET /api/repos/:id/subgraph-context`。
- Web：Inspector“复制 Agent 上下文”按钮、侧边栏即时检索、按仓库保留聊天记录、Local-First 隐私药丸与 Token 溯源。
- MyBatis XML 数据层穿透：Mapper/DAO 最后跳可定位到 XML 中的 SQL 与物理行号。
- 官方分发与 CI 协同：npm 单包 `codecompass`、`.github/actions/architecture-diff` PR 评论门禁。

### Changed

- 统一入口解析为 `{ symbol, fallback, confidence }`，architecture 与 call-chain 共享语义解析链路。
- 全部 package.json 与运行时版本同步到 `0.5.0`。
- 大仓导入进度改为实时 `parsed/total`，Worker 内存符号图缓存避免重复全表扫描。

### Fixed

- 修复“静默编造答案”：兜底入口强制标记 low-confidence 并输出固定提示。
- 修复浏览器历史、冷启动 glow、API JSON 404、临时目录污染索引等体验缺陷。
