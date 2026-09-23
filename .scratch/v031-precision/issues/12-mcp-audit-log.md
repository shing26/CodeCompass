# Issue 12 — MCP 审计日志接线（评估维 E-M12：1 → 3）

> 依据：`D:/WorkBuddyData/CodeCompass-短板清单-20260921.md`（E-M12 全表最低分 1）、`项目提升计划-20260921.md` B-2（全批次高优先）
> 分档要件（评分标准 §2.1，逐字）：**2 分** = 每次调用有日志（入参/出参/耗时/结果）；**3 分** = 有调用统计（成功率、耗时分布、错误分布）
> 判据：HANDOFF §2.2 不适用（非新增工具/页签，是既有设施的接线）
> 波次：v0.31.0（tag 未打，搭车）｜ 用户裁决：2026-09-21 批准（「五项仓内可完成」）

## 现状（实测）

`grep -c logger mcp/repoqa-mcp.ts` = **0**。仓内 `log-sink.ts` 已具备脱敏（`maskSensitiveText`）/ 4096 截断 / 5MB×5 轮转 / 14 天保留 / 写失败永不冒泡，但只接在 HTTP 侧 →
17 个工具的调用**无任何入参/出参/耗时记录**。

## 内容

### (a) 接线点在唯一收口处

`repoqa-mcp.ts:1069-1076` 的 `registerPlain` 是全部 17 个工具的唯一出口（`textResult(await handler(args))`）。
审计挂在这里，一处覆盖 17 个工具与未来所有工具。

### (b) Logger 注入而非内建（保持单测无副作用）

`McpDeps` 增**可选** `logger?: ServerLogger`：缺省不写日志（单测保持 hermetic，不产生文件）；
`runMcpServer` 从 `config.dataDir` 构造 `new ServerLogger(dataDir, process.env.MHW_LOG_LEVEL)` 注入。
**不得自建序列化**——脱敏与截断必须走 sink 内建 `sanitize`（R1 不变式的延伸面）。

### (c) 记录字段（对齐 3 分的统计需求）

`scope='mcp'`，`msg='tool_call'`，**实际落盘字段**：`tool` / `durationMs` / `ok` / `argsBytes` / `resultBytes` / `args` / `result` / `repoId?` / `error?`。

**与初版设计的偏差（2026-09-21 双轴评审自证后修正本票措辞）**：
① 用 `ok: boolean` 取代原计划的 `isError`（单一布尔即可推导，避免双字段互相矛盾）；
② **不落 `errorCode`**——MCP handler 抛的是普通 `Error`（如 `Repo not found: x`），该层没有稳定错误码；错误分布按**错误文本**聚合（`audit_stats.mjs`），这是本层的实情，不是遗漏；
③ 不单独落 `truncated`——截断由 sink 内部完成（每串 ≤4096），真实体积由 `argsBytes`/`resultBytes` 承载，重复落一个布尔会与 sink 语义重叠。

耗时用 `performance.now()` 差；handler 抛错时 catch → 记 `ok:false` + 错误文本后**原样重抛**（不改变协议行为）。

### (d) 调用统计入口（3 分证据）

新增 `scripts/mcp/audit_stats.mjs`（零依赖 node）：读 `logs/control-plane-*.jsonl`，过滤 `scope='mcp'`，
输出**成功率 / 耗时 P50·P95 / 错误分布（按 errorCode 与 isError）**；npm 脚本 `mcp:stats`。
**不新增 MCP 工具**（spec §1.1 冻结）——统计走 CLI 脚本。

### (e) 已知边界（如实登记，不假装覆盖）

经 SDK **输入校验拒绝**的调用不进入 handler，因此不在审计内（校验发生在我们的包装函数之前）。
这是设计边界而非缺陷；写入 ADR-0019 与报告。

### (f) ADR-0019（MCP 审计口径）

三要件齐备（难回退：日志字段/内容一旦落盘即成事实面；意外性：HTTP sink **排除** query 与请求体，而 MCP 审计**记录入参**；真实取舍：审计完整性 vs 隐私）。
记录：MCP 是本地优先、宿主驱动的面，其入参是 agent 自己的调用（非用户 HTTP 流量）；脱敏沿用全局不变式。

## 验收

- [x] `grep -c logger services/control-plane/src/mcp/repoqa-mcp.ts` **从 0 变正数**
- [x] e2e 新增断言：起真实 MCP stdio 会话 → 调用多个工具 → 断言 `control-plane-*.jsonl` 出现 `tool_call` 行且字段齐全 —— gate `issue12 mcp-audit-log`：`rows=6 tools=[diagnose, domain_radar, get_subgraph_context, index_repo, module_evolution, refactor_plan] fields_ok=True write_logged=True`
- [x] 脱敏/截断留证：单测喂含凭据的 args → 落盘行为 `password=[REDACTED AWS KEY]`，原串不在行内（运行时拼接夹具）
- [x] `npm run mcp:stats -- <dataDir>` 在真实日志上输出成功率/耗时分布/错误分布（见报告 §二：成功率 40.0%（2/5）、P50/P95、错误分布 `Repo not found`×3）
- [x] 一次排障复盘写入 `docs/reports/mcp-audit-log-2026-09-21.md`（真实会话案例：三步定位出"宿主凭猜测传 repoId"而非引擎故障）
- [x] 单测基线不降（**686 → 689**，+3 审计用例）；e2e **69 → 70 → 71**；四包 typecheck 净；精度棘轮不变

**实施偏差（如实登记）**：报告 §五 记的三条边界——① 经 SDK 校验拒绝的调用不入审计（口径为"已进入 handler 的调用"）；② args/result 截断至 4096 字符（真字节数另记）；③ 同步写未做"开/关审计"耗时对照（本批不预先优化，触发条件已登记）。

## 风险

1. **写日志拖慢工具调用**：sink 同步 append。以 `durationMs` 对照（开/关审计）留一个数字；若可见变慢再改异步（本票不预先优化）。
2. **日志体积**：args/result 只记字节数 + 由 sink 截断，不落全文；轮转/保留沿用既有策略。
3. 单测若误注入 logger 会污染临时目录——注入点可选，默认 `undefined`。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/mcp/repoqa-mcp.ts`（+test） | 共享区 | 收口点接线 + 可选 logger 注入（与票 07 同文件，串行在后） |
| `services/control-plane/src/mcp/web-session.ts`（如 logger 需传递） | — | 若 `runMcpServer` 已持有 config 则无需改动 |
| `scripts/mcp/audit_stats.mjs` | 新增 | 统计脚本（共享区新目录） |
| `scripts/e2e/closeout_gate.py` | 共享区 | 新增审计断言 |
| `package.json` | 共享区 | `mcp:stats` 脚本 |
| `docs/adr/0019-mcp-audit-log-policy.md` | 新增 | 审计口径决策 |
