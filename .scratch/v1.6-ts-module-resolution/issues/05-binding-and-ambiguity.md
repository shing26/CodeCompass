# 票 05 — 接进跨文件绑定：Phase 1 钉死 → Phase 2 歧义显式化

Status: in_progress（Phase 1 done / Phase 2 待裁决）

## Phase 1（done）

### 做法

`SymbolIndex` 增可选 `moduleImports`（caller → localName → `{target, kind}`），
`buildCallIndex(symbols, moduleImports?)` 携带；worker 在 `setSymbolGraph` 与冷启动
`getSymbolGraph` 两条路径都把落库的消解表带进索引。

绑定侧（`engine/repoqa-callchain.ts`）在同文件未命中之后、全局按名绑定之前插一级：

```
kind === 'named' && index.methodsByFile.get(target) 里确实声明该名 → 绑到 target
```

- `default` 不参与：它绑的是「模块的默认导出」，不一定是这个名字；
- `namespace` 不参与：它给的是模块对象，拿不到名字；
- 表缺省（旧索引 / 测试 / 未接线调用方）整段跳过，行为与 v1.5 完全一致。

### 效果（`scripts/precision/pin_effect.ts`，同索引跑带表/不带表两遍）

| 指标 | self 仓（`05efb41` 干净树） |
|---|---|
| 调用总数 | 17461 |
| 裸名分支（无 dynamic / 无 receiverType） | 9866 |
| 同文件未命中、全局有候选 | 1384 |
| **其中名字多文件声明（真正暴露在 tiebreak 下）** | **246** |
| Phase 1 实际换绑 | **15** |
| **回退（v1.5 有目标 → Phase 1 解析不出）** | **0** |
| 换绑样本 | `cli.ts: startServer repoqa-evolve.test.ts → server.ts`；`module-evolution-engine.ts: runConventionScan repoqa-worker.ts → engine/repoqa-conventions.ts` |

### 关键发现（会改写本战役的算式）

票 01 的 **1301** 是「名字层面候选歧义」的**上界**，不等于实际错绑面：绝大多数候选边由
类型化接收者 / 动态分派 / 跨语言桥分支先处理，根本走不到按名绑定。真正暴露在
「caller 文件优先 → 最早声明」这条 tiebreak 下的是 **246 条**，其中能被 import 声明钉死的
是 **15 条**。

所以 Phase 1 的价值不是「修正 1301 条」，而是「15 条从任意改为词法事实、且 0 回退」。
按 repo 的诚实纪律，这个数字必须写进 CHANGELOG 与 README 的披露，不能继续沿用 1301 的叙事。

## Phase 2（待裁决）

### 要做什么

把 246 条里**剩下 231 条**（多文件声明、import 钉不住）从「静默绑最早声明」改成显式可疑，
兑现零幻觉合约（`CONTEXT.md` Zero-Hallucination Contract：静态不可达边界强制标记）。

### 阻塞点：trace 面没有 SUSPECT 这个值

`RepoQaTraceHop` 只有 `break?: true` + `reason?: string`（`packages/contracts/v1.ts`），
而 `SUSPECT` 只存在于 `DiagnoseChainStep.status`。ADR-0022 决定 6 写的是「沿用既有枚举、
不加新值」——在 trace 面上这条**目前无解**，需要二选一：

1. **加一个新常量** `STATIC_ANALYSIS_BREAK_AMBIGUOUS`（如
   `'[Static Analysis Break: ambiguous target]'`）进 `packages/contracts`，
   同时改 ADR-0022 决定 6 与 spec 的「不触碰 contracts 镜像类型」一句。
   这是契约变更，按 `docs/agents/parallel-collaboration.md`「契约改动先落 spec」要先改 spec。
2. **不加新值、只改绑定**：继续绑最早声明，但在回执/诊断层标注「本批结论里 N 条边是
   按名兜底绑定」——不需要新 wire 值，但「可疑」不可被 agent 看到，价值打折。

### 影响面

231 条 / 17461 条调用 = 1.3%；改标记会让「可疑/未解析」计数上升，需要棘轮显式更新 +
逐条归因（票 02 的基线就是为此准备的）。

## Comments

- 2026-10-26 Phase 1 落地并全绿：typecheck/build 四前缀 0、控制面 **71 文件 893 测试**、
  e2e **73/0**、三仓 compare `lazygit`/`petclinic` **IDENTICAL**；self 漂移
  （+7 文件 / +34 符号 / orphan 173→176）可归因到新文件与 15 条换绑。
- 2026-10-26 尚未动 Phase 2：先要决定上面那个阻塞点（加标记 vs 只改绑定）。
