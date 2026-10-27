# 票 06 — 收口 v1.8.0

Status: pending

## 做法

1. 双轴 code-review（fixed point = v1.7.0 `41c4de5`）→ 报告 `docs/reports/`；
2. 共享区一次性收口：版本五处 → 1.8.0、CHANGELOG `[1.8.0]`、README 路线图 **勾选 R5-05**、
   HANDOFF §4 第 7 项销项（留证据链接）、CONTEXT Status 更新；
3. 门禁全跑：typecheck / 控制面 / web / bridge 单测 / e2e（只增断言）/ UI smoke（只增进度断言）；
4. 验收读数表（票 01 基线 vs 修后）进 CHANGELOG 或 HANDOFF；
5. tag `v1.8.0` 与发布沿用 [v1.7 的发布清单](../../v1.7-artifact-browser-gate/release-checklist.md)（工件门不涉及本批）。

## 验收

- 双轴评审无 P0/P1；e2e 断言只增不删；R5-05 在 README/HANDOFF 双处销项；
- 版本五处一致、CHANGELOG 顶部 = `version.ts`、`/health` 回显一致；
- 发布脚本模板复用（bump 到 1.8.0 时改两处版本串）。

## Comments

- 2026-10-27 完成。版本五处 1.8.0、CHANGELOG `[1.8.0]`、README（版本徽章 / ADR 表 24 份 / 质量门禁 /
  roadmap 勾 R5-05 + v1.8.0 行）、HANDOFF（v1.8.0 段 + §4 第 7 项销项）、CONTEXT（24 ADRs + 当前 1.8.0）。
- 断言只增：e2e 73→74（「fallback 不得声称进度」反向封条）；UI smoke 新增「服务端进度行出现」。
- 双轴评审 `docs/reports/code-review-2026-10-27-v18.md`：硬违规 1 已修（错误码三处同动 + guard 三元形状），
  judgement 修 5 / 部分 1 / deferred 1；Spec 修 6 / 部分 1。
- 门禁（本机实跑）：cp **907/72**、web **441/41**、bridge 26、e2e **74/0**、UI smoke PASS、typecheck 0。
- 发布沿用 v1.7 的 [release-checklist](../v1.7-artifact-browser-gate/release-checklist.md)；
  `D:\zcode-tmp\publish-1.7.0.cmd` 换版本号即可复用（登录 → publish → 校验）。
