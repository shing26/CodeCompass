# CodeCompass Handoff — 全历史交接（Phase 1 → Phase 4 · 2026-08-25）

> 生成时间：2026-08-25
> 生成目的：**转交给其他 agent 接手** —— 本文档覆盖项目从 0 到当前的全部改动，fresh agent 读完后应能跑通、看懂、敢改
> 实测验证（本会话）：后端 286/286 + `tsc --noEmit` 通过；前端 136/136（`--pool=forks --maxWorkers=2`）
> 历史基线：golden eval 50/50 在 Phase 1~3 与 Issue 18 会话均通过（完全确定性，零 LLM，可随时重跑）
> 历史文档：`docs/handoff-2026-08-21-archived.md`（旧 Phase 2 视角，仅参考）；`docs/reports/产品体验报告/`（dogfooding 产物归档）

## 1. 项目身份

- **名称**：CodeCompass（内部代号 RepoPulse）— 本地优先、**只读**的 Java 代码理解工作台
- **仓库**：`git@github.com:shing26/CodeCompass.git`（本地 `D:/CodeCompass`，branch `master`）
- **形态**：单进程全栈 —— Node + Express + SQLite + @lezer/java（后端）+ React 19 + Vite + Tailwind（前端）+ esbuild CLI 打包；无外部数据库、无构建期服务
- **核心信条**：AST（@lezer CST）→ 确定性调用图 → 零 Prompt 驾驶舱；call-chain / tours / dashboard / diff / eval **全部确定性、不调用 LLM**（LLM 仅用于 query/chat，且受门禁）
- **版本**：`0.3.0-beta`（CLI `VERSION` 常量；含个人使用收口：删除/重导 + 启动前自动备份）
- **分支状态**：`master` 领先 `origin/master` 5 个提交（Issue 18~22 已提交未 push）；另有 v0.3.0-beta 收口提交待 push

## 2. 历史总览（一条时间线）

| 阶段 | 提交 | 日期 | 内容 | 测试基线（后端/前端/eval） |
|------|------|------|------|------|
| Phase 1 — Deterministic Java Static Trace Closed Loop | `5d7e031` | 08-21 | Issue 01~10：仓库导入/AST 解析/确定性调用链/配置键/脱敏/事件平面/eval/LLM 适配器 | 101 / 56 / 50-50 |
| （文档提交） | `699cbaf` `c31d093` | 08-21 | HANDOFF.md 更新 | — |
| Phase 2 — Web Workbench | `45b7907` | 08-22 | Issue 11~14：自动 Tour / 零 Prompt 驾驶舱 / 前端看板+播放器 / ONBOARDING 导出 | 153 / 91 / 50-50 |
| Phase 3 — v0.2.0-beta 发布 | `831dbfe`（tag v0.2.0-beta） | 08-23 | Issue 15~17：多模块 Maven / CLI 打包+容器 / dogfooding 发布 | 183 / 93 / 50-50 |
| 13-bug 修复 + code-review 双 Medium | `e48d769`（= origin/master） | 08-24 | 产品体验报告 13 项缺陷全修（Round1 BUG-01~08 + Round2 BUG-09~13）+ 两轴 code-review 缺陷落地 | 184 / 100 / — |
| Issue 18 — MVP Usability & UX hotfixes | `e908a8c` | 08-24 | 路径清理 / scan 忽略 / Sidebar 导航 / 中文模糊起点 / 离线引导 | 211 / 108 / 50-50 |
| Issue 19 — Repository Ingestion Hub | `07840ac` | 08-24 | 目录视觉选择器 + GitHub 远程 clone 双 Tab 导入 | 229 / 120 / — |
| Issue 20 — MCP Server 导出 | `31b5bc7` | 08-24 | `codecompass mcp <path>` stdio 服务，4 工具，NDJSON | 241 / 120 / — |
| Issue 21 — record + Spring Bean 消歧 | `4f89dba` | 08-24 | Java 16+ record 解析补丁 / 注解落库 / Bean 注入静态消歧 | 252 / 120 / — |
| Issue 22 — PR 架构影响面透视 CLI | **未提交** | 08-24~25 | `codecompass diff <base> <head>` 只读 git 分析（见 §3.5） | **268 / 120（今天实测）** |

