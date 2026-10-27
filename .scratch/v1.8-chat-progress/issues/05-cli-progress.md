# 票 05 — CLI REPL 进度（条件票）

Status: done

## 背景

维护者也用 `codecompass chat` REPL；票 01 会实测 REPL 在慢模型/工具阶段是否同样整段静默。
若同样静默，本票用同一个 `onProgress` 回调在 TTY 打单行进度；否则标 wontfix 并留证据。

## 做法

1. `services/control-plane/src/chat/repl.ts`（或等价 REPL 入口）接 `onProgress`：
   - TTY：单行覆盖输出「· 模型思考中 3s」「· 调用 codecompass_scan」；非 TTY 静默（保持管道可解析）；
   - 不做花哨动画；不改变既有 stdout 答案格式。
2. 与 Web 共用 contracts 类型；不新增 CLI flag。

## 验收

- REPL 交互实测（接 stub 慢模式）：等待期有单行进度、工具阶段有 tool 名；
- 非 TTY 管道输出与修前逐字节一致（`| cat` 场景）；
- 若关闭：票尾记录「REPL 基线无差异」证据。

## Comments

- 票 01 基线已证实 REPL 静默：首字延迟 20s 场景下发送后 **20,413ms** 才有第一段输出，
  `progressLikeChunks=0`（`--scenario repl`）。本票**转正保留**（不再条件关闭）。
- 2026-10-27 完成（评审后调整）。`repl.ts`：导出 `formatProgressLine(event)`（model/tool 起止/
  synthesis/retry 各一行中文），进度**逐行写 stderr**（不用 `\r` 覆盖：stdout 答案流随时插入，
  覆盖式单行会把两者搅在一起）；门控 = `stderr.isTTY`，`REPOQA_CHAT_PROGRESS=1/0` 是显式调试覆盖
  （默认行为不变），非 TTY 静默。
- 实测（`--scenario repl`）：
  - 强制进度路径：发送后 **4ms** 出现「· 模型思考中（第 1 步）」，20.4s 后 delta；轮次结束清行；
  - 默认非 TTY 路径：`progressLikeChunks=0`，首输出仍 20,413ms —— 管道场景输出与修前一致。
- 测试：`formatProgressLine` 五相位单测进 `src/chat/chat.test.ts`；cp chat 套件 **29/29 绿**。
