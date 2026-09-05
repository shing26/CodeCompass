# CodeCompass 代码审查与可用性评估报告

> **⚠️ 已过时（superseded）**：本报告基于 v0.5.0 代码。其 P0/P1 缺陷大部分已在 v0.5.1/v0.6.0 修复（D1、D3–D5、D6、D7、D8 缺陷部分），E6/E3 已实现。当前有效的优先级与范围见 [`.scratch/v0.6-closeout/spec.md`](.scratch/v0.6-closeout/spec.md)。本文仅作历史存档。

> 审查对象：CodeCompass（本地优先、只读代码理解工作台）v0.5.0 代码库
> 方法：基于**实际代码**走查（`services/control-plane/src`、`apps/repoqa-web`、根配置、`Dockerfile`/`docker-compose.yml`、CHANGELOG），并结合上一轮端到端实测结论（复测 PASS=19 / FAIL=10）。
> 范围：① 运行/部署就绪度；② 模块实现完整性；③ 核心交互流程自洽性。
> 说明：前端由 Explore 子代理逐文件核对；后端由主代理直接读源码与路由表。

---

## 1. 运行 / 部署条件评估

### 1.1 环境依赖
| 依赖 | 要求 | 风险 |
|---|---|---|
| Node.js | 根 `package.json` `engines: ">=20"`；`Dockerfile` 用 `node:20` | **本地直接运行预编译 `dist` 时，必须与 `better-sqlite3` 原生模块的 ABI 匹配**。本环境 `dist` 按 Node 24（ABI 137）构建，用 Node 22 启动即报 `NODE_MODULE_VERSION` 错误；须用 Node 24。`engines: ">=20"` 具有**误导性**——并非"任意 ≥20"都行。 |
| 原生模块 | `better-sqlite3`、`express`、`ws`（esbuild 中 `external`） | 需 `npm install` 并**按当前 Node 重新编译**原生模块；Docker 内 `npm ci` 会重建，自洽。 |
| 前端 | React 19 + Vite 6 + TypeScript，需独立 `build`/`dev` | `apps/repoqa-web/dist` 已存在（2026-08-27 构建），但**不保证与最新源码一致**，需重跑 `npm run build` 确认。 |

### 1.2 配置文件与关键环境变量
- `services/control-plane/.env.example`：环境变量模板。
- 运行时变量（来自 `config.ts`）：
  - `MHW_CP_PORT`（默认 `43110`）
  - `MHW_DATA_DIR`（默认 `~/.mhw`，Docker 为 `/data`）→ SQLite `mhw.db` + 索引
  - `MHW_STATIC_DIR`（指向前端 `dist`，用于单进程托管 SPA）
  - `REPOQA_LLM_*`（**可选**，启用远程自然语言问答；不配置则纯确定性）
- 数据目录即状态：仓库索引、符号、调用边、事件均落在 `MHW_DATA_DIR`，属 Local-First 设计。

### 1.3 启动前置步骤
```
npm run install:all      # 安装 4 个子项目（contracts/bridge-adapters/control-plane/repoqa-web）
npm run build            # 顺序构建：contracts → bridge-adapters → control-plane → repoqa-web
npm start                # = node services/control-plane/dist/cli.js [可选本地路径]
# 或容器：
docker compose up --build   # 镜像内重建原生模块并托管前端
```
- `bin/codecompass.js` 仅是 launcher，依赖 `dist/cli.js` 已构建；未构建时会给出明确提示。
- 开发模式：前端 `vite` + `VITE_REPOQA_API_BASE=http://localhost:43110`，后端 CORS 已放开跨域（有意设计，非遗漏）。

### 1.4 部署结论
**具备直接部署条件，但有两个"坑"：**
1. **本地 Node 版本必须与 `better-sqlite3` 构建 ABI 一致**（本环境 Node 24 可用，Node 22 失败）。`engines: ">=20"` 应改为精确约束或文档明示。
2. **预编译 `dist` 可能滞后于源码**（root `0.6.0` vs `cli.ts`/`CHANGELOG` `0.5.0`）。Docker 路径因重建原生模块而更稳，推荐优先用容器部署。

---

## 2. 模块实现完整性（逐模块）

