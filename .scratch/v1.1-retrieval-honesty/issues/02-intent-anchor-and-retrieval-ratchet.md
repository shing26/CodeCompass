# Issue 02 — `intent-anchor` 补非 Java 题 + 豁免位 + 检索棘轮（**先红**）

> 依据：ADR-0002 的翻案门槛原文——*"embedding 只有在 golden dataset 证明关键词检索无法达到验收阈值后再引入"*。该条款**只有 1 条样本、从未被检验**；本票是生产该证据的**唯一合法动作**
> 波次：波 2（**波 2 的门**）｜ 状态：**✅ 已落地（2026-09-28）**——前红形态已建、豁免 4 题在册；**转正属票 04** ｜ 依赖：无（票 03/04 依赖本票）｜ 半批：A 主命题
> 决策依据：spec §7.1（D1 = 豁免位 + 复测棘轮；棘轮范围 = **9 桶全冻结**）

Status: done

## 1. 现状（实测）

- `intent-anchor` 桶共 **5 题**（`eval/repoqa-eval.ts:370-375`，夹具 repo-d）：`intent-1..5`。
- `intent-2..5` 的 query 是**精确标识符**（`doLike` / `likePost` / `transfer` / `legacyPing`）→ 走 `findSymbol`，**不经 chunk**。只有 `intent-1`「用户点赞」依赖 chunk。
- 夹具里唯一能被命中的 chunk 是 `/** 用户点赞主流程 */`；同夹具 `web/src/PostList.tsx` 产出 **0 chunk**。
- **夹具真实语言分布（实测，纠正一处外部数字）**：`repoqa-eval.ts:172` 是**内联定义**的字符串键夹具（运行时物化）——≈ **20 个 `.java` + 1 个 `.tsx`（`web/src/PostList.tsx`）+ 1 个 `.md`** + 2 个 xml + 1 个 yml；**Go = 0**。

⇒ 缺口在夹具里，只是从来没被问过。**但 `.tsx` 只有一个**，所以 3–5 道新题若全挂它，一个文件改动会同时影响多题 → 读数抖动。

## 2. 本票要做的三件事

### 2.1 补题（含夹具扩样）

1. 在 repo-d 夹具**补 1–2 个 TSX 文件**（夹具扩样属"生产证据"，见 spec §6.5），使新题**彼此独立**。
2. 补 3–5 道**非 Java 自然语言**题，答案落在 **TS/TSX 注释/docstring** 上。
3. 约束：**同一文件最多 2 题**。

### 2.2 豁免位（xfail 形态，master 恒绿）

- eval 支持 **per-question 豁免位**：豁免题**计入桶的题数**、但**不计入 gate 阈值**，并在报告里**单列实测命中率**（预期 0/4）。
- `check_eval_smoke`（`closeout_gate.py:2024`）判定**不变**（`passed===true` + 全桶 ≥85）→ **CI 不红**。
- 新题在票 04 落地后**同一 commit 内**转为正式题（去掉豁免位）。

### 2.3 检索棘轮（9 桶全冻结）

- 新增检索基线（形如 `scripts/eval/retrieval-baseline.json`，与 `ratchet-baseline.json` 同款 `note` 纪律）：
  - 冻结**全部 9 桶**的 `recallAtK` 现值 + 三个零幻觉桶的 `hallucinationRate`（0%）；
  - 冻结 `intent-anchor` 的**题数与豁免数**：题数只增、**豁免数只减不增**、收口时豁免数须为 **0**。
- `check_eval_smoke` 读该基线：任一桶低于冻结值 → 红。
- **纪律方向**：检索 `recallAtK` 是**正向**指标 → 只允许"收紧需理由"；放宽须在本 spec 追加记录。

## 3. "先红"的证明方式（两种形态都要，别混为一谈）

| 形态 | 做法 | 用途 |
|---|---|---|
| **真红** | 在分支上**临时不加豁免位**跑一次 gate，记录"桶 <85 → gate 红"的原始输出 | 证明这道门**真的会红**（spec §6.3 纪律） |
| **可见的红** | 豁免形态下报告单列"新题实测 0/4 命中" | 让缺口在**每一次**评测里可见（不靠一次性留档） |

> ⚠️ 不要在 spec/票里写"CI 会先红一段"——**与豁免位互斥**。master 恒绿是本票的设计前提。

## 验收（机器可验证）

