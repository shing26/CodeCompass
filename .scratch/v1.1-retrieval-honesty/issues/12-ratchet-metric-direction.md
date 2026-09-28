# Issue 12 — 棘轮指标方向与抽样口径入基线（pass/fail 零行为变更）

> 依据：本项目自己的报告原文——`docs/reports/scan-precision-baseline-2026-09-16.md:403` §13.1「孤儿桶因此变大 —— **代理指标方向与真实质量方向相反**」、`:414`「**判据纪律**：这张表是代理指标，本增量的正负号与它相反，必须以"假边条数"读进度」、`:71`「**抽样是 top-N，不是随机样本**……不能用它直接估计全桶假阳性率」
> 波次：波 1 ｜ 状态：**✅ 已落地（2026-09-28）** ｜ 依赖：无 ｜ 半批：E 搭车
> 性质：改共享门禁文件（`closeout_gate.py` + `ratchet-baseline.json`）→ **必须独立成票、先做、且 pass/fail 零行为变更**（否则 CI 一旦红无法二分定位）

Status: done

## 1. 问题（实证）

| 事实 | 证据 |
|---|---|
| 棘轮锁的是**孤儿比** | `ratchet-baseline.json`：`ratio: 0.1204` = `orphanTotal 236 / symbolCount 1960` |
| 门把它当**上限** | `closeout_gate.py:503-506` docstring："plus the **orphan-ratio ceiling** against a FROZEN baseline"；`ratioCeiling = ratio × 1.25 + 0.02` |
| 方向确实相反（实测） | 移除 1014 条按名猜出的**假边**后，lazygit 孤儿 **1807 → 1828（变大）**（CHANGELOG `[1.0.0]` / v0.31 票 21；非 ADR-0018） |
| 纪律方向也反 | spec §6.2 现措辞"只允许收紧需理由"——而对一个方向相反的指标，**放宽恰恰可能是改进**，却被当成需要辩护的例外 |

⇒ 合起来：**真实质量提升（假边减少）→ 孤儿比上升 → 可能越 ceiling 变红**，且纪律指向错误方向。

## 2. 落地（零 pass/fail 行为变更）

1. **`ratchet-baseline.json` 增字段**：
   - `metric_direction: "inverse"`（孤儿比）/ 预留 `"forward"`（未来正向指标）；
   - `sampling: "top-n"`（当前口径）。
2. **`check_precision_ratchet` 读这两个字段**，仅用于**改写失败提示**：
   - `inverse` 时提示复核者：*"本指标方向相反：升高可能是改进（假阴性转可见）。请以「假边条数」读进度；若确认为改进，用 `--ratchet-update` 并附证据。"*
   - 正向指标仍提示"回退"。
3. **判定公式与阈值一律不动** → 同输入同结果。

## 3. 与票 06 的关系

票 06 的门**必须读同一个 `sampling` 字段**，并在名称上收窄为「真仓 **top-10** 假阳性门」+ 显式"**不得外推全仓率**"（否则它会原样继承 top-N 抽样偏差）。

## 验收（机器可验证）

1. `--ratchet` 输出含**指标方向**与**抽样口径**两项。
2. 故意把 ceiling 调到现值以下 → 失败提示含"方向相反 / 以假边条数读进度"语（输出留档）。
3. **零行为变更证明**：同一输入下，改动前后 `check_precision_ratchet` 的 pass/fail 与 e2e 计数完全一致。
4. spec §6.2 的纪律措辞同步更新（正向只许收紧 / 反向放宽需证据）。

## 触发线

引入 `--sample seeded` 分层随机口径作为第二口径（报告 `:71` 已建议，harness 已输出该抽样）→ **重新冻结基线**，`sampling` 改 `stratified-random`。

## 验收实测（2026-09-28，终稿）

