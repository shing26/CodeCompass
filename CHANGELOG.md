# Changelog

## [0.21.0] - 2026-09-05

### Highlights

- **codex 真实使用反馈闭环**：codex（Python+React 仓库 dogfooding）靠逐文件阅读才发现的文件级技术债（"db.py 47 KB 是技术债"），scan 现在直接给出——新增第五桶 `oversizedFiles`（索引符号覆盖跨度 ≥600 行的文件，top-10 + 全量 total + 跨度/符号数 detail）。它专补方法级桶的盲区："很多中等方法堆成的大文件"。
- **定位显性化**：README 新增"给 agent 的确定性检索层"定位声明（精确检索工具而非理解工具、上下文经济性、大仓库优先）；scan/dashboard 工具 description 补上下文经济性引导；CONTEXT.md Candidate Scan 词条更新五桶 + 定位红线（scan 只报事实，判断属 agent）。

### Added

- `scan-engine.ts`：`oversizedFiles` 桶——按文件聚合索引符号的行跨度（纯索引副产品，零额外 I/O），`OVERSIZED_FILE_LINES = 600` 阈值导出；契约 `ScanBucket.id` 联合类型扩展。
- 测试：方法级盲区用例（3 个 210 行方法堆出 630 行文件，方法桶零命中、文件桶命中）；e2e gate scan 冒烟扩五桶断言。

### Notes

- grilling 三问：定位=守检索（用户作答）；文件桶与定位叙事未获作答按推荐默认执行并记录（v0.6 先例）。

## [0.20.0] - 2026-09-04

### Highlights

- **`codecompass_scan` 自荐发现引擎（第 15 个 MCP 工具）**：补齐"陌生仓库该动哪里"的主动发现闭环——此前 14 个工具全部要求点名 targetSymbol，scan 首次让引擎主动回答"该看哪"。四桶候选全部确定性产出（零 LLM，ADR-0002/0005 同族）：`orphanedPublic`（零静态调用者的生产符号，排除 route 入口，note 声明反射/动态代理误报边界）、`hubs`（PageRank 波及热点，引导 refactor_plan）、`oversized`（≥150 行方法，行距为方法体级 AST 落地前的代理信号）、`deepChains`（最深入口链，引导 diagnose）。每桶 top-10 + 全量 total + file:line 锚点 + 确定性 nextAction。

### Added

