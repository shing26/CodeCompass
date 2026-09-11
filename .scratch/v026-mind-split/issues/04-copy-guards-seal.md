# 04：A04 — 文案回归哨总闸 + 两视口截图核对（人工项为阻塞）

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch/v026-mind-split/spec.md`（验收门封条）；沿用票 15 的文案回归哨模式。*

Status: closed
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

## Comments

### 自动化部分完成（2026-09-11，ZCode）——剩人工核对阻塞

- **文件系统哨**：新建 `src/copy-guard.test.ts`（3 例）——①七词黑名单（推演卡/拆除计划/约定冲突/架构指标/智能体对话/读侧/写侧）对 `src/**.{ts,tsx,css}` 全文件行级 grep **零命中含注释**（哨自身词表拆分构造自豁免）；②侧栏英文 `Evolution` 节标题按 DOM 位点断言（标识符豁免）；③三定位句源码字面量存在钉（tooltip/空态/PlanCard 头部/Canvas 两动词/evolve 底线，防组件重构连带蒸发）。机械判据升级为「普通 grep 即可复核，无豁免行」。
- **自命中面重构**：TopBar.test（注释+regex）、EvolutionView.test（regex）、Canvas.test/PlanCardView.test（负断言字面量）、styles.css（注释引旧名）共 6 处改拆分写法。
- tsconfig 对 copy-guard 单独 exclude（浏览器 tsconfig 无 node types，不为此引 @types/node 依赖；vitest 转译照常执行）。web **320/320**（+3 哨例）、tsc 净。
- **截图台**：`.scratch/v026-mind-split/qa/a04-shots/`（gitignored）——`rig.mjs`（真控制面+真 db+dist 首用样式，6 面 × 375/1280 = **12 张 PNG 已产出**，零 pageerror）+ `overflow-check.mjs`（DOM 级截断机械测量：两视口四面 **ALL-CLEAN**，另核验空态两动词锚点真实命中非空选择器假绿）。重跑：`MHW_CP_PORT=43119 MHW_STATIC_DIR=apps/repoqa-web/dist node services/control-plane/dist/cli.js` 后 `node rig.mjs`。
- **移交登记**（A01/A02/A03 review 累积，归本闸裁决）：①「查调用链」按钮名实残差（接线仅 setView('topo') 不自动 trace；(i) 导航措辞或 (ii) 升级接线+重命名 open-chat 标识符）；②risk 色族跨视图统一（gate 红橙灰 vs delta 黄蓝绿）；③gate payload 渲染上限；④styles.css 首次生效=chat 视觉首秀，**眼验重点在 chat 侧栏/消息区排版是否成立**。

### 人工核对清单（maintainer 已完成，2026-09-11 回「A04 过」）

看图目录：`D:\CodeCompass\.scratch\v026-mind-split\qa\a04-shots\`

- [x] `empty-state-375.png`：两动词前置结构在窄屏不溢出、行不破版
- [x] `chat-375.png` / `chat-1280.png`：**chat 样式首秀**——侧栏/空态/底线句完整，视觉成立
- [x] `gate-375.png` / `gate-1280.png`：三段布局、策略旋钮两列在 375 的堆叠
- [x] `evolve-375.png` / `evolve-1280.png`：ScenarioGuide ①②③ 新措辞 + 「风险 Checklist」混排（uppercase 已去，眼验最终呈现）
- [x] `topo-375/1280.png`：侧栏「规范演进」门牌与 tab 同文
- [x] `dashboard-375/1280.png`：「查调用链」按钮宽度自适应

### 人工核对完成（2026-09-11，maintainer 回「A04 过」）

- 12 图眼验通过（含 A02 移交重点：styles.css 首次生效的 chat 视觉首秀排版成立、A03「风险 Checklist」混排无 CHECKLIST 全大写）。票 15 遗留的两视口核对动作就此销账。
- **四项移交裁决**：① 「查调用链」名实残差——保留现名（比旧名「提问」净改善；导航措辞升级/`open-chat` 标识符重命名属独立改动，随 A 系列已发版冻结，移交 v0.27）；② risk 色族跨视图统一（gate 红橙灰 vs delta 黄蓝绿）→ v0.27 立小票；③ gate payload 渲染上限（超大 run 全量进 DOM）→ v0.27 立小票；④ chat 视觉首秀 → 本次核对已验，closed。本票 closed，A 系列收官。

**Acceptance criteria:**
- [x] 用户可见文案黑名单零命中自动化（copy-guard.test.ts，文件系统级含注释）
- [x] 存在断言：三句定位句锚点在位（哨③钉源码字面量 + 票 01/02 组件测试钉渲染）
- [x] 全前端 src grep 复核（哨即自动化本体；dist 已重建非旧快照）
- [x] **[阻塞项·人工] 375px + 1280px 截图核对**——12 图已由 maintainer 眼验通过（2026-09-11「A04 过」），见上清单逐项勾记
- [x] web 全量绿（320 = 284 基线 + A01–A04 增量）
