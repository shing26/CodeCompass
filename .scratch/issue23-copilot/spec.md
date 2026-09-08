# Issue 23 — Architecture & Incident Copilot（排障副驾驶）

## 决策依据
- ADR-0010：Physical Anchor 四元组钉死 commit（`repoId + commit + file:line-range + symbolId`，dirty 记为 `commit+dirty`）。
- ADR-0011：Web 端改造不重建；v1 纯静态边界（文字 + 粘贴堆栈/日志，不接 APM）；零幻觉合约作 CI 门禁；Copilot 独立 6 步 ReAct 预算。
- 术语已入 `CONTEXT.md` 词汇表：Architecture & Incident Copilot / Zero-Hallucination Contract / Physical Anchor / Stack Trace Parsing。

## 已核实的现状锚点（实现时以此为准）
- `repoqa-worker.ts` `queryRepo`：mode 三态 `architecture | call-chain | environment`；LLM 门禁 = `isLlmConfigured && gatesPassed && mode 不在 {call-chain, environment}`；确定性回退分支按 mode 分流。
- `repoqa-llm.ts`：`MAX_AGENT_STEPS = 3`、`runReActAgent` 已接受 `maxSteps` 参数；ReAct 目前是**文本 JSON 协议**（content 里返回 `{tool}`），未用 OpenAI 标准 `tools`/`tool_calls`。
- `repos` 表只有 `branch` 没有 `commit`（ADR-0010 需新增列 + git 解析）。
- 前端 `RepoQAClient.queryRepo(repoId, question, mode?, start?)` → `QueryStream` SSE；`useChat(client, repoId)`；`App.tsx` `MainView` 状态机已有多视图分支。
- eval：`repoqa-eval.ts` 682 行，bucket 按 `question.mode` 聚合，幻觉率/Recall/锚点有效率三指标，`bucketPasses` 已是发布 gate。

## Tickets
- `issues/01-stacktrace-parser.md` — 确定性堆栈解析器 + 符号反查
- `issues/02-physical-anchor-commit.md` — commit 列 + 锚点四元组透传
- `issues/03-incident-mode-backend.md` — incident 模式（工具面/6 步预算/标准 tool_calls）
- `issues/04-eval-incident-bucket.md` — eval incident bucket + 门禁
- `issues/05-incident-view-frontend.md` — IncidentView + 模式接线
- `issues/06-gate-and-docs.md` — 全量回归 + e2e gate + 文档

## 非目标（v1 明确不做）
- 不接 APM/日志链路/运行时数据源。
- 不做独立 Penguin Agent 包装（后续可用 MCP 底座另立）。
- 不动普通问答的 3 步预算与既有协议字段语义（只增不改）。

## Comments

### 验收记录（2026-09-01，Ticket 06 收官）
- typecheck 四包全绿（contracts / bridge-adapters / control-plane / repoqa-web）。
- vitest：control-plane 38 文件 **475/475**；repoqa-web 32 文件 **266/266**（eval harness 测试补 15s 显式超时，消除并行负载下贴默认 5s 的 flaky）。
- `npm run build` 四包全绿。
- e2e closeout gate **37/37 全绿**（`scripts/e2e/e2e-result.json`），新增 incident 冒烟两项：
  - `incident SSE stream (pasted stack -> grounded answer)` — provenance=static、grounded=True、answer 含 VERIFIED/BREAK 断言行；
  - `ADR-0010 commit stamp: incident payload + anchors carry the pinned commit` — commit=b655af8、4/4 anchors 盖章。
  - eval gate 检查升级：75 题、7 桶全 100%、`incident_hallucination=0.0%`。
- 版本 0.16.0：root / control-plane / repoqa-web / contracts package.json + `cli.ts` VERSION + CHANGELOG 顶部条目（bridge-adapters 维持独立节奏 0.6.0）。
- 文档：CHANGELOG 0.16.0、CONTEXT.md 状态行（0.16.0 / 11 ADRs）、`docs/benchmark.md`（Ticket 04 已刷至 75 题 / 5 fixture）。
- 结论：零幻觉合约已进发布 gate（incident 幻觉率非 0 即 fail）且本次全绿，Issue 23 可声明完成。