## 3. 分阶段详情

### 3.1 Phase 1（`5d7e031`，2026-08-21）— Deterministic Java Static Trace Closed Loop

后端骨架与"确定性静态 trace"闭环，Issue 01~10：

- **契约冻结**：移除 embedding，SSE 固定事件 `repoqa.query.*`（token/mermaid/anchors/done/error），data 帧为 JSON 包装
- **仓库导入**：本地导入、幂等、重启恢复、3,000/500K 上限（后来放宽）
- **Java AST 解析**（`repoqa-parser.ts`，@lezer/java）：class/interface/method/field/route/service/repository + calls[]；`Type.class` 类字面量自动恢复（`recoverParseableSource`）
- **确定性调用链**（`repoqa-callchain.ts`，Issue 05）：receiver 判定（MethodName=隐式 this、Identifier=变量、嵌套=动态链）；接口 1 实现→绑定、0/>1→`[Static Analysis Break: Dynamic/RPC Dispatch]`；hop 行号=方法节点 span，callLine=调用语句行；深度默认 4
- **配置键提取**（`repoqa-config.ts`，Issue 06）：YAML 缩进栈→点路径、properties 左值、pom `<dependency>` 块；**只索引 key、值永不存储**
- **多模式脱敏**（`repoqa-masking.ts`，Issue 07）：13 模式（pem/pgp/jwt/github/openai/aws/aliyun/tencent/bearer/basic/credential 赋值/env 大写下划线…）+ 防误伤规则（模板串、成员表达式、函数调用、`===`/`=>` 跳过）；接入 LLM prompt、SSE 输出、chunks、raw 端点
- **本地证据面**（`repoqa_events` 表，Issue 08）：query.start/done、tool.miss、anchor.click、feedback、masking.applied、query.failure；`GET /api/events` 只读白名单过滤+分页
- **Eval Harness**（`repoqa-eval.ts`，Issue 09）：50 题冻结分桶（route-chain/config/architecture 20/15/15）、fixture 提交哈希可复现、`EVAL_PASS_THRESHOLDS`（recallAtK=85 / hallucinationRateMax=2 / anchorValidity=90）、结果落库 `eval.run`/`eval.bucket`
- **LLM 适配器 + ReAct**（`repoqa-llm.ts`，Issue 10）：.env（`REPOQA_LLM_BASE/API_KEY/MODEL/URL`）、8K token 预算、工具 `trace_call_chain`/`get_config_evidence`、三段式输出 + `code://` 锚点 Mermaid、未配置时无缝 fallback 到确定性路径

**Phase 1 已知遗留（后被后续 Issue 修复）**：record 声明与文本块被跳过（Issue 17 记盲区，Issue 21 修复）；npm/tsx/Playwright 的中国网络坑（见 §8）。

### 3.2 Phase 2（`45b7907`，2026-08-22）— Web Workbench

前端工作台（Vite 6 + React 19 + Tailwind + Monaco + Mermaid），Issue 11~14：

- **自动 Tour**（`repoqa-tours.ts`，Issue 11）：3 条 AST 启发式路线（auth-chain / main-flow / error-handling，无 LLM）；`GET /api/repos/:id/tours`；`@RestControllerAdvice` 先行判定 kind `'advice'`；pickMainFlow 平局=深度大→byLocation
- **零 Prompt 驾驶舱聚合**（`repoqa-dashboard.ts`，Issue 12）：techStack 分类（规则顺序敏感）、配置拓扑、scale、Top API（复用 resolveCallChain，按深度排序）；`GET /api/repos/:id/dashboard`
- **前端看板 + Tour 播放器**（Issue 13）：DashboardView / TourPlayer / QuickTours / App 三视图联动（dashboard/tour/chat）；`navigateRef` 解耦防 effect 死循环
- **ONBOARDING 导出**（`repoqa-export.ts`，Issue 14）：构建标准 Markdown（技术栈/指标/脱敏配置/Top API 时序图/3 条路线）；`GET /api/repos/:id/export/onboarding` + TopBar 一键下载；导出前再过 `maskSensitiveText`

