# Issue 25 — Copilot Consolidation & Perception Parity（Copilot 收编与感知面对等）

## 决策依据
- ADR-0012（accepted）：Intent→Artifact 交互终局——废除通用聊天气泡；Incident Copilot（ADR-0011）收编为推演台内的专用堆栈诊断控制台，边界不变，不再是通用聊天入口；会话历史呈现为 Artifact Stream，严格按 (repoId, commit) 物理隔离。
- ADR-0011（accepted）：incident 静态边界不变——零幻觉、file:line+commit 物理证据、VERIFIED/BREAK/SUSPECT 分级披露。
- ADR-0014（accepted）：Pattern Ingestion 证据化——惯例清单（锚点+覆盖率+异议披露）是引擎产物，MCP 外溢时不打折。
- ADR-0015（accepted）：演进工作台自由文本意图入口（Issue 24 已落 Web 面）；Issue 24/25 打包——**MCP 侧意图解析在宿主**（Dual-Surface：MCP 永不内置 LLM）。
- ADR-0016（accepted）：MCP 长操作立即返回——新增工具预期 >5s 必须异步"立即返回+轮询"，同步契约必须给时长预算。
- Dual-Surface 原则（2026-09-01 确认）：Web 与 MCP 消费同一份引擎输出。

## 已核实的现状锚点（实现时以此为准）
### 感知面（MCP）
- `services/control-plane/src/repoqa-mcp.ts` 注册 14 个 `codecompass_*` 工具（grep 计数 14；CONTEXT.md L4 同口径）；`mcpModuleEvolution`（L570-591）直调 `runModuleEvolution` 且**不捕获 `ConventionConflictError`**——冲突时宿主只拿到裸异常字符串；而 Web 面 worker（repoqa-worker.ts L946-954）输出结构化 `conventionConflict` 载荷——**现存 Dual-Surface 缺口，本 Issue 修复**。
- `repoqa-mcp.ts` **未 import** `runConventionScan`；worker 包装 `RepoQAWorker.runConventionScan`（L394-415）已含 anchors 物理存在性校验，是 `get_conventions` 的现成复用点。
- `runModuleEvolution` 已内嵌惯例消费：EXTEND 内部跑 `runConventionScan`（module-evolution-engine.ts L899）并 throw `ConventionConflictError`（L913/L922；类定义 L64）——`plan_evolution` 无需新引擎逻辑，只是引擎的 MCP 挂载 + 结构化错误面。
- gate：`scripts/e2e/closeout_gate.py` `check_mcp_composite_tools`（L781-870）做 tools/list 断言；L856 消息 "14 total since v0.18" 需同步。

### 工件流（前端）
- `apps/repoqa-web/src/hooks/useEvolutionSession.ts`（182 行）：`EvolutionCard{id,intent,target?,status,stages,echo,result,mermaid,commit,error,conflict}`；bucketsRef 按 `${repo.id}::${repo.commit ?? 'unknown'}` 分桶；切桶关闭 in-flight 流并把中断卡标 error；**L10 `nextCardId` 模块级自增——持久化后必须改**（hydrate 回放卡与自增 id 撞号）；L47 注释即"server-side persistence is Issue 25"。
- `EvolutionView.tsx`（462 行）已是工件卡时间线 presenter——Incident 收编的样式与交互基准。
- 通用聊天气泡现存两处：`IncidentView.tsx` L77（user/assistant 气泡）与 `Canvas.tsx` L280（topo 工作台侧栏 ChatMessage 流）——ADR-0012 废除对象。**2026-09-04 裁决②：两处一并收编/拔除，彻底清除全仓"通用对话气泡"的伪 Copilot 残留**（Canvas 拔除范围并入 Ticket 25.1）。
- `IncidentView.tsx`（185 行）：crashTarget = 第一个 VERIFIED 且 file:line>0 的证据（L49-55）；`?mode=incident` 深链（App.tsx L179-268、视图接线 L537-559）；接线 `onTraceCrash`（= call-chain 显式 (name,file) 起点，LLM bypass）/`onOpenInWorkbench`；`StackTraceInput` 收底；streaming/reconnecting/recovered/error 状态复用 useChat 状态机。收编时**深链语义与两条接线保持不变**。
- `ChatMessage`（useChat.ts L6-37）含 incident 专属字段 stack/evidence/mode；`historyByRepo` 仅按 repoId 分桶（无 commit 隔离）——与 ADR-0012 不符，incident 迁走后该分桶不再服务 incident。

