# 04 — Eval incident bucket（零幻觉合约门禁）

Status: done

<!-- 完成（Issue 23 / Ticket 04）：repoqa-eval.ts 新增 incident bucket（10 题 GOLDEN_DATASET 冻结，65→75）+ repo-e fixture（orders 链 4 文件，有意不动 repo-b 保护 route-chain 冻结真值）；hallucinationMaxFor(incident)=0% 零幻觉 gate（其余 bucket 维持 ≤2%）；incident 计分纯确定性（parseStackTrace→resolveFramesToSymbols→runDiagnose，无 LLM 冻结重放）；幻觉判定按 file:line 是否 grounded 于 fixture 物理文件集（含 raw-file 校验语义），期望 BREAK 帧被错误 resolve 记 expectedUnresolved 违例。踩坑：第一版把 diagnose 前向链下游跳（符号表物理可证）计幻觉导致 19.7%，改 grounded 判定后 0%。CLI 实测 75 题 incident: total 10/recall 100%/幻觉 0%/锚点 100%，failureTaxonomy 全零；repoqa-eval.test.ts 5/5（BUCKET_TOTALS incident:10、freeze 75 题七 buckets、反向 case、run 断言 incident.hallucinationRate===0）。typecheck 干净。docs/benchmark.md 已更新至 v0.16.0。 -->

## 目标
- `repoqa-eval.ts`：新增 `incident` bucket（延续冻结真值原则，ADR-0004）：
  - 10 题固定 case：样例 repo（OrdersController 链样例）构造 Java 堆栈文本 → 期望帧符号命中（crash 帧反查）、期望穿透链 hops、期望 BREAK 负例（堆栈指向不存在符号时必须标 BREAK 而非编造）。
  - 计分：断言 hop 必须出现在工具返回链中（幻觉 = 链外断言）；anchors 走既有有效性统计。
- `bucketPasses` 门禁自动覆盖 incident bucket（Recall ≥ 阈值、幻觉率 0%、锚点有效率 ≥ 阈值）。
- `docs/benchmark.md` 增补 incident bucket 说明与结果。

## 验收
- eval 单测更新（bucket 计数/负例），总数 65 → 75；全量绿。