- `services/control-plane/src/scan-engine.ts` + 测试：四桶引擎，一次 `buildRadarGraph` + `computePageRank` 复用（radar 图内建生产 kind 过滤与测试路径排除），`pickTopApis` 复用为深链桶；同仓库两次调用输出逐字节一致。
- `packages/contracts/src/repoqa.ts`：`ScanCandidate`/`ScanBucket`/`ScanResult` 契约。
- `codecompass_scan` 工具注册（同步查询契约——图已驻留内存缓存，毫秒级，不触发 ADR-0016 异步门槛）；`mcpScan` handler。
- e2e gate：scan 冒烟断言（四桶结构）+ 工具数 15 精确断言。
- `codecompass_get_conventions` MCP 工具（Ticket 02）：入参 repoId/targetSymbol?/nearPackages?，同步转发 `worker.runConventionScan`；nearPackages 兼容数组与逗号分隔字符串两种宿主方言。
- `codecompass_plan_evolution` MCP 工具（Ticket 02）：入参 repoId/intentType(EXTEND|DEPRECATE)/targetSymbolOrModule/extensionGoal?/nearPackages?；intentType 白名单校验 fail-closed，冲突走结构化载荷。
- MCP 冲突双端对等（Ticket 02）：`mcpPlanEvolution` 与重构后的 `mcpModuleEvolution` 均 try/catch `ConventionConflictError` 返回 `{error, conventionConflict}`；repoqa-mcp.test.ts 新增 makeConflictRepo 夹具 + 4 测（画像/规划/冲突拦截+双工具同构/intentType 与 Deprecated 前缀），29/29。
- `_McpSession`（gate 基建）：单 stdio 进程多轮 roundtrip——`codecompass_index_repo` 是 fire-and-forget（ADR-0016），进程被回收会让新仓库冻在 `indexing`；Issue 25 段全程共用一个活会话完成索引→就绪轮询→计时画像→冲突拦截。
- CONTEXT.md 词条 Candidate Scan。
- **演进感知 MCP 工具落地（Issue 25 / Ticket 02）**：`codecompass_get_conventions`（第 16 个）与 `codecompass_plan_evolution`（第 17 个）把 ADR-0014 的五轴惯例画像与演进规划直送 MCP 宿主——NLU 留宿主端，引擎只收物理意图；`ConventionConflictError` 在 MCP 层结构化捕获为 `{error, conventionConflict:{axis, verdict, coverage, anchors, suggestion}}`，与 Web worker 同构、禁裸异常（双端对等）。`codecompass_module_evolution` description 标记 Deprecated 前缀，行为不变向后兼容。
- **工件卡服务端持久化与 Hydrate 回放（Issue 25 / Ticket 03）**：SQLite 新表 `workbench_cards` 按 (repoId, commit) 流落地演进/排查终态卡——`UNIQUE(repo_id, commit_hash, seq)` 幂等防线（显式 `INSERT OR REPLACE`，网络重放不双写），五处终态落库点（worker evolve done / evolve 惯例冲突 catch / incident LLM 与 fallback done、http 层双 catch 的 error 卡），落库对象一律过 maskEventPayload；SSE done/error 终态载荷披露服务端 `cardId`/`cardSeq`，前端采纳替换临时卡 id（模块级 `nextCardId` 计数器退役→`crypto.randomUUID()`）。`GET /api/repos/:id/workbench-cards?commit=` 按 seq 升序全量回放（缺省当前物理流 `repo.commit ?? 'unversioned'`，+dirty 原样存储天然隔离）；`useEvolutionSession` 切桶 hydrate 回放按 id 去重合并（incident evidence 由 `parseEvidenceFromAnswer` 从落库 answer+anchors 确定性重算，断线中断卡不回写）；`deleteRepo` 事务级联清理（一处覆盖 MCP `remove_repo` 与 HTTP DELETE 双入口）。

### Changed

- `scripts/e2e/closeout_gate.py`：`check_mcp_composite_tools` tools/list 断言 15→17（含两个新工具名）；新增 Issue 25 五项检查——conflict repo 经 MCP 索引并轮询就绪、get_conventions 画像（含 5s 同步红线实测断言，实测 0.20s）、plan_evolution 结构化冲突拦截、legacy 工具同构对等。
- `codecompass_module_evolution` 工具 description 头部加 `[Deprecated: Superseded by codecompass_plan_evolution]`；入参/行为不变，向后兼容。
- e2e gate：新增 `check_workbench_cards_hydrate` 三断言（evolve done 载荷披露服务端 cardId/seq；hydrate 回放同 id 同 seq 同内容；conflict 流 error 卡回放含结构化 conflict）——用户裁决：Hydrate 冒烟提前至 Ticket 03 交付（repo spec 原文「扩项归 25.4」由本条取代）。
- 契约类型扩展（Ticket 03）：`RepoQaEvolveDone`/`RepoQaEvolveError`/`RepoQaQueryDone` 增可选 `cardId`/`cardSeq`（contracts src + v1 + web types 镜像三处）；web 新增 `WorkbenchCardRow` 回放行类型与 `RepoQAClient.getWorkbenchCards`（404→null 仿 getDashboard）。
- 测试：`repoqa-workbench-cards.test.ts` 新增 6 测（Evolve/Incident 混合顺序、显式 seq REPLACE 幂等、deleteRepo 级联、+dirty commit 隔离、2 条 HTTP 集成含「落库 JSON 与 GET 响应均不含敏感串」脱敏断言），control-plane 545/545；web hydrate 组件测试 3 条，284/284。

### Notes

- 立项访谈未获作答项按推荐默认执行并记录（v0.6 收口先例）：独立工具形态、四桶清单、同步契约、无 buckets 选择参数（Speculative Generality 防线）、挂载点桶推迟。
- Ticket 03 两处分歧裁决（以 repo spec 为准）：工件卡分列存储（echo/result/conflict/mermaid 独立列）而非单 payload blob；端点名 `workbench-cards` 而非 `workbench/cards`。列名 `commit_hash`（`commit` 为 SQLite 保留字，沿 db.ts `repos.repo_commit` 先例）。

