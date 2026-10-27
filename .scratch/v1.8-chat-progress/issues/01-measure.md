# 票 01 — 先量：静默时间线基线

Status: done

## 背景

R5-05 的症状来自「没有信号」，但先要把「多久没有信号、卡在哪个阶段」量出来，
否则阈值（5s/15s/45s/180s）都是拍脑袋。

## 做法

1. 扩展 `scripts/smoke/stub-llm.mjs`（只增，不改默认行为）：
   - `STUB_LLM_DELAY_MS`：每个 delta 前的延迟（默认 300ms 不变）；
   - `STUB_LLM_SCRIPT`：可选脚本模式——先回一个 `tool_calls`（如 `codecompass_scan`，参数为空对象），
     再按 `STUB_LLM_DELAY_MS` 回最终文本；用于制造「工具阶段」与「多步循环」。
2. 新增 `scripts/smoke/chat-progress-probe.mjs`：
   - 起服务（真实控制面 + stub LLM + 真 Chromium 不需要；纯 HTTP 客户端足够）；
   - POST `/api/chat/sessions/:id/messages`，逐帧记录 `event` 与到达时间戳；
   - 输出：首帧、首 delta、按 phase 的最大静默 gap、各事件计数、总时长；
   - `--json` 摘要 + 明细账（落 tmp，不入库）。
3. 跑三种场景：①慢模型（首 delta 延迟 20s）；②多步工具（1× tool_call + 2s 工具耗时）；
   ③正常（默认 stub）。记录基线表。
4. 同时测 CLI REPL：`node dist/cli.js chat` 接同一 stub，观察是否有任何进度输出（决定票 05 是否做）。

## 验收

- 三种场景各有基线行：`progress=0 hint=0 heartbeat=0 maxGap=Xs firstToken=Xs`；
- 探针可一键复跑、输出可粘进票尾；
- 不修改产品代码（只动 stub 与新增探针脚本）。

## Comments

- 2026-10-27 完成。stub 扩展：`scripts/smoke/stub-llm.mjs` 新增 scripted 模式
  （`delayMs` / `firstTokenDelayMs` / `script: 'text'|'tool-then-text'` / `toolName`），
  **默认行为不变**（无 options/env 时与修前逐字节一致，ui_smoke/e2e 不受影响）。
- 探针：`scripts/smoke/chat-progress-probe.mjs`（`--scenario fast|slow|tool|repl [--json]`），
  自带 demo 仓 + 本地 stub LLM + 真实控制面进程，逐帧记录 SSE 时间戳。

### 基线读数（修前，2026-10-27）

| scenario | frames | firstDeltaMs | maxGapMs（窗口） | progress | hint | heartbeat | totalMs |
|---|---|---|---|---|---|---|---|
| fast（默认 stub） | 6 | 413 | **407**（open→delta） | 0 | 0 | 0 | 684 |
| slow（首字延迟 20s） | 6 | 20428 | **20421**（open→delta） | 0 | 0 | 0 | 20698 |
| tool（1 工具调用 + 2s 二轮） | 8 | 2750 | **2742**（open→delta） | 0 | 0 | 0 | 5653 |
| repl（首字延迟 20s） | — | firstOutput 20413ms | — | 0（progressLikeChunks） | — | — | — |

- 结论：**修前服务端整轮只有 open/delta/citations/plan/done**；慢模型 20s 静默期内
  `progress=hint=heartbeat=0`，max silent gap = 首字延迟本身；CLI REPL 同样 20.4s 零输出 →
  **票 05（CLI 进度）转正保留**。
- tool 场景里工具本体只用了 5ms（dashboard 是快工具）；工具阶段无信号的缺陷由
  「progress 起止帧」在票 03 补，慢工具的真实 gap 由 e2e 的断言（起止帧存在）兜住。
- 复跑：`node scripts/smoke/chat-progress-probe.mjs --scenario slow --json`。
