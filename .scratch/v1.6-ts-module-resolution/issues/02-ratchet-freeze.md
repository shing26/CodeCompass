# 票 02 — 三仓棘轮基线冻结

Status: pending

## 要做什么

票 08「立项必须先做」第 2 条：**改消解规则前先冻结三仓孤儿数 / 假边数基线，逐字节差异必须有解释**。

1. 用既有 precision harness 冻结三仓（`self` / `lazygit` / `petclinic`）的读数：
   `npm run precision -- --freeze`（harness 已有 `--freeze` 显式动作，落
   `scripts/precision/frozen/`；clone 目录由 `PRECISION_DIR` 控制，默认 `%TEMP%\cc-precision`）。
2. 记录基线口径：孤儿总数、假边条数、抽样种子、commit、抓取时间。
3. 写一份「本战役允许的变化范围」：Phase 1 只应改变 TS 跨文件绑定，**Go/Java 必须 0 差异**；
   self 的孤儿数允许上下浮动，但每条差异要能归因到消解。

## 为什么是硬前置

Phase 2 会把「静默绑定最早声明」改成 `SUSPECT`，读数一定变。没有冻结基线，就分不清
「消解生效」和「模型漂移」，也就无法兑现评审要求的逐字节纪律。

## 验收

- `scripts/precision/frozen/` 下三仓摘要入库，键白名单、零易变字段（沿用 v1.1 票 06 的格式）。
- 基线里 `lazygit` / `petclinic` 的读数在 Phase 1 前后**逐字节相等**（这条会成为票 05 的回归断言）。
- 失败即停：任一仓冻结失败（clone/索引炸）就先修环境，不带着"没量过"的基线进战役。

## Comments

- 2026-10-26 立项。注意：`ratchet-baseline.json` 目前只有 `self` 一条（v1.1 冻结），
  `samples` 需要补齐三仓或另立一份本战役专用基线，票内决定。
