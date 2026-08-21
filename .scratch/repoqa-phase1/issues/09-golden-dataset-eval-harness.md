# 09 - Golden dataset eval harness

**What to build:** Give maintainers a repeatable, per-bucket quality gate before any prompt tuning: frozen repos, questions, ground truth, K, and failure taxonomy.

**Blocked by:** 05 - Deterministic call-chain query; 06 - Chunks and config evidence; 07 - Secret masking

**Status:** ready-for-human

- [x] Golden dataset freezes 3 repos/commits, 50 questions, ground truth anchors, K and match rules
- [x] Eval reports route-chain/config/architecture buckets separately with Recall@K, hallucination, anchor validity, latency
- [x] Failure taxonomy classifies parse, retrieval, generation, and anchor failures
- [x] Config bucket counts only after deterministic config extraction exists
- [x] Eval exists as a runnable harness with a clear pass/fail report

## Comments

### 2026-08-20 implementation

- 新增 `src/repoqa-eval.ts`：冻结三组本地 fixture/com​​mit、50 个 question（route-chain 20 / config 15 / architecture 15）、K=5 match rule。
- 报告分桶输出 `recallAtK`、`hallucinationRate`、`anchorValidity`、`avgLatencyMs`，阈值沿用 spec 的 85% / 2% / 90%。
- 失败分类输出 `parse/retrieval/generation/anchor`；config bucket 在 config extraction 存在时参与计数。
- `npm run eval --prefix services/control-plane` 已跑通并按阈值打印 CLI 报告；测试断言 total=50 与 pass 状态。
- 控制平面 16 条测试全通过，typecheck 通过；eval CLI 当前通过。

### 2026-08-20 code review note

- golden eval 现在对 fixture 做真实 `git init` + commit（固定 author/date），报告输出 `fixtureCommits` 真实 40 位 commit hash；K 收敛为显式 `RECALL_K = 5`。
- 题目仍由确定性代码生成而非人工标注，指标全部 100%；人工 ground truth 标注是 Phase 1 换真实基线 repo 前的后续工作。
