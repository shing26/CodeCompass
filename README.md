# CodeCompass

本地优先的代码理解工作台 —— 一条命令导入任何仓库，自动产出架构看板、跨模块调用链时序图与 ONBOARDING 文档。全部在一个 Node.js 进程内完成：AST 索引 → 确定性分析 → 零 Prompt 驾驶舱。

## 核心卖点

### 1. AST 确定性调用链
基于 `@lezer` 语法树（CST）构建调用图，call-chain 模式走**完全确定性的静态分析路径**，不调用任何 LLM、不消耗 token、结果可复现，每条调用链都带 `code://` 锚点可直接点击溯源。跨模块调用（Maven 多模块、npm workspace 等）自动聚合为一幅 mermaid 时序图。

### 2. 零 Prompt 驾驶舱
导入即分析，无需提问、无需配置：自动生成技术栈分类统计（framework / database / orm / cache / observability / test / http…）、架构指标（routes / services / repositories / classes / methods / fields / configKeys）、Top API 列表，并一键导出 `ONBOARDING.md`（技术栈、配置表、Top API 的 mermaid sequenceDiagram 段落）。

### 3. 双层脱敏
- **索引层（Issue 06/07）**：配置只索引 key，value 从不落盘、从不导出；多模式确定性掩码引擎重写凭据赋值（`password` / `secret` / `token` / `aws_access_key_id`…），且只重写字面量赋值，不误伤普通代码。
- **输出层（防御性兜底）**：所有导出与 HTTP 响应再经 `maskSensitiveText` 过滤一遍，双保险。

### 4. 多语言 AST 解析
`LanguageAdapter` 抽象层把不同语言的语法树统一成同一套 `RepoSymbol` 契约：同一份调用图索引、同一套确定性调用链算法、同一个 Web/MCP/CLI 证据面。

| 语言 | 扩展名 | 主要符号 | 框架 / 路由识别 |
| --- | --- | --- | --- |
| Java | `.java` | class / interface / method / field / route / service / repository / advice | Spring MVC 注解（`@RestController`、`@GetMapping` 等） |
| TypeScript / JavaScript | `.ts` / `.tsx` / `.js` / `.jsx` | Class / Function / Interface / Type | NestJS 装饰器、Express 路由、`axios` / `fetch` 调用提取 |
| Go | `.go` | struct / interface / func / receiver method / const / var | Gin / Fiber 路由注册（`r.GET`、`group.POST`） |
| Python | `.py` | class / def / async def | FastAPI / Flask 装饰器（`@app.get`、`@router.post`、`@app.route`） |

### 5. Graph RAG Agent Context
`codecompass context <query>` 用与调用链完全一致的确定性入口解析器定位符号，然后沿内存符号图做 **1-Hop Caller + 1~3 Hop Callee** 双向检索；输出会先折叠类骨架、按优先级队列做 Token 预算剪枝，再经过 13 类凭据脱敏，最终生成可直接粘贴给 Agent 的 Markdown 上下文。

## 快速上手

### 前置要求
- Node.js 24+（`engines` 与 `codecompass doctor` 均按此约束；开发环境 v24）
  > 原因：`better-sqlite3` 是原生模块，本地直接运行预编译 `dist` 时 Node 主版本必须与构建时 ABI 匹配（NODE_MODULE_VERSION），用 Node 20/22 启动 Node 24 构建的产物会直接报 ABI 错误。Docker 路径在镜像内重新 `npm ci` 重建原生模块，不受此限制。
- 首次使用需要构建一次（`bin/codecompass.js` 依赖 `dist/` 产物）
- 启动前可运行 `codecompass doctor --json` 自检环境（Node 版本 / SQLite ABI / 端口 / 数据目录 / 本地 Ollama）

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
codecompass --version
```

导入完成后浏览器访问 `http://localhost:<port>`，即可看到：
- **看板**：技术栈分类、架构指标、Top API
- **调用链**：输入方法/资源名，模式选 `call-chain`，得到带溯源锚点的 mermaid 时序图（支持跨模块 3+ 跳）
- **导出**：`ONBOARDING.md` 一键下载

### 回归门禁

```bash
python scripts/e2e/closeout_gate.py   # API 级端到端基线（需 Node 24 + 已构建 dist + git）
```

一键构建多语言 fixture（Java+TS / Python / Go）并断言 11 项能力（doctor、版本一致性、
消费面、跨语言桥接、SSE 调用链、masking、架构差异、热重载等），详见 `scripts/e2e/README.md`。

`context` 子命令无需启动 Web 服务，适合直接在终端或 CI 里取上下文：

```bash
# 使用当前目录作为仓库
npx codecompass context listOrders

# 显式指定仓库路径与可选 Token 预算
npx codecompass context listOrders /path/to/your/repo
```

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

## MCP 工具接入

`codecompass mcp <path>` 启动标准 stdio MCP 服务，当前提供 8 个确定性工具：

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
npm run eval           # golden eval：50 道冻结题，看 recall / hallucination / anchor 指标
npm run dev            # 前端 dev server（API 走 43110）
```

> 所有分析输出均可离线运行：核心路径不依赖外部 LLM，`eval` 在未配置 LLM 时也有确定性兜底，指标的完整生命周期见 Issue 16/17 验证记录。

## 个人数据管理

- **删除仓库**：只移除仓库索引，源文件与本地克隆目录保留，之后可随时重新导入同一路径。
- **启动前自动备份**：每次启动服务前用 SQLite online backup 生成 `mhw.db.backup-<时间戳>`，数据目录保留最近 5 份。

## 目录结构

```
apps/repoqa-web/            # React 驾驶舱（看板 / 调用链 / ONBOARDING 导出）
services/control-plane/     # 单进程控制面：解析、索引、AST 调用链、脱敏、导出
packages/contracts/         # 前后端共享契约
packages/bridge-adapters/   # 协议适配层
bin/codecompass.js          # CLI 启动器（thin launcher）
docker-compose.yml          # 本地容器开发（只读挂载）
```

## 版本

当前版本：`v0.5.0`。语义化版本规则见 `docs/adr/`。
