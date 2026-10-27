---
status: accepted
---

# chat 流式进度契约：让「服务端在干嘛」可见，但绝不替用户做决定

## 背景

- R5-05 走查（`docs/reports/产品体验报告-Round5.md:39`）：纯中文意图在 t+10s…120s 六次采样
  恒为 `…`，无断点提示、无错误、无重试。v1.2.x 已补前端半（已用时 / 首字延迟 / 停止键），
  但服务端整轮只有 `delta` 一种信号。
- v1.8 票 01 实测（`scripts/smoke/chat-progress-probe.mjs`）：
  | 场景 | 首 delta | 最大静默 gap | progress/hint/heartbeat |
  |---|---|---|---|
  | fast | 413ms | 407ms | 0/0/0 |
  | slow（首字 20s） | 20,428ms | **20,421ms** | 0/0/0 |
  | tool（1 工具 + 2s 二轮） | 2,750ms | 2,742ms | 0/0/0 |
  | CLI REPL（首字 20s） | 首输出 20,413ms | — | 0 |
- 代码事实：`chat/routes.ts` 只发 `open/delta/regenerate/citations/plan/done/error`；
  `chat/agent.ts` 在每次 `mcp.callTool` 前后零信号；`agent.ts` 调 `llm.chat` 不传 `timeoutMs`
  （`chat/llm.ts:151` 支持）→ provider 挂起时静默无上限。

## 决定

1. **新增三个 SSE 事件，只增不改**：`progress` / `hint` / `heartbeat`；既有事件字段一个不改，
   路由与请求体不变。消费方必须忽略未知事件；`done` 仍是轮次终态的唯一权威。
2. **事件只带机器可读字段**（phase/step/tool/turnId/elapsedMs、hint code），中文文案由前端
   copy 表映射——避免服务端成为第二份文案源，也满足 copy-guard 纪律。
3. **心跳用事件而非注释帧**（`heartbeat`，5s）：可被现有 fetch 流解析器断言，e2e 可证
   「服务端仍在线」；EventSource 未注册监听则自动忽略。
4. **慢提示只提示、绝不自动动作**：15s `SLOW_FIRST_TOKEN`、45s `VERY_SLOW_FIRST_TOKEN`、
   单次工具 >10s `TOOL_LONG_RUNNING`；`hint` 只给建议（停止 / 切档，且仅当档位 >1），
   **不自动 abort、不自动切模型**——与零幻觉合约同源：工具不替用户做决定。
5. **单次模型调用有硬上界**：`REPOQA_CHAT_LLM_TIMEOUT_MS`（默认 180,000ms）；超时走既有
   `error` 帧，新 code `chat_llm_timeout` + 人话引导。理由：无界静默等于让用户无法区分
   「慢」与「死」。
6. **阈值是共用常量**（`packages/contracts/src/chat.ts`）：服务端与前端 import 同一把尺，
   禁止两边各写数字；改阈值 = 改契约，需评审。
7. **文案分消费端维护**：Web（`ChatView`）与 CLI（`repl`）各自映射中文文案——两者依赖面不同，
   不共享源码是刻意取舍；事件名、阈值、语义仍是同一契约。**前端在首个 delta 到达即隐藏进度行**
   （它回答的是「还没出字时在干嘛」），CLI 进度逐行写 stderr、不用 `\r` 覆盖（避免与 stdout 答案抢行）。
8. **显式调试开关**：CLI 的 `REPOQA_CHAT_PROGRESS=1/0` 可强制开/关进度；默认仍按
   `stderr.isTTY`——非 TTY 管道输出与修前逐字节一致，这一点不因开关存在而改变。
7. **CLI REPL 同源**：agent 的 `onProgress` 回调同时供 REPL 在 TTY 打单行进度；非 TTY 静默
   （管道输出不被污染）。
8. **不重放进度**：断线重连（R2 的 reconnect 逻辑）从下一帧继续，不补发历史心跳/进度。

## 后果

- chat SSE 每轮多 3 类帧：心跳 5s/轮 + 每次工具 2 帧 + 模型阶段 1 帧；本地回环实测 wire 增量
  目标 ≤10%（验收见 spec）。
- 前端需要把「已用时/首字延迟」与 progress/hint 合成一个可读状态行；文案表新增 3 条提示。
- 17 个 MCP 工具与返回体零变化；HTTP/MCP 契约不动；`repoqa.query.*` 事件不动。
