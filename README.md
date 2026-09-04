# CodeCompass

![CI](https://github.com/shing26/CodeCompass/actions/workflows/ci.yml/badge.svg)

本地优先的**多语言代码理解工作台** —— 一条命令导入任何仓库，自动产出架构看板、跨语言确定性调用链与可溯源的 Agent 上下文。全部在一个 Node.js 进程内完成：AST 索引 → 确定性分析 → 零 Prompt 驾驶舱。

> 定位（ADR-0001/0002）：对源码**只读**、永不写回；只承诺**确定性静态分析**，不调用 LLM 也能给出全部核心结论；每个结论都带可点击的 `file:line` 锚点。

## 核心能力

### 1. AST 确定性调用链
基于 `@lezer` 语法树（CST）构建调用图，call-chain 模式走**完全确定性的静态分析路径**：不调用任何 LLM、不消耗 token、结果可复现。每条调用链都是一幅 mermaid 时序图，节点带 `code://` 锚点，点击直达 Inspector 源码行；静态解析不到的位置显式标记 **Static Analysis Break**，绝不静默编造。

### 2. 跨语言契约桥接
前端 `fetch` / `$fetch` / `axios`（含 `axios.create` 封装）的 HTTP 调用点，按归一化路径（含 `/api`、`/api/v1` 前缀变体）**唯一匹配**到 Spring / Express / Gin / Fiber / FastAPI / Flask 路由后连边——前端到后端的调用链在同一张图里打通。匹配保守：候选不唯一时停下并标记，而不是猜。

### 2.5 Prisma 数据层（v0.15）
TS/Node.js 工程的 `schema.prisma` 解析为实体与操作符号，`prisma.post.findMany()` 类调用确定性解析到数据层——TypeScript 项目拥有与 Java/MyBatis 同级的 4 层穿透能力。

### 3. 多语言 AST 解析
`LanguageAdapter` 抽象层把不同语言的语法树统一成同一套 `RepoSymbol` 契约：同一份调用图索引、同一套调用链算法、同一个 Web/MCP/CLI 证据面。

| 语言 | 扩展名 | 主要符号 | 框架 / 路由识别 |
| --- | --- | --- | --- |
| Java | `.java` | class / interface / method / field / route / service / repository / advice / mapper | Spring MVC 注解、MyBatis Mapper（含 XML SQL 穿透） |
| TypeScript / JavaScript | `.ts` `.tsx` `.js` `.jsx` `.mjs` | class / function / interface / type / route | NestJS 装饰器、Express 路由、`axios` / `fetch` 调用点 |
| Go | `.go` | struct / interface / func / receiver method | Gin / Fiber 路由注册（`r.GET`、`group.POST`） |
| Python | `.py` | class / def / async def / route | FastAPI / Flask 装饰器、`pyproject.toml` / `.env` 配置证据 |

消费侧同样多语言：dashboard 的技术栈统计与配置证据支持 `package.json`、`pyproject.toml`、`.env`、yaml/properties、`pom.xml`。

### 4. 零 Prompt 驾驶舱与架构差异
- **看板**：导入即分析——技术栈分类统计、架构指标（routes / services / repositories / methods / configKeys…）、Top API 列表，一键导出 `ONBOARDING.md`。
- **架构差异**：对比 base/head 两个 git ref，输出新增/删除路由、断边、受影响 API（风险分级）与 mermaid 差异图；CLI 侧 `codecompass diff` / `pr-summary` 同源内核，并支持 `--fail-on-auth-impact` 在 CI 中守住"无认证敏感路由被改"的安全红线。

### 5. Local-First 隐私与脱敏
- **索引层**：配置只索引 key，value 从不落盘、从不导出；多模式确定性掩码引擎重写凭据赋值（`password` / `secret` / `token` / `aws_access_key_id`…），且只重写字面量赋值。
- **输出层**：所有导出与 HTTP 响应再经 `maskSensitiveText` 防御性过滤，双保险。
- **前端可见**：Local-First 隐私药丸（纯本地 / 本地模型 / 远程模型三态）、会话 Token 预算、消息级来源徽章（静态图谱 vs 模型推理）——远程 LLM 问答默认关闭，需显式同意。

### 6. Graph RAG Agent Context
`codecompass context <query>` 用与调用链完全一致的确定性入口解析器定位符号，沿内存符号图做 **1-Hop Caller + 1~3 Hop Callee** 双向检索：折叠类骨架、按优先级队列做 Token 预算剪枝、13 类凭据脱敏，产出可直接粘贴给 Agent 的 Markdown。也可通过 `codecompass mcp` 以标准 MCP 工具供 Claude Desktop / Cursor 调用（见下文）。

### 7. 韧性与自诊断
- **doctor**：`codecompass doctor --json` 一键体检 Node 版本、SQLite 原生 ABI、端口、数据目录与磁盘余量、本地 Ollama。
- **分阶段索引**：DISCOVERY → AST_EXTRACTION → CROSS_LANG_BRIDGE → FINALIZING 四阶段实时进度。
- **热重载**：FS watcher 增量刷新符号与调用边，编辑即所见，无需重导。
- **大文件降级**：超大文件自动降级为轻量提取，不拖垮索引。

### 8. 专精 Agent 复合工具（v0.8）
两大**确定性、零 LLM** 的复合工具，替代分散的单点查询：
- **根因穿透**：`codecompass_diagnose` 从方法名或 `"POST /api/owners"` 出发，穿透 前端组件 → 路由 → Service → Mapper/XML SQL，逐层标 `VERIFIED / BROKEN / SUSPECT`；Java 全栈四层全开，其他语言按实际索引层级降级输出，缺层不硬凑。CLI 同款：`codecompass diagnose <symbol> [repoPath]`（输出 JSON，CI 可直接消费）。
- **爆炸半径**：`codecompass_refactor_plan` 递归聚合直接/间接调用方，上卷受波及对外路由与桥接前端组件，给出 HIGH/MEDIUM/LOW 风险评级与迁移步骤。CLI 同款：`codecompass refactor-plan <symbol> [--change-type <t>]`。
- **诊断工件**：`codecompass export <symbol> [--file out.html]` 输出单文件自包含 HTML（内联 mermaid 运行时，断网可渲染，可随 PR 归档），断链在拓扑图中红色描边。
- **深链现场还原**：工具结果的 `cockpitDeepLink` 携带 `?focus=<symbol>&traceId=<id>&mode=diff`，打开即闪烁聚焦目标卡片 / 直达架构差异视图。
补丁类生成内容归 LLM 编排层并显式标注（ADR-0006）；链路追踪 100% 确定性（ADR-0005）。

### 9. 模块演进副驾与领域雷达（v0.9）
- **安全下线推演**：`codecompass evolve --intent deprecate --target <module>` —— 模块聚类 → 全图反向引用 → **固定点级联孤立死代码**（被独占的公共工具一并标出）→ 五类清理 Checklist。
- **扩展挂载推演**：`codecompass evolve --intent extend --target <symbol> [--goal "..."]` —— 挂载点定位、方法/类/接口三级 `@Transactional` 事务边界证据、解耦模式匹配（Spring Event 异步 / AOP 切面 / 直接注入）+ 确定性代码脚手架（补丁仍归 LLM 层，ADR-0006）。
- **领域雷达**：`codecompass radar [query]` —— Hub 节点（出入度 + 确定性 PageRank，悬挂节点权重不外泄、桥接边计入入度）、Top APIs、持久化底座；中文意图靠 doc-chunk 证据确定性桥接，零 embedding。

### 10. Zero-Config 安装器（v0.8）
```bash
codecompass install --ide <cursor|zcode|claude|windsurf|cline|roo|all> [--repo <path>] [--dry-run]
```
把 stdio MCP 入口写入各 IDE 自有配置（Cursor `~/.cursor/mcp.json` 并注入工具 autoApprove 白名单、ZCode `~/.zcode/cli/config.json`、Claude Desktop），自动解析 Node 运行时绝对路径；幂等合并、写前自动备份、`--dry-run` 预览。

## 快速上手

### 前置要求
- Node.js 24+（`engines` 与 `codecompass doctor` 均按此约束；开发环境 v24）
  > 原因：`better-sqlite3` 是原生模块，本地直接运行预编译 `dist` 时 Node 主版本必须与构建时 ABI 匹配（NODE_MODULE_VERSION）。Docker 路径在镜像内重新 `npm ci` 重建原生模块，不受此限制。
- 首次使用需要构建一次（`bin/codecompass.js` 依赖 `dist/` 产物）
- 启动前可运行 `codecompass doctor --json` 自检环境

### 方式一：CLI（推荐）

```bash
# 1. 安装依赖
npm run install:all

# 2. 构建（一次即可，产物在 dist/）
npm run build

# 3. 单命令导入并打开驾驶舱
codecompass /path/to/your/repo
# 或
npm start -- /path/to/your/repo
```

常用参数：

```bash
codecompass <path>            # 导入仓库并自动打开浏览器到驾驶舱
codecompass <path> --port 9000        # 自定义端口（默认 43110 / $MHW_CP_PORT）
codecompass <path> --data-dir ./data  # 自定义数据目录（默认 ~/.mhw / $MHW_DATA_DIR）
codecompass <path> --no-browser       # 只启动服务，不自动开浏览器
codecompass context listOrders /path/to/your/repo   # 导出 Graph RAG Agent 上下文
codecompass doctor --json             # 环境自诊断
codecompass diff <base> <head> [path] # PR 架构影响面
codecompass --version
```

### Web 工作台

导入完成后浏览器访问 `http://localhost:<port>`，三栏工作台（clean / cyber 双主题）：

- **左侧栏**：Quick Tours 上手导览、路由列表、符号树——支持文本搜索与按符号类型（route / class / method / config / dependency…）过滤。
- **中央画布**：提问即得确定性调用链时序图；看板 / CI 门禁 / 架构差异为独立 Tab。
- **右侧 Inspector**：Monaco 只读源码 + 一次性 glow 定位；选中符号可看**反向依赖**（谁调用了它）、**子图透视**（caller / callee 方向切换）、复制 Agent 上下文。
- **导入**：本地路径 / GitHub 克隆双通道，导入前实时预览文件数；大仓超限时会给出可一键选用的子目录建议。

### 回归门禁

```bash
npm run e2e   # = python scripts/e2e/closeout_gate.py（需 Node 24 + 已构建 dist + git + python3）
```

一键构建多语言 fixture（Java+TS / Python / Go）并断言 35 项能力：doctor、版本一致性、
多语言消费面、Module Scope、扫描过滤（venv/二进制）、跨语言桥接、reverse-deps、
确定性调用链、SSE 流（mermaid + 锚点）、symbolType 枚举、架构差异、ADR-0003 脱敏
门禁、FastAPI Depends、Go 隐式接口、热重载，以及 v0.8 的 MCP stdio 复合工具往返、
CLI diagnose / refactor-plan / export 与 install --dry-run，以及 v0.9 的 radar 全景与意图锚点、evolve 双意图与多视图工件断言（含 MCP stdio 往返）、v0.13 的 golden eval 阈值冒烟。基准报表见 `docs/benchmark.md`。

### 方式二：Docker（容器开发）

```bash
docker compose up --build
```

`docker-compose.yml` 将当前目录**只读挂载**到容器内的 `/repo`（容器拿不到你的源码写权限），导入结果存到命名卷 `codecompass-data`，服务暴露在 `http://localhost:43110`。不想用默认编排时，也可直接构建镜像：

```bash
docker build -t codecompass:local .
docker run --rm -p 43110:43110 \
  -v "$PWD:/repo:ro" -v codecompass-data:/data \
  codecompass:local node services/control-plane/dist/cli.js /repo --no-browser
```

## 安装（npm）

```bash
# 无需预装，直接拉起 stdio MCP 服务：
npx @codecompass/cli mcp /path/to/your/repo

# 或全局安装后使用 codecompass 命令：
npm install -g @codecompass/cli
codecompass /path/to/your/repo          # 打开 Web 驾驶舱
codecompass install --ide all           # 一键写入 6 家 IDE 的 MCP 配置
```

支持一键写入的 IDE：Cursor、ZCode、Claude Desktop、Windsurf、Cline、Roo Code、Windsurf、Cline (VS Code)、Roo Code (VS Code)。

## MCP 工具接入

`codecompass mcp <path>` 启动标准 stdio MCP 服务，当前提供 12 个确定性工具：

| 工具 | 用途 |
| --- | --- |
| `codecompass_list_repos` | 列出已索引仓库的 id / name / status / fileCount |
| `codecompass_trace_call_chain` | 解析确定性静态调用链 |
| `codecompass_get_dashboard` | 聚合零 Prompt 架构驾驶舱 |
| `codecompass_get_config_evidence` | 配置 key 证据（只返回 file:line，不返回 value） |
| `codecompass_get_tours` | 返回 Onboarding Tour |
| `codecompass_reverse_deps` | who-uses 反向调用者查询 |
| `codecompass_get_pr_impact` | Git PR 架构影响面分析 |
| `codecompass_get_subgraph_context` | **Graph RAG 子图提取**：1-Hop Caller + 1~3 Hop Callee、骨架折叠、Token 剪枝与凭据脱敏 |
| `codecompass_diagnose` | **跨栈根因穿透**：前端组件 → 路由 → Service → Mapper 分层链路，逐层 VERIFIED/BROKEN/SUSPECT |
| `codecompass_refactor_plan` | **重构爆炸半径**：直接/间接调用方、受波及路由与前端组件、风险评级与迁移步骤 |
| `codecompass_domain_radar` | **领域全景雷达**：出入度 + 确定性 PageRank 的 Hub 节点、Top APIs、持久化底座与意图锚点（零 embedding） |
| `codecompass_module_evolution` | **模块演进推演**：DEPRECATE 固定点级联孤立死代码 + 清理 Checklist；EXTEND 事务边界证据 + 解耦模式脚手架 |

### Cursor

在项目根目录创建 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "codecompass": {
      "command": "npx",
      "args": ["codecompass", "mcp", "/path/to/your/repo"]
    }
  }
}
```

### Claude Desktop

编辑 `claude_desktop_config.json`（Windows：`%APPDATA%\Claude\claude_desktop_config.json`；macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "codecompass": {
      "command": "npx",
      "args": ["codecompass", "mcp", "/path/to/your/repo"]
    }
  }
}
```

