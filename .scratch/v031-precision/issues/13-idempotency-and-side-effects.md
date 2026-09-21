# Issue 13 — 幂等与副作用边界（评估维 E-M7：2 → 3）

> 依据：短板清单 E-M7「无重复调用测试、无审计日志」；`项目提升计划` B-5（与 E-M12 共用设施）
> 分档要件（§2.1）：**2 分** = 区分只读/写工具；写工具幂等或有明确副作用声明。**3 分** = 有重复调用测试；有副作用审计日志
> 波次：v0.31.0 ｜ 依赖：票 12（审计日志 = 本票的日志证据）｜ 用户裁决：2026-09-21 批准

## 契约核实（先核后钉，2026-09-21 实测）

| 场景 | 现行语义 | 证据 |
|---|---|---|
| 同路径重复 `index_repo` | **身份幂等**：`findByLocalPath` 命中则复用同一 repoId（`created:false`）并**重跑索引**（有副作用，非免费） | `ingest/repoqa-repos.ts:401/415-436` |
| indexing 中重复 `index_repo` | 拒绝，`repo_indexing_conflict` | `routes/repos.ts` + CONTEXT 错误码表 |
| 重复 `remove_repo` | **不静默**：第二次因仓库已不存在而报错（fail-closed，镜像 HTTP 404） | `mcp/repoqa-mcp.ts:950-960`（`resolveMcpRepo` 先行） |
| indexing 中 `remove_repo` | 拒绝（防"索引完成复活幽灵索引"） | `repoqa-mcp.ts:951-956` |

**结论**：契约是「身份幂等 + 副作用显式 + 重复删除 fail-closed」，**没有静默的重复副作用**——但**这三条一条测试都没有**，且没有一张对外可查的读写/副作用表。本票补的正是"声明 + 测试"。

## 内容

### (a) 重复调用测试（3 分第一条要件）

新增 `services/control-plane/src/mcp/idempotency.test.ts`：
1. 同路径 `index_repo` 两次 → 断言 repoId 相同、仓库行数不增（`created:false`）；
2. 重复 `remove_repo` → 断言第二次**明确报错**且不误删其它仓库；
3. indexing 中 `remove_repo` → 断言拒绝且索引不中断（既有行为，补钉子）。

### (b) 读写/副作用分类表（2 分要件的可查化）

`docs/mcp-tool-contract.md`（新）：17 工具 × 读/写 × 幂等性 × 副作用 × 失败语义，作为对外声明。
与 `instructions` 里的"除 index_repo/remove_repo 外全部只读"一致（单一源：表 + 生成器校验二者一致的可选断言）。

### (c) 副作用审计日志（3 分第二条要件）

由票 12 提供：写工具调用在审计行中带 `tool`/`ok`/`errorCode`/`argsBytes`；
本票补一条 e2e/单测断言：**写工具调用留下审计行**（读工具与写工具在日志中可区分）。

## 验收

- [x] 三条重复调用测试在位且绿（`services/control-plane/src/mcp/idempotency.test.ts`，3/3）；**人为破坏 → 测试红**：把 `findByLocalPath` 复用分支禁掉后首条测试红（`expected 'repo-8107c7cb…' to be 'repo-d4b3ca07…'`），已恢复
- [x] `docs/mcp-tool-contract.md` 读写/副作用表落库（2 写 15 读；重复导入=身份幂等但重跑索引、重复删除=fail-closed），与 `instructions` 文案一致
- [x] 写工具调用有审计行的断言在位：gate 的 `issue12 mcp-audit-log` 增 `write_logged`（`codecompass_index_repo` 必须留 `ok:true` 行）
- [x] cp 单测 **689 → 692**；e2e **71/71**；精度棘轮不变

**外部复算的已知边界（如实登记）**：`_tools/probe.py` 按设计**排除测试文件**，因此 E-M7 的证据（重复调用测试）不会让它的 `幂等键` 计数移动（实测 5→5）。该项的 3 分证据只能由**票面 + 契约表**承载，重评分时需要人工读这两处，不能只看 probe 计数。

## 风险

1. 「重复导入会重跑索引」是**有代价的副作用**——表格必须写明，不能宣称"完全幂等"（否则是虚假声明）。
2. 测试不能依赖真实 clone（用本地 fixture 目录，与既有测试同手法）。

## 文件面声明

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/mcp/idempotency.test.ts` | 新增（MCP 工具面） | 三条钉子 |
| `docs/mcp-tool-contract.md` | 新增 | 17 工具读写/副作用分类表 |
| `scripts/e2e/closeout_gate.py` | 共享区 | 写工具审计行断言（与票 12 同一处） |