**Phase 2 关键坑（已解决）**：monaco 需逐文件 mock；SSE 事件名带前缀；mermaid foreignObject 点击委托；`new RepoQAClient()` 放 useMemo 防循环。

### 3.3 Phase 3（`831dbfe`，2026-08-23）— v0.2.0-beta 发布

- **Issue 15 多模块 Maven**：`parsePomModules` / `detectMavenModules` / `pickOverload` 名基兜底；模块布局走证据平面 `repoqa.modules.detected`，**不写 kind 'module' 进符号表**（避免前端空文件组 UI 噪声）
- **Issue 16 CLI 与打包**：静态托管 + SPA 回退、`server.ts#startServer` 抽取、`cli.ts`（parseArgs/runCli/main + 平台化 openBrowser）、esbuild 打 `dist/cli.js`、根 `bin/codecompass.js`、Dockerfile + docker-compose（只读挂载 /repo、命名卷 /data）；EADDRINUSE 双 error 监听（server + wss）防崩溃
- **Issue 17 dogfooding 收官**：真实仓库 spring-petclinic-microservices 演练；修复"单文件解析失败中止整个导入"（try/catch + `repoqa.index.warning` 事件）与 `Type.class` 恢复；版本 0.1.0→0.2.0-beta；README.md；tag `v0.2.0-beta`

**发布验证**：后端 183 + 前端 93 + typecheck 全绿；eval 50/50（三桶 100/0/100）。

### 3.4 体验修复轮（`e48d769`，2026-08-24）— 13-bug 全修 + code-review

依据 `产品体验报告/产品体验报告.md`（三画像 dogfooding，v0.2.0-beta 实测）的 **13 项缺陷，已全部修复**：

- **Round1（BUG-01~08，product-tester 完成）**：Bug-01 前端字段 snake_case→camelCase 统一、Bug-02 Top API 追踪错位+占位文案、Bug-03 call-chain UI 不可达、Bug-04 375px 溢出、Bug-05 导入错误信息丢弃、Bug-06 Inspector glow 跨文件丢失、Bug-07 0 步 Tour、Bug-08 刷新丢状态
- **Round2（BUG-09~13，本 agent 完成，均已实测）**：
  - Bug-09 Routes 显示真实 URL：Spring 映射注解提取（`display_path` 列）
  - Bug-10 导入 Name 透传 + 幂等重导刷新名
  - Bug-11 ESC 关闭导入弹窗
  - Bug-12 长导入实时进度（`RepoStatus 'indexing'` + 1200ms 轮询 + `import-progress`）
  - Bug-13 畸形 JSON 返回 400 不泄露 HTML 堆栈
- **code-review 双 Medium（都落地）**：
  - Spec：Top API 点击透传 `startName/startFile`（QueryStart{name,file} 贯穿 queryRepo→SSE URL→useChat→worker `input.start`）
  - Standards：`findStartSymbol` 显式起点精确匹配优先、生产路径优先、`isTestPath` 排除测试文件

### 3.5 Phase 4（Issue 18 → 22）— 近三天演进

