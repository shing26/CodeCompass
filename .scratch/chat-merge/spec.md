# Chat Merge：compass-copilot 毕业并入 CodeCompass Workbench

> 状态：**已裁决（grill 定稿 2026-09-07），待实施**
> 性质：推翻并取代 2026-09-03 的"智能体独立项目"决策——当时拒绝的是"引擎长出聊天气泡"（无编排层的伪智能体）；现在融入的是**成熟独立的编排框架**（QA 三轮淬炼、8.6/10、19 提交、零引擎耦合），性质是框架毕业，不是回退。
> 触发理由：单人单机场景下双线维护成本 > 隔离收益；对话与引擎耦合天然紧密；copilot 框架已具备进主线条件。

## 一句话

Workbench 吸收式替换：copilot 的编排层+对话 UI 毕业进 CodeCompass 主线（进程内直调），incident 卡流退役由新 chat 承接，copilot 仓库归档（REPL 移植为 `codecompass chat` 子命令），MCP 17 工具 stdio 消费面不变。

## Grill 六问裁决（2026-09-07）

| # | 决策 | 内容 |
|---|---|---|
| Q1 | 形态 | **吸收式替换**——Incident 卡流退役（排障对话由新编排层承接，它是 incident 模式的超集）；Canvas 纯拓扑不动（v0.21 裁决不翻）；evolve 工作台不动（确定性管线可视化，与 chat 定位不同） |
| Q2 | copilot 仓库归宿 | **归档毕业**——移植以 CodeCompass 落地为准；copilot 打 final tag 0.1.0、README 毕业声明、GitHub archived；REPL 不废弃，移植为 `codecompass chat` 子命令（CLI 已有 mcp/diff 子命令先例） |
| Q3 | 技术路线 | **进程内直调**——编排层四文件（agent/llm/store/log ≈1200 行）进 `services/control-plane/src/chat/`，`McpLike` 实现从 stdio 客户端换为进程内直调引擎 handler（消灭自闭环）；**接口边界保留**（编排层可再抽出复用）；LLM 键名回归 `REPOQA_LLM_*`（键名隔离理由随合并消失） |
| Q4 | 前端 | **组件整体移植**——MessageView/消息流/会话侧栏进 apps/repoqa-web 新 ChatView；**独立 `chat_sessions`/`chat_messages` 表**（对话历史语义 ≠ workbench_cards 工件回放语义，不混表）；cite 角标升级为 Workbench 内部深链（点角标跳 Canvas 定位——融合专属增强） |
| Q5 | 版本流程 | **v0.24.0 单版本收口**——`.scratch/chat-merge/` spec 先行（本文件）→ 实现 → 双轴 code-review → 全量门禁（控制面+web 单测、e2e gate）→ 六处 bump + CHANGELOG。无并行线（copilot 已归档），双线收口约定暂停适用。防线单测（35+）全部随迁为 chat 模块基线 |

## 移植清单（从 copilot 带什么）

| 资产 | 处置 |
|---|---|
| `agent.ts`（ReAct 循环、8 条纪律 prompt、防线、串行锁） | → `src/chat/agent.ts`，McpLike 直调实现 |
| `llm.ts`（多 profile、SSE 流式、掩码） | → `src/chat/llm.ts`，键名 REPOQA_LLM_* |
| `store.ts`（chat_sessions/chat_messages，WAL） | → `src/chat/store.ts`，表名不变 |
| `log.ts`（JSONL 取证） | → 保留，会话日志并入引擎 events 体系或独立保留待定 |
| StreamLeakFilter / stripTextToolCalls / cite 校验 | 随 agent.ts 迁移，35+ 单测随迁 |
| web：MessageView / 消息流 / 会话侧栏 / 计划卡 / regen 提示 | → ChatView，样式对齐 Workbench 主题 |
| `main.ts` REPL | → `codecompass chat` CLI 子命令 |
| `approve.ts`（autoApprove 派生） | 保留在 MCP 消费文档/安装器路径，不进 chat |

## copilot 侧遗留转本线

- 批次 D 模型选型对比 → 归入本线 post-v0.24（对比在库内做更方便）
- 卡片化 v2（issue 01）→ 归入本线 backlog
- CodeCompass 侧 `.scratch/copilot-m4-findings/` 两个引擎 issue（孤儿桶漂移/文件数口径）**不受影响**，继续等线 A 排期

## 不变的红线

- ADR-0002（运行时降级不可断言）、ADR-0006（补丁只在编排层）、scan 定位红线——随编排层继续生效，落为 chat 模块的 system prompt（copilot 已实现）
- MCP stdio 17 工具对外契约零变化（外部消费者无感知）
- Canvas 无气泡（v0.21 裁决⑤延续）

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| incident 卡流退役伤了既有用户习惯 | chat 承接排障场景（超集能力）；过渡期 CHANGELOG 明示 |
| 双表并存（chat_* 与 workbench_cards）造成认知负担 | 语义边界写进 CONTEXT.md：对话历史 vs 工件回放 |
| 编排层直调改造引入回归 | McpLike 薄接口 + 35+ 单测随迁 + e2e gate 新增 chat 场景断言 |
| copilot 归档后取证历史失联 | GitHub archived 保留全部 CI/提交历史；JSONL 取证体系随 log.ts 迁入 |

