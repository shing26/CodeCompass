# v0.28 引擎细化批（B 批）spec —— 来源 2026-09-14 全模块验证 + grill 定案

> 决策链：grill D6（B 主线=control-plane 细化）/ D7（附属票并入）/ D8（结构轴）。
> 版本预claim：v0.28 → **已兑现：v0.28.0 发布于 2026-09-15（tag=commit 3b917c0，CI+Release 双绿，票 01-04 全闭）**。

## 票池

| 票 | 账 | 内容 |
|---|---|---|
| 01 | V27-28 | bridge-adapters vitest 化 + 4 适配器纯逻辑单测 + CI/根脚本接线（零 token 零外网） |
| 02 | V27-29 | web→contracts 单一源：types.ts 重复类型改直接 import，字段考古裁决，拆 V27-26 守卫哨，Dockerfile web 段连带 COPY packages |
| 03 | V27-30 | control-plane 结构轴手术：repoqa-worker.ts 2556 行拆分（头部工具外迁 + RepoQAWorker 按 ingest/persist/progress/graph 抽协作者）、registerAnalysisRoutes 515 行拆注册、repoqa-* 家族目录归组 |

## 硬约束

- 零行为变更（纯测试与结构面；契约面变更只允许出现在票 02 的类型归属裁决，且须票面逐字段记录）。
- 每票验收=全门禁护航：四包 typecheck + cp/web/bridge 单测 + e2e 62 + UI 冒烟（票 03 另加 scan oversizedFiles 前后对照入票面）。
- workspaces 化不做（D6 裁决）；包引用维持相对路径 + esbuild 内联模式。