- **Issue 18（`e908a8c`）MVP usability & UX hotfixes**：`cleanLocalPath`；scan IGNORED_DIRS 扩充+大小写不敏感；Sidebar 新增符号树按钮点击经 App 层打开 Monaco；**中文自然语言模糊起点**（`splitIdentifier`/`fuzzyMatchScore` 10 分档差带——method ≥ type-10 时方法胜；fuzzy 先于精确 typeKind 循环）；Canvas 空态引导 + `offline-hint`
- **Issue 19（`07840ac`）Repository Ingestion Hub**：`git-importer.ts` 安全浅克隆（`--depth 1`、60s、目录穿越防护）；`POST /api/repos/clone` → 202 + fire-and-forget 索引；前端 ImportRepoModal 双 Tab（本地文件夹 / GitHub URL+分支），idle→cloning→indexing 三阶段；TopBar 重构交接
- **Issue 20（`31b5bc7`）MCP Server**：`codecompass mcp <path>` stdio 服务，4 工具（trace_call_chain / get_dashboard / get_config_evidence / get_tours）；**NDJSON framing（非 Content-Length）**；日志一律走 stderr；repo 支持 id/name 回退
- **Issue 21（`4f89dba`）record + Spring Bean 静态消歧**：record 声明等长补丁（`record`→`class ` + 组件列表空格化，offset 逐字节稳定）→ 组件生成只读 field + accessor 符号；**文本块 `"""` 由 lezer 1.1.3 原生支持**（无需补丁）；注解/参数注解落库（`annotations`/`param_annotations` 列）；**Bean 消歧顺序：@Qualifier/@Resource(name) 显式 → 唯一 @Primary → @Autowired 字段/参数名匹配 → 否则 Static Analysis Break**（Spring DefaultListableBeanFactory 真实语义）
- **Issue 22（未提交）PR 架构影响面透视 CLI**：`codecompass diff <base> <head> [repoPath]`，全只读 git 对象分析；
  - `repoqa-diff.ts`（约 1020 行）：git 只读封装（execFile 参数数组、60s、`--no-renames`）/ `parseUnifiedDiff` / `changedLinesFor`（Java 符号用 hunk span 交集、配置键用精确增删行）/ `pickModifiedSymbols` / `reverseReachability`（head 全量图 + base 全量图双图反向 BFS 到 @RestController）/ `detectConfigChanges`（只报键名+位置）/ `buildMermaid`（`🔴 修改`/`🗑 删除` classDef）/ `renderMarkdown`（4 节报告）/ `analyzeDiff`（8 并发 git show）
  - 配套：`parseJavaSource(source, relPath, repoId)` 从内存解析（parser.ts）；`symbolIdentity` + `CallResolver`（callchain.ts 导出，O(symbols+edges) 反向遍历）
  - **关键 bug 修复**：`receiverOf` 的 `child === methodName` 引用比较不可靠（@lezer 同一树位可能返回不同包装实例）→ 改 `child.name === 'MethodName'`；此修复影响所有裸调用解析，**勿回退**（268/268 无回归）

### 3.6 v0.3.0-beta 个人使用收口（随本次提交）

- **版本 bump**：`0.2.0-beta` → `0.3.0-beta`（5 个 `package.json` + 3 个 lock + `cli.ts VERSION` / `repoqa-mcp.ts MCP_SERVER_VERSION` / `server.ts version`）。
- **仓库生命周期**：`DELETE /api/repos/:id` 只删索引、保留源文件与克隆目录；`POST /api/repos/:id/reindex` 用存储的 localPath 后台重建；`indexing` 期间两者返回 409；TopBar 增加“重新索引 / 删除”入口。
- **SQLite 启动前自动备份**：`db.ts` 新增 `backupDb()`，在 `openDb()` 前用 better-sqlite3 online backup 生成 `mhw.db.backup-<时间戳>`，数据目录保留最近 5 份；`startServer` 与 `runMcpServer` 均接入。

## 4. 当前工作区状态（未提交内容明细）

```
## master...origin/master [ahead 5]      # Issue 18~22 未 push
 M HANDOFF.md                                     # 本文档（同步本次收口）
 M docs/repoqa-prd.md                              # 补充 Phase 4 路线
 M docs/repoqa-plan.md                             # 补充 Phase 4 实现说明
?? docs/handoff-2026-08-21-archived.md             # 旧 Phase 2 交接档案
?? docs/reports/产品体验报告/                      # dogfooding 产物归档（onboarding.md + ui-shots/ + 产品体验报告.md）
```

