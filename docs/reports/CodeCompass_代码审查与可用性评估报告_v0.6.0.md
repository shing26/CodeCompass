# CodeCompass 代码审查与可用性评估报告（v0.6.0）

> 审查对象：CodeCompass（Local-First、只读代码理解工作台）**v0.6.0**
> 审查日期：2026-08-29 ｜ 构建：`dist` 2026-08-28 18:38 ｜ 运行时版本实测 `0.6.0`
> 方法：读码（`services/control-plane/src`、`apps/repoqa-web/src`、根配置、`Dockerfile`/`docker-compose.yml`、CHANGELOG）+ **实跑验证**（`codecompass doctor`、自建 E2E harness、项目自带 `scripts/e2e/closeout_gate.py`）
> 说明：本报告取代 v0.5.0 版审查结论（旧报告已归档）。上一版所有缺陷均已在 v0.5.1/v0.6.0 修复并经本轮实测复核。

---

## 0. 结论摘要

| 维度 | 结论 |
|---|---|
| 运行 / 部署就绪度 | ✅ **具备直接部署条件**；新增 `doctor` 自诊断可一键前置体检，本机 5/5 通过 |
| 模块实现完整性 | ✅ **主体完整**，无未实现/半成品/桩代码；上一版 10 项缺陷全部闭环 |
| 交互自洽性 | ✅ 导入/查询/反向依赖/差异/隐私各链路自洽，**无断点、无死循环、无状态不一致** |
| 实测结果 | 自建 E2E **PASS=35 / FAIL=0**；项目自带 closeout gate **19 passed / 0 failed** |
| 遗留问题 | 4 项轻微（1 项部署配置不一致需优先处理） |

**一句话结论**：项目已从"可用但有硬伤"演进为"可交付且有自动化回归门禁"；当前主要风险不在功能缺失，而在**部署配置与文档的一致性**。

---

## 1. 运行 / 部署条件评估

### 1.1 环境依赖（含 `doctor` 实测）

```
$ codecompass doctor --json   →  status: ok, durationMs: 1349
```

| 检查项 | 实测结果 | 说明 |
|---|---|---|
| Node.js 运行时 | ✅ Node 24.15.0 satisfies **>= 24.0.0** | `package.json:30` 已修正为 `">=24"`（v0.5.0 时为 `">=20"`，具误导性） |
| SQLite 原生 ABI | ✅ WAL probe ok (`journal_mode=memory`) | better-sqlite3 原生模块与当前 Node ABI 匹配 |
| 端口可用性 | ✅ Port 43110 bindable | 默认端口未被占用 |
| 数据目录 | ✅ `~/.mhw` 可写，**20590 MB** 可用 | 隔离数据目录实测 6407 MB 可用 |
| 本地 LLM | ✅ Ollama ready（4 models） | 可选依赖；未配置时走纯确定性路径 |

其他依赖：前端 React 19 + TypeScript + Vite 6（`apps/repoqa-web`）；原生模块 `better-sqlite3`/`express`/`ws`（esbuild external，需按当前 Node 编译）。

### 1.2 配置文件与环境变量

| 来源 | 关键项 |
|---|---|
| `services/control-plane/.env.example` | 环境变量模板 |
| `config.ts` | `MHW_CP_PORT`（默认 43110）、`MHW_DATA_DIR`（默认 `~/.mhw`/容器 `/data`）、`MHW_STATIC_DIR`（前端 dist）、`REPOQA_LLM_*`（可选远程推理） |
| 数据目录 | 同时承载 SQLite `mhw.db` 与索引——**删除即丢全部索引**，Local-First 的核心状态 |

### 1.3 启动前置步骤

```bash
npm run install:all                 # 安装 4 个子项目
npm run build                       # contracts → bridge-adapters → control-plane → repoqa-web
node services/control-plane/dist/cli.js doctor      # ★ v0.6.0 新增：首跑前置体检
npm start                           # = node dist/cli.js [可选本地路径]
# 或容器
docker compose up --build
```

开发态：前端 `vite` + `VITE_REPOQA_API_BASE=http://localhost:43110`，后端已放开 CORS（有意设计）。
生产态：后端静态托管 `apps/repoqa-web/dist`（`MHW_STATIC_DIR` + SPA 回退）。

### 1.4 部署结论与风险

- ✅ **具备直接运行/部署条件**，两条路径均完整接线。
- ⚠️ **风险（新发现）**：`Dockerfile:6,27` 仍为 `node:20-bookworm-slim`，但 `package.json:30` 要求 `">=24"`、且 `doctor` 强制校验 `>= 24.0.0`。**容器镜像会违反自身 engines 约束并导致 doctor 的 node 检查失败**——需同步升级基础镜像。
- ℹ️ 容器内 `npm ci` 会重建原生模块，故容器路径本身可自洽；该问题属"约束声明与镜像不一致"。