## 开发

```bash
npm run install:all    # 安装全部 workspace 依赖
npm run typecheck      # 四个包全部 tsc --noEmit
npm test               # 后端 vitest（services/control-plane）
npm run test:web       # 前端 vitest（apps/repoqa-web）
npm run dev            # 前端 dev server（API 走 43110）
python scripts/e2e/closeout_gate.py   # API 级端到端回归基线
```

## 个人数据管理

- **删除仓库**：只移除仓库索引，源文件与本地克隆目录保留，之后可随时重新导入同一路径。
- **启动前自动备份**：每次启动服务前用 SQLite online backup 生成 `mhw.db.backup-<时间戳>`，数据目录保留最近 5 份。

## 目录结构

```
apps/repoqa-web/            # React 三栏工作台（看板 / 调用链 / 差异 / Inspector）
services/control-plane/     # 单进程控制面：解析、索引、调用链、桥接、脱敏、导出
packages/contracts/         # 前后端共享契约
packages/bridge-adapters/   # 协议适配层
scripts/e2e/                # API 级回归门禁（closeout_gate.py）
bin/codecompass.js          # CLI 启动器（thin launcher）
docker-compose.yml          # 本地容器开发（只读挂载）
docs/adr/                   # 架构决策记录；术语表见 CONTEXT.md
```

## 版本

当前版本：`v0.20.0`（CHANGELOG 含 0.5.x–0.20.0 完整条目）。语义化版本规则见 `docs/adr/`。
