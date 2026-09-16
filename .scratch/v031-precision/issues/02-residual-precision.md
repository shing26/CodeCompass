# Issue 02 — 残余精度攻坚

> Spec：`.scratch/v031-precision/spec.md` §3（M1）、§6.2（降级策略）
> 波次：Wave 2 ｜ 依赖：票 01（没有基线不修） ｜ 阻塞：票 04

## 目标

把三样本真实仓库假阳性率（M1）压到 **< 5%**；若不可达，给出**可达下限 + 剩余噪声的可解释性**（诚实口径，不允许按目标倒推度量）。

## 现状证据（已登记主因）

- **Go 跨文件类型引用**：`GoAdapter.ts` 的 `declaredTypes` 是**按文件**构建的类型表，跨文件 receiver 类型（如 lazygit `g *Gui`）无法绑定 → 调用边落回 `dynamic: true` → 孤儿桶假阳性。CHANGELOG 两处明确记为主因（`CHANGELOG.md:209`、`:227`）。
- v0.22 已解决的部分：vendor 排除、裸调用 + `pkg.Func` 限定调用静态化、`isTestPath` 文件名模式、空桶 nextAction；v0.23 已解决 DI/入口点白名单与 accessor 降权。
- **未验证的剩余面**：petclinic（Java，DI 容器反射）与本仓（TS，barrel/动态 import）修复后从未复测——归因分布未知，**先测再修**。

## 方法（禁止盲修）

1. 用票 01 的基线对假阳性逐条归因，产出**根因分布表**（例：Go 跨文件 receiver 占 X%、Java 反射 Y%、TS 再导出 Z%、其他 W%）。
2. 按 Pareto 排序修，每修一项复跑基线，记录单项增益。
3. 先做 Go 跨文件类型表（已登记主因，且机制清楚：把 per-file `declaredTypes` 提升为 per-repo 类型表，且在跨文件解析时保持"宁 dynamic 不猜测"）。

## 架构约束（违反即返工）

- **真理之源红线（ADR-0002）**：跨文件绑定必须是确定性解析（import 路径 / 包限定名），**解析不到就保持 dynamic**，不得用名字相似度猜。
- 反向邻接必须走 `buildFullCallersIndex`（HANDOFF §2.2）。
- 引擎布局：改动落在 `src/languages/*Adapter.ts` 与 `src/engine/repoqa-callchain.ts`；若需跨文件类型缓存，放 worker/ingest 侧，不污染 adapter 单文件契约。

## 验收

- [ ] 三仓 M1 < 5%（或出「可达下限 + 根因可解释性」结论并写明代价）
- [ ] 97 题 golden eval 全阈值不回退（Recall@5 ≥85%、幻觉 ≤2%、incident 0%）
- [ ] 控制面单测基线 650 不降（新增/改动用例随行）
- [ ] 每条根因修复在基线报告里留单项 before/after

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/languages/GoAdapter.ts`（+test） | MCP 工具面 | 主战场 |
| `services/control-plane/src/engine/repoqa-callchain.ts`（+test） | MCP 工具面 | 跨文件解析若需下沉 |
| `services/control-plane/src/ingest/**` | MCP 工具面 | 若需类型表缓存 |
| `scripts/e2e/closeout_gate.py` | 共享区 | 仅在需要新断言时，先落 issue 再改 |