| 模块 | 状态 | 证据 | 影响 |
|---|---|---|---|
| 入口 / CLI（`cli.ts`、`bin`） | ✅ 完整 | `mcp`/`diff`/`pr-summary`/`context` 子命令均在；`bin` launcher 健全 | — |
| 配置（`config.ts`） | ✅ 完整 | 端口/数据目录/静态目录解析清晰 | — |
| HTTP API（`http.ts`） | ✅ 完整 | 约 30 条路由：`/health`、`/api/repos*`、`/query`(SSE)、`/reverse-deps`(272)、`/subgraph-context`(349)、`/architecture-delta`、`/export`、`/events`、`/tasks`、`/harnesses`、`/workspaces`、`/clone` 等；**无空路由/未实现桩** | — |
| 仓库导入与扫描（`repoqa-scan.ts`） | ⚠️ 有缺陷 | `MAX_LINES=500_000`（:6）、`:211` 抛错；行数把日志/文档/json 一并计入 | **D1 硬阻断**：ResuAlign-Lite 真实 243 py 但 501996 行被拒 |
| 语言适配层（`LanguageAdapter` + 4 适配器） | ⚠️ 部分 | Java/TS/Python 完整且 E2E 验证；**Go 适配器已实现但无样本仓实测**；`TYPESCRIPT_EXTENSIONS` 不含 `.mjs`（D7），ResuAlign 37×`.mjs` 不被解析 | D7；Go 潜在缺陷待验证 |
| 确定性调用链（`repoqa-callchain`、`worker`） | ✅ 完整 | Java/Python/TS 调用链 E2E 可用（D2 已闭环）；不调 LLM | — |
| 看板（`repoqa-dashboard`） | ⚠️ 未跨语言 | `techStack`/`topApis`/`configKeys` 仅 Java(Maven) 有效（R4=8/10/111；R1/R2/R3 全 0） | **D3/D4/D5**：消费侧能力名不副实 |
| 低置信度兜底（`worker`） | ✅ 完整 | architecture 与 call-chain 对未解析符号均输出固定提示（E2E 验证） | — |
| Graph RAG 子图（`repoqa-graphrag`） | ✅ 完整 | `likePost` 子图 8 节点、含 distance/direction/tokens（E2E 验证） | — |
| 反向依赖 | ⚠️ 桥接缺失 | HTTP 端点 `http.ts:272` **存在**；但 `subgraph`/`reverse` 的调用图**仅含同语言节点**（likePost 全 Java），前端经 `apiClient` 封装的调用未被桥接 | **D8 跨语言桥接未生效**（端点有，跨语言边无） |
| MCP 工具（`repoqa-mcp`） | ✅ 完整 | 8 工具齐全并 E2E 验证（`tools/list`） | — |
| PR 影响面（`repoqa-diff`） | ✅ 完整 | `analyzeDiff`/`pr-summary`，含 `--fail-on-auth-impact` 敏感路由门禁 | — |
| 脱敏（`repoqa-masking`） | ✅ 完整 | `maskedValues`、13 类凭据脱敏，E2E 验证 | — |
| 前端（`apps/repoqa-web`） | ⚠️ 局部缺口 | 7/8 功能完整：SSE 流式问答、Mermaid 调用链、PrivacyPill、Token/Provenance、Tours、符号搜索、导入向导；**反向依赖 UI 缺失**（后端有、前端未调用）；架构差异视图仅为文本报告（未用其 `mermaid` 字段做图）；**无 TODO/桩代码** | UI 入口缺口 |
| 版本一致性 | ❌ 不一致 | root `package.json` `0.6.0` vs `cli.ts`/`CHANGELOG` `0.5.0`；**CHANGELOG 宣称"跨语言桥接已实现"与实际不符（D8）** | 文档/实现不符风险 |

**代码卫生结论**：后端生产源码**未发现**任何 `TODO`/`FIXME`/`not implemented`/占位桩；前端同样无桩。问题集中在"能力边界"与"文档宣称"，而非半成品代码。

---

## 3. 核心交互流程与自洽性

### 3.1 导入流程
`POST /api/repos` → 后台扫描+解析+索引 → 前端轮询 `status` → `ready`/`error`。
- **自洽**：索引为有限扫描，无死循环；D1 时返回 `error`（前端 `ImportRepoModal` 已处理 `cloning→indexing→error` 阶段）。
- **断点**：真实大仓直接报错，**无子模块/子目录选择器**（前端也未提供），用户只能手动指子目录绕过。

### 3.2 查询 SSE 流程
前端 `EventSource` → 后端生成器逐事件 `repoqa.query.token` / `.mermaid` / `.anchors` → `done`/`error` 收尾。
- **自洽**：E2E 实测各模式均正常结束（无悬挂流）；前端 `useChat` 带**自动重连预算**，避免无限重连。
- 事件名前后端完全一致（已核对 `http.ts` 与 `RepoQAClient.ts`）。

### 3.3 调用链 / 子图可视化
Mermaid 静态图 + `code://` 锚点点击跳转 → 打开对应 `file:line`。
- 可用，但**非交互式**（不可折叠/双向切换，E4 待做）。
- **跨语言断点（D8）**：前端→后端调用图断裂，用户看到的调用链止步于前端 API 层（subgraph 全 Java）。