1. 该桶题数 ≥ **8**；新题为非 Java 自然语言（票内列出 query 与期望锚点）；**同一文件 ≤ 2 题**。
2. 新题在票 04 之前**实测命中 0**（输出留档本票 Comments）；同时留档一次"去豁免后 gate 真红"的输出。
3. 报告含新题单列命中率字段；`check_eval_smoke` 的 pass/fail 与改动前同输入同结果（豁免题不进阈值）。
4. 棘轮：故意把某桶 `recallAtK` 判据改坏 → 门红 → 复原 → 绿；豁免数从 4 起、只减不增。
5. 其余 8 桶 `recallAtK` 不降（现全 100%）。
6. 转正后（票 04 落地）：该桶 `recallAtK ≥ 85`，豁免数为 0。

## 落地清单（2026-09-28，验收 1 要求的题面与锚点）

夹具扩样（`repoqa-eval.ts` 的 repo-d，**新增**文件、既有文件一字未动）：

| 文件 | 符号 | JSDoc 里的答案短语 |
|---|---|---|
| `web/src/LikeButton.tsx`（新增） | `LikeButton` / `throttleLike` | 「点赞按钮的乐观更新…」/「连续点击的防抖…」 |
| `web/src/CommentBox.tsx`（新增） | `autosaveDraft` / `filterComment` | 「评论草稿自动保存…」/「评论提交前的敏感词过滤…」 |

新题（4 道，全部 `exempt: true`；同一文件 2 题，符合上限）：

| id | query | 期望锚点 | 归属文件 |
|---|---|---|---|
| intent-6 | 点赞按钮的乐观更新 | `LikeButton` | LikeButton.tsx |
| intent-7 | 连续点击的防抖 | `throttleLike` | LikeButton.tsx |
| intent-8 | 评论草稿自动保存 | `autosaveDraft` | CommentBox.tsx |
| intent-9 | 评论提交前的敏感词过滤 | `filterComment` | CommentBox.tsx |

query 与夹具中的任何标识符零重叠，只能靠 doc-chunk 桥接命中——这正是被测的覆盖缺口。

机制与门（`repoqa-eval.ts` / `scripts/eval/retrieval-baseline.json` / `closeout_gate.py`）：

1. **豁免位**（xfail 形态）：`EvalQuestion.exempt`；逐题处理照常计入 `total`，随后把该题的 `matched/expected/anchors/invalid/hallucinated/latency` 增量**回滚**出桶并转入 `exempt*` 计数 → 阈值输入不受影响；报告新增 `bucket.exempt = {total, recallAtK}`（实测命中率单列），`eval.bucket` 事件同步携带。
2. **检索棘轮**：`scripts/eval/retrieval-baseline.json`（`metric_direction: "forward"`）冻结 9 桶 `recallAtK=100` + 三零幻觉桶上限 0 + `intentAnchor {questions: 9, exempt: 4}`；`check_eval_smoke` 读它做四条判定（逐桶 recall ≥ 冻结值 / 幻觉 ≤ 上限 / 题数只增 / 豁免只减），**基线缺失或畸形 = fail-closed 红**。
3. 计数同步：97 → **101**（gate 的 `totalQuestions` 下限与检查名、`repoqa-eval.test.ts`、`repoqa-http.test.ts`）；`intent-anchor` 桶 5 → 9。

## 验收实测（2026-09-28）

- [x] 验收 1：该桶题数 **9 ≥ 8**；新题均为非 Java 自然语言（上表列出 query 与期望锚点）；每文件 ≤ 2 题（LikeButton.tsx 2、CommentBox.tsx 2）。
- [x] 验收 2（两种"红"都留档，逐字）：
  - **可见的红**（豁免形态、master 恒绿）：eval 原始 JSON 的 `"exempt": { "total": 4, "recallAtK": 0 }`（intent-anchor 桶，`"total": 9`），门禁行尾逐字 `— … | ratchet=ok | intent-anchor=9q/4exempt`——即新题 **0/4** 命中，每次评测都可见（非一次性留档）。
  - **真红**（临时去掉 4 个豁免位跑门禁检查）：`[FAIL] golden eval passes every threshold (incident/evolve-intent/convention hallucination 0%) — … intent-anchor=56% … | ratchet=intent-anchor: recallAtK 56% < frozen 100%; intent-anchor: baseline freezes 4 exemptions but the report carries no exempt tally (did the report field vanish?)（forward 指标：低于冻结值即回退，须修复；放宽须在 spec 追加记录） | intent-anchor=9q/0exempt`（5/9=56% < 85%，门真的会红）；复原后 `[PASS] … intent-anchor=100% … | ratchet=ok | intent-anchor=9q/4exempt`。
  - **fail-closed 追加取证**（评审发现后补）：把基线临时缩成 `{"note": …, "metric_direction": "forward"}` → `[FAIL] … | ratchet=baseline is missing the recallAtK map; route-chain: scored but not frozen in the baseline; …（9 桶逐个）; baseline is missing the hallucinationRateMax map; baseline is missing intentAnchor.questions/exempt | …`——**部分基线不再静默放行**；基线按 `git hash-object` 逐字节复原（`80b68413…`）。
