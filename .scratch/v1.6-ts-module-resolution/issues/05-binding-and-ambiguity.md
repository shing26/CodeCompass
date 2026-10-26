# 票 05 — 接进跨文件绑定：Phase 1 钉死 → Phase 2 歧义显式化

Status: done

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

## Phase 2（done —— 2026-10-26 裁决走方案 1）

### 决定

trace 面没有 `SUSPECT`（那是 `DiagnoseChainStep.status` 的枚举），所以先改 spec 与 ADR-0022，
再给 `reason` 加**一个**取值，不新增枚举类型、不动工具签名：

1. `spec.md` 决策 5 + 文件面：契约面只此一处，明确写了改什么；
2. `docs/adr/0022` 决定 6 改写：`reason` 加 `STATIC_ANALYSIS_BREAK_AMBIGUOUS`
   （`'[Static Analysis Break: ambiguous target]'`），诊断面映射既有 `SUSPECT`；
3. `packages/contracts/src/repoqa.ts`：新常量 + `isAmbiguousDispatchReason`——
   **不进** `isExternalDispatchReason`（歧义不是「止于仓外」）。

### 接线

- `repoqa-callchain.ts`：裸名分支里，`global` 中该名字跨 **>1 个文件**声明、且 import 钉不住、
  且调用方是 TS/JS 文件 → 返回歧义 reason。**Go/Java 不标记**（绑定规则不在本战役射程）；
- `diagnose-engine.ts`：歧义 hop → `status: 'SUSPECT'` + 中文说明「不确定，不是解析失败」；
- `useChat.ts` / `types.ts` / `mermaidGraph.ts` / `Canvas.tsx`：Web 映射到既有「存疑」文案
  （警示色，与 BROKEN 的危险色区分）；
- `repoqa-trace.ts` / `repoqa-snippet.ts`：`breaks` 增 `ambiguous` 维度（trace 文本里输出
  `AMBIGUOUS xN`）；`output-contract.ts` 的 `breakMarkers` 增 `AMBIGUOUS` 归类。

### 效果（`pin_effect.ts` 改写后的口径）

Phase 2 之后「带表/不带表」不再等于 Phase 1 换绑量（歧义标记是共享逻辑），新口径是：

| 指标 | self 仓 |
|---|---|
| 名字多文件声明的裸名调用 | 246 |
| **Phase 2 实际标歧义** | **230** |
| **Phase 1 从歧义里救回（import 唯一钉死）** | **16** |
| 回退（v1.5 有目标、现在解析不出且不是歧义标记） | **0** |

230 + 16 = 246，账平。救回样本：`cli.ts: startServer → server.ts`、
`routes/snippet.ts: analyzeSnippet → engine/repoqa-snippet.ts`。

## 门禁（Phase 2 终态）

- 控制面 `tsc --noEmit` 0；**71 文件 / 899 测试**全绿（新增 Phase 2 用例 5 条 + 诊断
  SUSPECT 映射 1 条）；web `tsc` 0、**41 文件 / 433 测试**全绿；bridge 26 绿。
- `npm run build` 四前缀 0；e2e `closeout_gate.py` **73 passed, 0 failed**。
- 三仓 `compare --must-match lazygit,petclinic`：**lazygit / petclinic IDENTICAL**
  ——Go/Java 的 TS/JS 门控生效，硬断言成立。
- self 漂移（8 项）：commit 前进、+7 文件 / +37 符号、orphan 173→181、hubs 1828→1861、
  orphan 抽样键位移——可归因到新增文件 + 230 条边不再绑到任意目标（部分 symbol 因此失去
  唯一调用者）。这是「把任意性搬到台面」的预期读数变化，不是精度回退。

## Comments

- 2026-10-26 Phase 1 + Phase 2 全部完成。
- 2026-10-26 一个真 bug 记在这里：`export {...} from './x'` 曾被 `export {...}` 的正则误判为
  本地导出（`\}\s*(?!from)` 的 `\s*` 回溯），已修并有用例（见票 04）。
- 2026-10-26 口径变更留痕：Phase 1 单独验收时用「带表 vs 不带表」量得换绑 15 条；
  Phase 2 落地后这条口径失效（歧义标记是共享逻辑），改为「救回 16 条 / 标歧义 230 条」。
  两个数字都对，只是衡量对象不同，CHANGELOG 里按新口径写。