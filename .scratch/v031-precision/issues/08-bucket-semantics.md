# Issue 08 — 孤儿桶语义收窄（ADR-0018 落地）

> Spec：`.scratch/v031-precision/spec.md` §3（M1）、§1.1
> ADR：`docs/adr/0018-orphan-bucket-semantics.md`（本次裁决的规范记录）
> 波次：**Wave 2.5**（票 02 的阻塞项解除后立即）｜ 依赖：票 02 的基线（已完成）
> 性质：**裁决落地 + 归因入口**。三裁决于 2026-09-18 由用户批准（A / A→A′ / B）

## 目标

把 ADR-0018 的三条裁决落成代码与可复算的响应字段，使 M1 有资格变动；
**判据是"桶的声称是否成立"，不是"数字好不好看"**（报告 §3 度量纪律）。

## 内容

### (a) 类型声明不进孤儿候选（裁决 1 = A）

孤儿候选收窄为 `kind === 'method'`。`class` / `interface` / `service` / `repository` /
`config` / `advice` / `mapper` / `sql` 全部不进候选，并按规则计数回报。

### (b) 接口方法声明不进候选（裁决 2 = A 为目标态，A′ 为执行路径）

- **本次做**：`kind === 'method'` 且其 owner（`parentType`）是 interface 声明 → 排除。
  判定只需符号表内的类型 kind，无需新表。owner 名字歧义（同名 interface 与 class）时按 fail-closed
  处理：**算作接口成员并排除**，同时在计数里可解释（与 Go 包表"歧义一律丢弃"的取向一致）。
- **本次不做（deferred）**：接口**实现**方法（lazygit 620 条）。判定需要接口→实现关系表
  （Go 是隐式实现），是 A′ 的第二步。响应里以 `deferred` 规则**显式登记**——不允许"不知道就不报"。

### (c) 仅被测试调用的符号：标注而非排除（裁决 3 = B）

`buildFullCallersIndex` 的全量调用者里"有调用者但全部在测试路径"→ 候选带 `testOnly: true`，
并计入普查。**不排除**、不改"测试调用算不算调用者"的口径。

### (d) 归因入口（票 02 第三增量自留的「另需决定」）

`runScan` 原先只发布前 10 条候选，全桶归因靠临时诊断。本次让孤儿桶在响应里带一份**确定性普查**：
`zeroCallers` + `testOnly` 与 `total` 守恒，`excluded` 列出被规则排除的类与条数。
做成响应字段而非新工具（受 spec §1.2 冻结面约束：不加第 18 个工具）。

**已知缺口（如实登记）**：普查把桶内剩余项分为 `zeroCallers` / `testOnly` 两类，
**尚不能**区分报告 §7.5 里的"无任何引用 742"与"dynamic 已引用了但未绑定 351"
（后者需要边级 `dynamic:true` 证据，`buildFullCallersIndex` 只给已解析的调用者）。
本票不假装能分——要分需另开边级归因，属票 02 的面。

### (e) 文档面同步（必要条件①）

`ORPHAN_NOTE`、`codecompass_scan` 的工具描述、README 生成器的 `LABELS`（`codecompass_scan` 行）
三处同步改为新口径，README 由生成器重写（`scripts/docs/sync-mcp-tool-table.py`）。

## 验收

- [x] 三仓复算：lazygit 孤儿 2805 → **1807**（−623 类型声明 −375 接口方法声明，与裁决算术逐字吻合）；
      petclinic **45 → 13**；self **692 → 283**（符号数同期 1940 → 1949）。
      复跑：`NODE_OPTIONS=--max-old-space-size=4096 services/control-plane/node_modules/.bin/tsx scripts/precision/scan_precision.ts self lazygit petclinic`
- [x] `excluded` 计数可解释且守恒：三仓 `zeroCallers + testOnly == total` 全部成立（lazygit 1693+114=1807；
      petclinic 13+0=13；self 279+4=283），且 **harness 现在会因不守恒直接抛错**（不留"数字对不上"的快照）
