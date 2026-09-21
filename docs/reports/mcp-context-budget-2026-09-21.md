# MCP 上下文治理：token 剪枝对比与超限实测（评估维 E-M4：2 → 3）

> 日期：2026-09-21 ｜ 票：`.scratch/v031-precision/issues/15-context-budget-comparison.md`
> 分档要件（外部评分标准 §2.1）：**3 分** = 有 token 消耗前后对比；**有超限触发实测**
> 复跑：`node scripts/mcp/token_pruning_compare.mjs --repo <path> --query <symbol> --data-dir <dir>`

## 一、三档实测（真实 MCP stdio 会话，query=`runScan`，repo=本仓）

| 预算 maxTokens | 输出字符 | 估算 token（chars/4） | 剪枝条数 `context.prunedCount` | 截断 `context.truncated` | 耗时 ms |
|---|---|---|---|---|---|
| **6000（默认档，剪枝生效）** | 29,236 | **7,309** | **7** | **true** | 34 |
| **100000（上限档 ≈ 关剪枝）** | 50,874 | **12,719** | 0 | false | 20 |
| 500（紧预算，压测） | 2,254 | 564 | 27 | true | 17 |

**结论（3 分第一条要件）：剪枝确实省 token。** 同一 query 下，默认档比上限档少 **5,410 估算 token（42.5%）**，且剪枝计数从中位档的 0 变为默认档的 7 条。

**超限触发（3 分第二条要件）：`truncated=true` 在默认档与紧预算档都真实出现**——不是"文档说有截断策略"，而是超限被触发并可由工具输出观察到。

## 二、口径（先写清楚，防事后倒推）

- **token 为估算**：chars/4，**与代码同口径**（`engine/repoqa-graphrag.ts:219-221` 内 `maxChars = maxTokens * 4`）。这不是真实 tokenizer 计数，报告与脚本均如此标注。
- **"关剪枝"是近似**：`maxTokens` 在 handler 里的合法区间是 **1..100000**（上限由 handler 校验），因此"关剪枝"用**上限档 100000** —— 该 query 的数据量（约 5 万字符 ≈ 1.27 万 token）远小于上限，故剪枝不触发（`prunedCount=0`、`truncated=false`），等价于关。
- **不得按目标倒推**：若某 query 在默认档本就不触发剪枝，脚本会显式打印"本 query 上默认档没有触发剪枝——不得用它声称剪枝有效"，要求换更大 query/repo 重跑。

## 三、过程中被实测纠正的一处探针错误（留档）

初版脚本用 **200000** 做"关剪枝"档，实测返回 **48 字符**：

```
maxTokens must be a positive integer (1..100000)
```

脚本却把这条**拒绝消息**当作"输出长度"，于是算出"节省 −7,297 token（−60,808%）"这种荒谬数字。修正两点：

1. 被拒档位单列并标注，**不参与任何节省计算**（脚本现在会打印"被拒档位"一行）；
2. "关剪枝"改用合法的上限档 100000。

这同时是一条对外的**输入校验证据**：`get_subgraph_context` 的参数范围校验真实生效（属票 07 的 schema 护栏族）。

## 四、字段层级（实测，供复跑参考）

工具输出的剪枝可观测字段**不在顶层**，位于 `context` 之下：`context.prunedCount` / `context.truncated`。
脚本用深度查找（而非硬编码路径）定位它们，因此字段若在后续版本挪位也不会静默读成 `null`。

## 五、复跑与断言

```bash
# 三档对比（默认 repo=. query=runScan，可覆盖）
node scripts/mcp/token_pruning_compare.mjs --repo "D:/CodeCompass" --query runScan --data-dir <dir>
```

验收对照：默认档 `truncated` 应为 `true`、`prunedCount > 0`；上限档 `prunedCount = 0`；紧预算档 `truncated = true`。
