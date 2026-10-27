# Code review — 2026-10-27（v1.8 chat 流式可感知）

- **fixed point**：`41c4de5`（= 当前 HEAD，v1.7.0 文档回写 commit）
- **范围**：v1.8 工作树改动（12 改 + 3 新）+ 版本五处 / CHANGELOG / README / HANDOFF / CONTEXT
- **方法**：双轴并行 sub-agents（Standards / Spec），互不共享 context；「处置」由 Lead 复核后给出
- **背景**：v1.8 = R5-05 后端半——`progress`/`hint`/`heartbeat` 三事件（ADR-0024）、
  ChatView 进度行/慢提示、CLI REPL 进度、180s 模型硬超时

---

## Standards

### Standards findings

- **[硬违规] 新错误码绕开三处同动契约** — `services/control-plane/src/chat/routes.ts:291`（另见
  `:288` 注释仍称「稳定 `chat_run_failed`」、`:299/:301` 出口）新增 `chat_llm_timeout`，但
  `packages/contracts/src/error-codes.ts:71` 表内无此码、`apps/repoqa-web/src/client/errorCodes.ts:31`
  `ERROR_COPY` 无此文案、`CONTEXT.md:98` 表无此行。依据 `CONTEXT.md:87`「**新码三处同动**：
  contracts `ERROR_CODES` → 前端 `ERROR_COPY` → 本表」与 `error-codes.ts:23-24`。更要紧的是字面量
  藏在三元里，`error-code-guard.test.ts:43` 只认 `code:\s*['"]…` 形状 → 扫描哨静默放行；
  `describeError` 查不到 copy 即原样透出 → ADR-0024 决定 5「人话引导」端到端落空。
- **[judgement] 计时器收尾函数后置声明** — `routes.ts:132`、`:140` 先调用，`cleanupTurn` 到
  `:167` 才 `let` 声明（从未重赋值）；今日靠异步时序侥幸，同步提前调用即 TDZ。`:140` 缩进错位。
- **[judgement] 用坏消息判类型** — `routes.ts:34-38` `isTimeoutError` 靠 `err.name` 三选 +
  `/(timed out|timeout)/i` 嗅探 message，重复了 `AbortSignal.timeout` 已给的 TimeoutError 事实；
  provider 原文含 "timeout" 即误判。
- **[judgement] 同一事件两份中文文案表** — `repl.ts:18` 与 `ChatView.tsx:34` 各自映射 progress→文案，
  措辞与单位分叉（`42ms` vs `1.2s`）；ADR-0024「中文文案由前端 copy 表映射」。
- **[judgement] 零消费方的契约导出** — `packages/contracts/src/chat.ts:61-62`
  `CHAT_PROGRESS_EVENTS`/`ChatProgressEventName` 全仓无引用。
- **[judgement] 探针读数工具自身错算** — `chat-progress-probe.mjs:124` 用 `'\\ndata: '`
  （字面反斜杠 n）拼帧，每帧多算字节，CHANGELOG 的 wire 百分比出自该函数；`freePort` 是第三份复制。
- **[judgement] 一致性小账** — `ChatView.test.tsx:354` import 放在文件中部；
  `CONTEXT.md:4`「最近」列表吞掉 ADR-0018；票 06 / spec status 仍 pending 而 HANDOFF 已宣告收口。

### 最严重问题

`chat_llm_timeout` 三处缺两处，且靠绕开扫描哨的形状实现——本版核心体验「让用户分不清慢与死」
在最后一米失效；任何后续新码写成三元字面量都能绕过门禁。

---

## Spec

### Spec findings

1. **(a) `chat_llm_timeout` 未落入错误码契约与前端文案** — spec 决策 5（spec.md:71、ADR-0024:34-35）
   要求「超时走既有 error 帧、新 code + 人话引导（复用前端 describeError 面）」；三处缺失（同上）。
2. **(a) done 权威性单测缺失** — spec.md:120 要求「done 权威性有单测（心跳/进度迟到不改变终态）」，
   routes 测试只有正向流；「未知事件忽略」也只覆盖 heartbeat（已知事件）。
3. **(c) 进度行在首个 delta 到达时不清空** — issue 04 与 CHANGELOG:17 称「首个 delta 到达或轮次结束
   即清空」；`ChatView.tsx:459-462` 只清 slowHint，progressLine 到 finally 才清。
4. **(c) REPL 进度行会与答案抢同一行** — `repl.ts:79-81` 用 `\r` 覆盖 stderr 行，首个 delta 写 stdout
   前不清行；真 TTY 下答案接在进度行尾部，轮末写 64 空格可能抹掉答案首 64 字符。
