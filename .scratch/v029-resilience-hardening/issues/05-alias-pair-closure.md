# 05：T6 — 异名隐藏镜像对收口（Anchor / IndexingProgress，V27-30 票04 尾巴）

> *Parent spec：`.scratch/v029-resilience-hardening/spec.md`。*

Status: closed
标签：契约 / P3 / 来源：B4（票 04）遗留注记「异名对留结构批统一裁决」。

## 裁决与实施（含与计划形态的一处偏离）

| 对 | 计划 | 实际落地 | 偏离理由 |
|---|---|---|---|
| `Anchor` ↔ `RepoQaAnchor` | re-export 别名 | ✅ 同计划：`export type Anchor = RepoQaAnchor`（本地 alias 形，因 types.ts 自家 QueryEvent 也要用它——`export type {}` 不建局部绑定，tsc 当场教做人） | — |
| `IndexingProgress` ↔ `RepoQaIndexProgress` | re-export 加宽 + StatusStepper unknown-phase 兜底 | **改名立实**：web 形状 `StepperProgress`（诚实窄化投影：phase=四阶段、字段子集），wire 真身 `RepoQaIndexProgress` 原名直出 | 加宽路线会引入 phase='cloning' 时步进条 -1 语义的**运行时行为问题**（本次战役铁律=零行为变更）；改名是纯类型面消谎——web 谎话的根源是「子集型顶着全集的名」，把名字还给投影、全集用契约原名，两侧都真话 |

消费面同步：RepoContext（state/annotation/cast/索引访问）、StatusStepper（prop）、TopBar（prop）→ StepperProgress；types.ts 头注改准。

## 验收

web 354/354（含 ratchet 5 例——`export type Anchor = …` 本地 alias 不触发红线：Anchor 名不在 contracts 导出中，RepoQaAnchor 才是；`export type { RepoQaIndexProgress }` 纯 re-export 不匹配 definedNames 正则）、tsc 净、vite build 成功、UI 冒烟 PASS。
