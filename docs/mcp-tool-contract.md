# MCP 工具契约表（读写 × 幂等 × 副作用）

> 依据：评估维 **E-M7 幂等与副作用边界**（2 分要件「区分只读/写工具；写工具幂等或有明确副作用声明」的可查化）
> 生成基线：`5700bbd` + v0.31 未提交批 ｜ 日期：2026-09-21 ｜ 契约测试：`services/control-plane/src/mcp/idempotency.test.ts`
> 单一源纪律：工具集合由 `MCP_TOOLS` 决定（README 工具表已由 `scripts/docs/sync-mcp-tool-table.py` 生成并受 gate 双向断言）；
> 本表的「读/写」一栏与 `instructions` 的声明必须一致——**改这里也要改 `MCP_SERVER_INSTRUCTIONS`**。

## 一、总则

- **只有两个写工具**：`codecompass_index_repo`、`codecompass_remove_repo`；其余 15 个**只读**（不改索引库、不改源码）。
- 引擎永不修改被索引仓库的源码（ADR-0001 本地只读）。
- 写工具的失败语义遵循统一 `{error, code?}` / `isError` 形状；只读工具的失败**不产生部分写入**（无事务残留）。

## 二、写工具（副作用显式声明）

| 工具 | 副作用 | 幂等性 | 重复调用语义 | 失败语义 |
|---|---|---|---|---|
| `codecompass_index_repo` | 克隆（仅 URL 输入时）＋ 写入/刷新索引（符号、chunk、事件） | **身份幂等，执行非幂等** | 同路径再次导入 → **复用同一 repoId** 并**重跑索引**（`created:false`）；索引进行中再次调用 → `repo_indexing_conflict`（ADR-0016 异步契约：立即返回 `indexing`，须轮询 `list_repos` 至 ready/error） | `clone_url_invalid` / `clone_branch_invalid` / `clone_git_failed` / `repo_path_required` / `repo_path_invalid` / `import_failed` / `repo_indexing_conflict` |
| `codecompass_remove_repo` | 级联删除索引数据（符号 / chunk / 文件 / 事件 / 目录行）；**磁盘源码与克隆目录保留** | **非幂等（fail-closed）** | 重复删除：第二次因仓库不存在而**明确报错**；索引进行中删除 → **拒绝**（防"索引完成复活幽灵索引"） | `repo_not_found`；indexing 中调用 → 明确错误（含 "still indexing" 指引） |

**为什么重复删除不静默成功**：静默成功会让调用方误以为"删掉的是刚创建的那份"，掩盖 repoId 混淆类缺陷；fail-closed 与 HTTP `DELETE /api/repos/:id` 的 404 语义一致（镜像契约，不新造方言）。

## 三、只读工具（15）

| 工具 | 读什么 | 副作用 |
|---|---|---|
| `codecompass_list_repos` | 仓库目录表 | 无 |
| `codecompass_scan` | 五桶候选（孤儿/热点/超长/深链/超大文件） | 无 |
| `codecompass_trace_call_chain` | 静态调用链 | 无 |
| `codecompass_reverse_deps` | 反向调用者（who-uses） | 无 |
| `codecompass_diagnose` | 跨栈分层链路（含断点证据） | 无 |
| `codecompass_refactor_plan` | 爆炸半径 + 风险评级 | 无 |
| `codecompass_get_dashboard` | 驾驶舱聚合 | 无 |
| `codecompass_get_config_evidence` | 配置 key 位置（只回 file:line，**不回 value**） | 无 |
| `codecompass_get_tours` | Onboarding Tour | 无 |
| `codecompass_get_subgraph_context` | Graph RAG 子图（含 token 剪枝） | 无 |
| `codecompass_domain_radar` | Hub/PageRank/Top APIs | 无 |
| `codecompass_get_conventions` | 约定画像五轴 | 无 |
| `codecompass_plan_evolution` | 演进方案（EXTEND/DEPRECATE） | 无 |
| `codecompass_module_evolution` | **已弃用**（由 `plan_evolution` 接替，保留向后兼容） | 无 |
| `codecompass_get_pr_impact` | PR 架构影响面（读 git 对象，不写库） | 无 |

## 四、审计与验证