---

## 2. 模块实现完整性（逐模块）

| 模块 | 状态 | 实测证据 |
|---|---|---|
| 入口 / CLI（`cli.ts`、`bin`） | ✅ 完整 | `mcp`/`diff`/`pr-summary`/`context`/**`doctor`** 子命令齐备；`bin` launcher 健全 |
| 配置（`config.ts`） | ✅ 完整 | 端口/数据目录/静态目录解析清晰 |
| HTTP API（`http.ts`） | ✅ 完整 | ~30 条路由，含 `reverse-deps`、`subgraph-context`、`architecture-delta`、`query`(SSE)、`clone`、`export`；无非实现路由 |
| 仓库导入与扫描（`repoqa-scan.ts`） | ✅ 已修复 | `SOURCE_EXTENSIONS`(`:13`) 仅计源码行，`:238` 过滤非源码扩展 |
| 语言适配层（Java/TS/Python/Go） | ✅ 完整 | 四语言均产出符号与路由；Python FastAPI/Flask 增强；`.mjs` 已纳入 |
| 确定性调用链 | ✅ 完整 | Java / Python / **TypeScript** 三语调用链均返回 mermaid |
| 看板消费侧（techStack/topApis/configKeys） | ✅ 已多语言化 | 见下表，4 仓全部非空 |
| `/symbols` symbolType | ✅ 已修复 | 4 仓 `unknown=0`（v0.5.0 时 1600 条全 unknown） |
| 跨语言桥接 | ✅ 已修复 | subgraph 含 `java`+`tsx` 节点；reverse-deps 返回 TS 前端调用方 |
| Graph RAG 子图 | ✅ 完整 | `likePost` 子图 9 节点（含跨语言节点） |
| MCP 工具 | ✅ 完整 | `tools/list` 返回 8 工具 |
| 低置信度兜底 | ✅ 完整 | architecture 与 call-chain 双模式对未解析符号均输出固定提示 |
| PR 影响面 / 脱敏 | ✅ 完整 | 配置值永不外泄（ADR-0003：key 暴露、value 不出现） |
| 大文件韧性（v0.6.0） | ✅ 可用 | Tier 3 轻量提取，3000 方法大类仍能提取类符号 |
| 前端（`apps/repoqa-web`） | ✅ 完整 | 反向依赖面板、架构差异 mermaid 渲染、PrivacyPill/Token/Provenance、Tours、符号搜索、导入向导、StatusStepper |
| 代码卫生 | ✅ 良好 | 后端与前端**均无** TODO/FIXME/占位桩 |

### 消费侧多语言化实测（4 个真实仓库）

| 仓库 | 语言 | routes | techStack | topApis | configKeys | symbolType |
|---|---|---|---|---|---|---|
| CodeCompass | TS/JS | 33 | 4 | 10 | 6 | ✅ unknown=0 |
| ResuAlign-Lite | Python | 163 | 4 | 10 | 196 | ✅ unknown=0 |
| moa-gateway | Python | 36 | 6 | 10 | 47 | ✅ unknown=0 |
| Nexus-Campus | Java+TS | 12 | 9 | 10 | 147 | ✅ unknown=0 |

> 对照：v0.5.0 时除 Java 外，**TS/Python 三项全为 0**，ResuAlign-Lite 更是被 500K 行上限直接拒绝导入。

### 缺陷闭环追溯（v0.5.0 审查 → 现状）

| ID | v0.5.0 问题 | 修复版本 | 本轮复核 |
|---|---|---|---|
| D1 | 大仓 500K 行上限误杀 | 0.5.1 | ✅ ResuAlign-Lite 全仓 `status=ready` |
| D2 | TS 调用链不可用 | — | ✅ 持续可用（×3 稳定） |
| D3/D4/D5 | 消费侧仅 Java | 0.5.1 | ✅ 4 仓全部非空 |
| D6 | symbolType 全 unknown | 0.5.1 | ✅ unknown=0 |
| D7 | `.mjs` 未解析 | 0.5.1 | ✅ 已纳入扫描与解析 |
| D8 | 跨语言桥接未生效 | 0.5.1 | ✅ 子图含 tsx；reverse-deps 含前端调用方 |
| 版本/ABI 陷阱 | engines `>=20` 误导 | 0.6.0 | ✅ 改 `>=24` + `doctor` 校验 |
| 反向依赖 UI 缺失 | — | 0.6.0 | ✅ `useReverseDeps` + Inspector 面板 |
| 差异视图非图化 | — | 0.6.0 | ✅ `ArchitectureDeltaView:235` 渲染 Mermaid |
| 增量热重载未验证 | — | 0.6.0 | ✅ closeout gate 已覆盖并通过 |

---

## 3. 核心交互流程与自洽性

| 流程 | 路径 | 自洽性验证 |
|---|---|---|
| **前置体检** | `doctor --json` → 5 项检查 → 决定是否可跑 | ✅ 只读、临时探针自清理；失败即阻断首跑，避免 ABI 类哑火 |
| **导入** | `POST /api/repos` → 分阶段广播 DISCOVERY→AST_EXTRACTION→**CROSS_LANG_BRIDGE**→FINALIZING → SSE/WS → 前端 StatusStepper → ready | ✅ 阶段可观测；超限返回 `suggestedSubdirs` 而非硬报错；无死循环 |
| **查询** | EventSource → `repoqa.query.token`/`.mermaid`/`.anchors` → `done`/`error` | ✅ 各模式均正常收尾（无悬挂流）；前端带重连预算，防无限重连 |
| **调用链 / 子图** | mermaid 渲染 + `code://` 锚点跳转 | ✅ 锚点有效；跨语言节点已连通 |
| **反向依赖** | Inspector 选中符号 → `/reverse-deps` → 调用方列表（含跨语言） | ✅ 加载/空/错误态均有测试覆盖 |
| **架构差异** | base→head → 新增/删除路由、断边、受影响 API + mermaid 渲染 | ✅ API 返回 mermaid（len 252）且 UI 渲染 |
| **隐私 / Token** | PrivacyPill 三态 + Token 计数 + Provenance 徽章 | ✅ 本地确定性 vs 模型推理可区分 |

**结论**：未发现断点、死循环或状态不一致。此前的三个交互断点（大仓导入拒绝、反向依赖无 UI、差异视图非图化）均已补齐。

---

## 4. 问题清单

### 仍存在的问题（按优先级）

| 优先级 | 问题 | 证据 | 影响范围 | 建议 |
|---|---|---|---|---|
| **P1** | **容器镜像 Node 版本与 engines 约束冲突** | `Dockerfile:6,27` = `node:20` vs `package.json:30` = `">=24"` | 容器部署路径：违反自身约束，`doctor` node 检查必失败，用户困惑 | 将 Dockerfile 基础镜像升级为 `node:24`（或对齐 engines 到 20 并复核 ABI） |
| **P2** | **Go 仓库 `configKeys=0`** | closeout gate：`go/gin` → techStack=1 configKeys=**0** | Go 项目缺失配置证据能力（消费侧未完全覆盖 Go） | 为 Go 补 `configKeys` 提取（如 `viper`/`os.Getenv`/yaml） |
| **P2** | **大文件 Tier 3 是有损降级** | CHANGELOG 0.6.0：>3000 行或单行 >1000 字符降级轻量提取 | 生成代码/巨型文件的方法级符号可能缺失（设计取舍，非缺陷） | 在 UI/导入结果中明示"该文件已降级提取"，避免用户误判漏符号 |
| **P3** | **`scripts/e2e/__pycache__` 未忽略** | `scripts/e2e/__pycache__/` 存在 `.pyc` | 仓库卫生（构建产物入库） | 加入 `.gitignore` |
| **P3** | **根 `package.json` 描述过时** | `description: "Local-first static **Java** architecture cockpit"` | 产品已是 Java/TS/Python/Go 多语言，描述仍只提 Java | 更新描述与 README 定位 |

### 已闭环（无需再处理）
D1、D2、D3、D4、D5、D6、D7、D8、版本/ABI 陷阱、反向依赖 UI、差异视图图化、增量热重载验证。

---

## 5. 总体结论与建议

**结论**：CodeCompass v0.6.0 **具备直接运行/部署条件，功能完整度高，实测无断裂链路**。相较 v0.5.0，最实质的进步是：① 多语言从"底座多语言"扩展到"消费侧多语言"；② 跨语言桥接真正落地并有 E2E 证据；③ 引入 `doctor` 把"能不能跑"从试错变成可断言；④ 建立 `scripts/e2e/closeout_gate.py` 自动化回归门禁。

**建议顺序**：
1. **先修 P1**（Dockerfile Node 20→24）——这是唯一影响"官方部署路径正确性"的问题，成本极低。
2. 补齐 Go 的 `configKeys`（P2），使消费侧能力在四语言上真正对齐。
3. 把 Tier 3 降级在 UI 显式化（P2），把"有损取舍"变成"可解释行为"。
4. 清理 `__pycache__` 与过时描述（P3）。

**回归方式**：`bash codecompass_e2e_harness.sh`（自建，35 项断言）+ `scripts/e2e/closeout_gate.py`（项目自带，19 项）。两者全绿即视为可发布。
