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
- [x] README 工具数、安装段、Node/ABI 提示与实现一致 —— `cb15585`（工具数 15 → 17；安装段随发布后复核）；**2026-09-24 增补：首句定位改为「多语言代码事实层，主轴 MCP」**（原文自称"工作台"，与"Web 只减不增"的裁决矛盾，用户当场指出）
- [x] benchmark 文档 bucket 数与题数与 `npm run eval` 实际输出一致 —— `cb15585` 刷到 97 题 / 10 bucket，并加真实仓库段交叉引用；版本标签随 v0.31.0 推进更新为 2026-09-17
- [x] 协作文档与 CONTEXT 词条无「六处/8 工具」等过时表述（grep 留证）—— `cb15585`（版本五处 + 17 工具）
- [x] CHANGELOG 0.31.0 条目含发布段 —— 本增量（含发布物、M4 验收命令、发布前核验结果）

**发布前核验（agent 侧，2026-09-17 首次；2026-09-24 重做——此后仓库又落了 6 张票的改动）**：

1. `npm pack --dry-run` 复检：仍是 **160 文件 / 5.0 MB / 解包 19.9 MB**；`LICENSE` + `README.md` 经 npm always-include 兜底入包、
   `bin/codecompass.js` 在、两份 dist 齐（控制面 2 + web 154）、可疑条目扫描（`.env` / `.scratch` / `node_modules` / `src/` / `.test.`）**命中 0**。
2. **打包产物端到端跑通 M4 的本地等价物**（新增可复跑脚本 `scripts/smoke/packed-mcp-handshake.mjs`）：
   `npm pack --pack-destination <tmp>` → 干净目录 `npm install <tgz>` → 从**安装后的包**读 `bin` 字段解析入口 →
   起 `codecompass mcp <path>` → 子进程 stdio JSON-RPC 依次 `initialize` / `tools/list` / `tools/call list_repos`。
   **实测**：`serverVersion=0.31.0`、`instructionsPresent=true`、**`toolCount=17`**、`listReposOk=true`（payload 4879 B）。
   这比"在工作树里跑"强：它验证的是**包内容与 `bin` 声明**，正是 M4 在干净机器上真正走的那条路；唯一未覆盖的是 npm 下载本身（需先发布）。

**用户本机余下三步**：

```bash
# 1) 确认 @codecompass scope 归属（npm 侧建 org）+ 登录
npm login
npm view @codecompass/cli version        # 发布前应为 404，发布后须有值
# 2) 发布（prepublishOnly 自动跑全量构建，约 2–4 分钟）
npm publish --access public
# 3) 打 tag 触发 Release 管线
git tag v0.31.0 && git push origin v0.31.0
# 4) 发布后按 M4 验收：干净目录一行命令
npx @codecompass/cli mcp <某仓库路径>     # 完成 stdio 握手并返回 list_repos
```

**⚠ 2026-09-24 首次实跑的两个拦路（均已定位，改用下方修正版）**：

1. **npm 403**：`Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.`
   ——npm 现行政策（登录时的 notice 即预告：`gh.io/npm-gat-bypass2fa-deprecation`）要求发布必须"账号 2FA"或"bypass-2FA 的细粒度令牌"；
   网页登录拿到的会话令牌不含发布授权。**另查明 `@codecompass` scope 尚不存在**（`npm org ls codecompass` → Scope not found，
   账号 `shing426`），npm 不会在 publish 时自动建 org。故发布前要先做两件网站/账号操作。
2. **`git tag v0.31.0 && git push origin v0.31.0` 在 Windows PowerShell 5.1 下整条不执行**（`&&` 不是有效语句分隔符）——
   实测该命令根本没跑。**而且 tag `v0.31.0` 早在 2026-09-21 13:57 就已存在并推送**（指向 `ba00138`，票 07–16 批），
   GitHub Release v0.31.0 也已生成；master 现已领先 6 个提交（票 20/21/19/17/03），按 spec"两锚点"与"tag 重指"预案，
   **由 agent 侧把 tag 重指到收口提交并 force-push**（v0.27.0 同款三轮实战先例），用户无需再执行第 3 步。

**修正版用户步骤（PowerShell 安全，逐行执行）**：

```powershell
# ① 建 scope（若 npmjs.com 上还没有 codecompass 这个 org）：浏览器打开
#    https://www.npmjs.com/org/create  → org 名 codecompass（免费档可发公共包），建完默认自己是 owner
npm org ls codecompass          # 直到列出 shing426 (owner) 为止

# ② 给账号开 2FA（若尚未开；验证器 App 扫码）
npm profile enable-2fa auth-and-writes

# ③ 发布：带 OTP（prepublishOnly 自动全量构建）
npm publish --access public --otp=<6位验证码>

# ④ 发布后按 M4 验收：干净目录一行命令
npx @codecompass/cli mcp <某仓库路径>
```

（备选：npmjs.com → Access Tokens → **Granular Access Token**，Packages: Read and write、scope 选 `codecompass`、
勾 bypass 2FA，再 `npm config set //registry.npmjs.org/:_authToken=<令牌>` 后 `npm publish --access public`。
但按 npm 官方公告，bypass-2FA 令牌正在收紧，OTP 路线更长久。）

**`files` 字段核验口径（2026-09-18 实测，2026-09-24 复检同结论）**：`files` 只声明三项（`bin/`、`services/control-plane/dist/`、`apps/repoqa-web/dist/`），
**包能成立靠三件事，发布前需逐条确认**：

1. `LICENSE` 与 `README.md` **不在 `files` 里却入包**——npm 的 always-include 白名单兜底（实测 `npm pack --dry-run` 两者均在，160 文件 / 5.0 MB / 解包 19.9 MB）。改包名或换 registry 时这条兜底不保证成立。
2. **工作区包已被内联进 dist**：`dist/cli.js` / `dist/index.js` 中 `@codecompass/contracts`、`@codecompass/bridge-adapters` 出现次数均为 0，
   因此二者的 dist 不必入包，也**不得**事后把根 `dependencies` 改成引用它们（会立刻变成运行时缺包）。
3. **三处外部依赖必须留在根 `dependencies`**：`better-sqlite3` / `express` / `ws`（实测 dist 中仍是外部 `require`，未 bundle）。
   `bin/codecompass.js` 用相对路径解析 `../services/control-plane/dist/cli.js`，这正是两个 `dist/` 必须在 `files` 内的原因。

`prepublishOnly` 已挂 `npm run build`，故 `dist/` 不入库也不会发出过期产物；`engines: node >= 24` 仅告警不阻断，README 已写明 better-sqlite3 的 ABI 理由。

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