## 验收标准（v0.24.0 收口 gate，全部必须 PASS）

### A. 功能等价性（copilot 已有能力一件不丢）

| # | 验收项 | 通过标准 |
|---|---|---|
| A1 | 自由文本 ReAct | 输入「这个仓库哪里最值得改」→ 模型自主编排工具（scan 等）→ 流式回答带五桶事实与判断；SSE 事件序列 open→delta*→citations→done |
| A2 | cite 溯源契约 | 回答事实段落带 [cite: N]；角标可点击展开来源工具调用（工具名/参数/耗时）；**N 与 citations 数组一一对应，悬空角标在出口被剔除** |
| A3 | 多轮上下文 | 同会话第二轮提问可用「第一个/上面说的」指代；重启服务后历史完整回放（SQLite 水合） |
| A4 | 会话隔离 | 两个会话分别聊不同仓库/话题，互不污染；会话列表跨重启保留 |
| A5 | 模型热切换 | POST /api/model 或 UI 下拉切换 profile：不重启、不断连、切换事件落日志；未知 profile → 400 |
| A6 | 对抗性防线（QA 三轮成果全部随迁） | a) 流式与最终答案零 `<tool_call>` 文本块（含嵌套标签）；b) 触发重试时发 `regenerate` 事件 + 前端清空缓冲显示提示条；c) 零空答案（重试自愈）；d) 同会话并发双发串行执行不串历史；e) 注入类 prompt（DAN/批量删除）被纪律拒绝且不执行演进管线 |
| A7 | 确定性 fallback | LLM 未配置时 scan 关键词路由仍可用（fallback:true 语义，不虚构） |

### B. 融合特异性（只有合并才有的验收点）

| # | 验收项 | 通过标准 |
|---|---|---|
| B1 | 进程内直调 | chat 编排不 spawn 子进程（`McpLike` 直调引擎 handler）；单轮工具调用延迟 ≤ stdio 方案（不劣化） |
| B2 | cite 深链 | 回答中的符号引用渲染为可点击链接 → 跳转 Workbench Canvas 并定位该符号（inspector 打开文件）；跨视图跳转不丢当前仓库上下文 |
| B3 | IncidentView 替换 | 旧 incident 入口（TopBar tab + `?mode=incident` 深链）→ 进入新 ChatView 的排障场景（预填模式：粘贴堆栈的输入引导）；旧深链不 404 |
| B4 | 双表边界 | `chat_sessions`/`chat_messages` 与 `workbench_cards` 数据互不干扰：chat 历史不含工件卡、工件回放不含对话消息；PRAGMA 迁移幂等（旧库升级不丢数据） |
| B5 | `codecompass chat` 子命令 | CLI 直启终端 REPL：连接仓库、对话、/tools /model 等命令全可用；`--help` 出现在 USAGE |
| B6 | MCP 契约零变化 | `tools/list` 仍 17 工具、NDJSON 协议不变、现有 IDE 配置（autoApprove）无需重新生成 |

### C. 质量门禁（收口硬指标）

| # | 验收项 | 通过标准 |
|---|---|---|
| C1 | 单测 | chat 模块单测 ≥ 35 条随迁全绿（含防线回归：泄漏过滤嵌套标签/载荷感知压缩/串行锁/cite 校验/config）；控制面总量 ≥ 590、web ≥ 300 |
| C2 | typecheck | 四包 tsc 零错误（含新增 chat 模块与 ChatView） |
| C3 | e2e gate | 现有 52+ 项全绿 + **新增 chat 断言 ≥ 3 项**（chat SSE 全流程 / 双表隔离 / incident 深链重定向） |
| C4 | 双轴 code-review | fixed point = v0.23.0（4df2613）；审查面覆盖 chat 模块移植 diff 与 ChatView；P1/P2 清零 |
| C5 | 版本一致性 | 六处 0.24.0 + CHANGELOG [0.24.0] 头 + README 状态行；check_versions gate 通过 |
| C6 | 文档 | CONTEXT.md：chat 模块词条 + 双表语义边界；HANDOFF.md：v0.24.0 状态与 chat-merge 决策指针；copilot 仓库 README 毕业声明 |

### D. 用户验收冒烟（收口前最后一道，真实会话驱动）

1. 浏览器打开 Workbench → chat tab 问「这个仓库怎么样」→ 得到带角标的流式回答
2. 点任一 cite 角标 → Canvas 定位到对应符号
3. 粘贴一段 Java 堆栈 → 排障引导正常（原 incident 场景由 chat 承接）
4. 刷新页面 → 会话历史完整；切换仓库 → 会话隔离
5. `codecompass chat` REPL 跑同一组问题 → 行为与 Web 一致
6. 旧 copilot 用户视角：`~/.compass-copilot` 的旧会话数据**不被读取也不报错**（独立产品归档，不迁移）

### 明确不验收的（防范围蔓延）

- 批次 D 模型选型对比（post-v0.24 独立做）
- 卡片化 v2 结构化分组（backlog，v1 计划卡已够用）
- JSONL 取证并入 events 体系的具体方式（实施时按最小改动定，不设验收）
