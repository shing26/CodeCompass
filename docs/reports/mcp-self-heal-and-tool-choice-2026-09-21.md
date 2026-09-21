# 模型在环一轮实验：自愈率与误调率（评估维 E-M5 2→3；E-M2 仅前向基线）

> 日期：2026-09-21 ｜ 票：`.scratch/v031-precision/issues/16-model-in-the-loop.md`
> 模型：`.env` 的 `REPOQA_LLM_MODEL` = **`deepseek-v4-flash`**（native tool calling，即宿主真实用法）
> 调用量：**20/20**（脚本内置上限；另有首轮 20 次因脚本汇总处笔误丢失——见 §4 教训，合计实际消耗约 40 次）
> 原始记录：`scripts/out/mcp-model-in-the-loop.json` ｜ 复跑：`node …/tsx/dist/cli.mjs scripts/eval/mcp_model_in_loop.ts --budget 20`
> 分档要件（§2.1）：E-M5 3 分 = 有「模型遇错后自愈成功率」数字；E-M2 3 分 = 有描述质量**迭代记录**

## 一、E-M5 自愈成功率 = **7/7 = 100%**（真失败场景口径）

给模型一条真实失败调用 + 该工具返回的**真实错误载荷**，要求它只回一次修正调用，再真跑一次验证。

| 场景 | 首次失败 | 首次错误（截断） | 模型重试 | 恢复 |
|---|---|---|---|---|
| repoId 不存在 | 是 | `Repo not found: no-such-repo` | `list_repos`（先取真 id） | ✅ |
| maxTokens 传成字符串 | 是 | `MCP error -32602: Input validation error…` | `get_subgraph_context`（改数字） | ✅ |
| maxTokens 超出上限 | 是 | `maxTokens must be a positive integer (1..100000)` | `get_subgraph_context`（降到范围） | ✅ |
| 缺少必填 `symbolOrMethod` | 是 | `MCP error -32602: Input validation error…` | `reverse_deps`（补齐参数） | ✅ |
| 工具名拼错 | 是 | `MCP error -32602: Tool codecompass_scan_repo not found` | `scan` | ✅ |
| 删除不存在的仓库 | 是 | `Repo not found: ghost-repo` | `list_repos` | ✅ |
| refactorPlan 缺 `targetSymbol` | 是 | `MCP error -32602: Input validation error…` | `scan` → 后续补参数 | ✅ |
| repoId 用仓库名而非 id | **否** | `{"tours":[], "note":"No routes detected…"}` | — | 剔除 |
| trace 起点不存在 | **否** | 返回了一条链载荷 | — | 剔除 |
| diagnose 入口不存在 | **否** | 返回了 diagnose 载荷 | — | 剔除 |

**口径（关键）**：只有 **7 个场景的首次调用真的报错**（以 MCP 的 `isError`/JSON-RPC error 为权威信号，不用文本启发式）。另 3 个场景**首次调用根本没失败**——`repoId` 传仓库名被名称解析接受、`trace`/`diagnose` 对陌生符号仍返回载荷——它们既不是失败也谈不上自愈，**已剔除、不计入分母**。若按 10 个场景全算，会得到虚高的 10/10。

**E-M5 结论**：7/7 = **100% 自愈成功率**（n=7，单一模型，见 §3 限制）。错误载荷对模型是**可执行的**：`-32602` 校验错误、`Repo not found`、`not found`、范围错误四类都被正确识别并修正。

## 二、E-M2 误调率前向基线 = **60%（工具选择 4/10；参数键集 4/10）**

| 任务 | 期望工具 | 模型实选 | 参数键集 |
|---|---|---|---|
| 列出已索引仓库 | `list_repos` | `list_repos` | ✅ |
| 不知道从哪改起 | `scan` | **`list_repos`** | ❌ |
| 谁调用了 runScan | `reverse_deps` | `reverse_deps` | ✅ |
| 从 mcpScan 往下看调用链 | `trace_call_chain` | **`list_repos`** | ❌ |
| 配置项定义在哪 | `get_config_evidence` | `get_config_evidence` | ✅ |
| 新人导览 | `get_tours` | **`list_repos`** | ❌ |
| runScan 换签名的爆炸半径 | `refactor_plan` | `refactor_plan` | ✅ |
| 要带 token 上限的上下文 | `get_subgraph_context` | **`list_repos`** | ❌ |
| 架构热点 | `domain_radar` | **`list_repos`** | ❌ |
| 新增 handler 的既有约定 | `get_conventions` | **`list_repos`** | ❌ |

**别把这个 60% 当"工具描述质量差"的证据——它主要是指令交互造成的，不是描述缺陷。**

