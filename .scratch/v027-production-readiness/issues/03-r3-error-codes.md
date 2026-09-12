# 03：R3 — 错误码契约五面 + chat 人类化（销 V27-12）

> *Parent spec 同上（Q4）。*

Status: closed
标签：enhancement / P1 / 来源：生产就绪度评估 差距5 + V27-12

## Agent Brief

**用户场景：** chat 后端 404 把 `unknown session` 英文裸传进 UI，用户看不懂也退不出。修复后：五高频面（chat、gate run、import/reindex、file/raw、delta）响应带稳定 `code`；ChatView 按 code 映射中文文案+下一步指引；错误码表在 `CONTEXT.md` 可查。

**Summary:** 后端五面 `{error,code}`（code 枚举表进 spec 附录/CONTEXT.md）；前端 `errorCodes.ts` 映射 + ChatView catch 人类化（过 copy-guard 七词黑名单）；`internal_error`/`network_timeout`（R1/R2 已立码）并入同表。

**Acceptance:** 每面 code 断言 + ChatView 中文文案测；既有 `{error}` 字符串测试随改列清单。

**R1 review 移交（P2-5，存量）：** `chat/routes.ts:178,183,185` 非流分支把 `agent.runSerialized` 原始 reason 裸 `res.status(500).json({error: reason})` + `send('error')` 上线且未过 `maskEventPayload`（LLM provider 报错常回显 URL/参数）——R3 收编：chat 域错误出网站点统一掩码+挂 code。

**R2 review 移交（P2-1/P2-6）：** 前端渲染层对 `NetworkTimeoutError`（code='network_timeout'，URL 在 err.url 不在 message）给人类化文案「服务无响应（可能后端未启动）」+重试指引；`url-userinfo` 掩码上线后 chat 错误文案可复用同一 code 表。

Blocked by: R1

## Comments（2026-09-12 实施收口）

- 五面挂码（28 个稳定码，CONTEXT.md 新增「Error Code Contract」权威表）：requireRepo 收口 `repo_not_found` 全仓共享；import/preview/clone/delete·reindex 409/file-raw 四面；delta/gate 票 14 家族（`{error, detail, code}` additive，e2e 键读不受影响）；chat 全分支。
- chat 人类化（V27-12 销）：前端 `client/errorCodes.ts`（ApiError/ERROR_COPY/describeError——有码中文指引+原始错误保留，无码原样透出零发明）；ChatView 四 catch 全走映射。
- 掩码收口（R1 review P2-5 销）：chat_run_failed reason 三出口（SSE 帧/500 JSON/入库 note）过 maskSensitiveText；routes.test 新增 6 例=三出口全钉（含帧级 JSON 形状与 ghp_ token 早炸 500 分支）。
- Reviewer-Security P1×2 修：**P1-1 前端断链**——createSession/switchModel 改抛 ApiError 带码；`messages()` 原来 404 静默渲染空会话（chat_session_not_found 最典型路径不可达）→ 现带码 fail-loud；**P1-2 掩码侧门**——agent.ts 工具错误原文进模型上下文可经合成轮回声绕过三出口 → 入口过 maskSensitiveText。P2×4 修：reader.cancel、copy-guard 词表升格共享权威源 `client/copyBlacklist.ts`（两哨同表防漂移）、四 catch 原文出库补掩码、测试形状强化。
- **V27-21 入册**：maskSecrets 弱三件套（成功路径工具结果）与 maskSensitiveText 全套不同尺——需专票统一（golden eval 冻结集按旧行为钉，不可静默换尺）。
- 门禁：cp 603/603、web 349/349、双 tsc 净、build、e2e 60/60。
