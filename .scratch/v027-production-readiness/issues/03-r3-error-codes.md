# 03：R3 — 错误码契约五面 + chat 人类化（销 V27-12）

> *Parent spec 同上（Q4）。*

Status: open
标签：enhancement / P1 / 来源：生产就绪度评估 差距5 + V27-12

## Agent Brief

**用户场景：** chat 后端 404 把 `unknown session` 英文裸传进 UI，用户看不懂也退不出。修复后：五高频面（chat、gate run、import/reindex、file/raw、delta）响应带稳定 `code`；ChatView 按 code 映射中文文案+下一步指引；错误码表在 `CONTEXT.md` 可查。

**Summary:** 后端五面 `{error,code}`（code 枚举表进 spec 附录/CONTEXT.md）；前端 `errorCodes.ts` 映射 + ChatView catch 人类化（过 copy-guard 七词黑名单）；`internal_error`/`network_timeout`（R1/R2 已立码）并入同表。

**Acceptance:** 每面 code 断言 + ChatView 中文文案测；既有 `{error}` 字符串测试随改列清单。

**R1 review 移交（P2-5，存量）：** `chat/routes.ts:178,183,185` 非流分支把 `agent.runSerialized` 原始 reason 裸 `res.status(500).json({error: reason})` + `send('error')` 上线且未过 `maskEventPayload`（LLM provider 报错常回显 URL/参数）——R3 收编：chat 域错误出网站点统一掩码+挂 code。

Blocked by: R1
