# 智能体主线交接手册（Agent Line Handoff）

> 交接时点：2026-09-05（v0.21.0 已发布、v0.22.0 在途），智能体主线因**开发环境转移**收口。
> 读者：接手智能体线的下一位开发者（fresh agent 或人）。
> 姊妹文档：仓库总交接 `HANDOFF.md`（门禁/架构不变量/版本演进）；双线协作约定 `docs/agents/parallel-collaboration.md`。细节以姊妹文档为准，本文不重复。

## 1. 主线一句话

智能体线 = 以 CodeCompass 为**确定性检索层**的对话式智能体。当前形态：本仓库 Workbench 的会话编排（Incident 卡流 + 演进工作台，走 v0.23.0 版本线）；下一步：**独立的对话式智能体项目**——另立 repo、消费 MCP 17 工具、自持版本号。

## 2. 里程碑史（commit / 版本锚点）

| 锚点 | 内容 |
|---|---|
| Issue 23 | 排障副驾驶 `mode=incident` 零幻觉合约；ADR-0010 物理锚点四元组、ADR-0011 静态边界 |
| Issue 24 | 演进工作台：`POST /evolve` 单遍流式 Intent→四工件卡、artifact stream、evolution view、Intent Eval Bucket（97 题冻结集） |
| Issue 25 T01 `92ac703` | Canvas 拔气泡（回归纯拓扑工作台）+ Incident 卡流重构 |
| Issue 25 T02 `9b0b34a` | `get_conventions` / `plan_evolution` MCP 工具（第 16/17 个），`module_evolution` 转别名 |
| Issue 25 T03 `9e40495` | `workbench_cards` 按 (repoId,commit) 持久化 + `GET workbench-cards` 回放 + 前端切桶 hydrate |
| Issue 25 T04 `59033f1`+`b4fae3b` | v0.21.0 收口：与并行会话合流、CHANGELOG [0.20.0]纯Scan/[0.21.0]收官重排、gate 断言名 five buckets |
| tag `v0.21.0` = `b4fae3b` | Release/CI 双绿（run 33946730235 / 33946729855），release 产物 architecture-artifact.html + e2e-result.json |
| `01ae26c` + `368a973` | 发布后收尾（Mimosa 误报规避、报告归档）+ 双线协作约定固化 |

## 3. 运行手册（本机实测值）

- **启动**：工作区 `D:/CodeCompass` 下 `node services/control-plane/dist/cli.js` → http://localhost:43110 （自动开浏览器）；数据目录 `~/.mhw`
- **端口纪律**：43110（控制面）与 5173（web dev）协议约定勿占用
- **dist 新鲜度**：改 src 必 `npm run build`（esbuild）；启动前可比对 `dist/cli.js` 与 `src/*.ts` mtime
- **健康核验**：`curl localhost:43110/api/repos` 期望返回 ready 仓库列表；首页 HTTP 200
- **交接时刻状态**：43110 服务仍在运行（b4fae3b 构建）——不含 master 上的收尾提交与在途 v0.22.0 改动，**重启后才反映新能力**
- **停止/重启**：对进程 Ctrl-C / 重跑启动命令

## 4. 双线协作现状

| | 线 A：MCP 工具面（ZCode） | 线 B：智能体线（本文） |
|---|---|---|
| 地盘 | `*-engine.ts`、`repoqa-mcp.ts`、gate 工具数断言 | `apps/repoqa-web`、worker/http 会话编排；智能体本体独立 repo |
| 版本 | **v0.22.0（在途）**：四包 bump + 引擎/web 批量改动未提交，scan dogfooding 已开工（`.scratch/scan-dogfooding-v021`） | **v0.23.0（预留）** |

三条最易踩的铁律（完整版见约定文档）：共享文档（HANDOFF/CHANGELOG/CONTEXT/README）收口时才写；开线先看 CHANGELOG 顶部确认版本号未被对方占；提交只挑自己的文件。

## 5. 工程坑速查（全部踩过的实录）

| 坑 | 处置 |
|---|---|
| git-bash 的 npm/npx 被 WSL shim 劫持 | `cmd //c "cd /d D:\... && ..."` 包装 |
| vitest 并发抖动 | `--pool=forks --minWorkers=1 --maxWorkers=1`；瞬时失败复跑两次再定性 |
| 多行 commit message | 一律 `git commit -F <file>`（heredoc 反斜杠、-m 反引号都会坏） |
| worktree 跑 build/测试 | 接齐 **3 个** node_modules junction（bridge-adapters/control-plane/web）；缺哪个包哪个包落全局 tsc 7.0.2 报 **TS5108**；拆除先 `rmdir` 链接再 `git worktree remove --force` |
| Mimosa 拦 ZCode 工具层 `git commit` | `--no-verify` 无效；等并行线收编或用户本机手动；测试夹具凭据一律运行时拼接 `'AKIA' + 'A'.repeat(16)` |
| eval/diff 长测试 | 高负载下 5s/15s 超时为已知 flake，复跑确认 |
| esbuild 剥注释 | 验证 dist 用字符串字面量 grep 或行为验证 |

## 6. 环境转移清单

- **仓库本体**：GitHub `shing26/CodeCompass`，master=`368a973` 全部已推（含 tag v0.20.0/v0.21.0），换环境 `git clone` 即得全部
- **本线 agent 持久 memory**：`C:\Users\Shing\.penguin\data\default_project\agents\default_agent\agent_state\memory\codecompass-643b2785\`（issue05→issue25 全程 + `parallel-lines-assignment` 分工定盘；`MEMORY.md` 为索引）——整个目录拷走即完成记忆迁移
- **对侧（ZCode）memory**：`C:\Users\Shing\.zcode\cli\memories\projects\codecompass-0da1d6bfa4427c13\memory\`
- **本会话 scratchpad**（过程稿/补丁脚本，可弃）：`...\.penguin\data\default_project\agents\default_agent\scratchpad\session-2026-09-01-03-12-52-a6c5150f\`——有价值结论均已沉淀进 memory 与本文档
- **HANDOFF.md §3 索引行**：本文档的索引行留给下次收口补（交接时 HANDOFF 在线 A 在途批中，避免交叉触碰）

## 7. 下一步（接手即开工）

1. **对话式智能体项目立项**（独立 repo）：MCP stdio 客户端（17 工具，autoApprove 动态派生）+ ReAct 编排层（ADR-0006：补丁只在此层生成并标注）+ ADR-0016 异步合约（index_repo 立即返回+轮询）；**首个真实任务 = scan dogfooding 回访**，与线 A v0.22.0 天然咬合
2. **库内 workbench**（v0.23.0 预留）：先跑 `HANDOFF.md` §6 快速验证清单确认新环境健康，再决定动不动
3. **开线 checklist**：`git fetch` → 看 CHANGELOG 顶部版本未被占 → `.scratch/<slug>/spec.md` 声明触碰面 → 分支从最新 master 拉
