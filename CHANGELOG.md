# Changelog

## [0.9.0] - 2026-08-29

### Highlights

- **模块演进副驾**：`codecompass_module_evolution` —— DEPRECATE 管线做模块聚类、全图反向引用扫描与**固定点级联孤立死代码检测**（被独占的公共工具会被二次波及一并标出），输出五类清理 Checklist；EXTEND 管线定位挂载点、回溯方法/类/接口三级 `@Transactional` 事务边界证据，按可解释规则匹配解耦模式（Spring Event 异步 / AOP 切面 / 直接注入）并产出确定性代码脚手架。
- **领域全景雷达**：`codecompass_domain_radar` —— 全图出入度统计 + 确定性 PageRank（阻尼 0.85、悬挂节点权重每轮均匀重分配不外泄、TS fetch→Controller 桥接边计入 Controller 入度），三栏全景（Top APIs / Hub 节点 / 持久化底座）；自然语言意图锚点 = 标识符模糊匹配链 + doc-chunk 证据（中文意图的确定性桥接）+ 图排名增益，**零 embedding**。
- **多视图工件**：`codecompass export` 升级为 Architecture + Sequence 双视图 Tab（Sequence 惰性渲染，规避隐藏容器 0 宽高陷阱）；Lifecycle/Dataflow 以"v1.0 证据采集排期中"占位——没有方法体级 AST 证据就绝不渲染假图；品牌徽标（Spring/Redis/MySQL 等，依依赖关键词贴标）与 Story Beats 分步演播带（Prev/Next 联动代码切片）。
- MCP 工具升至 **12 个**；CLI 新增 `radar` 与 `evolve` 子命令。

### Added

- `services/control-plane/src/domain-radar-engine.ts`：度数聚合、确定性 PageRank、意图锚点融合打分（+7 单测）。
- `services/control-plane/src/module-evolution-engine.ts`：DEPRECATE/EXTEND 双管线（+9 单测）。
- e2e 门禁新增 6 项 v0.9 检查（radar 全景/意图锚点、evolve 双意图、多视图工件断言），总检查 **33 项**。

### Changed

- `export-artifact.ts` 重构为多视图渲染器；CLI `export` 输出 sequence 视图、品牌徽标与 Story Beats。


## [0.8.0] - 2026-08-29

### Highlights

- **专精 Agent 复合工具**：`codecompass_diagnose`（跨栈根因穿透：前端组件 → 路由 → Service → MyBatis XML，逐层 VERIFIED/BROKEN/SUSPECT）与 `codecompass_refactor_plan`（重构爆炸半径：直接/间接调用方、受波及路由与前端组件、风险评级与迁移步骤）。两者 100% 确定性、零 LLM、可单测可重放。
- **Zero-Config 安装器**：`codecompass install --ide <cursor|zcode|claude|all>` 把 stdio MCP 入口写入各 IDE 配置（Cursor 含 autoApprove 白名单），幂等合并 + 自动备份 + `--dry-run`。
- **驾驶舱深链**：`?focus=<symbol>&traceId=<id>` 现场还原、`?mode=diff` 直达架构差异视图，workbench tab 与 URL 双向同步。
- **单文件 HTML 工件**：`codecompass export` 输出自包含诊断工件（内联 mermaid 运行时，断网可渲染，可随 PR 归档），断链在拓扑图中红色描边。

### Added

- `services/control-plane/src/diagnose-engine.ts`：4 层可降级穿透引擎（Java 全栈四层全开，其他语言按实际索引层级输出），确定性 traceId 与 cockpitDeepLink、代码切片。
- `services/control-plane/src/blast-radius.ts`：覆盖全部符号（含路由）的反向邻接 + BFS 间接调用方聚合 + 风险打分（路由暴露 ×2、前端组件 ×3、REMOVAL 加权）。
- `services/control-plane/src/installer.ts`：Cursor（mcp.json + autoApprove）/ZCode（mcp.servers）/Claude Desktop 三家适配器，幂等 merge、备份、dry-run。
- `services/control-plane/src/export-artifact.ts`：自包含 HTML 渲染器，monorepo 内解析本地 mermaid，找不到时回退 CDN 并告警。
- MCP 注册 `codecompass_diagnose`、`codecompass_refactor_plan`（现共 10 工具）；内置 ReAct 编排挂载 `diagnose_chain`/`blast_radius` 工具。
- CLI 新增 `diagnose` / `refactor-plan` / `export` 子命令（CI 可直接消费 JSON/HTML）。
- e2e 门禁新增 MCP stdio 复合工具往返、CLI 三命令与 install --dry-run 检查，并接入 `npm run e2e`。

### Changed

- `repoqa-callchain.ts`：路由匹配将数字路径段按 `{id}` 折叠（与既有 `{id}`/`:id` 归一化同一语义），前端具体 URL 可桥接到占位符路由。
- MCP 启动时安装全局 console 劫持（log/info/warn → stderr），第三方依赖无法污染 JSON-RPC 流；新增真实子进程 stdout 纯净性测试。


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