5. **(b) 未被要求的开关与死导出** — `REPOQA_CHAT_PROGRESS=1/0` 让非 TTY 也输出进度（与 spec
   「非 TTY 时静默」相反）；`CHAT_PROGRESS_EVENTS` 无消费方。
6. **(c) HANDOFF 预称不存在的评审报告** — `HANDOFF.md:12` 指向本报告，写作时文件尚不存在。
7. **(c) `isTimeoutError` 过宽** — 同上（provider message 误判）。

### 最严重问题

第 1 条为 P1：180s 硬超时的用户可见收益实际落地为英文原文，且新错误码绕过单一源契约与两道门禁。

---

## 处置（Lead 复核后）

| # | 轴 | finding | 处置 |
|---|---|---|---|
| S1 | Standards | `chat_llm_timeout` 三处缺 + 门禁绕过（硬违规） | **已修**：`ERROR_CODES` 加码、`ERROR_COPY` 补人话文案、`CONTEXT.md` 表加码；`routes.ts` 改用 `ERROR_CODES.*` 常量（不再有字面量）；guard 增 `CODE_TERNARY_RE` 三元形状扫描 + 自检用例 |
| S2 | Standards | `cleanupTurn` 后置声明 / 缩进 | **已修**：改 `function cleanupTurn()`（提升）+ 缩进归位 |
| S3 | Standards | `isTimeoutError` 嗅探 message | **已修**：只认 `err.name === 'TimeoutError'`（AbortSignal.timeout 的单一判别源） |
| S4 | Standards | 同一事件两份中文文案表 | **部分（裁决）**：CLI 与 Web 是两个消费端，终端文案独立维护（不共享 Web 源码）；已写入 ADR-0024，事件/阈值仍是同一契约。REPL 改逐行输出，避免与 stdout 覆盖 |
| S5 | Standards | `CHAT_PROGRESS_EVENTS` 死导出 | **已修**：删除 |
| S6 | Standards | 探针 frameBytes 错算 | **已修**：`\n` 修正后重测 slow **2.1%**（396B）、tool **2.5%**（705B） |
| S7 | Standards | `freePort` 第三份复制 | **deferred**：抽公共件需同时动 ui_smoke/readme-shots，收益低于改动面；登记 |
| S8 | Standards | 测试 import 位置 / CONTEXT 0018 / ticket-spec status | **已修**：import 归顶、0018 恢复、票 06 与 spec 收口时置 done |
| P1 | Spec | `chat_llm_timeout` 三处缺（同 S1） | **已修**（同 S1） |
| P2 | Spec | done 权威性 + 未知事件单测缺失 | **已修**：RepoQAClient 测试新增「done 后迟到 progress/heartbeat 不改终态」「真正未知事件忽略」两条 |
| P3 | Spec | 首个 delta 后进度行未清 | **已修**：`onDelta` 首字即 `setProgressLine(null)`；新增「delta 到达后进度行退场（busy 仍真）」测试 |
| P4 | Spec | REPL `\r` 覆盖与答案抢行 | **已修**：改逐行写 stderr（不再覆盖）；探针实测 3ms 出进度、20.4s 后 delta |
| P5 | Spec | 未要求的 env 开关 / 死导出 | **部分**：死导出已删；`REPOQA_CHAT_PROGRESS=1/0` 保留但明确为**显式调试覆盖**（默认仍 TTY 门控），已写入 spec/ADR |
| P6 | Spec | HANDOFF 预称报告 | **已修**：本报告即该文件 |
| P7 | Spec | `isTimeoutError` 过宽 | **已修**（同 S3） |

## 复核（修复后重跑）

- `packages/contracts` / 控制面 / web typecheck **零错误**；
- `src/chat/` + `error-code-guard`：**32/32**；web 定向（ChatView / RepoQAClient / errorCodes / copy-guard）：**76/76**；
- 全量门禁与 e2e/UI smoke 读数见 CHANGELOG `[1.8.0]`（本报告收口时复跑）。
- 探针：slow maxGap 5,014ms、heartbeat 4、hint 1、wire 2.1%；tool progress 5、wire 2.5%；
  REPL 强制进度路径 3ms 出「· 模型思考中（第 1 步）」。

## 两轴小结

- **Standards**：7 条（1 硬违规 + 6 judgement call）。最严重 = 新错误码绕开三处同动契约且绕过扫描哨；
  硬违规已修，judgement 修 5 / 部分 1（CLI 文案独立，记为裁决）/ deferred 1。
- **Spec**：7 条。最严重 = 180s 硬超时的「人话引导」端到端落空；6 项已修、1 项部分（env 开关转为显式调试覆盖）。
