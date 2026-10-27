# 票 02 — 契约：事件类型 + hint code + ADR-0024

Status: done

## 背景

新 SSE 事件是**共享区契约**（`packages/contracts`），按 parallel-collaboration 纪律必须先落 spec
（本批 spec 已写）再落代码；同时需要一条 ADR 钉住边界，防止以后被误当成 MCP 能力或自动动作开关。

## 做法

1. `packages/contracts/src/` 新增（不改既有导出）：
   - `ChatProgressEvent`：`{ phase: 'model' | 'tool' | 'synthesis' | 'retry'; step: number; tool?: string; turnId: string; elapsedMs: number }`；
   - `ChatHintEvent`：`{ code: ChatHintCode; elapsedMs: number; profile: string; profilesAvailable: number }`；
   - `ChatHeartbeatEvent`：`{ elapsedMs: number }`；
   - `CHAT_HINT_CODES` 常量 + 类型（`SLOW_FIRST_TOKEN` / `VERY_SLOW_FIRST_TOKEN` / `TOOL_LONG_RUNNING`）。
2. `docs/adr/0024-chat-progress-contract.md`（accepted）：增量事件、只带机器字段、心跳 5s、
   15/45s 提示不自动动作、180s 硬上界、老客户端忽略未知事件、不重放进度、不碰 MCP。
3. contracts 镜像只加类型，不加运行时依赖；`tsc` 零错误。

## 验收

- 类型/常量可被 cp 与 web 同时 import（构建期验证）；
- 既有 contracts 导出签名零变化（diff 只增）；
- ADR-0024 合入并被本 spec 引用。

## Comments

- 2026-10-27 完成。新增 `packages/contracts/src/chat.ts`（`ChatProgressEvent` / `ChatHintEvent` /
  `ChatHeartbeatEvent` + 阈值常量 `CHAT_SLOW_FIRST_TOKEN_MS` / `CHAT_VERY_SLOW_FIRST_TOKEN_MS` /
  `CHAT_TOOL_LONG_RUNNING_MS` / `CHAT_HEARTBEAT_MS` / `CHAT_LLM_TIMEOUT_MS`），`index.ts` 只增一行导出。
- ADR-0024 `docs/adr/0024-chat-progress-contract.md`（accepted）。
- 既有 contracts 导出签名零变化；`npm run typecheck --prefix packages/contracts` 绿。
