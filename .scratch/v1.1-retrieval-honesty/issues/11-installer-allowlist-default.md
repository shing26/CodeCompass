# Issue 11 — 安装器默认 allowlist 去掉 `remove_repo`

> 依据：审计 v2 §4.3「MCP 面写工具无确认」。**实测把问题定位到了真正的审批面**：`installer.ts:105` 给 Cursor/Cline/Roo 写入的 `autoApprove = codecompassToolNames()` = **全部 17 个工具**，即**默认安装就把 `remove_repo` 自动批准了**
> 波次：波 1 ｜ 状态：**✅ 已落地（2026-09-28）** ｜ 依赖：无 ｜ 半批：D 搭车
> 决策依据：spec §7.1（**只去掉 `remove_repo`**）

Status: done

## 1. 现状（实测）

- `services/control-plane/src/installer.ts:92` `codecompassToolNames()` = `MCP_TOOLS.map(t => t.name)`（17 个）。
- `:105`（`cursor`/`cline`/`roo` 三家共用）写入 `autoApprove: codecompassToolNames()`。
- `remove_repo` 的语义（`docs/mcp-tool-contract.md:19`）：**级联删除索引数据**（符号 / chunk / 文件 / 事件 / 目录行）；磁盘源码保留；**非幂等（fail-closed）**。
- 工具描述与文档**都如实**写了它是破坏性的——问题**不在描述，在默认配置**。
- 审批职责本就在宿主侧（allowlist 是宿主能力），故修法在安装器，**不动协议**。

## 2. 落地

1. 默认 allowlist 改为**除 `remove_repo` 外的 16 个**（`index_repo` **保留**：它是每个新仓的第一步，去掉会给 AFK agent 造成实打实的摩擦）。
2. 提供**显式开关**恢复全量（如 `codecompass install --auto-approve-all`，或等价 flag），并在 `--help` 与 README 安装段落写明：**默认不自动批准破坏性工具**。
3. 影响面：`cursor` / `cline` / `roo` 三家；`zcode` / `claude` 等不写 allowlist 的形态**不受影响**。
4. 已装环境**不会自动变安全**——须重跑 `codecompass install`（README/HANDOFF 提示一句）。

## 验收（机器可验证）

1. `installer --dry-run`（cursor/cline/roo）输出的 `autoApprove`：**长度 16、不含 `remove_repo`、含 `index_repo`**。
2. 带开关时：**长度 17**、含 `remove_repo`。
3. 幂等合并行为不变（重复执行不产生 diff；备份/`--dry-run` 语义不变）。
4. **17 工具数量与签名零变化**：`repoqa-mcp.test.ts` 名单断言与 e2e 的 `tools/list` 检查不破。
5. installer 单测更新（新增 2 条：默认 16 / 开关 17），控制面用例数在票内记账。

## 验收实测（2026-09-28）

- [x] 验收 1（默认 16）：`install --dry-run`（cursor/cline/roo，临时 HOME）→ `autoApprove` **长度 16**、**不含** `codecompass_remove_repo`、**含** `codecompass_index_repo`（三家一致；改动前为 17/含）。
- [x] 验收 2（开关 17）：`install --ide cursor --dry-run --auto-approve-all` → **长度 17**、含 `codecompass_remove_repo`。
- [x] 验收 3（幂等/备份语义不变）：临时 HOME 真写 → 重跑 install → 配置**逐字节一致**且第二次日志为 `already up to date`；`mergeCodecompassEntry` 与备份路径未改。
- [x] 验收 4（17 工具契约零变化）：e2e 全绿 **71/0**，其中 `v0.8 MCP tools/list … tools=17`、`readme-tool-table-parity`（17 工具双向一致）、`v0.8+ CLI install --dry-run` 三查均 PASS；工具签名未动。
- [x] 验收 5（单测记账）：`installer.test.ts` **+2**（默认去掉破坏性工具 / `--auto-approve-all` 还原全量）→ 控制面 **737 → 739**（59 文件全绿；另两处 `parseArgs` 全量快照补 `autoApproveAll: false`，属新字段的机械同步）。typecheck 干净。

## Comments

- 2026-09-27 立项（原为"工具内 env 门控 confirm 参数"）；2026-09-28 实测后改到安装器层——**那里才是审批真正发生的地方**，且非协议变更、无版本号要求。
- 与 spec §1.2 的一致性：本票只改**写入的默认配置**，不动任何工具签名，故不违反"17 工具 v1 契约冻结"。
- 2026-09-28 落地：`installer.ts` 新增 `NON_AUTO_APPROVED_TOOLS`（现只列 `codecompass_remove_repo`）+ `defaultAutoApproveTools()`（= 注册表减该清单，**单一源**）；`renderServerEntry(ide, entry, { autoApproveAll })` 按开关选择；CLI 新增 `--auto-approve-all`（`CliArgs`/解析/USAGE/Options/install 子命令说明五处同步）；README 两处（第 10 节安装器块 + npm 安装段）写明「默认不自动批准破坏性工具」与「早前装过的环境须重跑 install」。
- 2026-09-28 文件面：`installer.ts`、`cli.ts`、`installer.test.ts`、`repoqa-cli.test.ts`、`repoqa-mcp.test.ts`（仅快照字段）、`README.md`、`HANDOFF.md`（见下）。
- 2026-09-28 HANDOFF 两行同步（票面 §2.4 授权）：§2.1 门禁基线更新为实测 **739 / 347 / 26 / 71-0**（原 711 / 364 均为旧数，cp 差 22+、web 差 17）；§2.1 MCP 行改写——installer 的 autoApprove 不再是"动态派生不用改"，**新增破坏性工具必须加进 `NON_AUTO_APPROVED_TOOLS`**，否则默认安装会重新自动批准它。
- 2026-09-28 待办转交：CLI 侧「`args.autoApproveAll` → `installIdeConfig`」的接线**无自动化用例**（票面只要求 2 条单测，未新增第 3 条以免破坏票面计数），已用真实 CLI 跑通取证（`--auto-approve-all` → 17）。后续若加 guard，建议放 installer.test.ts 或 e2e。