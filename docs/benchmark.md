# Benchmark — Golden Eval Baseline (v0.13.0)

> `npm run eval`（`services/control-plane` 内 `npx tsx src/repoqa-eval.ts`）一键重放。
> 数据集：65 条 golden 问题 × 4 个代码内联 fixture（自动物化 + git 提交，确定性可重放）。
> 指标：Recall@5（期望锚点在 Top-5 的比例）、幻觉率（报告了期望之外的锚点）、锚点有效率、平均延迟。

## 最近一次全量结果

| Bucket | 用例数 | Recall@5 | 幻觉率 | 锚点有效率 | 平均延迟 |
| --- | --- | --- | --- | --- | --- |
| route-chain（调用链） | 20 | 100% | 0% | 100% | ~0ms |
| config（配置证据） | 15 | 100% | 0% | 100% | ~0ms |
| architecture（架构全景） | 15 | 100% | 0% | 100% | ~0ms |
| intent-anchor（意图锚点，v0.9） | 5 | 100% | 0% | 100% | ~2ms |
| diagnose-chain（四层穿透，v0.8） | 5 | 100% | 0% | 100% | ~0ms |
| evolution（模块演进，v0.9） | 5 | 100% | 0% | 100% | ~0ms |

**通过阈值（EVAL_PASS_THRESHOLDS）**：Recall@5 ≥ 85%、幻觉率 ≤ 2%、锚点有效率 ≥ 90%。
失败分类（parse / retrieval / generation / anchor）全零即为绿色发布。

## 覆盖场景（repo-d fixture）

- 中文意图 → doc-chunk 确定性桥接命中 Service（无 embedding）
- 前端 axios 调用 → Controller → Service → MyBatis XML SQL 四层穿透（含具体 ID 路径归一化）
- legacy 模块下线 → 固定点级联孤立死代码（含负例：在用 DTO 不误报）
- @Transactional 方法级/接口方法级三级回溯 + 解耦模式推导