**待办**：push 5 个已提交 + 本次 v0.3.0-beta 收口提交。

## 5. 当前产品能力全景（代码库地图）

```
services/control-plane/src/
  cli.ts              # CLI 入口：start | mcp | diff；USAGE/parseArgs/runCli（VERSION='0.3.0-beta'）
  index.ts, server.ts # 单进程启动（HTTP + SSE + WS + 静态托管 + SPA 回退）；EADDRINUSE 双 error 监听
  repoqa-parser.ts    # @lezer/java AST → RepoSymbol[]；record 等长补丁；parseJavaSource；receiverOf 修复
  repoqa-callchain.ts # 确定性调用边 + CallResolver + bean 消歧；symbolIdentity
  repoqa-diff.ts      # 【新】Issue 22 diff 影响面（git 只读/反向可达/Mermaid/报告）
  repoqa-repos.ts     # repo DAO；符号/注解/display_path/config 落库；recordEvent；upsertByLocalPath
  repoqa-config.ts    # YAML/properties/pom 配置键扫描（只索引 key，值不落盘）
  repoqa-masking.ts   # 13 模式脱敏引擎（值级 + 事件级 maskEventPayload）
  repoqa-worker.ts    # indexRepo/queryRepo/ReAct 循环；SSE 事件；findStartSymbol 启发式；findStartSymbolForQuery
  repoqa-scan.ts      # 文件扫描（忽略清单、maven 模块检测）
  repoqa-tours.ts     # 3 条 AST Tour 路线
  repoqa-dashboard.ts # 驾驶舱聚合（techStack/topology/scale/topApis）
  repoqa-export.ts    # ONBOARDING.md 导出
  repoqa-eval.ts      # golden eval（50 题冻结分桶 + EVAL_PASS_THRESHOLDS）
  repoqa-events.ts    # 只读证据面查询
  repoqa-llm.ts       # LLM adapter + ReAct（.env/8K 预算/code:// 绑定）
  repoqa-mcp.ts       # MCP stdio server（4 工具、NDJSON）
  git-importer.ts     # 安全浅克隆（--depth 1、60s）
  db.ts, http.ts      # SQLite schema / Express 路由（/api/repos, /clone, /query SSE, /dashboard, /tours, /export/onboarding, /events, /file/raw…）
apps/repoqa-web/
  src/App.tsx                     # 三视图联动（dashboard/tour/chat）+ 导入/导出/回退
  src/client/RepoQAClient.ts      # API 客户端（解包 {repo}/{dashboard}/{tours}/{symbols}；QueryStream startName/startFile）
  src/types.ts                    # 统一 camelCase；QueryStart / Repo / RepoSymbol(displayPath)…
  src/components/                 # ImportRepoModal / Sidebar / TopBar / Canvas / Inspector / MermaidDiagram / TourPlayer / DashboardView / QuickTours
  src/hooks/                      # useRepoCatalog / useSymbols / useTours / useDashboard / useChat / useInspector
根 /
  bin/codecompass.js   # spawn dist/cli.js
  Dockerfile, docker-compose.yml, README.md, CONTEXT.md, AGENTS.md
  docs/                # PRD/plan/review/architecture/adr + 归档交接
  产品体验报告/        # dogfooding 报告（13 缺陷）+ ui-shots + ONBOARDING 样例
```

## 6. 测试与验证基线（实测命令）

