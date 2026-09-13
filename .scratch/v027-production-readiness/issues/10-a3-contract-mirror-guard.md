# 10：A3 — web↔contracts 镜像守卫哨（立 V27-26）

> *Parent spec：`.scratch/v027-production-readiness/spec.md`。宽口径批（2026-09-14 grill D4 分层裁决）。*

Status: closed
标签：test / P1 / 来源：2026-09-14 全模块验证——`apps/repoqa-web/src/types.ts` 首行注释自称 mirror `packages/contracts/src/repoqa.ts`，但零一致性检查（全仓无任何测试/脚本比对），两侧字段已各自演化（web 侧 `defaultBranch`/`suggestedSubdirs` 等）。

## 实施定案（2026-09-14 实施时修正）

- **原设想的 `Repo`/`RepoStatus` 关注清单不成立**：contracts 根本没有这两个类型（`Repo` 真源在 `repoqa-repos.ts`，经 HTTP 序列化到前端）。types.ts 的首行 mirror 注释本身就漂了——只覆盖部分类型。
- 首版哨改盯**真重叠的 16 个类型名**（实测 comm 交集）：ArchitectureDeltaReport / ConventionAnchor / ConventionConflictDetail / DomainRadarAnchor / DomainRadarResult / EvolutionIntentEcho / EvolutionPlacement / EvolutionPlacementFile / EvolutionRisk / EvolutionStageId / IndexingPhase / ModuleEvolutionResult / RepoQaEvolveDone / RepoQaEvolveError / RepoQaEvolveStage / TokenUsage。
- **只锁类型名集合双向一致**（并顺带验 v1.ts 的 Task/TaskStatus 仍被 web 消费侧兼容）；**字段级哨推迟到 B2**——实施时证实 contracts 是 `+nullable` 扩展方向（如 `filePath?` vs web 必填），字段集合现在不等，B2 单一源时统一裁决。types.ts 注释同步改准。

## Agent Brief

**Summary:** 新增 `apps/repoqa-web/src/contract-mirror.test.ts`，手法沿用 `copy-guard.test.ts`（readFileSync 相邻源码 + 正则解析导出名）。名单漂移即红并打印两侧差集。真单一源手术在 V27-29（web 直接 import contracts，届时本哨升级为字段级或拆除）。

**Acceptance:** `npm run test:web` 全绿且哨在位；人为在 contracts 删一个导出类型名后哨红。

## Comments（2026-09-14 实施收口）

- 落地：`contract-mirror.test.ts` 两例（关注清单双侧存在性 / web∩contracts 交集==清单），tsconfig 追加 exclude（沿用 copy-guard 的 node:fs 通道），types.ts 头注改准（双镜像源事实：contracts 覆盖 delta/radar/evolve 等 16 型，`Repo`/`RepoStatus` 系 control-plane HTTP 载荷镜像非 contracts）。
- **关注清单为实施时修正**：原设想盯 `Repo`/`RepoStatus`，实测 contracts 无此二型（真源 `repoqa-repos.ts`）；首版改盯真重叠的 16 个类型名。
- 字段级等值因 contracts 系 `+nullable` 超集方向（如 `filePath?` vs web 必填）推迟至 V27-29 单一源手术——故首版只锁类型名集合，避免上线即红。
- 验收：web 349→351（+2）绿；失败消息带双侧差集字段名，B2 拆哨前有效。
