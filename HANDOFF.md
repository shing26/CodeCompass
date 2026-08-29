# CodeCompass 开发交接文档（Handoff）

> 写给：接手 CodeCompass 开发的下一个 agent（fresh session）
> 交接时点：2026-08-30，v0.9.0 已发布并推送
> 工作区：`D:\CodeCompass`（Windows 11 / Git Bash / Node 24）
> 远端：`git@github.com:shing26/CodeCompass.git`（master 与 tag 均已同步）

---

## 1. 当前状态（一句话版）

**v0.9.0 已发布**（`5cd7c36`，tag `v0.9.0`）：复合 Agent 工具（v0.8）+ 模块演进副驾/领域雷达/多视图工件（v0.9），全部走完了 grill 访谈 → 实现 → 双轴 code-review → 修复 → 验收清单实测的完整管线。工作区 tracked 干净，无未提交变更。

## 2. 新 agent 上手前必须知道的事实

### 2.1 仓库与运行

| 事项 | 值 |
|---|---|
| 版本一致性硬约束 | `package.json` == `cli.ts VERSION` == `CHANGELOG.md` 顶部条目（e2e 门禁会校验，改版本必须三处同步） |
| 构建产物 | `services/control-plane/dist/`（esbuild）；改了 src 必须重建 dist 再跑 e2e/CLI 验证 |
| 本地端口 | 控制面 **43110**（`MHW_CP_PORT` 可配），Web dev 5173（`.env.development` 钉了 API base） |
| 测试命令 | `npm test`（控制面，需在 services/control-plane 下）；`apps/repoqa-web` 用 `npx vitest run`；`npm run e2e`（Python 门禁，需先 build） |
| 门禁基线 | 控制面 430 用例 / 35 文件，前端 201 用例 / 27 文件，e2e **33/33** —— 全绿是发布前提，不允许回退 |
| 数据库 | 本机 `~/.mhw/mhw.db`，已索引 13 个仓库。**真实测试数据仓库**：`D:\Nexus-Campus`（Java+React 全栈，有真实点赞链路，repoId `repo-28e49624-...`）、`spring-petclinic-customers-service` |
| 本会话 MCP | 当前 ZCode 会话挂载的 codecompass MCP 可直接调用 12 个工具（repoId 见 `codecompass_list_repos`）；勿用旧索引 `repo-6b577b83` |

### 2.2 架构不变量（违反即返工）

- **真理之源红线（ADR-0002）**：链路追踪/依赖计算 100% 确定性 AST 图谱，禁止 LLM 猜测；无 AST 证据就渲染诚实占位（ADR-0008），绝不编造数据
- **补丁边界（ADR-0006）**：确定性工具的 `suggestedPatch` 恒空（e2e 有断言 `is None`）；补丁只在 ReAct 编排层由 LLM 生成并标注 `llm-generated`
- **脱敏（ADR-0003）**：任何源码切片流出前必须过 `maskSensitiveText`（先例：`repoqa-graphrag.ts`、`diagnose-engine.readSnippet`）
- **反向邻接**：所有需要"全符号反向边"的引擎必须用 `repoqa-callchain.ts` 导出的 `buildFullCallersIndex`（`CallResolver` 类的预建索引只走 method 调用者、会丢路由出边——这是历史 bug 源）
- **引擎布局**：扁平 `src/<name>-engine.ts` + 同位 `.test.ts`，不建子目录（`src/agent/` 两次出现在计划书里都被否了）

### 2.3 本环境工程坑（血泪教训）

1. **模板字面量里禁用反引号**：`cli.ts` 的 `USAGE` 是模板字面量，内容里写 `` `--ide` `` 会终止字符串；git `commit -m` 的 message 含反引号也会被 bash 执行（已发生两次，v0.9 修正提交被迫 force push 修正）——**多行 commit message 一律 `git commit -F <file>`**
2. **e2e 门禁吃 stdout JSON**：CLI 一次性命令（diagnose/evolve/radar/export）的日志走 `console.log` 会混进 stdout；门禁脚本用"首个独占 `{` 行起 raw_decode"提取 JSON
3. **vitest 并发抖动**：`npm test` 偶发 412/430 类瞬时失败，复跑两次确认再定性；stdio 集成测试（`repoqa-mcp-stdio.test.ts`）spawn 真实子进程，Windows 下 kill 后文件句柄释放有延迟，清理用 `rm(...).catch(() => {})`
4. **Windows 路径**：`path.resolve` 归一斜杠，测试断言比对路径时用 `path.resolve` 后的期望值；jsdom 没有 `scrollIntoView`，前端代码需 `typeof el.scrollIntoView === 'function'` 防御
5. **esbuild 会剥注释**：验证 dist 是否更新不能 grep 注释文案，要 grep 字符串字面量或直接验证行为