- **审计**：所有调用（含两个写工具）在 `logs/control-plane-<date>.jsonl` 留 `scope:'mcp'`、`msg:'tool_call'` 行，含 `tool`/`durationMs`/`ok`/`argsBytes`/`resultBytes`（详见 `docs/reports/mcp-audit-log-2026-09-21.md` 与 ADR-0019）。
- **契约测试**：`npm test --prefix services/control-plane -- idempotency` 三条钉子（同路径复用 repoId / 重复删除 fail-closed / indexing 中拒绝删除）。
- **CI**：e2e 门禁的 `issue12 mcp-audit-log` 断言写工具调用（`codecompass_index_repo`）留下审计行。

## 五、用通用套件验证任意 MCP 服务端（评估维 E-M10）

`scripts/e2e/mcp_conformance.py` 是**协议层**套件：不引用本仓任何工具名、工具数或载荷字段，全部靠运行时 `tools/list` 发现，因此可对任意 stdio MCP 服务端跑。

```bash
# 本仓（默认命令）
python scripts/e2e/mcp_conformance.py

# 任意实现
python scripts/e2e/mcp_conformance.py --server-cmd "<启动服务的命令>"
```

七项断言：① `initialize` 握手（protocolVersion / serverInfo.name / capabilities.tools）；② `tools/list` 形状（name 唯一、description 非空、inputSchema.type=object）；③ `tools/call` 信封（`content[0].type==='text'`，成功与域错误都须合规）；④ 未知工具名必须显式失败；⑤ 类型不匹配的参数必须被拒（不得静默强转）；⑥ 缺必填参数必须被拒；⑦ 声明 outputSchema 的工具成功调用必须返回对象型 structuredContent（v1.10 票 05，详见第六节）。

**反向验收**：`scripts/e2e/fixtures/mcp-bad-server.mjs` 是故意违规的假服务端（两种模式：`--mode=handshake` 缺 capabilities.tools；`--mode=tools` 空描述 + 未知名静默成功 + 无参数校验）。门禁的 `issue14 mcp-conformance` 同时跑「本仓必须全绿」与「假服务端必须被抓」——**只绿自己不能证明可对任意实现跑**。

> 与本仓 `closeout_gate.py` 的分工：gate 断言本仓业务语义（五桶/图谱/门禁史）且**保持不动**；本套件承担可移植面。两者并存，职责不同。

## 六、structuredContent 与 outputSchema（票 05，v1.10）

17 个工具在 `tools/list` 中声明 **`outputSchema`**（zod shape 单一源：`services/control-plane/src/mcp/output-schemas.ts`），成功结果同时携带 **`structuredContent`**——宿主从此可按 schema 机器读结果，无需解析文本。三条硬规则：

1. **SDK 强制校验**：声明 outputSchema 后，SDK 对每个成功（非 isError）结果做 schema 校验，缺失或不符直接抛 `McpError InvalidParams`（`server/mcp.js` validateToolOutput）；isError 结果不校验——错误契约（票 02 的 `{error:{code,message,hint}}`）不受影响，且错误结果**不携带** structuredContent。
2. **掩码同源（R1 双通道）**：structuredContent 由**掩码后的文本**反序列化得出（`textResult` 单一出库咽喉），绝不从原始 value 直出——掩码覆盖双通道是构造性保证，不是两处分别实现。文本通道逐字节不变，老客户端零迁移。
3. **数组的对象化包装**：MCP 要求 structuredContent 必须是对象。唯一返回裸数组的 `codecompass_trace_call_chain` 在**结构化通道**包装为 `{ items: [...] }`；文本通道仍是裸数组。同源 parity 由 wire 测试钉死（`structured.items` deep-equals `parse(text)`）。

**schema 保真度规则**（改 handler 返回形状时同步改 `output-schemas.ts`，否则运行时即红）：`JSON.stringify` 丢弃 `undefined` 的字段必须 `.optional()`；含 `null` 的字段必须 `.nullable()`；一律普通 `z.object`（非 strict）——`verification` 回执等加性字段永远兼容。`module_evolution` / `plan_evolution` 运行时双形状（计划 / 约定冲突），因 SDK 顶层只接受对象 schema（union 会在校验时崩），声明为全字段 optional 的单对象形状，仅 `verification` 必填。

**通用断言**：即第五节的第 ⑦ 项——声明了 outputSchema 的工具，成功调用必须返回对象型 structuredContent（零项目数据依赖，可对任意实现跑；无 outputSchema 的服务端 vacuous 通过，不算违规）。
