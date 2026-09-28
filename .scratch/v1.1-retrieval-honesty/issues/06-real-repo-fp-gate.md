# Issue 06 — 真仓 **top-10** 假阳性门（账实一致，不 clone）

> 依据：审计 v2 指出"评估只覆盖合成夹具，`ratchet-baseline.json` 的 `samples` 只有 `self`，真仓假阳性无回归门"
> 波次：波 3 ｜ 状态：**已落地（2026-09-29）** ｜ 依赖：票 12（读其 `sampling` 字段）｜ 半批：B 证据诚实
> 决策依据：spec §7.1（D2 = 冻结摘要 + 手动复测；票 06 形态 = 账实一致 + 修口径）

## 1. 现状（实测，含三处定性纠正）

| 事实 | 证据 |
|---|---|
| 棘轮只跑 `self`，**是有记录的决定** | `closeout_gate.py:500` docstring："`self` only — CI has no lazygit/petclinic clones, and the ratio invariants do not need them." |
| 但真仓的判定与样本**都已入库** | `scripts/precision/verdicts/{lazygit,petclinic,self}.json`（各含 `_meta` + 逐条 `verdict`/`reason`）；原 dump 在 `scripts/precision/out/*.json`（**被 gitignore**） |
| **三仓 M1 现值全 100%** | `--score` 实测：self 10/10、lazygit 10/10、petclinic 10/10 |
| **CHANGELOG [1.0.0] 的 "40%" 已不可复算** | 该行写"**40%（09-25 重判，4/10）**…`npm run precision -- --score self` **可复算**"；今日复算得 **100%**。根因在 `verdicts/self.json` 的 `_meta`：票 22 落地后 **top-10 整榜换人**（原文 "Top-10 fully reshuffled by the issue-22 mechanisms … What floated up is a DIFFERENT population: test-only components/exports"）；旧 4 条真阳性已被 `54ae70b` 清掉 |

⇒ 三条结论：
1. **缺的是门，不是样本**；
2. **M1 是样本相关读数**：40% 与 100% 不是同一个人群，趋势叙述（100→90→40）被样本重排打断；
3. **CI 无 clone ⇒ 引擎不跑 ⇒ 本门抓不到引擎回归**，只抓编辑/一致性漂移。**不得含糊这一点。**

## 2. 本票要做的（不设假上限）

### 2.1 账实一致（机器可查）

- 新增**冻结摘要** `scripts/precision/frozen/{name}.json`：`{name, commit, top:[{filePath,line,symbol}…]}`，只在显式动作时重写（**易变字段 `measuredAt`/`elapsedMs`/`fileCount`/`metrics` 一律不入库**）。
- CI 检查（**零 clone**）：`frozen` 摘要的 keys ↔ `verdicts/*.json` 的 keys **完全一致**（多余的 verdict 键会被点名，如现在的 self 有 2 条历史残留键）；覆盖率守卫（分母可见、stale 标注）在 CI 中执行。
- 门名称收窄为「**真仓 top-10 假阳性门**」，票内与文档中显式写清 **"不得外推全仓率"**（引报告 `:71`）。
- 读票 12 的 `sampling: "top-n"` 字段，与 `metric_direction` 一并显示。

### 2.2 手动复测入发布清单

- v1.1.0 收口清单增一条：**发版前在有 clone 的机器上复跑 `--score`**，结果与 `frozen`/`verdicts` 的差异必须为空或有书面解释（这是唯一能触及引擎回归的环节）。

### 2.3 修口径（CHANGELOG / HANDOFF）

- CHANGELOG `[1.0.0]` 段的 M1 行加注：**该读数为样本相关，样本重排后不可比**；补三仓当前实测值（皆 100%）并说明"40%"对应的旧样本人群已随票 22 与 `54ae70b` 消失。
- HANDOFF 的精度段落同步。

## 验收（机器可验证）

1. CI 在**零 clone** 环境跑出账实一致检查（证明不依赖 clone）；故意删一条 verdict → 覆盖守卫报出宽度不足 → 红。
2. `frozen` 摘要在库里可读且不含易变字段（键白名单断言）。
3. **会红证明**：故意改一条 verdict 的 `verdict` 值 → 直方图漂移被报出 → 复原 → 绿。
4. CHANGELOG/HANDOFF 口径修正落地，且 `--score` 输出与文档所载数值一致（同轮核对）。
5. 门名与文档含"top-10／不得外推"字样（grep 断言）。

## Comments

- 2026-09-27 立项；2026-09-28 按 D2 与评估意见重写（去掉假上限、收窄命名、补手动复测与口径修正）。
- **诚实边界（必须留存于票内）**：本门不能发现引擎在真仓上的回归；那是发布前人工复测的职责。
- 2026-09-29 **落地**：
  - **冻结摘要（验收②）**：harness 新增 `--freeze` 模式（显式动作、需 clone 机的 dump）→ `scripts/precision/frozen/{self,lazygit,petclinic}.json` 入库——`{name, commit, sampling, metric_direction, top:[{filePath,line,symbol,verdict,class}]}`，**键白名单**（易变字段 measuredAt/elapsedMs/fileCount/metrics 一律不写，gate 断言）；`sampling=top-n`/`metric_direction=inverse` 从票 12 的 ratchet-baseline 拷贝。三仓 commit 钉：lazygit@c07f4d3 / petclinic@3858f9c / self@c88a206。
  - **CI 门（验收①③⑤）**：`closeout_gate.py::check_precision_frozen`——frozen↔verdicts 双向键相等（残留键点名）、逐键 verdict 值相等（漂移点名）、frozen 键白名单、无 clone；门名即「真仓 top-10 假阳性门（账实一致，零 clone，不得外推全仓率）」；**会红证明在案**：改一条 verdict 值 → drift 红；删一条 verdict 键 → unjudged+drift 红；复原 → 绿（字节级还原验证）。e2e 71 → **72**。
  - **残留键清理**：self 的 2 条历史残留键（`brand-marks.ts:182`、`mermaidGraph.ts:51`，top-10 换血后离榜的旧判定）删除，理由写入 verdicts `_meta.note`（判定史在 git）。
  - **口径修正（验收④）**：CHANGELOG `[1.0.0]` M1 行加「样本相关读数」注（40% 旧人群随票 22+`54ae70b` 消失、三仓现值皆 100%、进度以假边条数读）；HANDOFF §4 加同款口径注；HANDOFF §2.1 门禁基线 739/71 → **770/72**（控制面含票 03/04/05/08 新测）；v1.1 spec §6.1 收口清单增「发版前在有 clone 机器复跑 `--score`，差异为空或有书面解释」。
  - 全量门禁 **72/72**。