```bash
# 后端：268/268 + typecheck
cd D:/CodeCompass/services/control-plane
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit

# 前端：120/120 —— ⚠️ 默认 pool 下 esbuild 偶发崩溃（ERR_IPC_CHANNEL_CLOSED），用 forks pool 限并发：
cd D:/CodeCompass/apps/repoqa-web
node node_modules/vitest/vitest.mjs run --pool=forks --maxWorkers=2

# golden eval（完全确定性，可随时跑；历史 50/50 三桶 100/0/100）
cd D:/CodeCompass/services/control-plane && node node_modules/vitest/vitest.mjs run src/repoqa-eval.test.ts

# Issue 22 CLI 手动验证（演示仓库 .scratch/issue22-demo，4560c54 → 93b5581）
node node_modules/esbuild/bin/esbuild src/cli.ts --bundle --platform=node --format=cjs \
  --external:better-sqlite3 --external:express --external:ws --outfile=dist/cli.js
node dist/cli.js diff 4560c54 93b5581 D:/CodeCompass/.scratch/issue22-demo
node dist/cli.js diff --output=json 4560c54 93b5581 D:/CodeCompass/.scratch/issue22-demo
# 预期：3 个受影响 API（listOrders/getOrder/recentOrders）+ 反向 Mermaid（🔴/🗑）+ 配置键值不泄露
```

测试数量演进（后端/前端）：101/56（P1）→ 153/91（P2）→ 183/93（v0.2.0-beta）→ 184/100（13-bug）→ 211/108（I18）→ 229/120（I19）→ 241（I20）→ 252（I21）→ 268/120（I22）→ **286/136（v0.3.0-beta）**。E2E/Playwright：Phase 2 gate、Issue 14 导出、Issue 19 git daemon、Issue 20 NDJSON 26 项、13-bug 浏览器 13/13 均通过过。

## 7. 接手必读 —— 关键设计决策（跨 Issue 累积）

1. **确定性优先、零 LLM 是产品定义**：call-chain / tours / dashboard / diff / eval 不得引入 LLM；LLM 只在 query/chat 且 `isLlmConfigured(process.env)` 门禁内。
2. **只读原则**：任何功能不写用户仓库；git 访问一律 `execFile` 参数数组（绝不拼 shell 字符串）+ 超时；`diff` 只读 git 对象（`<ref>:<path>`），MCP 日志走 stderr。
3. **脱敏双层（Issue 06/07）**：索引层配置只存 key、值永不落盘；输出层 `maskSensitiveText`/`maskEventPayload` 防御兜底。`diff` 报配置键名+位置，**值永不输出**。
4. **双图反向可达性（Issue 22）**：base 侧删除方法必须用 base 全量图找调用者；base 只解析变更过的 Java 文件做符号提取。
5. **span vs 精确行（Issue 22）**：Java 符号用 hunk span 交集（纯删除仍标记方法）；配置键用精确增删行（上下文不误报）。
6. **Bean 消歧顺序（Issue 21）**：@Qualifier/@Resource(name) → 唯一 @Primary → @Autowired 字段/参数名匹配 → 否则 `[Static Analysis Break: Dynamic/RPC Dispatch]`；变量名匹配放 @Primary 之前是**错的**。
7. **record 解析（Issue 21）**：等长补丁（offset 逐字节稳定），组件→只读 field + accessor；文本块原生支持无需补丁；record 类被当普通 class 无注解。
8. **⚠️ receiverOf 修复（Issue 22）**：用 `child.name === 'MethodName'` 而非引用比较；影响所有裸调用解析，**勿回退**。
9. **行号/符号语义约定**：hop 行号=方法节点 span；注解行=类声明前一行；`display_path` 存 Spring 路由 / 路径；Top API 只统计 @RestController；`pickOverload` 同文件优先→lineStart 最小。
10. **前端类型一律 camelCase**（Bug-01 根因）；`RepoQAClient` 必须解包后端包裹（`{repo}`/`{dashboard}`/`{tours}`/`{symbols}`）；新字段别引回 snake_case。
11. **Mermaid 约定**：节点 ID==标签才能点击跳转（`Controller[Controller]`）；边引用裸 ID；链内中间节点 key 加 `mid-${index}` 防同名自环；diff 图用 `🔴 修改`/`🗑 删除` classDef。
12. **模糊起点（Issue 18）**：10 分档差带（method ≥ type-10 时方法胜）+ fuzzy 先于精确 typeKind 循环；golden eval 不走 findStartSymbol，改序对 eval 零影响。
13. **EADDRINUSE**：`server.on('error') + wss.on('error')` 双监听防崩溃；CLI 友好提示 exit 1。
14. **eval 完全确定性**：50 题冻结分桶 + fixture 哈希可复现 + `EVAL_PASS_THRESHOLDS` 共用；阈值改要两头同步。

