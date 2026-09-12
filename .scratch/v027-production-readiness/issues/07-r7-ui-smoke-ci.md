# 07：R7 — UI 冒烟进 Release 门（stub LLM、真 chromium、三链路+韧性断言）（销 V27-13）

> *Parent spec 同上（Q3/Q8）。本批收口锁。*

Status: closed
标签：test / P1 / 来源：V27-13（chatGuardSend P0 存活两天，330 测全绿零拦——mock 不校验参数、e2e 绕前端层）

## Comments（2026-09-13 实施收口）

- 落地：`scripts/smoke/ui_smoke.mjs`（真 chromium 四段：选库 / AskDock→chat / 门禁真跑 / 杀后端重启）+ `stub-llm.mjs`（OpenAI-SSE 假 endpoint，只服务 /v1/chat/completions，300ms 帧距 ≫ 服务端 40ms 批帧窗）；挂 `release.yml`（E2E 门后，步骤 timeout-minutes:12，PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD 防三浏览器全拉）。
- 两段式流式钉（R7 review P2-1）：先见「前缀无全文」中间态再等全文——done.answer 兜底不可能产生中间态，「渲染必经 SSE delta 通路」从此有证据；韧性断言=未刷新的页面经 MutationObserver 捕到 WS 索引进度帧（锁 R2 重连），落定信号走服务端 status（进度条残留系 V27-23 在册缺陷，已在注释互引）。
- 凭据红线：唯一 key 字面量为显式假占位（stub 不校验 authorization），git 身份用 .invalid TLD，COPILOT_ENV_FILE 指向不存在文件杀穿 ~/.compass-copilot 候选；review 轴1 零发现。
- Reviewer-Security P0/P1：P1-1=记账面（本 Comments+销项补齐）；P2×8 全收：stub 404 纵深、finally signalCode 挂死防、失败必 dump stderr、端口抢占换 port 重试、git -c gpgsign/hooksPath 隔离、POST /api/repos 5min 硬超时、--no-sandbox 删除（ubuntu runner 无需）、waitForSelector 化（domcontentloaded 不抢跑）。
- 本地验证：3 轮 PASS（修前 1 轮暴露 domcontentloaded 抢跑并当场修）。
- CHANGELOG 0.27.0 条目留收口批（V27-13 划除已随本票完成）。

## Agent Brief

**Summary:** 新 `scripts/smoke/ui_smoke.mjs` + `scripts/smoke/stub-llm.mjs`（本地假 OpenAI/SSE endpoint，env `REPOQA_LLM_BASE` 注入，零 token 零外网零凭据字面量）；真 chromium（Playwright）跑：①选库→canvas/侧栏；②AskDock→chat→stub 回答渲染出流式文本+非错误态；③门禁运行出结果；④韧性：杀后端重启→断言 WS 重连+UI 刷新恢复（锁 R2）。挂 `release.yml` 作发布门（本地先跑通）。

**Acceptance:** 本地一键跑通（复用 `ui1-shots.mjs` bootstrap 模式与 TMPDIR=D 盘惯例）；CI 步骤文档化；Reviewer-Security 过「零凭据/不泄 URL」轴。

Blocked by: R1, R2, R3, R4
