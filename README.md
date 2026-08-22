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

## 快速上手

### 前置要求
- Node.js 20+（开发环境已验证 v24）
- 首次使用需要构建一次（`bin/codecompass.js` 依赖 `dist/` 产物）

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
codecompass --version
```

导入完成后浏览器访问 `http://localhost:<port>`，即可看到：
- **看板**：技术栈分类、架构指标、Top API
- **调用链**：输入方法/资源名，模式选 `call-chain`，得到带溯源锚点的 mermaid 时序图（支持跨模块 3+ 跳）
- **导出**：`ONBOARDING.md` 一键下载

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

当前版本：`v0.2.0-beta`。API 与 CLI 参数在 beta 阶段可能调整，语义化版本规则见 `docs/adr/`。