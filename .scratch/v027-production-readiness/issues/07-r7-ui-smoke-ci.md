# 07：R7 — UI 冒烟进 Release 门（stub LLM、真 chromium、三链路+韧性断言）（销 V27-13）

> *Parent spec 同上（Q3/Q8）。本批收口锁。*

Status: open
标签：test / P1 / 来源：V27-13（chatGuardSend P0 存活两天，330 测全绿零拦——mock 不校验参数、e2e 绕前端层）

## Agent Brief

**Summary:** 新 `scripts/smoke/ui_smoke.mjs` + `scripts/smoke/stub-llm.mjs`（本地假 OpenAI/SSE endpoint，env `REPOQA_LLM_BASE` 注入，零 token 零外网零凭据字面量）；真 chromium（Playwright）跑：①选库→canvas/侧栏；②AskDock→chat→stub 回答渲染出流式文本+非错误态；③门禁运行出结果；④韧性：杀后端重启→断言 WS 重连+UI 刷新恢复（锁 R2）。挂 `release.yml` 作发布门（本地先跑通）。

**Acceptance:** 本地一键跑通（复用 `ui1-shots.mjs` bootstrap 模式与 TMPDIR=D 盘惯例）；CI 步骤文档化；Reviewer-Security 过「零凭据/不泄 URL」轴。

Blocked by: R1, R2, R3, R4
