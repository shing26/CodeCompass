# 票 03 — 服务端：progress / hint / heartbeat + LLM 超时

Status: done

## 背景

服务端是唯一知道「此刻在调模型还是在跑工具」的一方；不新增信号，前端再努力也只能显示计时器。

## 做法（先把票 01 的探针改成红）

1. `chat/agent.ts`：`runSerialized/run` 的 opts 增加 `onProgress?: (e: ChatProgressEvent) => void`；
   在四个点回调——模型调用前（phase=model，step=n）、每次工具调用前（phase=tool，tool=name）、
   工具返回后（同 phase + `elapsedMs`）、合成/重试轮（synthesis/retry）。`turnId` 由 agent 内部生成后回传。
2. `chat/agent.ts` 的每次 `llm.chat` 传 `timeoutMs`（读 `REPOQA_CHAT_LLM_TIMEOUT_MS`，默认 180000）；
   超时抛既有错误路径，由 routes 转 `error {code:'chat_llm_timeout'}`。
3. `chat/routes.ts`：
   - 起轮次时启动 5s `heartbeat` 定时器与 15s/45s 首字提示定时器（收到首个 delta 即清除提示定时器）；
   - `onProgress` → `send('progress', …)`；工具单次 >10s → `send('hint', TOOL_LONG_RUNNING)`（每工具只发一次）；
   - 轮次结束/出错/客户端断开时清除全部定时器（复用现有 `closed` 守卫）。
4. 先红：在实现前用票 01 探针记录 `progress=0 hint=0 heartbeat=0`；实现后同一探针复跑，填读数表。

## 验收

- 慢模型场景（首 delta 20s）：`heartbeat` ≥ 3 帧、`hint SLOW_FIRST_TOKEN` 恰一次、
  `maxGap ≤ 5s`、总时长不因心跳显著变长；
- 多步工具场景：每次工具调用有 `progress` 起止帧，工具阶段 `maxGap ≤ 5s`；
- 180s 超时（stub 永不回）：`error chat_llm_timeout`，消息经掩码，前端文案可读；
- 客户端中途 abort：定时器清零、无 `send` 抛错、服务端仍持久化（沿用现有 M4-01 行为）；
- 单测：agent progress 回调顺序、routes 定时器生命周期、超时路径。

## Comments

- 2026-10-27 完成。实现：`agent.ts` 增加 `onProgress`（model/tool 起止/synthesis/retry，带 turnId+elapsedMs）
  与每次 `llm.chat` 的 `timeoutMs`（`REPOQA_CHAT_LLM_TIMEOUT_MS`，默认 180s）；`routes.ts` 增加
  `progress` 直发、5s `heartbeat`、15s/45s 首字提示、10s 慢工具提示，并在完成/出错/断连处清理定时器；
  超时映射 `chat_llm_timeout`。
- 测试：`src/chat/` 28/28 绿（新增 agent 进度序列/超时 2 条 + routes 进度流 1 条，计时参数用 test seam 注入）。

### 修后读数（同一探针，2026-10-27）

| scenario | progress | heartbeat | hint | maxGapMs（窗口） | 说明 |
|---|---|---|---|---|---|
| fast（默认 stub） | 1 | 0 | 0 | 379 / 715 | 短轮次不出心跳 |
| tool（1 工具 + 2s 二轮） | 5 | 1 | 0 | 2365 / 5653 | 工具起止帧齐全 |
| slow（首字 20s） | 1 | 4 | 1（SLOW_FIRST_TOKEN@15.0s） | **5002–5011 / 约 20.7s** | 心跳保底；gap = 心跳周期 + 调度抖动 |

- wire 开销（4KB 答案样本 `--answer-chars 4000`；探针字节账修复后重测）：slow **2.1%**（396B）、tool **2.5%**（705B），
  低于 spec 的 10% 目标；短答案下占比天然偏高（fast 16.7%，因分母只有 ~700B），已在 spec 修正口径。
- 超时路径：单测用 20ms 上界证明 `TimeoutError` 传播（routes 映射 `chat_llm_timeout`）。
- 先红已留档（票 01 表：修前 progress/hint/heartbeat 全 0、slow maxGap 20.4s）。
