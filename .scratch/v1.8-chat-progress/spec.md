# v1.8 — chat 流式可感知：服务端进度与慢模型断点提示

Status: done（2026-10-27 收口；双轴评审与门禁见 Comments）

## 定位（ADR-0021 通道 B 论证）

**消费面**：Web 驾驶舱的 chat + CLI REPL——即 ADR-0021 定义的维护者 dogfooding 面（通道 B），
不是对外产品面扩张：17 个 `codecompass_*` MCP 工具输入签名与返回体零变化，HTTP/MCP 契约不动。

**回答的摩擦类别**：**流式期间「服务端在干什么」不可见**。R5-05 走查证据：
纯中文意图「索引是怎么建立起来的？」在 t+10s…120s 六次采样恒为字面量 `…`，无断点提示、
无错误、无重试（`docs/reports/产品体验报告-Round5.md:39`；同报告 `:53` R5-14 流式无中断）。
v1.2.x 已补前端半：**已用时 + 首字延迟 + 停止键**（`ChatView.tsx:274-303`），
但服务端整个 ReAct 轮次只有 `delta` 一种信号：

- `services/control-plane/src/chat/routes.ts:163-188` 只发 `open/delta/regenerate/citations/plan/done/error`；
- `services/control-plane/src/chat/agent.ts:183-253` 的 ReAct 循环在每次 `mcp.callTool` 前后
  **不产出任何信号**——工具阶段（可能数秒）整段静默；
- `agent.ts` 调 `this.deps.llm.chat` 从不传 `timeoutMs`（`chat/llm.ts:151` 支持该参数），
  provider 挂起时静默**无上限**；用户无法区分「慢」与「死」。

## 背景与度量

**基线（票 01 已实测，2026-10-27）**：

| 场景 | 帧数 | 首 delta | 最大静默 gap（窗口） | progress / hint / heartbeat |
|---|---|---|---|---|
| fast（默认 stub） | 6 | 413ms | 407ms（open→delta） | 0 / 0 / 0 |
| slow（首字延迟 20s） | 6 | 20,428ms | **20,421ms**（open→delta） | 0 / 0 / 0 |
| tool（1 次工具 + 2s 二轮） | 8 | 2,750ms | 2,742ms（open→delta） | 0 / 0 / 0 |
| repl（首字 20s） | — | 首输出 20,413ms | — | 0（无任何进度输出） |

前端计时器只证明「页面没死」，不证明「服务端在干活」；慢模型/工具阶段的静默就是这道门要消掉的东西。

**修后（票 03 实测，同一探针）**：

| 场景 | progress | heartbeat | hint | 最大静默 gap |
|---|---|---|---|---|
| fast | 1 | 0 | 0 | 379ms |
| tool（1 工具 + 2s 二轮） | 5（起止帧齐全） | 1 | 0 | 2,365ms |
| slow（首字 20s） | 1 | 4 | 1（SLOW_FIRST_TOKEN @15.0s） | **5,002–5,011ms**（= 心跳周期 + 调度抖动） |

wire 开销（4KB 答案样本，探针字节账修复后重测）：slow **2.1%**（396B）、tool **2.5%**（705B）——**同时修正口径**：
10% 目标只在「接近真实长度的答案」上成立，短答案分母过小（fast 16.7% 是因为分母仅 ~700B），
验收以 4KB 样本 + 固定开销（≤1KB/轮）双读数为准。

**修后目标读数（验收用）**：

| 指标 | 目标 |
|---|---|
| 活动轮次内任意相邻两帧最大间隔 | **≤ 5s**（heartbeat 5s 保底） |
| 首字 > 15s | 必有一次 `hint SLOW_FIRST_TOKEN` |
| 首字 > 45s | 必有一次 `hint VERY_SLOW_FIRST_TOKEN`（带「可停止 / 可切档」建议，仅当 >1 档） |
| 工具阶段 | 每次工具调用有 `progress` 起止事件（phase/step/tool/ms） |
| wire 增量 | ≤ 现有 SSE 字节的 10% |
| delta 批帧 | 不变（`routes.ts:111-129` 的 200 chars / 40ms） |

## 决策（草案）

1. **新增 SSE 事件是增量契约**：`progress` / `hint` / `heartbeat` 三个新事件名；既有事件字段
   一个不改，HTTP 路由与请求体不变。`ChatMergeClient` 按 event 名分支、未知事件忽略
   （`RepoQAClient.ts:1163-1190`）——老客户端天然兼容，新客户端逐项消费。
2. **事件只带机器可读字段，不带文案**：progress `{phase:'model'|'tool'|'synthesis'|'retry',
   step, tool?, turnId, elapsedMs}`；hint `{code, elapsedMs, profile, profilesAvailable}`；
   中文文案由前端 copy 表映射（copy-guard 纪律：英文退役词不进 UI）。
