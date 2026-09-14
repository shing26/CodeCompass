# 02：B2 — web→contracts 类型单一源（销 V27-29，终结 V27-26 镜像哨的原始问题）

> *Parent spec：`.scratch/v028-engine-refactor/spec.md`（grill D4/D7）。*

Status: closed
标签：契约 / P2 / 来源：2026-09-14 全模块验证——types.ts 手工镜像 contracts 无编译期链接，A 批先立名集合哨（V27-26），本票做真手术。

## Agent Brief

**Summary:** web 重复类型改直接 re-export contracts（`../../../packages/contracts/src/index`，与 control-plane 现行模式一致；纯 type-only 导入，bundle 零增量）；字段考古逐字段裁决；守卫哨升级为「禁止手工重镜像」棘轮；Dockerfile `COPY packages/` 提前至 web 构建前。

**Acceptance:** web typecheck 净（手术安全网）+ 全测试绿 + 生产构建成功 + UI 冒烟绿 + docker 重建绿；哨升级后「再有人手工镜像 contracts 名即红」。

## 实施裁决（考古证据表 → 决策，2026-09-14）

| # | 差异 | 裁决 |
|---|---|---|
| 1 | `TokenUsage` 同名异义（contracts=harness 'token.usage' {taskId,…}；web=query usage {input,output,total,source}） | web 真身=contracts `RepoQaTokenUsage`，改 `export type TokenUsage = RepoQaTokenUsage` 别名桥，哨白名单登记；contracts 不动 |
| 2 | `EvolutionPlacement.injection`：contracts 必填 `codeSnippet`（engine 恒发），web 镜像私造 `signature?/note?` 且 EvolutionView 消费 signature——**死 UI 分支** | 删死分支（渲染输出前后一致：服务端从不发 signature）；fixture 改 codeSnippet |
| 3 | `ModuleEvolutionResult.transactionBoundaries` contracts 必填（engine 两路径恒发，可 []） | contracts 保持必填；web fixture 补 `[]`（web 无读方） |
| 4 | axis 族 string→ConventionAxisId 收窄（EvolutionRisk/ConflictDetail/basedOn/conventions.axes） | 零改动——web 只渲染不判等，全部 fixture 用合法字面量；约定未来禁造非法 axis |
| 5 | ArchitectureDelta 元素异名（ExtractedSymbol/CallEdge vs ArchitectureDeltaSymbol/Edge）；impactedApi 为匿名内联 | 别名 re-export + **派生** `ArchitectureDeltaImpactedApi = Report['impactedApis'][number]`（永不与宿主漂移） |
| 6 | DomainRadar hubNodes 匿名内联 | 随 Result 整体 re-export，web 仅读 [0]?.symbol 已判空 |
| 7 | 异名隐藏镜像（IndexingProgress↔RepoQaIndexProgress、Anchor↔RepoQaAnchor）不在 16 内 | 本票不动（D8 边界：只动 16+别名），留 V27-30 结构批顺带裁决 |
| 8 | workspaces 化 | 不做（D6）；相对源码导入，接受 contracts 无 dist 现状 |

## Comments（2026-09-14 实施收口）

- 落地：types.ts 16 型删除本地定义改 contracts 类型 re-export（+TokenUsage 别名桥、+派生 ImpactedApi、delta 族异名别名）；EvolutionView 死分支删；fixture 两处按裁决表修；哨**升级为棘轮**（未拆）——从「16 型名集合相等」改为「web 手写定义 ∩ contracts 导出 = ∅（白名单除名）」，防「手工重镜像」回潮（V27-24/V27-29 病灶的免疫机制），覆盖面加 RepoQAClient/useChat/useEvolutionSession。
- **tsc 一次过**：考古表 8 项裁决全部兑现、零意外爆点——354/354（哨 2→5 例）+ vite build 成功 + UI 冒烟四旗全绿（新 web dist 实跑）+ docker 重建绿（COPY packages 前置于 web 段，容器内 web 构建实证单源通路）+ 容器 /health/SPA 200。type-only 导入被 esbuild 擦除，bundle 零增量。
- 顺手修：ci.yml e2e-gate job 名「33 checks」陈旧→「62 checks」。
- 异名对（IndexingProgress/Anchor）与 V27-30 的目录归组有交集，留结构批统一处置。