## [0.19.0] - 2026-09-04

### Highlights

- **演进工件会话流（Issue 24 / Ticket 05）**：EvolutionView 重构为会话式 append-only 工件卡流——`useEvolutionSession` 按 (repoId, commit) 分桶归组，同仓库同 commit 的演进结果追加成卡不互相覆盖，意图回声/工件卡/图谱卡随帧落入会话。
- **Intent Eval Bucket（Issue 24 / Ticket 06）**：golden eval 冻结集 75 → 97 题——新增 `evolve-intent`（14 题：DEPRECATE 动词族、EXTEND doc-chunk 桥、拉丁类名、显式路径锚定，覆盖确定性回退与 LLM 双路径的准确率与确定性）与 `convention`（8 题：repo-d 五轴实测值固化）两 bucket；`expectedAbsent` 命中即计幻觉，incident / evolve-intent / convention 三 bucket 幻觉率 0% 纳入 closeout gate 必查。
- **Closeout Gate 纳管演进管线（Issue 24 / Ticket 06）**：#15 `POST /api/repos/:id/evolve` SSE 五阶段顺序 + done 四工件结构（intentEcho / checklists / commit / 可选引擎 mermaid）；#16 STRICT 轴惯例冲突流式返回结构化 `conventionConflict`（计划的产出而非崩溃）；MCP tools/list 断言收紧为 ==14（含 v0.18 `codecompass_remove_repo`）。

### Changed

- 版本推进 0.18.1 → 0.19.0（root / cli.ts / MCP server / control-plane / web / contracts 六处）。
- `docs/adr/0013`：删除"迁移期披露"句——图层指令契约已落地，incident 模型自绘边不再是已知缺口。

## [0.18.1] - 2026-09-04

### Fixed

双轴 code-review findings（v0.18.0 发布后补审）修复：

- **幽灵防线位置与声明对齐**：第一处存在性断言移到 `saveFiles` **之前**（原实现靠 `foreign_keys=ON` 兜底、且会走 catch 广播 error 而非静默终止），与 ADR-0016 §4「写入前断言」及代码注释三方一致。
- **fire-and-forget 不再静默吞错**：`indexRepo` try 块之前的入口检查（fs.stat/upsert）若 reject，`.catch` 现在把 repo 行翻转为 `error` + 根因，消除"永久卡 `indexing`"的僵尸记录（ADR-0016 §3 禁止项）。
- **`list_repos` 的 error 字段过 `maskSensitiveText`**（ADR-0003）：错误摘要可能携带 git stderr/本机路径，流出前过敏感信息过滤器。
- **`matchedBy` 收窄为两值**：`graph-rank` 在 `base > 0` 门禁下不可达（死值），从 contracts/引擎/前端 types/CONTEXT.md 词条中移除——只保留 `identifier` | `doc-chunk`，不承诺不存在的溯源值。
- **config 扫描补"顶层"语义**：UPPER_SNAKE 正则现在要求零缩进（`line.startsWith(trimmed)`），函数/类内缩进的赋值不再混入 config topology。
- basename 兜底抽共享 helper `deriveLocalRepoName`（repoqa-repos.ts 导出），worker 与 MCP handler 各写一份的重复消除。

## [0.18.0] - 2026-09-04

### Highlights

- **`codecompass_index_repo` 全异步化（ADR-0016）**：真实 agent 反馈（BossHunter）暴露致命缺陷——同步契约下大仓库索引必然撞 30s stdio 超时，且 clone 期间 repo 行不存在导致"仓库消失"。现在同步部分只剩校验 + clone（≤60s）+ localPath 前置门禁，repo 行建立后立即返回 `{repoId, status: 'indexing', pollHint}`，索引 fire-and-forget，agent 轮询 `list_repos` 至 `ready`/`error`（error 行带根因摘要）。同步失败（URL 非法/路径不存在）坚决不落库。
- **新增 `codecompass_remove_repo`（第 14 个 MCP 工具）**：补齐仓库管理闭环——删除索引记录并级联清除符号/chunks/文件/事件，磁盘克隆保留；indexing 状态拒删（镜像 DELETE /api/repos/:id 的 409 语义）。
- **幽灵索引防线**：worker 在两处数据表写入点（`saveFiles` 前、`upsertSymbols/upsertChunks` 前）断言 repo 行仍存在，中途被删的索引静默终止，不再复活孤儿数据。

