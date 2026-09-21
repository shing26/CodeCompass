# Issue 15 — 上下文治理的 token 剪枝对比（评估维 E-M4：2 → 3）

> 依据：短板清单 E-M4「token 预算 6000 + 优先级剪枝 + `truncated` 可观测已具备，但**无剪枝前后的 token 消耗对比**」
> 分档要件（§2.1）：**3 分** = 有 token 消耗前后对比；**有超限触发实测**
> 波次：v0.31.0 ｜ 用户裁决：2026-09-21 批准（五项之一）

## 现状（实测，决定了本票几乎零代码）

- `engine/repoqa-graphrag.ts:300` `const maxTokens = Math.max(1, options.maxTokens ?? DEFAULT_MAX_TOKENS)`——**无上限**，故"关剪枝"可用超大预算近似；
- 输出已带 `truncated`（:67）与 `prunedCount`（:68）；
- token 口径与代码同源：`:219-221` `maxChars = maxTokens * 4`（即 4 字符 ≈ 1 token）。

## 内容

### (a) 两档对比实验（同一 query）

对同一 repo 同一 query 跑 `codecompass_get_subgraph_context`：
- 默认档 `maxTokens = 6000`（剪枝生效）；
- 大预算档 `maxTokens = 200000`（数据量小于预算 ⇒ 剪枝实际不触发 ≈ 关）。

记录：输出字符数 → 估算 token（chars/4，**与代码同口径**）、`prunedCount`、`truncated`、耗时。

### (b) 超限触发实测

小预算档（如 `maxTokens = 500`）→ 断言 `truncated === true`（超限被真实触发，而非仅声明有截断策略）。

### (c) 可复跑

新增 `scripts/mcp/token_pruning_compare.mjs`：起一次 MCP 会话（或直调引擎）→ 三档各跑一次 → 打印 Markdown 表。
产出落 `docs/reports/mcp-context-budget-2026-09-2X.md`（含三档原始数字 + 结论）。

## 验收

- [x] 两档对比表：**默认档 7309 估算 token（prunedCount=7、truncated=true）vs 上限档 12719（prunedCount=0、truncated=false）→ 剪枝省 5410 token（42.5%）**，数字成立（`docs/reports/mcp-context-budget-2026-09-21.md`）
- [x] 超限触发实测：紧预算档（500）`truncated=true`，默认档亦 `true` 留证
- [x] `npm run mcp:token-compare` / 脚本直跑可复跑，输出 Markdown 表
- [x] 报告入 `docs/reports/`；口径标注（chars/4 估算，非真实 tokenizer）

**实测纠正（如实登记）**：初版用 200000 做"关剪枝"档，被 handler 以 `maxTokens must be a positive integer (1..100000)` 拒绝，脚本却把这条 48 字符错误当"输出"，算出 −60808% 的荒谬节省。修法：① 被拒档位单列、不参与节省计算；② "关剪枝"改用合法上限档 100000。剪枝字段的真实层级是 `context.prunedCount` / `context.truncated`（脚本用深度查找，不硬编码路径）。

## 风险

1. **若默认档在该 query 上本就不触发剪枝**，对比数字会接近 0 —— 那就换一个更大的 query（或更大的 repo）直到剪枝真实生效；**不允许用"未触发"的样本冒充"剪枝有效"**（口径纪律）。
2. chars/4 是估算：报告必须写明，不得声称精确 token 数；若日后接入真实 tokenizer 再升级口径。

## 文件面声明

| 文件 | 归属 | 说明 |
|---|---|---|
| `scripts/mcp/token_pruning_compare.mjs` | 新增 | 三档对跑 |
| `docs/reports/mcp-context-budget-2026-09-2X.md` | 新增 | 对比表 + 结论 |
| `package.json` | 共享区 | `mcp:token-compare` 脚本（与票 12 同文件） |