## 3. 关键文档索引（不重复内容，直接读）

| 文档 | 内容 |
|---|---|
| `CONTEXT.md` | 术语表（Diagnose Chain / Blast Radius / Deep-Link / Module Evolution / Domain Radar / Story Beats / Brand Badge 等）+ 9 篇 ADR 索引 |
| `docs/adr/0001–0009` | 全部架构决策；**0005/0006/0007/0008/0009 是 v0.8/v0.9 新立的边界**，新功能设计前必读 |
| `CHANGELOG.md` | 0.6.0→0.9.0 完整发布条目（每个文件路径都有记载） |
| `.scratch/v0.7-semantic-canvas/spec.md` | @Async/@EventListener 推迟决策的原始记录（Dataflow 视图数据源缺口的根源） |
| `scripts/e2e/closeout_gate.py` | 33 项门禁断言 = 系统能力的可执行规格 |
| 用户批准的 v0.9 计划 + 四条实操提醒 | 在上一会话对话中（要点已固化进 ADR-0008/0009 与 CHANGELOG）； Lifecycle/Dataflow 的数据源缺口分析也在其中 |
| agent 持久记忆 | `C:\Users\Shing\.zcode\cli\memories\projects\codecompass-0da1d6bfa4427c13\memory\`（v06 收口默认决策、v07/v08/v09 发布边界、grill-with-docs 工作流） |

## 4. 版本演进史与工作流（新功能照此办理）

成熟工作流（v0.8/v0.9 两轮验证有效）：

```
用户给计划书 → [grill-with-docs] 先派 Explore agent 代码核实（计划书常有失实/过时项）
  → 逐题访谈（AskUserQuestion 一次一题 + 推荐答案；用户未答时按推荐默认执行并记录）
  → ExitPlanMode 批准 → 分阶段实现，每阶段提交
  → [code-review] 双轴（Standards + Spec 并行 sub-agent，fixed point=上个已审 commit）
  → 修复 findings → 全量回归（typecheck + 双端单测 + npm run e2e）→ bump 三处版本 + CHANGELOG → tag → push
```

已建立的评审基线：每个发布版本都过一次双轴 review；fixed point 依次是 `8af00f5`（v0.8 审完）→ 本次审到 `5cd7c36`（v0.9 审完）。

## 5. 下一步候选（backlog，按用户已表达的优先级）

1. **方法体级 AST 提取器**（解锁 Lifecycle/Dataflow 视图的关键前置）：枚举状态迁移扫描、`@Async`/`@EventListener`/MQ API 调用识别。注意 v0.7 推迟 @Async 的理由（Spring 代理调用消歧复杂）记录在 `.scratch/v0.7-semantic-canvas/spec.md`
2. **Web 端 StoryBeatStrip**：需要 SSE/API 把 diagnose/evolve 步骤数据传给前端（ChatMessage 协议无步骤概念）——协议扩展 + Canvas 侧组件（ADR-0009 留的口子）
3. **图画布**（可平移缩放的拓扑视图）：ADR-0007 保留了深链参数契约兼容性，做之前先重读该 ADR
4. **WorkBuddy installer 适配器**（installer.ts 的 IdeSpec 结构已预留扩展位）
5. **E8 评测集 / Golden Dataset**（ADR-0004 proposed 状态，一直未启动）
6. 小项：DEPRECATE checklist 60 条静默截断可加溢出说明字段；MCP `intentType` 可加 enum 校验；`DomainRadarInput.hubLimit` 无调用方使用

## 6. 建议调用的 skills（suggested skills）

| 场景 | Skill |
|---|---|
| 新版本计划书评审/新功能设计 | `grill-with-docs`（内含先代码核实再逐题访谈的既定管线） |
| 发布前 | `code-review`（双轴并行 sub-agent，fixed point 用上一次审完的 commit） |
| 交接/会话收尾 | `handoff`（本文档即产物，接手后可更新覆盖） |
| 实现阶段 | `implement` / `tdd`（控制面是 TDD 友好结构：纯函数引擎 + 注入式 MCP handler） |
| 修 bug 时 | `diagnosing-bugs` |
| 记忆延续 | 新 agent 应读取 2.3 节列出的 agent 持久记忆目录（MEMORY.md 索引） |

## 7. 快速验证清单（接手后先跑一遍确认环境健康）

```bash
cd D:/CodeCompass
git log --oneline -3                    # 应见 5cd7c36 fix(v0.9)
npm run typecheck                        # 全仓零错误
cd services/control-plane && npm test    # 430/430
cd ../../apps/repoqa-web && npx vitest run   # 201/201
cd ../.. && npm run build && npm run e2e     # 33/33（需 Node24 + git + python3）
node services/control-plane/dist/cli.js install --ide zcode --repo D:/CodeCompass
# 应输出 "already up to date"（幂等）
```