6 次错误里有 **5 次选了同一个工具 `list_repos`**，而 `MCP_SERVER_INSTRUCTIONS`（票 07 新加）第一条原文就是
「**list_repos first** — never guess a repoId. If the repo is missing, call index_repo」。也就是说模型在**执行编排指令的第一步**，
而不是"读不懂描述挑错了工具"。这是本轮实验最有价值的一条发现：**单轮选择题会把"遵循工作流"误记成"误调"**。

**因此 E-M2 的诚实定性**：本轮只产出**前向基线**，且该基线的解释力被指令污染削弱；**E-M2 仍记 2 分**，不因有数字就宣称 3 分。
要把它变成真正的描述质量指标，需要先改测量协议（见 §5）。

## 三、限制（n=10、单模型、单轮）

1. **样本极小**：n=10 / n=7，比例本身置信区间很宽，不得当作稳定指标引用。
2. **单一模型**：`deepseek-v4-flash` 的结果不能推广到其它宿主模型；不同模型（尤其带更强工具选择训练的）可能显著不同。
3. **单轮**：E-M2 没有"迭代前/后"对照（未做描述修改），E-M5 也没有跨会话稳定性数据。
4. **任务措辞由本脚本自拟**：任务描述本身的清晰度是混杂变量。

## 四、过程教训（已入脚本期）

1. **首轮 20 次调用因脚本汇总处一个变量名笔误整批丢失**。修法不只是改笔误：脚本现在**先落原始 JSON、再渲染汇总**——展示层的错误不得毁掉已花掉的实验数据。
2. **"首次调用未失败"必须剔除**：初版把 10 个场景全算，得出虚高的 10/10。现在以 MCP 的 `isError` 为权威判定，无效场景单列并标注原因。
3. 花 token 的脚本要**内置上限**：本脚本 `--budget`（默认 20）在超限时直接中止，不静默多花。

## 五、下一步（要拿 E-M2 的 3 分，必须先改协议）

- **去掉编排指令的干扰**：二轮测量时把 `instructions` 从宿主提示里剔除（或改为两阶段协议：先允许一次"准备工作"调用，再测目标任务的选择），否则测的是"是否遵循工作流"而非"描述是否有区分度"。
- **改描述 → 复测**：定位区分度最差的 1–2 条描述（本轮线索：`scan` 与 `domain_radar`/`get_conventions` 被 `list_repos` 压过），修改后同协议复测，才有资格声称"误调率下降"。
- 提高 n（≥30）并至少跨两个模型；报告 n 与模型清单。

## 六、实验后的 provider 状态与对门禁的影响（必须连着读）

实验跑完后，收口门禁出现 **2 条失败**（`incident SSE stream`、`chat SSE turn streams open/citations/done`，事件为 `['open','error']`）。定位结论：

- 一次最小探测（`.scratch/llm-probe.ts`）得到 **`LLM request failed with HTTP 402`** —— provider 侧余额/额度不足，**不是代码回归**。
- **CI 环境不受影响**：CI 无 `.env`（无 provider 凭据），此时 chat/incident 路径走引擎自身的确定性降级并照常发出 `done` 载荷 —— 最近 6 次 CI（含 `5700bbd`）E2E gate **全绿**为证；本批运行前的同机 gate 也是 71/71 全绿。
- 也就是说：**「无 LLM」与「LLM 正常」两态都绿，只有「配了 provider 但返回 402」这一态红**——本批改动与之无关。
- **诚实交代**：额度是否由本轮实验（20+20=40 次调用，首轮因脚本笔误丢失输出但调用已花出）耗尽，**无法确定**；时间上吻合，key 自身套餐上限也属可能原因。§一/§二的数字在额度耗尽**之前**取得，有效；**复跑实验需要先恢复额度**。

**留给下一批的判断（未擅自改）**：e2e gate 的 chat/incident 检查直连真实 provider，因此"配了 key 但额度耗尽"会把门禁染红而 CI 看不出来（CI 无 key）。Release 冒烟门已有零 token 的 `scripts/smoke/stub-llm.mjs`，可选做法是让 e2e gate 也支持 stub 回退（并在记录里标注 stub 模式）——这属**门禁语义决策**，需你裁定，本批只登记证据不改。

## 七、复跑

```bash
# 实验（需要 provider 额度）
node --max-old-space-size=4096 services/control-plane/node_modules/tsx/dist/cli.mjs \
  scripts/eval/mcp_model_in_loop.ts --repo "D:/CodeCompass" --data-dir <dir> --budget 20

# provider 健康探测（1 次调用；402 = 额度不足）
node --max-old-space-size=2048 services/control-plane/node_modules/tsx/dist/cli.mjs .scratch/llm-probe.ts
```

环境要求：`.env` 配置 `REPOQA_LLM_BASE` / `REPOQA_LLM_API_KEY` / `REPOQA_LLM_MODEL`；未配置时脚本**拒绝运行并打印原因**（不伪造数字）。
