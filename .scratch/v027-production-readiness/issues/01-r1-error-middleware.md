# 01：R1 — 全局 error 中间件 + asyncHandler（JSON 500、堆栈不出网、request-id 贯穿）

> *2026-09-12 v0.27-B grill 拆票。Parent spec: `.scratch/v027-production-readiness/spec.md`。*

Status: open
标签：bugfix / P1 / 来源：生产就绪度评估 差距1

## Agent Brief

**用户场景：** 后端某个端点内部炸了，用户看到的是永远转圈（async rejection 悬挂）或一张泄堆栈的 Express 默认 HTML 页。修复后：任何未捕获异常都返回 JSON `{error,code:'internal_error'}` + `x-mhw-request-id` 头，堆栈只进日志。

**Summary:** Express 4 无全局 error 中间件（http.ts 现仅挡 entity.parse.failed）；async handler 未包 try 的 rejection → 悬挂。补：①`asyncHandler` 包装（routes 现存 9 处 async 全接）；②末尾 `app.use((err,req,res,next))`：已响应头则 next(err)，否则 500 JSON；③requestId 中间件（计数器+响应头）；④未捕获错误先 stderr 结构化 JSON 行（R5 后迁 sink）。

**Acceptance:** vitest——async throw→500 JSON 无 stack、sync throw 同、`x-mhw-request-id` 存在、已 send 后错误不双写；既有路由测试零红。全量门禁+Reviewer-Security。

Blocks: R3, R5, R7