- [x] 接口实现方法项以 `deferred` 规则出现在响应里（count 缺席 + `deferred: true`），不是静默缺失
- [x] `testOnly` 标注有单测（含"标注而非排除"与守恒断言）；口径未变（测试调用仍不计入调用者）
- [x] 97 题 golden eval 全阈值不回退；e2e **68/68**；控制面单测 **670 → 673**（+3 裁决用例）；四包 typecheck 净
- [x] README 工具表与工具描述同步新口径（`scan` 行由生成器重写，`--check` 通过）
- [x] M1 复算留档——**仍为 100%**（本票不承诺达标，只承诺从此可解释）

## 实施记录（2026-09-18）

三裁决落地为四处改动：`scan-engine.ts`（收窄 + 普查）、`repoqa.ts`（`testOnly` / `census` 可选字段）、
`repoqa-mcp.ts`（`scan` 工具描述）、生成器 `LABELS` + README 重生成；`scan_precision.ts` 增普查记录与守恒断言。

**判定顺序是有意的**：wired 判定在收窄**之前**——外部注入是更具体的确定性原因，被注解的类型继续计入
`wiredExcluded`（既有语义与既有断言不变），只有**未注解**的类型声明才计入 `census.excluded['type-declaration']`。
两条路径都排除，只有归因不同。

**一处口径差异，需后续对账（不影响裁决）**：报告 §7.5 记"仅被测试调用 94 条"，本次实测 **114 条**（lazygit 同一 commit）。
差异来自判定定义：报告那 94 条出自临时诊断，本次用 `buildFullCallersIndex`（全量调用者，测试调用者计入）判定。
裁决 3（B：标注而非排除）不受影响——两种定义下这些条目都留在桶内。**但 94 不得再被当作规范数字引用**；
普查字段成为该类的唯一权威口径。

## 风险

- **桶语义收窄后 M1 仍可能是 100%**：剩余 1807 条里 620 条是 deferred 的接口实现，
  1093 条"零调用者"未逐条核验。若 M1 不动，下一步应是 deferred 项与这 1093 条的抽样归因，
  而不是再收窄口径。
- **同名类型歧义**：owner 名歧义时按接口成员排除属 fail-closed，可能误排少量非接口方法；
  计数可见，若复算发现异常先查这里。
- **`buildFullCallersIndex` 二次构建**：本票在 `runScan` 内新增一次调用（原先仅 `buildRadarGraph` 内部有）。
  若大仓耗时可见上升，应把全量索引提升为 `buildRadarGraph` 的返回值（共享区契约改动，需先落票面）。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `packages/contracts/src/repoqa.ts` | **共享区（契约）** | `ScanCandidate.testOnly`、`ScanBucket.census`（含 `ScanExclusion`）；均为可选字段，不破坏既有消费方 |
| `services/control-plane/src/scan-engine.ts`（+test） | MCP 工具面 | 三裁决落地 + 普查 |
| `services/control-plane/src/mcp/repoqa-mcp.ts` | 共享区 | `codecompass_scan` 的工具描述随新口径改写（与票 07 同文件，本票串行在后） |
| `scripts/docs/sync-mcp-tool-table.py` | 共享区 | `LABELS['codecompass_scan']` 随口径改写；README 由生成器重写 |
| `README.md` | 共享区 | 仅生成块内的 `scan` 行（不手改） |
| `docs/adr/0018-orphan-bucket-semantics.md` | 共享区 | **新增**，本票的规范记录 |
| `docs/reports/scan-precision-baseline-2026-09-16.md` | 共享区 | 追加收窄后的复算段（收口时一次性） |

**边界**：本票**不动** `pickTopApis`（deepChains 桶的入口候选过滤已在 V31-02 第三增量完成），
也不动 `domain-radar-engine.ts` 的节点集合（接口/类仍参与 PageRank——**收窄的是孤儿桶的候选声称，不是图**）。
