# Issue 08 — 决策链可整段取出（`turnId` 关联）

> 依据：审计 v2 称网页端"`TraceStep[]` 实时步进条"是 agent 决策面——**本仓实测为误判**，实为调用链 hop（见 spec §2-5）
> 波次：波 3 ｜ 状态：**已落地（2026-09-29）** ｜ 依赖：无

## 1. 现状（实测，含一处对外表述的纠正）

**调用链（对代码的探查结果）已可呈现**：

`done.payload.trace` → `useChat.ts:81-108` 的 `parseTraceSteps` → `TraceStep[]`（`file`/`line`/`symbol`/`VERIFIED|BROKEN`）→ `Canvas.tsx` 步进高亮。**这是调用链，不是 agent 决策步。**

**决策步（agent 自己的动作序列）现状**：

| 面 | 现状 | 缺口 |
|---|---|---|
| SSE `citations` 事件 | 带 `{n, tool, args, ms}`（`chat/agent.ts:183`） | 无关联键，页面刷新即丢 |
| `done` 载荷 | `steps` 是**数字**（工具轮数，`agent.ts:57`） | 不是序列 |
| JSONL（ADR-0019） | `tool_result {tool, via, cite, ms}`（`agent.ts:185`） | **无 args、无 `turnId`**，行与行之间无法关联 |

⇒ 缺口性质：**有留痕、无整段可回放面**——"一次提问到底调了哪些工具、各自多久、结果是什么"无法作为一个整体取出。

⚠️ **同名异物警告**：本仓 `TraceStep` = 调用链 hop（`apps/repoqa-web/src/types.ts:204`）；另一项目（ShopPilot）的 `TraceStep` = FSM 状态转移。**对外文档必须区分这两个词**，否则合并讲时必被问倒。

## 2. 落地

- 新增**每轮关联键** `turnId`（形如 `sessionId:seq`），写入三处：① JSONL 的 `tool_result` / `agent_turn` 行；② `citations` 元素；③ `done` 载荷。
- 使"一次提问 → 全部工具调用（含 args / 耗时 / 结果摘要）"可**按 `turnId` 整段取出**。
- **边界登记**（不得静默）：ADR-0019 明写**被 SDK 校验拒绝的调用不进审计**；契约须带 `not_audited` 标记，禁止静默空洞。
- **不改** 17 工具签名、**不改** `MAX_STEPS=3`、不把网页端升格为产品面（spec §1.2）。

## 验收（机器可验证）

1. 一次提问命中 2 次工具 → 按 `turnId` 取出 **2 条**记录，且 `done.payload` 的工具计数与之一致。
2. **脱敏不变式**：载荷中的 args 过 `maskSensitiveText`（R1 不变式，不得回退）。
3. **断链用例**：故意让一条记录不写 `turnId` → 一致性检查能报出（"记录数与 citations 不符"）。
4. 前端零改动或只增不改（Web 只减不增约束；本票不要求 UI 呈现，只要求**可取回**）。

## Comments

- 2026-09-27 立项。本票是"可审计"从**计数**升到**序列**的最小一步；是否在 UI 呈现留待后续（需先证明有消费方，否则又是一份没人读的 JSON）。
- 2026-09-29 **落地**（`chat/agent.ts` + `chat/log.ts` + `chat/routes.ts` 三文件，零 MCP 零前端改动）：
  - **turnId 三处落点**：① JSONL `tool_result` 行新增 `turnId`/`args`（掩码后）/`summary`（模型可见内容前 800 字）；`agent_turn` 行新增 `turnId` + `notAudited`（=citations−tool_result 行数，恒 0——ADR-0019「被 SDK 拒绝的调用不进审计」的空洞从静默变显式计数）；② `Citation` 接口增 `turnId`，每轮共享；③ `AgentTurn`/SSE `done` 载荷增 `turnId`（routes 级用例钉帧形状）。格式 `sessionId:seq`（seq 为 per-agent 单调计数；REPL 无 sessionId 时前缀字面量 `session`）。
  - **args 掩码前置（验收②）**：新增 `maskArgs`（stringify→maskSensitiveText→parse，结构保持模式）——此前 citations 的 args **未掩码直出** SSE/DB/JSONL，本票在源头收口；假凭据（运行时拼接）用例钉 `[REDACTED AWS KEY]`。
  - **整段取出（验收①）**：`log.ts::auditTurnRecords(rows, turnId, expected)`——records/citations/missingTurnId/consistent 四字段；断链用例（一条 tool_result 无 turnId → consistent=false、missingTurnId=1）在档（验收③）。
  - **验收④**：web 零改动（chat SSE 载荷无 contracts 镜像，字段纯增量）；17 工具签名与 MAX_STEPS=3 零动。
  - 门禁：typecheck 0 错（**教训**：票 04+05+07 的 CI 红即 TS1470 `import.meta` 在 CJS 包不可用——仓内早有明文红线（copy-guard.server.test.ts:20），本票全程按 `process.cwd()` 包根模式）、控制面 **770/770**（766+4 新测）、e2e **71/0**。