### 持久化（服务端）
- `repoqa_events`（db.ts L123-139）是 dogfooding 埋点表（feedback TEXT JSON）；evolve done 时 recordEvent 只存 `{intentType, target}` 意图回声（repoqa-worker.ts L989 一带）——**无 echo/result/mermaid/conflict 工件**；向埋点表塞内容数据不可取，持久化落新表。
- incident query.done 载荷（repoqa-worker.ts L1507-1520）：`{answer, mermaid, anchors, suggestedAction, confidence, lowConfidence, provenance:'static', usage, commit}`——incident 卡字段的直接来源。
- contracts 现成导出（packages/contracts/src/repoqa.ts）：`ModuleEvolutionResult`(L263)、`ConventionConflictDetail`(L354)、`EvolutionIntentEcho`(L422)、`RepoQaEvolveDone/Error`(L447-461)、`ConventionProfile`(L224)；**`ConventionScanInput` 仅在 control-plane**（repoqa-conventions.ts L385）——`get_conventions` 若经 MCP 返回 ConventionProfile，类型已可用，无需新造。
- http.ts evolve 分支（L584-644）SSE 直写未过 `maskEventPayload`（query 分支有）——落库前按 Issue 07 口径复核；现有结论：工件 result 只含 path/symbol/引擎模板（Issue 12"值永不索引故天然脱敏"），需显式核对 `scaffoldTemplates` 代码骨架。

## Tickets
- `issues/01-incident-investigation-stream.md` — IncidentView 收编为 InvestigationStream：气泡 → 工件卡；卡模型泛化（EvolveCard | IncidentCard 判别联合）；**Canvas.tsx topo 侧栏通用聊天气泡同步拔除**（composer/气泡流/自由输入清零，trace strip 数据源重接线，侧栏纯化为节点/边事实探针）；保留 ?mode=incident 深链、StackTraceInput、trace-crash/open-workbench 接线；ADR-0011 边界不变。
- `issues/02-mcp-conventions-plan-evolution.md` — MCP `codecompass_get_conventions` + `codecompass_plan_evolution`（14→16 纯新增）；宿主侧意图解析契约（显式 intentType/target）；`module_evolution` 冲突结构化缺口随 `plan_evolution` 落地修复；既有工具标注 `[Deprecated: Superseded by codecompass_plan_evolution]`；**新工具坚决 Sync（裁决⑤，5s 红线）**。
- `issues/03-artifact-persistence.md` — 工件流服务端持久化：新表 **`workbench_cards`**（同表 + kind 列，主键幂等键 (repoId, commit, seq)，裁决④）+ hydrate/回放端点（双流混合回溯）；useEvolutionSession 改造（卡 id 服务端化、nextCardId 退役）。
- `issues/04-gate-and-docs.md` — gate 扩项（MCP 16 断言/工件回放/incident 流/Sync 时长红）+ 全量回归 + CONTEXT/CHANGELOG + 版本 bump 0.20.0。

## 非目标（v1 明确不做）
- 不做跨仓库全局记忆（ADR-0012）。
- MCP 不内置 LLM、不做自然语言意图猜测（宿主解析失败即显式参数错误）。
- 不动已冻结 eval 题面（97 题 bucket 只增不改）。
- 不产 patch（ADR-0006 红线沿用）。
- Dashboard/Canvas 重组织与全景探针矩阵化（placeholder 第 4 项）**坚决排除**——留待视觉专项（裁决①）；但 Canvas.tsx 通用聊天气泡的拔除不属于此豁免，已并入 Ticket 25.1（裁决②）。

## 裁决记录（2026-09-04，v0.19.0 落袋同期，Open Questions 全部关闭）
1. **Dashboard/Canvas 重组织（placeholder 第 4 项：全景探针矩阵化 + Level-1 API 路由矩阵增量）**：坚决排除，不纳入 v1，留待视觉专项。
2. **Canvas.tsx topo 侧栏通用聊天气泡**：同步收编/拔除——彻底清除全仓"通用对话气泡"的伪 Copilot 残留；干掉自由输入气泡框，侧栏纯化为节点/边事实探针（NodeInspector），多轮追问一律引导至演进或事故工作台。范围并入 Ticket 25.1（原 ticket 只覆盖 IncidentView）。
3. **`codecompass_module_evolution`（v0.9 起既有）**：保留但 description 显式标注 `[Deprecated: Superseded by codecompass_plan_evolution]`；不打断既有脚本；v1.0 大版本再物理下线。
4. **Incident 卡持久化**：同表 + kind 列；表名抽象为 **`workbench_cards`**（不再叫 evolution_cards）；主键幂等键 (repoId, commit, seq)；hydrate 回放端点自然支持双流混合回溯。
5. **MCP 新工具执行模型**：坚决同步（Sync），严守 5s 红线——纯 AST 检索/图拓扑（零 LLM、零外网 I/O）理应 200ms~1500ms；超 5s 属引擎贪婪回溯 Bug，应引擎侧优化剪枝，不得用异步轮询掩盖（对 ADR-0016 构成这两个工具的显式裁决细化）。