- [x] 验收 3：报告含 `exempt: {total, recallAtK}` 单列字段（事件面同步）；`check_eval_smoke` 的 pass/fail 与改动前**同输入同结果**（豁免题不进阈值 → 桶仍 100%、门仍绿；`totalQuestions` 下限仅随题数 97→101 同步）。
- [x] 验收 4（棘轮会红）：把基线 `route-chain` 冻结值临时改成 101 → `[FAIL] … ratchet=route-chain: recallAtK 100% < frozen 101%（forward 指标：低于冻结值即回退，须修复；放宽须在 spec 追加记录）`（**阈值全过、棘轮单独红**）→ 复原 → `[PASS] … ratchet=ok`；豁免数由基线冻结为 **4（只减不增）**。
- [x] 验收 5：其余 8 桶 `recallAtK` 全 **100%**（e2e 明细逐桶可见）；控制面 **739 全绿**（断言折入既有用例、计数不变）、typecheck 干净；e2e **71/0**。
- [ ] 验收 6（**票 04 承接**）：4 题转正（去豁免）后该桶 `recallAtK ≥ 85`、豁免数为 0，并在同一 commit 重冻 `intent-anchor` 的 `recallAtK` 现值——放宽冻结值须按 spec §6.2 追加记录。

## Comments

- 2026-09-27 立项；2026-09-28 按 D1 决策（豁免位 + 棘轮）与棘轮范围（9 桶）重写。
- **与票 03/04 的依赖是硬性的**：跳过本票直接扩覆盖 = 无门禁的盲改，且 ADR-0002 是否翻案将永远无法回答。
- 2026-09-28 落地：夹具只**新增**两个 TSX 文件（既有 fixture 保持逐字节不变——`repoqa-eval.ts` 里已注明"改这两段注释必须重跑 eval"）；4 题 query 与夹具标识符零重叠（否则会经 findSymbol/fuzzy 路绕过 chunk 桥，前红不成立）。文件面：`src/eval/repoqa-eval.ts`、`src/eval/repoqa-eval.test.ts`、`src/repoqa-http.test.ts`、`scripts/eval/retrieval-baseline.json`（新增）、`scripts/e2e/closeout_gate.py`。
- 2026-09-28 边界说明（诚实披露）：本棘轮冻结的是**当前树**的读数，它拦"回退与漂移"，不拦"新题加入后桶内构成变化"——后者由 `intentAnchor{questions,exempt}` 的只增/只减与票 04 的转正动作承担。另：`--sample seeded` 第二口径按 §7.1 追加裁决在本批不启用。
- 2026-09-28 双轴评审后修正（提交前）：① **fail-closed 补全**——基线缺 `recallAtK`/`hallucinationRateMax`/`intentAnchor` 键、或"报告里出现的桶未冻结"一律判红（原先 `{}` 形态会静默放行；新桶也因此必须显式冻结）；② 基线冻结 `exempt > 0` 时，报告缺 `exempt` 字段本身即红（防"删字段绕过只减不增"）；③ 基线在跑 eval **之前**读取，坏基线报自己的原因、不再借用 eval 的失败文本；④ 全局题数下限与零幻觉桶集合改由基线提供（`questions` / `hallucinationRateMax`），门禁不再各存一份字面量；⑤ `forward` 方向词条接入失败提示（对齐票 12 的方向纪律）；⑥ eval 侧：豁免回滚改为**整桶快照**（未来新增阈值字段自动回滚）、`avgLatencyMs` 分母改为"实际计时的题数"（原先豁免题把延迟摊薄）。