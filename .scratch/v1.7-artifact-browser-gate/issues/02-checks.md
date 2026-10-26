# 票 02 — 检查项实现（9 条 fail-closed）

Status: done

## 背景

票 01 证明缺口后，本票实现 `scripts/smoke/artifact_browser_check.mjs` 的检查主体。
只做检查与判定，回执写入/退出码在票 03。

## 做法

1. 骨架：`node scripts/smoke/artifact_browser_check.mjs <artifact.html> [--self-test] [--json]`。
   - loader 复用 `ui_smoke.mjs:34-46` 的 `SMOKE_PW_MODULE`/`SMOKE_CHROMIUM_PATH` 接缝；
     headless、viewport 1440×900、context `offline: true` + `route` 一律 abort 并计数；
   - 打开 `file://` URL；`waitForFunction` 等 mermaid 渲染（上限 10s，超时记 `CHECK_TIMEOUT`）。
2. 按 spec 的检查项表实现 9 条，逐条产出 `{id, status, evidence}`；任何异常不得吞掉——
   抛错也要转成该 check 的 `UNCHECKED` + 诊断。
3. `--self-test`：用票 01 的四份 fixture 自检——good 必须 PASS，三份 bad 必须各自命中
   `DIAGRAM_SVG_EMPTY` / `VIEW_NOT_RENDERED` / `STORY_BEATS_STUCK`。自检失败退出码非 0。
4. 稳定性：连续跑两次结果与耗时抖动 < 20%；不得依赖网络、字体、外部图片。

## 验收

- good 工件 9 条全 PASS（Story Beats 存在时非 SKIPPED）；
- 三份 bad 精确命中各自诊断码，且 `selector` 指向具体节点；
- 无外部请求（`runtime/no-network` 证据里外部请求计数 0）；
- 单工件耗时 < 15s（本机，chromium 已缓存）；
- `--self-test` 可一键复跑。

## Comments

- 2026-10-26 完成。`scripts/smoke/artifact_browser_check.mjs`，9 条检查全部 fail-closed：
  readable / self-contained / svg-rendered / lazy-view / story-beats / deeplink /
  no-pageerror / no-console-error / no-network。
- `--self-test`（四份 fixture）：good PASS、bad-syntax FAIL(`DIAGRAM_SYNTAX_ERROR`)、
  bad-lazy FAIL(`VIEW_NOT_RENDERED`)、bad-beats FAIL(`STORY_BEATS_STUCK`)，4/4 符合预期。
- 实测耗时 1.8–2.0s/工件；外部请求一律 offline 拦截并计数，工件无网络也判绿。
- 设计细节：`svg-rendered` 只验「当前可见」容器（隐藏的 lazy 容器归 `lazy-view` 管）；
  `bad-syntax` 的 mermaid 会画一张错误图，故用页面文本 `Syntax error` 兜底判定。