### Added

- `services/control-plane/src/repoqa-mcp.ts`：`codecompass_remove_repo` 工具 + `mcpRemoveRepo` handler；`mcpListRepos` 返回体增 `symbolCount`/`localPath`/`error` 字段。
- `services/control-plane/src/repoqa-worker.ts`：`indexRepo` 返回类型放宽 `Repo | null`（幽灵路径），全部调用点（cli/http/eval/mcp）空值防护。
- `docs/adr/0016-mcp-long-ops-return-immediately.md`：MCP 长操作立即返回 + 轮询观测的架构决策（含对后续新工具的约束）。
- `domain-radar-engine` + contracts：锚点新增 `matchedBy`（`identifier` | `doc-chunk` | `graph-rank`）——匹配来源可溯源，agent 可对措辞敏感的锚点降权；前端 types 副本同步。

### Fixed

- config topology 噪音（BossHunter 反馈）：Python/TS 扫描只收 UPPER_SNAKE 顶层赋值，`content`/`temporary_path` 类模块状态不再混入配置证据。
- `get_tours` 半残感（BossHunter 反馈）：空步 tour 过滤（对齐 HTTP 层行为），非 Java 仓库返回 `{tours: [], note}` 诚实说明 Java/Spring 边界，不再返回三个空壳。

### Changed

- `codecompass_index_repo` 契约破坏性变更：v0.17 同步返回 `ready` → v0.18 异步返回 `indexing` + 轮询。已安装用户重启 MCP 会话后生效；工具 description 已重写说明轮询方式。

## [0.17.0] - 2026-09-03

### Highlights

- **MCP 工具面新增 `codecompass_index_repo`**：agent 会话内可直接克隆 GitHub 仓库或索引本地目录，返回 repoId 后立即使用其他 12 个工具——打通"陌生仓库分析"闭环的第一环。远程仓库走 `git clone --depth 1`（60s 超时、`validateGitUrl` 安全校验），本地目录走 `worker.indexRepo` 管线。MCP 工具总数升至 **13 个**。

### Added

- `services/control-plane/src/repoqa-mcp.ts`：新增 `codecompass_index_repo` MCP 工具（含 url 克隆 + localPath 两条分支）、`mcpIndexRepo` handler、`McpDeps` 加 `dataDir` 字段、`McpToolHandlerArgs` 加 `url/localPath/branch/name` 入参。
- `services/control-plane/src/repoqa-mcp.test.ts`：4 项新测试（localPath 索引成功、路径不存在报错、双参数冲突报错、无参数报错）+ 三处工具名单更新至 13 项。
- `scripts/e2e/closeout_gate.py`：`check_mcp_composite_tools` 新增 `codecompass_index_repo` 冒烟断言（索引本地 demo-polyglot → 验证 `status: ready`），工具数量断言提升至 `>=13`。
- `MCP_SERVER_VERSION` 同步至 0.17.0（此前落后于产品版本 0.9.0）。

## [0.16.0] - 2026-09-01

### Highlights

- **Architecture & Incident Copilot（排障副驾驶，Issue 23）**：新增 `mode=incident` 查询通路——粘贴 Java/TS 堆栈即可获得物理级锚定的排障分析。静态路径确定性解析堆栈帧→符号（`repoqa-stacktrace.ts`，Java/V8/通用兜底三格式 + 噪声帧过滤），LLM 路径走白名单工具（diagnose_chain / blast_radius / trace_call_chain / get_config_evidence / parse_stack_trace）6 步 ReAct 预算（ADR-0011 静态边界）。
- **零幻觉合约进发布 gate**：每条调用链断言逐字来自本次会话工具返回，`file:line` 过 raw-file 校验；不可证的边界强制 BREAK/SUSPECT，永不编造。eval 新增 incident bucket（10 题），`hallucinationMaxFor('incident') = 0%` —— 幻觉率非零即 gate 失败。
- **物理锚点四元组（ADR-0010）**：锚点升级为 `repoId + commit + file:line-range + symbolId`，索引时钉住 `HEAD` commit 并在锚点/回答 payload 盖章；前端 EvidenceCard 按 VERIFIED / BREAK / SUSPECT 三徽标呈现证据，VERIFIED 行点击直达 Inspector 源码切片。