- [x] 验收 1：`npm run precision:ratchet` 新增一行 `[precision] metric=orphan-ratio direction=inverse sampling=top-n`（绿轮也打印）。gate 侧**绿轮 detail 与改动前同形**（`| self | 164/2060 | 8.0% | ok (ceiling 17.1%) |`）——按 §2.2「仅用于改写失败提示」，纪律信息不进绿轮记录。
- [x] 验收 2（门真的会红）：把基线 `ratio` 临时压到 `0.0001`（ceiling 2.0% < 现值 8.0%）→ 输出留档：
  `| self | 164/2060 | 8.0% | EXCEEDED (ceiling 2.0%) |` + `[precision] RATCHET FAILED:` + `[precision] 指标方向相反（inverse）：孤儿比升高可能是改进——假边/假阴性被修掉后孤儿变可见，请以「假边条数」读进度；若确认为改进，用 --ratchet-update 并附证据。`，退出码 **1**。
  - 复原后回绿：`ok (ceiling 17.1%)`、退出码 **0**、比值逐字节复原 `0.12040816326530612`（`git diff` 只剩本票的 note 扩展 + 两字段）。
  - 顺带复核既有不变量：**失败轮不刷新基线**（失败后 ratio 仍为被压下的 0.0001，未被自更新）。
  - gate 侧：失败 detail 由 `_precision_ratchet_hint` 从 harness 的 `[precision]` 行提取该提示（不重述文案，单源），伪 proc 用例覆盖「ceiling 红 → 取到提示行 / 仅不变量红 → 不取（空）」；`forward` 文案随 harness 分支一并生效。
- [x] 验收 3（零行为变更）：判定公式、阈值（`RATCHET_SLACK`/`RATCHET_FLOOR`）、`ok = ratio <= ceiling` 与 gate 侧 `returncode == 0` 判据**均未改动**（diff 可核）；改动前后 e2e 均 **71/0**、该条 check `ok=true` 且绿轮 detail 同形。两测之间 working tree 因本票自身变化 **+2 符号**（新增两个 gate 侧 helper；census 2058→2060，孤儿数不变 164），比值同为 **8.0%**。
  - 说明：`scripts/` 不在任何 `tsconfig.json` 的 include 内（本仓无覆盖脚本的 tsconfig），故该文件仅由执行验证 + 定向 `tsc` 探针核对（探针报的 8 处错误全在 ≤ :322 的存量区，本票编辑区无新增错误）。
- [x] 验收 4：spec §6.2 已加注「票 12 已落地：`ratchet-baseline.json` 带 `metric_direction`/`sampling` 字段，harness 与 `check_precision_ratchet` 按方向改写失败提示；票 06 **须**读同一 `sampling` 字段」，规则原文（正向只许收紧 / 反向放宽需证据）保持不动。

## Comments

- 2026-09-28 立项：外部评估列为 9 条风险之首（"现存 CI 棘轮会因改进变红，且纪律方向也反"），本仓复核其三处引文全部成立后立票。
- 本票是 spec §7.1「票 02 是否拆票」例外条款的适用对象：改共享门禁文件 → **拆出、先做、零行为变更**。
- 2026-09-28 落地：字段放在**基线顶层**（该文件的度量只有孤儿比一个，方向/口径是度量级而非样本级）；`metric_direction`/`sampling` 缺失时按本度量的已知性质回退（`inverse`/`top-n`），**不新增失败模式**。双面同读：harness 负责本地 `--ratchet` 输出与失败提示，`check_precision_ratchet` 负责 CI 记录的 detail 后缀（并通过 `e2e-result.json` 留证）。
- 2026-09-28 文件面：`scripts/precision/scan_precision.ts`、`scripts/precision/ratchet-baseline.json`、`scripts/e2e/closeout_gate.py`、spec §6.2（共享门禁文件本票独占，票 02 的 `check_eval_smoke` 改动随其票排队）。
- 2026-09-28 双轴评审后修正（均在提交前）：① gate 侧不再复写方向提示文案，改为从 harness 的 `[precision]` 行提取（单源，文案归 `scan_precision.ts`）——顺带补上 forward 分支在 gate 侧的提示；② 绿轮不再附加 discipline 后缀，回到 §2.2 的「仅用于改写失败提示」；③ `baseline.get()` 移入 `try`（基线若解析为非对象不再抛 `AttributeError` 把 gate 打死）；④ 方向解析改 fail-safe：仅显式 `forward` 走正向文案，未知/缺失一律按 `inverse`（打字错误不会翻成"回退"建议）。