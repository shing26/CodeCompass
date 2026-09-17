# Issue 03 — 发布就绪（npm 首发 + 文档一致性包）

> Spec：`.scratch/v031-precision/spec.md` §3（M4）、§2（实证修正）
> 波次：Wave 2 ｜ 依赖：票 01（仅 (c) 需精度数字；(a)(b)(d)(e) 可先行）

## 目标

M4 = 1：**陌生人照 README 抄一行命令即可接入 Cursor**；同时消灭四份「文档与实现不一致」的存量漂移。

## 内容

### (a) npm 首发（凭证在用户侧）

- 包名 `@codecompass/cli`（根 `package.json` 已是该名 + `files: bin/, services/control-plane/dist/, apps/repoqa-web/dist/`）。
- agent 侧可做：`npm pack --dry-run` 核验包内容面（bin 可执行位、dist 齐全、LICENSE/README 入包、无 `.env`/`.scratch` 泄漏）；`prepublishOnly` 构建链在干净目录验证。
- **用户侧执行**：确认 `@codecompass` scope 归属（npm org）→ `npm publish`。
- 发布后核验：`npm view @codecompass/cli version` 有值；干净目录 `npx @codecompass/cli mcp <path>` 完成 stdio 握手并返回 `list_repos`。

### (b) README 修正

- 工具数：现写「**15 个**确定性工具」→ 实际 **17**（`src/mcp/repoqa-mcp.ts` 的 `MCP_TOOLS`）。
- 安装段实测：`npx @codecompass/cli` 目前 404，发布后必须逐字跑通（含 Node 24 要求与 `better-sqlite3` ABI 提示——干净机器最容易撞的一条）。
- 与 §1.2 冻结面一致：安装段是「给 agent 用」的门面，Web 段落降权为演示。

### (c) `docs/benchmark.md` 刷新

- 现文档停在 **v0.16.0 / 75 题 / 7 bucket**；实际 eval = **97 题 / 10 bucket**（含 incident / evolve-intent / convention）。
- 增「真实仓库段」：引用票 01 的精度对照表（合成基准与真实仓库分开陈述，不得混为一谈）。

### (d) `docs/agents/parallel-collaboration.md` 版本面修正

- 现文写「版本六处 = 四个 package.json + cli.ts VERSION + repoqa-mcp.ts MCP_SERVER_VERSION」——**已过时**：主版本单一源 = `src/version.ts`（V27-25）；`MCP_SERVER_VERSION` 已是别名且受 gate 棘轮（V30-11，`mcp-handshake-version`）。
- 改为「版本五处 = 四本 package.json + version.ts；MCP 握手版本禁字面量（gate 执法）」。

### (e) `CONTEXT.md` Dual-Surface 词条校准

- 词条写「v1 MCP 感知面冻结为现有 **8 工具**，演进类工具随 Issue 25 补齐」——Issue 25 已补齐，现实为 **17 工具**。改为「冻结为现有 17 工具（数量只减不增；精度增强不受限）」，与 spec §1.2 语义对齐。

## 验收

- [ ] `npm view @codecompass/cli version` 有值；干净目录一行命令跑通 MCP 握手（含截图/日志留档）—— **待用户执行发布**（agent 无凭证；发布前核验已完成，见下）
- [x] README 工具数、安装段、Node/ABI 提示与实现一致 —— `cb15585`（工具数 15 → 17；安装段随发布后复核）
- [x] benchmark 文档 bucket 数与题数与 `npm run eval` 实际输出一致 —— `cb15585` 刷到 97 题 / 10 bucket，并加真实仓库段交叉引用；版本标签随 v0.31.0 推进更新为 2026-09-17
- [x] 协作文档与 CONTEXT 词条无「六处/8 工具」等过时表述（grep 留证）—— `cb15585`（版本五处 + 17 工具）
- [x] CHANGELOG 0.31.0 条目含发布段 —— 本增量（含发布物、M4 验收命令、发布前核验结果）

**发布前核验（agent 侧，已完成 2026-09-17）**：`npm pack --dry-run` 干净——160 文件 / 5.0 MB / 解包 19.9 MB，`bin/codecompass.js` 与两份 `dist/` 齐全，`.env`、`.scratch`、`node_modules`、测试夹具零入包。版本五处已推进至 0.31.0，e2e gate 的 `version-consistency` 与 `/health payload version` 双绿（后者需先 `npm run build`——`dist/` 不入库，是本次发现的第六处版本落点，CI 已自带 build 步骤）。

**余下两步（用户本机）**：① 确认 `@codecompass` scope 归属 → `npm publish`；② `git tag v0.31.0 && git push origin v0.31.0` 触发 Release 管线。发布后按 M4 验收命令在干净目录实测 `npx @codecompass/cli mcp <path>`。

## 风险

- npm scope 未创建 / 包名冲突 → 需用户先在 npm 侧建 org。
- 发布后首次 `npx` 走的是 npm 缓存外的真实下载，冷启动路径必须实测（不能只在本地 `npm link` 验证）。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `package.json`、`services/control-plane/package.json`、`apps/repoqa-web/package.json`、`packages/contracts/package.json` | 共享区（版本五处） | **v0.31.0 推进**（`packages/bridge-adapters` 独立 0.6.0 线不动） |
| `services/control-plane/src/version.ts` | 共享区（版本五处） | 单一源；`MCP_SERVER_VERSION` 为别名，受 gate `mcp-handshake-version` 棘轮 |
| `CHANGELOG.md` | 共享区 | **新增 0.31.0 段**（发布段载体） |
| `README.md`、`docs/benchmark.md`、`docs/agents/parallel-collaboration.md`、`CONTEXT.md` | 共享区 | (b)(c)(d)(e) 已于 `cb15585` 落地；本增量另动了三处**版本叙事**（benchmark 两处版本标签随 v0.31.0 推进刷新、CONTEXT Status 行改 0.31.0 并把 0.30.0 降为「此前」），因为它们会随版本推进变成误导 |
| `docs/reports/scan-precision-baseline-2026-09-16.md` | 共享区 | 增 M2 归零一行（见 02 第三增量） |

**边界**：`git tag v0.31.0` / GitHub Release / `npm publish` 均为**对外动作**，由用户执行；本票只准备到「工作树就绪 + 发布前核验」为止。