### Added

- `services/control-plane/src/repoqa-stacktrace.ts`：堆栈解析 + 帧到符号解析 + `stackTraceSummary`，13 项单测。
- `repoqa-worker.ts`：`runIncidentQuery`（LLM 白名单工具路径 + 确定性静态回退三段式回答）；incident 豁免 1.5s 延迟门禁（六步深度工具遍历，ADR-0011）。
- `GET /api/repos/:id/query?mode=incident&stack=...`；done payload 增 `commit` 与 `provenance`。
- 前端：`IncidentView` / `StackTraceInput`（IME 安全 Enter 提交）/ `EvidenceCard` 三徽标 + commit chip；`components/evidence.ts` 纯确定性断言解析（叙事文本不产生证据行）；TopBar 新增「排障」Tab，深链 `?mode=incident`。
- eval：incident bucket 10 题冻结 + repo-e fixture（orders 链）+ 幻觉判定（file:line grounded）；`docs/benchmark.md` 刷新至 75 题 / 5 fixture。
- ADR：`docs/adr/0010-physical-anchor-pins-commit.md` ~ `docs/adr/0015-evolution-workbench-freeform-intent.md`（均 accepted）——0012–0015 为架构雷达 / 演进顾问定位 grilling 裁决（Intent→Artifact、引擎垄断图谱渲染、Pattern Ingestion、自由文本意图入口），实装随 Issue 24/25。
- 证据链兜底：`unionIncidentAnchors`（repoqa-llm.ts）——堆栈锚点优先合并 LLM 返回锚点，去重并丢弃格式残缺项，答案中的 `file:line` 不再因模型漏报锚点而失证。
- 前端：IncidentView 动作条（爆炸半径 / 调用链溯源 / 重跑）+ 每条证据溯源链 + mermaid 断点图可点击跳转 Inspector；`App.tsx` 接线「排障」Tab。
- 测试根修：`repoqa-http.test.ts` 以 `vi.mock('./repoqa-scan', importOriginal)` 将文件预算收窄至 60，file-limit 用例不再 flaky。

### Fixed

- POST + `express.json()` 场景下客户端断连检测误用 `req.on('close')`，改为 `res.on('close')`（此前正常完成的 POST 查询会被误判为中断）。

## [0.15.0] - 2026-08-31

### Highlights

- **大型仓库规模化**：文件预算可配置化（`REPOQA_MAX_FILES`/`REPOQA_MAX_LINES`），默认上限从 3000 提至 12000。对 spring-boot（11,482 文件 / 58,535 符号）实测全量索引 **26.3s / 438MB**——已达 v1.0 GA 目标区间（≤30s / ≤500MB），基线报表见 `docs/profiling.md`。旧 3000 上限会截断该仓库约 75% 的代码。
- **Prisma 数据层（TS/Node.js 四层穿透补全）**：新 `PrismaAdapter` 解析 `schema.prisma` 为实体（`repository`）与操作（`sql`）符号；确定性桥接 `prisma.<model>.<op>()` → schema 操作节点，TypeScript 工程由此获得与 Java/MyBatis 同级的 `DATA_MAPPER` 跳层。

### Added

- `services/control-plane/src/languages/PrismaAdapter.ts`（schema 解析 + 15 种 Prisma 操作白名单）+ 测试。
- `repoqa-callchain.ts`：`prismaStatements` 索引与 `resolvePrismaCall` 桥接（大小写归一、单命中才解析）。
- `scripts/profile-index.ts`：大仓库索引 profiling 工具；`docs/profiling.md` 基线报表。
- 扫描预算纳入 `.prisma` 扩展。


## [0.14.0] - 2026-08-30

### Highlights

