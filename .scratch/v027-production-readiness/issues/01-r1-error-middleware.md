# 01：R1 — 全局 error 中间件 + asyncHandler（JSON 500、堆栈不出网、request-id 贯穿）

> *2026-09-12 v0.27-B grill 拆票。Parent spec: `.scratch/v027-production-readiness/spec.md`。*

Status: closed
标签：bugfix / P1 / 来源：生产就绪度评估 差距1

## Comments（2026-09-12 实施收口）

- 落地：`http-error.ts`（requestIdMiddleware/asyncHandler/errorMiddleware）+ http.ts 装配（id 在 express.json 前、终端错误中间件居末）+ 13 处 async 处理器 codemod 包裹（analysis 6/repos 5/workbench 1/chat 1，闭合逐一核对）。
- 门禁：control-plane vitest 598/598（+4：R1×3 + 掩码×1）、tsc 净、build、e2e 60/60×2 轮。
- Reviewer-Security 处置：**P1-1** stderr 裸写 message/stack（测试实测 DSN 原样落行）→ 过 `maskSensitiveText` 双掩码；**P2-1** body-parser 4xx（413/415）被压 500 → 保真透传（`request_error` 码）；**P2-2** stderr 行契约零测试 → 新增 spy 测（requestId 关联+DSN 必掩）；**P2-3** headersSent 守卫软测 → 加单元级钉（next 被调、res 不碰）；**P2-4** preflight 无 id → 注释补设计意图。
- 顺带发现并补共享缺口：`maskSensitiveText` 原本不认 URL userinfo 口令（`postgres://u:p@h`）——新规则 `url-userinfo`（只掩口令、留 scheme/user/端口可诊断），masking 测试钉正向+误伤（普通 URL/端口不碰）。
- **P2-5 移交 R3**（存量：chat/routes.ts:178,183,185 原始 reason 裸上线未过掩码）。
- 插曲：首轮 e2e chat SSE 出 error 帧红——新 dist 直跑同题全绿（open→regenerate→citations→plan→done），定性为 LLM 端瞬时抖动非 R1 故障；R7 的 stub LLM 正是为消灭这类不稳定而立。

## Agent Brief

**用户场景：** 后端某个端点内部炸了，用户看到的是永远转圈（async rejection 悬挂）或一张泄堆栈的 Express 默认 HTML 页。修复后：任何未捕获异常都返回 JSON `{error,code:'internal_error'}` + `x-mhw-request-id` 头，堆栈只进日志。

**Summary:** Express 4 无全局 error 中间件（http.ts 现仅挡 entity.parse.failed）；async handler 未包 try 的 rejection → 悬挂。补：①`asyncHandler` 包装（routes 现存 9 处 async 全接）；②末尾 `app.use((err,req,res,next))`：已响应头则 next(err)，否则 500 JSON；③requestId 中间件（计数器+响应头）；④未捕获错误先 stderr 结构化 JSON 行（R5 后迁 sink）。

**Acceptance:** vitest——async throw→500 JSON 无 stack、sync throw 同、`x-mhw-request-id` 存在、已 send 后错误不双写；既有路由测试零红。全量门禁+Reviewer-Security。

Blocks: R3, R5, R7