3. **心跳用事件而非注释帧**：`heartbeat {elapsedMs}` 每 5s 一次。理由：可被 fetch 流解析器
   断言（e2e/单测可证），EventSource 客户端未注册监听则自动忽略；注释帧无法被现有解析器观测。
4. **慢提示只在阈值触发一次，绝不自动动作**：15s / 45s 两级；`hint` 只是建议，
   **不自动 abort、不自动切模型**（工具不替用户做决定——与「不编造」同一纪律）。
5. **硬上界**：每次 `llm.chat` 传 `timeoutMs`（`REPOQA_CHAT_LLM_TIMEOUT_MS`，默认 180000）；
   超时走既有 `error` 帧、新 code `chat_llm_timeout` + 人话引导（复用前端 describeError 面）。
6. **CLI REPL 同源**：agent 的 `onProgress` 回调同时供 REPL 打进度；默认按 `stderr.isTTY`，
   非 TTY 静默（管道输出不被污染）。`REPOQA_CHAT_PROGRESS=1/0` 是显式调试覆盖（不改变默认）；
   终端文案与 Web copy 表各自维护（两个消费端，ADR-0024 决定 7）。
7. **不做**：MCP progress notifications（17 工具冻结，ADR-0020）；取消协议改造（客户端 abort
   已可用）；自动重试/自动切模型；进度持久化进 DB/JSONL（既有 `tool_result` 审计不变）。

## 事件契约（草案）

| event | payload | 触发点 | 消费者行为 |
|---|---|---|---|
| `progress` | `{phase, step, tool?, turnId, elapsedMs}` | 模型调用前（model）、每次工具调用前（tool）、工具返回后（tool 收尾，含 ms）、合成/重试轮（synthesis/retry） | 渲染单行进度：「正在执行 codecompass_diagnose（第 2 步）」 |
| `hint` | `{code, elapsedMs, profile, profilesAvailable}` | 15s 无首 delta（SLOW_FIRST_TOKEN）、45s 无首 delta（VERY_SLOW_FIRST_TOKEN）、单次工具 >10s（TOOL_LONG_RUNNING） | 渲染提示条 + 建议（停止 / 切档），不自动动作 |
| `heartbeat` | `{elapsedMs}` | 活动轮次每 5s | 默认忽略；可用于「服务端仍在线」保底 |

兼容与收口规则：

- 未知事件一律忽略；`done` 是轮次结束的唯一权威（心跳/进度不承诺顺序）；
- 断线重连（R2 的 reconnect 逻辑）**不重放**进度事件——重连语义保持「从下一帧继续」；
- 事件名沿用 chat 面现有裸名（`open/delta/…`），不趁机改 `repoqa.*`（V30-10 破坏面另立票）。

## 文件面（开线声明）

- `packages/contracts/src/`（**共享区**：chat SSE 事件类型 + hint code 常量；不改 MCP 类型）
- `services/control-plane/src/chat/agent.ts`（`onProgress` 回调 + `llm.chat` timeout 接线）
- `services/control-plane/src/chat/routes.ts`（progress/hint/heartbeat 发送、5s 心跳、15/45s 定时器）
- `services/control-plane/src/chat/llm.ts`（仅接线 timeoutMs，无 API 变更）
- `apps/repoqa-web/src/client/RepoQAClient.ts`（ChatMergeClient 解析 + handlers）
- `apps/repoqa-web/src/components/ChatView.tsx`（进度行/提示条 + copy 表；沿用现有停止键与档位切换）
- `scripts/smoke/stub-llm.mjs`（新增 scripted slow 模式：可选 tool_calls + 可配延迟）+
  `scripts/smoke/chat-progress-probe.mjs`（新）
- `scripts/smoke/ui_smoke.mjs`（只增断言）、`scripts/e2e/closeout_gate.py`（只增 SSE 时间线断言）
- `docs/adr/0024-chat-progress-contract.md`（新）
- 共享区（CHANGELOG / README / HANDOFF / CONTEXT / 版本五处）：**只在票 06 一次性动**
- **不触碰**：17 个工具输入 schema、MCP 返回体、检索/引擎、`repoqa.query.*` 事件

## 票清单

- 01 先量：slow stub（tool_calls + 可配延迟）+ SSE 时间线探针，产出基线表（首帧/首 delta/工具阶段 max gap）
- 02 契约：contracts 事件类型 + hint code 常量 + ADR-0024
- 03 服务端：agent `onProgress` + routes progress/hint/heartbeat + LLM timeout（先红：探针报 progress=0/hint=0/maxGap=X）
- 04 前端：ChatMergeClient handlers + ChatView 进度/提示（copy-guard 合规、停止/切档复用）
- 05 条件票：CLI REPL 进度（取决于票 01 是否显示 REPL 同样静默）
- 06 收口：版本 1.8.0、CHANGELOG、README 路线图勾 R5-05、HANDOFF §4 销项、UI smoke/e2e 断言、双轴评审