### 3.4 隐私 / Token 呈现 —— **已纠正**
前端 `PrivacyPill`（none/local/remote 三态）、会话 Token 进度条、消息级 `provenance` 徽章（静态图谱/模型推理）**均已实现**。
> ⚠️ 更正：此前《验证计划》将 AC-9 列为"P1 待联调"是错误的——前端探索确认其**已完成**。AC-9 应从待办移除。

### 3.5 状态一致性
- 仓库选择（`TopBar` 下拉）与查询上下文经 `useRepoCatalog` 统一管理；`'metrics'` Tab 复用 `DashboardView`（有意设计，非断链）。
- 未发现明显状态不一致或竞态。

### 3.6 交互断点汇总
1. 跨语言桥接断点（D8）：调用图止步前端层。
2. 反向依赖断点：后端能力存在，前端无入口。
3. 大仓导入断点（D1）：无子模块选择，真实大仓被拒。
4. 差异视图非图化：架构差异仅为文本，未利用其 `mermaid` 字段。

---

## 4. 总体结论

- **运行/部署**：具备条件，Docker 路径更稳；本地直接跑预编译 `dist` 须注意 Node/ABI 匹配与 `dist` 滞后。
- **代码质量**：主体完整、卫生良好，无半成品/桩代码；确定性调用链、MCP、Graph RAG、脱敏、前端核心体验均已落地。
- **主要短板**（决定"多语言"成色）：① 导入层硬阻断 D1；② 消费侧能力仅 Java（D3/D4/D5）；③ 跨语言桥接名不副实（D8 + CHANGELOG 夸大）；④ 版本/文档不一致；⑤ 若干 UI 入口缺失（反向依赖、差异图、子模块选择）。

---

## 5. 问题清单（按优先级）

### P0（部署/导入阻断）
- **P0-1｜D1 大仓 500K 行上限误杀** — `repoqa-scan.ts:6,211`。影响：真实大仓无法导入，导入层硬阻断。
- **P0-2｜版本/ABI 部署陷阱** — 本地 Node 须匹配 `better-sqlite3` 构建 ABI（`engines:">=20"` 误导）；root `0.6.0` vs `cli`/`CHANGELOG` `0.5.0` 不一致。影响：直接运行易失败、版本溯源混乱。

### P1（多语言成色 / 可用闭环）
- **P1-1｜D3/D4/D5 消费侧能力仅 Java** — `repoqa-dashboard`：techStack/topApis/configKeys 对 TS/Python 为空。影响：dashboard/tours/MCP 对非 Java 仓库信息贫乏，"多语言"名不副实。
- **P1-2｜D8 跨语言桥接未生效 + CHANGELOG 夸大** — subgraph/reverse 仅同语言节点；CHANGELOG 宣称已实现但样本仓不可复现。影响：产品核心卖点失真、用户预期落差。
- **P1-3｜反向依赖 UI 缺失** — 后端 `/api/repos/:id/reverse-deps` 存在，前端从未调用。影响：用户无法在 UI 使用已具备的能力。
- **P1-4｜大仓导入无子模块选择器** — 前端 `ImportRepoModal` 未提供子目录选择。影响：D1 的用户侧缓解缺失。

### P2（完善度）
- **P2-1｜D6 `/symbols` 的 `symbolType` 全 `unknown`** — 前端符号类型过滤维度失效（E2E 实测 1600 条全 `?`）。
- **P2-2｜D7 `.mjs` 未纳入 `TYPESCRIPT_EXTENSIONS`** — 37×`.mjs` 不被解析。
- **P2-3｜架构差异视图仅为文本** — 未利用其数据中已定义的 `mermaid` 字段做图可视化。
- **P2-4｜Go 适配器未实测** — 已实现但无样本仓，存在潜在缺陷风险。
- **P2-5｜增量索引/热重载（AC-12）未验证** — 本轮未对 FS watcher 热重载做实测，伸缩性待评估。

---

## 6. 建议的下一步
1. 先收 **P0**：放宽/修正行数统计口径（仅计源码行）+ 提供子模块选择；统一版本号、修正 `engines` 与部署文档。
2. 再收 **P1**：消费侧多语言化（D3/D4/D5）、跨语言桥接落地或下修 CHANGELOG 宣称、补齐反向依赖 UI 与子模块选择器。
3. 末收 **P2**：symbolType、.mjs 覆盖、差异图可视化、Go 实测、增量索引验证。
4. 复用 `codecompass_e2e_harness.sh` 作为回归基线，修复后重跑直至 AC-1~AC-4、AC-8、AC-10 全绿。
