# Issue 10 — 探针重跑并入库原始记录

> 依据：审计 v2 §4.3 称 `scripts/out/mcp-model-in-the-loop.json` "是**占位**不是能力证据"
> 波次：波 3 ｜ 状态：**deferred（2026-09-29）——重跑挂起于 provider 402（额度）；指针诚实化已落地** ｜ 依赖：无 ｜ 半批：B 证据诚实
> 决策依据：spec §7.1（**重跑并入库**）

## 1. 现状（实测，含三处纠正）

| 事实 | 实测 |
|---|---|
| 该 JSON **从未入库** | `.gitignore:53` 忽略 `scripts/out/`；v0.21 评审时已 `git rm --cached`（`docs/reports/code-review-2026-09-21.md:69` 记"现场修毕"）→ `git ls-files scripts/out/` = **0** |
| 行数 | **10 + 10**（`toolChoiceRows` + `selfHealRows`），**不是** 17 |
| 现存那份是**后一次 `budget 0` 运行**覆盖的产物 | `callsUsed: 0 / callBudget: 0`，每行 `note: "call failed: call budget 0 exhausted"`（`generatedAt 2026-09-21T18:35:32Z`） |
| 真正入库的是**报告** | `docs/reports/mcp-self-heal-and-tool-choice-2026-09-21.md`，且**如实**：调用量 20/20、n=10/n=7 限制、明确拒绝因有数字就把 E-M2 升分、并自查"指令污染"（5/6 误选 `list_repos` 其实是在执行 `MCP_SERVER_INSTRUCTIONS` 第一步） |
| **真实缺陷** | 报告 `:6` 写"**原始记录**：`scripts/out/mcp-model-in-the-loop.json`"——指针**悬空**（那里现在是 budget-0 的产物）。照指针去取会读到"工具全失败" |

## 2. 落地

1. **重跑**：`node …/tsx/dist/cli.mjs scripts/eval/mcp_model_in_loop.ts --budget 20`（需 `.env` 的 `REPOQA_LLM_*`；含自愈轮）。
2. **产物入库到 `docs/reports/`**（与报告同目录，如 `docs/reports/mcp-self-heal-and-tool-choice-2026-09-21.raw.json`），报告与产物**双向链接**。
3. **硬约束（防"迁就旧数"）**：若重跑数字与原报告不一致，**按实测更新报告正文**（含限制与口径段落），**不得沿用旧数**；报告中写明重跑日期与模型。
4. 报告 `:6` 的"原始记录"改为指向入库产物，并注明 `scripts/out/` 是**本地未跟踪产物、会被后续运行覆盖**。

## 验收（机器可验证）

1. 入库产物存在且 `callsUsed > 0`、`toolChoiceRows` 覆盖 17 个工具、`selfHealRows` 非空。
2. 报告与产物的数字**逐项一致**（票内给出对照表：E-M5 自愈率、E-M2 工具选择率、参数键集率、剔除场景数）。
3. 报告 `:6` 的指针指向**入库路径**（grep 断言）；`scripts/out/` 仍在 `.gitignore`。
4. 报告含"重跑日期 + 模型 id + 调用量"三要素。

## Comments

- 2026-09-27 立项（原为"标 PLACEHOLDER"）；2026-09-28 按用户决策改为"重跑并入库"，并据实测更正审计的三处描述（未入库 / 行数 / 报告并非不诚实）。
- 成本说明：本票需 token 预算（量级 ~40 次调用，照原报告的 20+20）。
- 2026-09-29 **重跑尝试被 402 阻塞，部分落地 + 显式 deferred**（spec §6.1 允许非主命题票 deferred 登记）：
  - **已落地半**：报告 `:6` 悬空指针诚实化——明写 `scripts/out/` 是本地未跟踪产物、09-21 原始 JSON 已被 budget-0 运行覆盖丢失、入库原始记录待重跑产出；报告新增 §八（重跑尝试日志：日期/模型/调用量三要素齐备）。
  - **重跑结果**：17/20 次调用全部 `HTTP 402`（provider 额度耗尽，§六 状态延续）——**402 记录不构成有效测量，不入库当证据**（比悬空指针更糟的是伪证据）；§一/§二 的 09-21 数字仍是唯一有效测量。
  - **触发线（解冻条件）**：provider 额度恢复 → 按报告 §七 命令重跑 → 产物入 `docs/reports/` 与报告双向链接 → 数字不一致则按实测更新正文（不迁就旧数）→ 本票转正。
  - 挂账影响：验收 1/2/4 三条（产物入库/数字对照/报告三要素的"有效"版）随重跑一并结清；验收 3 的指针断言已提前满足（指针不再指向 gitignored 路径作权威记录）。