- **npm 首发**：包名 `@codecompass/cli`（bin 命令仍是 `codecompass`），`npx @codecompass/cli mcp <repo>` 一键拉起；补齐 keywords/LICENSE/repository 元数据，`npm pack` 实测 2.8MB / 155 文件。
- **安装器生态扩至 6 家 IDE**：新增 Windsurf（`~/.codeium/windsurf/mcp_config.json`）、Cline 与 Roo Code（VS Code globalStorage，支持 autoApprove 白名单），沿用幂等 merge/备份/dry-run 机制。
- **Release 管线**：tag 触发 GitHub Actions——全量验证后 `npm publish`，GitHub Release 附带开源 fixture 生成的示例 `architecture-artifact.html`。

### Added

- `.github/workflows/release.yml`（v* tag 触发）。
- `LICENSE`（MIT）。


## [0.13.0] - 2026-08-30

### Highlights

- **评测基线落地（ADR-0004 → accepted）**：golden eval 从 50 条扩至 **65 条**，新增三个 bucket 覆盖 v0.8/v0.9 复合引擎——`intent-anchor`（中文意图→doc-chunk 桥接命中）、`diagnose-chain`（四层穿透 + 断点判定，含负例）、`evolution`（固定点级联孤立 + 三级事务边界 + 解耦模式）。全部 **Recall 100%、幻觉率 0%**（`docs/benchmark.md`）。
- **CI 硬性门禁**：GitHub Actions 三平台矩阵（ubuntu/windows/macos × Node 24）跑 typecheck + 全部单测 + 构建；35 项 e2e 门禁（含 1 项新增 eval 冒烟）跑 ubuntu 专属 job；README 挂真实 CI badge。
- e2e doctor 检查容忍 warning（CI 容器无 Ollama 不再误伤）；`codecompass install` 输出至 12 工具。

### Fixed

- `runModuleEvolution` 对 intentType 做大小写归一——'extend' 不再静默落入 DEPRECATE 管线。
- 事务边界三级回溯补齐**接口方法级** `@Transactional`（Spring 代理最常见的声明位置），实现类经 `interfaces` 列表回溯接口方法注解。


## [0.11.0] - 2026-08-30

### Highlights

- **技术栈品牌徽标**：Mermaid 图节点按 `filePath` 扩展名 / `kind` / `annotations` 自动推断技术栈并注入内联 SVG 徽标（Spring / MyBatis / FastAPI / React / TS / Go / SQL 等），`?badges=0` 可关闭；徽标走后渲染 DOM 注入，绕开 mermaid 标签白名单，点击跳转与节点搜索不受影响。
- **Cmd+K 命令面板**：居中磨砂玻璃面板，300ms 防抖请求后端确定性雷达（复用 `runDomainRadar` + doc-chunk 证据），符号结果带出入度徽标；内置"切换主题 / 返回看板"命令；Enter 触发射击式画布居中 + Inspector 同步。
- **Inspector 面包屑 + 实时演播带**：Inspector 顶部 `Repo > 文件 > 符号` 可点击面包屑；Canvas 底部浮动"调用链步进"条（Prev / Step N/M / Next），步进时联动画布居中 + Monaco 切片高亮，BROKEN/HTTP 状态即时可见。

### Added

- `apps/repoqa-web/src/brand-marks.ts`：品牌推断 + 内联 SVG 徽标映射 + `?badges=0` 降级（+11 单测）。
- `apps/repoqa-web/src/components/CommandPalette.tsx`：Cmd/Ctrl+K 全局快捷键、防抖雷达检索、键盘导航（↑/↓/Enter/Esc）（+7 单测）。
- `services/control-plane/src/http.ts`：`GET /api/repos/:id/radar?query=` 路由 + 60s `(repoId, query)` TTL 缓存。
- `apps/repoqa-web/src/client/RepoQAClient.ts`：`radar(repoId, query)` 方法。

### Changed

- `packages/contracts/src/repoqa.ts`：`DomainRadarAnchor` 新增 `inDegree` / `outDegree`；`domain-radar-engine.ts` 在锚点输出中携带图度数。
- `apps/repoqa-web/src/components/MermaidDiagram.tsx`：新增 `symbols` / `focusRequest` 受控 prop，注入品牌徽标并支持外部画布居中。
- `apps/repoqa-web/src/components/Canvas.tsx`：传符号目录给图元、托管焦点请求、新增实时演播带（+2 单测）。
- `apps/repoqa-web/src/components/Inspector.tsx`：新增 `repoName` / `onBackToDashboard` 与面包屑（+4 单测）。
- `scripts/e2e/closeout_gate.py`：新增 radar HTTP 返回结构断言。