## 8. 环境坑速查（Windows 11 + 中国网络，git-bash）

- **npm/npx 被 WSL shim 劫持**（`CreateProcessCommon execvpe(/bin/bash) failed`）→ 一律 `node node_modules/<bin>` 直接跑；`cmd //c "..."` 兜底。
- **前端 vitest 默认 pool 下 esbuild 崩溃** → `--pool=forks --maxWorkers=2`。
- tsx 的 ESM 解析对 src 外无扩展名相对导入失败 → 调试脚本放 `src/*.test.ts` 用 vitest 跑。
- Playwright 用 npmmirror 镜像（`PLAYWRIGHT_DOWNLOAD_HOST`）；chromium 需显式 executablePath（headless_shell-1234）；preview 仅 IPv6 localhost（用 `localhost` 不用 127.0.0.1）；vite preview 4173。
- 勿动 43110（后端默认，可能被旧 dev 进程占用属预期）/5173（Vite）；新验证用 freePort。
- `MHW_CP_PORT` / `MHW_DATA_DIR` / `MHW_STATIC_DIR` / `VITE_REPOQA_API_BASE`（dev 时 43110，prod 同源 ''）；CLI 参数是 **`--data-dir`**（不是 `--dataDir`）。
- 杀掉自启服务：`netstat -ano | grep :端口` → `taskkill //F //PID`（git-bash 无 sleep；Ctrl-C 对后台 node 无效）。
- git：`git init` 后需先 config user.name/email 才能 commit；diff 输出路径分隔符 `/`；`git daemon --listen=127.0.0.1` 防防火墙。
- 记忆文件必须用绝对路径 `C:/Users/Shing/.penguin/...`，相对路径会误建到 CWD。

## 9. 下一步建议

1. **push**：确认后推送 5 个已提交 + v0.3.0-beta 收口提交。
2. 后续方向：`codecompass diff --output=json` 可直接供 CI/PR 机器人消费；MCP 工具可扩展；roadmap 剩余路线按 PRD 继续。

## 10. 引用文档与记忆索引

- 本文档关联：`docs/handoff-2026-08-21-archived.md`（旧 Phase 2）；`README.md`（用户视角）；`CONTEXT.md`（术语表）；`AGENTS.md`
- 设计/评审：`docs/repoqa-prd.md` / `docs/repoqa-plan.md` / `docs/repoqa-review.md` / `docs/repoqa-architecture-vision.md` / `docs/adr/`
- 产品体验：`docs/reports/产品体验报告/产品体验报告.md`（13 缺陷源文档）
- 记忆底稿（`C:/Users/Shing/.penguin/data/default_project/agents/default_agent/agent_state/memory/codecompass-643b2785/`）：`issue22-diff-cli` / `issue21-record-spring-disambiguation` / `issue20-mcp-server` / `issue19-ingestion-hub` / `issue18-usability-ux` / `issue17-dogfood-release` / `issue16-cli-packaging` / `phase3-multimodule` / `issue14-onboarding-export` / `issue13-dashboard-view` / `issue12-dashboard` / `issue11-tours` / `issue10-llm` / `issue09-eval` / `issue08-events` / `issue07-masking` / `issue06-config` / `issue05-callchain` / `codecompass-phase2-complete` / `repoqa-e2e-verification`
- 用户记忆：`codecompass-bugfix-round2`（13-bug 修复）、`windows-china-dev-env`、`resualign-lite-testing`、`codex-skills-port`