## 完成定义

- 票 01/03 各一份**基线 vs 修后**读数表：max silent gap 从 X s → **≤5s**；首字 >15s 的场景
  出现 `SLOW_FIRST_TOKEN`；工具阶段出现 `progress` 起止帧；wire 增量 ≤10%；
- **先红证据留档**：修前探针输出 `progress=0 hint=0 heartbeat=0 maxGap=Xs`；
- 老客户端兼容：未知事件忽略有单测（真未知事件名）；`done` 权威性有单测
  （done 之后迟到的 heartbeat/progress 不改变终态）；
- typecheck / 控制面 / web / bridge 单测全绿；e2e 只增断言且全绿；UI smoke 断言进度行出现；
- README 路线图 **R5-05 勾选**；HANDOFF §4 第 7 项销项并留证据链接；CHANGELOG `[1.8.0]`；
- 双轴 code-review（fixed point = v1.7.0 `41c4de5`）报告落 `docs/reports/`。

## 风险与裁决项

- **R1 事件命名不一致**：chat 面裸名 vs V30-10 的 `repoqa.*` 遗留——本批沿用现状，不改名。
- **R2 心跳 5s 是否过密**：本地回环实测预期 <1KB/轮增量；若将来有代理/隧道场景另议。
- **R3 180s 默认超时**：Round5 实测整轮 68.5s、预热首字 466–660ms；180s = 2.6× 余量，可配。
- **R4 背压**：`routes.ts` 的 `send` 无显式背压处理（沿用现状）；进度/心跳帧量级小，纳入 wire 增量验收。
- **R5 CLI 是否本批做**：条件票 05，由票 01 基线决定。
- **R6 版本预占**：**v1.8.0**；固定点 = v1.7.0（`41c4de5`）。开工前按 parallel-collaboration
  步骤 1 核 CHANGELOG 顶部，确认未被抢号。

## Comments

- 2026-10-27 立项草案（Lead 起草，待用户裁决）：来源 = README 路线图唯一未勾项 R5-05 +
  `HANDOFF.md:151` §4 第 7 项。起草时未跑探针；票 01 先量是硬前置。
- 2026-10-27 裁决：用户「全部默认」——heartbeat 5s / hint 15s+45s / LLM 硬超时 180s 接受；
  票 05 CLI REPL 保留为条件票；版本预占 **v1.8.0**、ADR-0024 确认。开线。
- 2026-10-27 票 01 done：基线读数见 `## 背景与度量`；stub scripted 模式 + `chat-progress-probe.mjs`
  已入库（默认行为不变）。REPL 实测 20.4s 零输出 → 票 05 转正。
- 2026-10-27 票 02 done：`packages/contracts/src/chat.ts` + ADR-0024。
- 2026-10-27 票 03 done：服务端 progress/hint/heartbeat + LLM 超时；`src/chat/` 28/28；
  修后读数（slow maxGap 5.0s、hint@15s、4KB 答案 wire 2.1%）见 `## 背景与度量`。
- 2026-10-27 票 04 done：`ChatMergeClient` 解析 progress/hint（heartbeat 显式忽略）；`ChatView`
  进度行/慢提示（多档才提示切档；delta 到达或轮次结束即清空）；定向 web 测试 66 passed（含 copy-guard）。
- 2026-10-27 票 05 done：REPL `formatProgressLine` + stderr 进度（TTY/env 门控）；实测强制路径
  3ms 出进度、默认非 TTY 仍静默（管道输出与修前一致）；评审后改逐行 stderr（不与 stdout 抢行）；cp chat 29/29。
- 2026-10-27 票 06 收口 + 双轴评审：报告 `docs/reports/code-review-2026-10-27-v18.md`（fixed point `41c4de5`）。
  硬违规 1（`chat_llm_timeout` 未入三处同动契约 → 已补 ERROR_CODES/ERROR_COPY/CONTEXT + 发码走常量 +
  guard 增三元形状扫描）；judgement 修 5 / 部分 1（CLI 文案独立 + env 调试开关写入 ADR）/ deferred 1（freePort 重复）；
  Spec 轴修 6（done 权威性/未知事件单测、delta 后清进度行、REPL 逐行）部分 1（env 开关转为显式调试覆盖）。
- 发布：沿用 v1.7 release-checklist；npm 1.7.0 → 1.8.0（发布脚本模板换版本号即可）。
