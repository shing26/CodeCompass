# MCP 审计日志接线与一次排障复盘（评估维 E-M12：1 → 3）

> 日期：2026-09-21 ｜ 票：`.scratch/v031-precision/issues/12-mcp-audit-log.md` ｜ 决策记录：`docs/adr/0019-mcp-audit-log-policy.md`
> 分档要件（外部评分标准 §2.1）：**2 分** = 每次调用有日志（入参/出参/耗时/结果）；**3 分** = 有调用统计（成功率、耗时分布、错误分布）
> 落点：`services/control-plane/src/mcp/repoqa-mcp.ts` 的 `registerPlain`（全部 17 个工具的唯一出口）

## 接线形态

- `McpDeps.logger?: ServerLogger`（**可选**：单测不注入 ⇒ 不写文件，测试保持 hermetic）；`runMcpServer` 从 `config.dataDir` 构造 sink 注入 → 只有真实服务路径产生审计。
- 写盘复用既有 sink：`maskSensitiveText` 深走 + 每串 4096 截断 + 5MB×5 轮转 + 14 天保留 + 写失败永不冒泡（**不新增设施**，也不自建序列化）。
- 落 `logs/control-plane-<date>.jsonl`，`scope='mcp'`、`msg='tool_call'`，字段：`tool` / `durationMs` / `ok` / `resultBytes` / `argsBytes` / `args` / `result` / `repoId?` / `error?`。

**真实样本**（一次 `codecompass_list_repos` 调用，2026-09-21）：

```json
{"ts":"2026-09-20T20:17:46.474Z","level":"info","scope":"mcp","msg":"tool_call",
 "tool":"codecompass_list_repos","durationMs":0,"ok":true,"argsBytes":2,"resultBytes":166,
 "args":"{}","result":"{\"repos\":[{\"id\":\"repo-3e2e1727-…\",\"name\":\"CodeCompass\",\"status\":\"ready\",\"fileCount\":1558,\"symbolCount\":1966}]}"}
```

脱敏留证（单测）：args 里的 `password=AKIA…` 落盘为 `password=[REDACTED AWS KEY]`，原串不出现在行内。

## 3 分证据一：调用统计

`npm run mcp:stats -- <dataDir>`（脚本 `scripts/mcp/audit_stats.mjs`，零依赖）。以下为一次**真实会话**的原样输出
（会话内容：`list_repos` ×2 成功、`scan` ×2 与 `get_conventions` ×1 因传入不存在的 repoId 失败）：

| 指标 | 值 |
|---|---|
| 成功率 | **40.0%**（2/5） |
| 耗时 P50 / P95 / max | 0 ms / 2 ms / 2 ms |
| 失败调用 | 3 |

**错误分布**：`Repo not found: no-such-repo` × 3

**按工具**：

| 工具 | 调用 | 失败 | P50 | P95 |
|---|---|---|---|---|
| codecompass_list_repos | 2 | 0 | 0 ms | 2 ms |
| codecompass_scan | 2 | 2 | 0 ms | 0 ms |
| codecompass_get_conventions | 1 | 1 | 0 ms | 0 ms |

三个要件（成功率 / 耗时分布 / 错误分布）齐备，且都可对任意 dataDir 复跑。

## 3 分证据二：排障复盘（典型问题定位流程）

**现象**：一次宿主会话里成功率只有 40%，三类工具集中失败。
**定位（三步、无需求助源码）**：

1. `npm run mcp:stats -- <dataDir>` → 失败全部落在 3 次调用上，错误文本同一句：`Repo not found: no-such-repo`；
2. 看同一批行的 `args` 字段 → 失败调用的入参是 `{"repoId":"no-such-repo"}`，而成功调用的 `result` 里给出的真实 repoId 是 `repo-3e2e1727-…`；
3. 结论：**不是引擎故障，是宿主侧凭猜测传了 repoId**——正是 `instructions` 第 1 条（"list_repos first — never guess a repoId"）要防的行为。修法在宿主/提示层，不需要动引擎。

**复盘价值**：这条链路以前不存在——`grep -c logger mcp/repoqa-mcp.ts` = 0 时，同样的失败只能看到客户端侧的 isError 文本，无法区分"引擎报错"与"调用方传错"，也无法回答"是哪个工具、传了什么、花了多久"。现在三步可答，且证据以 JSONL 落盘可事后取证。

## 已知边界（如实登记，见 ADR-0019）

1. **经 SDK 输入校验拒绝的调用不进入 handler，因此不在审计内**（校验发生在包装函数之前）。统计口径是「已进入 handler 的调用」——脚本头注释与本节都写明，避免把成功率误读为含被拒调用的总口径。
2. `args` / `result` 以截断形态入库（每串 ≤4096 字符），真实字节数由 `argsBytes` / `resultBytes` 记录；需要全文的场景不适用本审计。
3. 写日志为同步 append，尚未测"开/关审计"的耗时差（本批不预先优化，出现可见变慢再改异步——票 12 风险节已登记触发条件）。

## 复跑

```bash
# 产生审计（真实 stdio 会话；任选一个已索引仓库路径）
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"codecompass_list_repos","arguments":{}}}' \
| node services/control-plane/dist/cli.js mcp "D:/CodeCompass" --data-dir <dataDir> > /dev/null

# 统计
npm run mcp:stats -- <dataDir>

# 断言（CI）：e2e 门禁内 `issue12 mcp-audit-log` 已覆盖"起真实会话 → 审计行字段齐全"
```
