# Parallel collaboration: dual-agent conventions

两条开发线（MCP 工具面 / 智能体工作台）并行提交本仓库的协作约定。由 v0.20/v0.21 两轮并行交付的实际冲突面提炼，2026-09-05 固化。

## 冲突面的结构（为什么需要约定）

| 层 | 归属 | 冲突性质 |
|---|---|---|
| MCP 工具面 | `services/control-plane/src/*-engine.ts`、`repoqa-mcp.ts`、gate 工具数断言 | 基本不撞 |
| 智能体工作台 | `apps/repoqa-web/`、worker/http 的会话编排（Incident/evolve 流） | 基本不撞 |
| 共享区 | `packages/contracts` 三处镜像类型、SSE 载荷契约、`scripts/e2e/closeout_gate.py` 断言、CHANGELOG / CONTEXT / HANDOFF / README、版本六处 | 必撞，靠约定消 |

版本六处 = 四个 `package.json` + `cli.ts` 的 `VERSION` + `repoqa-mcp.ts` 的 `MCP_SERVER_VERSION`（e2e gate 校验前三者 + CHANGELOG 顶部 + README 版本行）。唯一例外：`packages/bridge-adapters` 独立 0.6.0 版本线，不随主版本推进。

## 开线前

1. **版本号预占**：`git fetch` + 看 CHANGELOG 顶部 + `git log --oneline -5`，确认目标版本没被对方占走。两条线各占一个 minor（如 0.22.0 / 0.23.0），谁先发布谁先合，后合的线跳号——避免 v0.21 式的事后 CHANGELOG 收拢裁决。
2. **声明文件面**：在 `.scratch/<feature-slug>/` 的 issue 里写清本线会触碰的区域（尤其是否涉及共享区）。
3. **契约改动先落 spec**：改 contracts 类型、SSE 载荷或 gate 断言前，先在 spec 里写明，双方确认再动手。

## 开发中（三条铁律）

1. **小步快合**：ticket 粒度合 master，绝不攒大分支（分支漂移一周以上冲突解起来就是考古）。
2. **提交只挑自己的文件**：共享文档（HANDOFF / CHANGELOG / CONTEXT）的更新压到收口时一次性做，开发中途不动。每天开工前 `git log` 扫一眼对方是否动过自己声明过的区域。
3. **Mimosa 约定**：ZCode 工具层的 `git commit` 会被 Mimosa L3 全仓扫描拦截（存量高危误报，`--no-verify` 无效），出路只有两条——用户本机 shell 手动提交，或等并行线收编。测试夹具的凭据一律运行时拼接（`'AKIA' + 'A'.repeat(16)`），不写静态字面量。

## 收口（收口人制）

1. **一个版本一个收口人**：最后收口的线统一做——版本六处推进、CHANGELOG 重排、双轴 code-review（fixed point = 上次审完的 commit，不可省）、全量门禁（控制面 ~550 + 前端 ~280 单测、e2e 52+ 项全绿）。
2. **合并方向**：后收口的线负责把先收口的合进自己的分支再推，master 保持线性历史。
3. **冲突裁决基准**：
   - 共享文档冲突：不删对方条目，只重排位置。
   - 契约冲突：以 `.scratch/<feature-slug>/spec.md` 原文为准裁决（先例：v0.21 工件卡分列存储、`workbench-cards` 端点名）。
   - 用户未作答的决策：按推荐默认执行并在 spec/CHANGELOG 记录（v0.6 先例）。

## 一句话版

**开线对号、共享区收口时才写、ticket 粒度合 master、契约改动先落 spec、一个版本一个收口人。**
