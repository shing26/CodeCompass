# Changelog

## [0.6.0] - 2026-08-27

### Highlights

- **Resilience**：超大文件（>3000 行或单行 >1000 字符）不再拖垮索引，降级为 Tier 3 轻量提取；MCP 进程致命失败时 stdout 仍保持合法 JSON-RPC，Agent 侧不会读到半截流。
- **doctor 自诊断**：新增 `codecompass doctor`（`--json`），一键体检 Node 版本（>=24）、SQLite 原生 ABI/WAL、端口可绑定、数据目录可写与磁盘余量、本地 Ollama 健康。
- **分阶段索引**：索引进度按 DISCOVERY → AST_EXTRACTION → CROSS_LANG_BRIDGE → FINALIZING 四阶段广播（SSE/WebSocket），前端 StatusStepper 实时呈现。
- **架构差异视图**：`POST /api/repos/:id/architecture-delta` 返回新增/删除路由、断边、受影响 API 与 mermaid 图；Web 新增 ArchitectureDeltaView。

### Added

- `services/control-plane/src/doctor.ts`：五项只读体检（含临时探针文件自清理）。
- `services/control-plane/src/large-file.ts`：大文件分级提取策略。
- `packages/contracts/src/repoqa.ts`：`IndexingPhase` 与架构差异契约（含 `mermaid` 字段）。
- Web：`ArchitectureDeltaView`（统计卡片 + 路由/断边/受影响 API 列表 + Markdown 报告复制）、`StatusStepper`。
- PythonAdapter 增强：FastAPI/Flask 生态解析扩展（+161 行）。

### Changed

- 全部 package.json 与运行时版本同步到 `0.6.0`。

## [0.5.1] - 2026-08-27

### Highlights

- **消费侧多语言化**（D3/D4/D5）：techStack 识别 Java/TypeScript/Python/Go；configKeys 支持 `package.json`、`pyproject.toml`（PEP 621 + Poetry）、`.env`、yaml/properties；topApis 覆盖 Express/FastAPI/Flask 路由——dashboard/tours/MCP 不再只对 Java 有效。
- **跨语言桥接加固**（D8）：TypeScript 侧提取 `fetch`/`$fetch`/`ofetch`/`axios`（含 `axios.create`）与 `apiClient` 等封装；调用链按归一化路径（含 `/api`、`/api/v1` 变体）唯一匹配后端路由才连边，歧义显式 Static Analysis Break；新增 `GET /api/repos/:id/reverse-deps` HTTP 端点。
- **大仓导入口径修正**（D1）：行数只计源码扩展名（`.java/.ts/.tsx/.js/.jsx/.mjs/.py/.go`），日志/文档/JSON 不再误伤；超限时返回 `suggestedSubdirs` 建议而非硬报错。
- `/symbols` 返回真实 `symbolType` 枚举（CLASS/INTERFACE/FUNCTION/ROUTE/SERVICE/REPOSITORY/ADVICE/CONFIG/FIELD/MAPPER/SQL/DEPENDENCY），`.mjs` 纳入 TypeScript 解析与扫描范围（D6/D7）。

### Changed

- 全部 package.json 与运行时版本同步到 `0.5.1`。

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