## [0.10.0] - 2026-08-30

### Highlights

- **Mermaid 质感对齐**：画布跟随 clean/cyber 主题注入 themeVariables（暗色不再白底），节点圆角统一 8px；主题切换即时重渲染，不再残留旧主题缓存。
- **语义边与状态胶囊**：查询 trace 的 BROKEN/HTTP/async 证据直接渲染为红脉冲虚线边、紫青流光 HTTP 边与黄虚线异步边；节点标签追加 GET/POST/BROKEN 胶囊，一眼分辨调用链状态。
- **trace 契约前置**：`RepoQaTraceHop.http` 字段（optional）把浏览器 HTTP 桥接方法/URL 带给前端，控制面在 AST 证据层确定性标注（零 LLM 猜测），旧序列化不受影响。

### Added

- `apps/repoqa-web/src/client/mermaidRenderer.ts`：按主题注入 mermaid themeVariables，主题键驱动重新 initialize（+6 单测）。
- `apps/repoqa-web/src/client/mermaidGraph.ts`：`escapeMermaidLabel` 与 `edgeAnnotationsForTrace`，标签转义覆盖 `[]"` 与中文路径，trace 边语义有序映射（+4 单测）。
- `apps/repoqa-web/src/components/MermaidDiagram.tsx`：消费 `traceSteps`，向 SVG `g.edgePath`/`g.node` 注入语义 class（+4 单测）。
- `services/control-plane/src/repoqa-worker.ts`：`annotateTraceHttpMethods` 将 `frontendCallersForRoute` 桥接证据写入 trace hop（+4 单测）。
- `index.css`：BROKEN 脉冲、HTTP 流光、async 虚线、节点状态胶囊，全部走设计 token（无硬编码 hex）。

### Changed

- `packages/contracts/v1.ts`：`RepoQaTraceHop` 新增 optional `http` 字段。
- `useChat` 消费 `done.payload.trace` 归一化为 `TraceStep[]`，供画布语义注入与后续演播带使用。


## [0.9.0] - 2026-08-29

### Highlights

- **模块演进副驾**：`codecompass_module_evolution` —— DEPRECATE 管线做模块聚类、全图反向引用扫描与**固定点级联孤立死代码检测**（被独占的公共工具会被二次波及一并标出），输出五类清理 Checklist；EXTEND 管线定位挂载点、回溯方法/类/接口三级 `@Transactional` 事务边界证据，按可解释规则匹配解耦模式（Spring Event 异步 / AOP 切面 / 直接注入）并产出确定性代码脚手架。
- **领域全景雷达**：`codecompass_domain_radar` —— 全图出入度统计 + 确定性 PageRank（阻尼 0.85、悬挂节点权重每轮均匀重分配不外泄、TS fetch→Controller 桥接边计入 Controller 入度），三栏全景（Top APIs / Hub 节点 / 持久化底座）；自然语言意图锚点 = 标识符模糊匹配链 + doc-chunk 证据（中文意图的确定性桥接）+ 图排名增益，**零 embedding**。
- **多视图工件**：`codecompass export` 升级为 Architecture + Sequence 双视图 Tab（Sequence 惰性渲染，规避隐藏容器 0 宽高陷阱）；Lifecycle/Dataflow 以"v1.0 证据采集排期中"占位——没有方法体级 AST 证据就绝不渲染假图；品牌徽标（Spring/Redis/MySQL 等，依依赖关键词贴标）与 Story Beats 分步演播带（Prev/Next 联动代码切片）。
- MCP 工具升至 **12 个**；CLI 新增 `radar` 与 `evolve` 子命令。

### Added

- `services/control-plane/src/domain-radar-engine.ts`：度数聚合、确定性 PageRank、意图锚点融合打分（+7 单测）。
- `services/control-plane/src/module-evolution-engine.ts`：DEPRECATE/EXTEND 双管线（+9 单测）。
- e2e 门禁新增 7 项 v0.9 检查（radar 全景/意图锚点、evolve 双意图、多视图工件断言、两个新工具的 MCP stdio 往返），总检查 **33 项**。

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
