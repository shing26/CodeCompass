# 04：A04 — 文案回归哨总闸 + 两视口截图核对（人工项为阻塞）

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch/v026-mind-split/spec.md`（验收门封条）；沿用票 15 的文案回归哨模式。*

Status: ready-for-agent
标签：test / P2 / 来源：v0.26 预留 A 验收封条

## Agent Brief

**Category:** test（A 系列验收封条；含一项人工核对阻塞）

**用户场景：** 改名这件事在本仓已经翻车两次（8ac9bea 轮改名漏网产生票 15，v0.25 QA 又抓出引导滞后）——如果没有一道"总闸"测试，三年后第三次改名照样漏。维护者/AI 实施后需要一个机械判据回答"旧词真的死干净了吗"；发布前需要有人眼确认 375/1280 两种子下新文案不溢出、底线句不截断（票 15 遗留未销的同一动作）。

**Summary:** 建 grep 级文案黑名单测试 + 定位句存在断言，并驱动两视口人工核对。

**Acceptance criteria:**
- [ ] 用户可见文案黑名单零命中自动化：`推演卡`、`拆除计划`、`约定冲突`、`架构指标`、`智能体对话`、`读侧`、`写侧`、侧栏英文 `Evolution` 节标题
- [ ] 存在断言：「问现状」「要方案」「引擎只读，改动由你执行」三句各自锚点在位（TopBar tooltip、ChatView/空态、PlanCardView 头部）
- [ ] 全前端 src grep 复核（dist/.mimosa 快照不算）
- [ ] **[阻塞项·人工] 375px + 1280px 两视口截图人工核对新引导排版（maintainer 执行，销票 15 遗留）；未完成前本票不得置 closed**
- [ ] web 全量绿（基线 = 284 + A01–A03 增量）

**Out of scope:** 任何新文案生产（只守不改）；e2e（纯前端面，无涉）。

**Blocked by:** 01-positioning-copy-sweep、02-plan-digest-cta、03-evolve-artifact-naming（全部合入后开工）。

**触碰面声明：** apps/repoqa-web 测试层为主。零后端、零新文案。
