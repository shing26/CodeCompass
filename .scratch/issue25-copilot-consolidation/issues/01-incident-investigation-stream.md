# Ticket 25.1 — IncidentView 收编为 InvestigationStream + Canvas 拔除通用气泡

## 目标
ADR-0012 交互终局（Web 面）：废除 IncidentView 残存的 user/assistant 气泡流，事故排查并入与 EvolutionView 同形态的工件卡时间线；ADR-0011 静态边界（零幻觉、VERIFIED/BREAK/SUSPECT 分级、file:line+commit 物理锚点）一字不动。
**并裁决②（2026-09-04）**：Canvas.tsx topo 侧栏的通用聊天气泡同步拔除——彻底清除全仓"通用对话气泡"伪 Copilot 残留；干掉自由输入气泡框，侧栏纯化为节点/边事实探针（NodeInspector），多轮追问一律引导至演进或事故工作台。

## 现状锚点（已核实）
- `apps/repoqa-web/src/components/IncidentView.tsx`（185 行）：L77 `messages.map` 渲染 user 气泡（text+stack pre）与 assistant 气泡（text/diagram/evidence/provenance/usage/lowConfidence）；L49-55 crashTarget = 第一个 VERIFIED 且 file:line>0 的证据；L126-155 "接入工作台"动作行（incident-trace-crash / incident-open-workbench）；L182 `StackTraceInput` 收底。
- `apps/repoqa-web/src/hooks/useChat.ts` L6-37 `ChatMessage`：incident 专属字段 `stack`/`evidence`/`mode`；`historyByRepo` 仅按 repoId 分桶（无 commit 隔离）。
- 深链与接线（App.tsx）：`?mode=incident` 深链 L179-268；视图接线 L537-559（`onTraceCrash` = call-chain 显式 (name,file) 起点、LLM bypass；`onOpenInWorkbench`）；`handleIncidentSubmit` 走隐私同意门（L327-339）。
- 服务端 incident done 载荷（repoqa-worker.ts L1507-1520）：`{answer, mermaid, anchors, suggestedAction, confidence, lowConfidence, provenance:'static', usage, commit}`。
- `apps/repoqa-web/src/hooks/useEvolutionSession.ts`（182 行，Ticket 24.5 已落主树）：EvolutionCard 卡模型 + (repoId, commit) 分桶机制，incident 并流的宿主。
- `apps/repoqa-web/src/components/Canvas.tsx`（749 行，裁决②拔除对象）：L404-458 composer 表单（testid chat-mode-switcher / chat-input / chat-submit）；L279-299 MessageBubble 气泡流；L266-278 chat-empty 空态；L300-322 totalUsage 条；L323-350 streaming/reconnect/recovered/error+retry 指示条；L352+ trace strip（**保留但需重接线**——现从 messages prop 提取 traceSteps/anchors，拔除后 messages 不再传入）；MessageBubble / TraceOutcome / OffRampActions 内部组件一并删除。
- App.tsx 接线：`useChat` 仅剩 Canvas 消费；`handleIncidentSubmit` L328-334（隐私同意门 L336-346）；`inspectorSlices` L406-414（现单源 useChat messages，需改双源：session 卡 + Canvas 剩余面）；incident 视图渲染 L537-558；深链 `?mode=incident` 三处 L179-268。

## 改动点
- **卡模型泛化**：`useEvolutionSession.ts` 引入联合卡类型 `EvolutionCard | IncidentCard`（或 `kind: 'evolve' | 'incident'` 判别）；`IncidentCard` 承载 incident done 载荷全量：intent(用户问题)+stack、answer 文本、evidence 分级清单、mermaid、provenance/lowConfidence/usage、commit。
- **IncidentCard 流入同一 Artifact Stream**：incident 提交不再走 `useChat.messages`，改投 useEvolutionSession（(repoId, commit) 隔离自动获得——现状 useChat 只按 repoId 分桶，不满足 ADR-0012）；诊断卡展开体 = 堆栈回显 + EvidenceCard + MermaidDiagram + 动作行。
- **流式语义**：incident 提交的 streaming 卡沿用 status='streaming'→done/error 生命周期；streaming/reconnecting/recovered/error 状态条照搬现 IncidentView 文案。
- **Composer 复用**：StackTraceInput 保持 incident 视图唯一输入口（占位文案照旧"粘贴堆栈或描述症状"）。
- **动作接线不变**：incident-trace-crash（crashTarget 判定逻辑原样迁移）/ incident-open-workbench / EvidenceCard→Inspector 跳转。
- **深链不变**：`?mode=incident` 仍直达 incident 视图（现顶栏 Tab 或收编后入口形态由实现定，测试断言深链语义）。
- **Canvas 拔除（裁决②）**：删 composer 表单、MessageBubble 流、chat-empty 空态、totalUsage 条、streaming/reconnect/recovered/error 指示；trace strip 保留但数据源重接线（不再依赖 messages prop）；Canvas props 相应精简；侧栏留纯事实探针（节点/边 + 既有 Inspector 面板）。
- **useChat 降为内部**：气泡流拔除后 useChat 的对话式渲染面不复存在——topo 呼出链路（Top API/trace-crash 驱动的 call-chain 提交）保留，incident 消费路径全部改投 useEvolutionSession；多轮追问入口只指向演进/事故工作台（off-ramp 引导文案），不再有自由输入框。
- **清理**：IncidentView.tsx 气泡渲染路径删除；`ChatMessage` 的 stack/evidence 字段与 useChat incident 分支的归属（保留 API 兼容 or 降为内部）由实现按最小 diff 定；IncidentView.test.tsx 重写为 InvestigationStream 断言；chat.test.tsx 气泡流断言——核心状态机测试随 incident 收编迁移，纯气泡 UI 断言删除；App.test.tsx incident 块改接线（evolveStream mock），chat-empty 断言改 Canvas 存在性断言。

## 验收
- incident 提交 → 流内出现 streaming 诊断卡 → done 载荷四件套（evidence/mermaid/answer/usage）渲染齐全；BREAK/SUSPECT 低置信标注可见。
- (repoId, commit) 隔离：切仓不串流、re-index 开新流（与 evolve 卡同规则）。
- trace-crash 点击后 call-chain 视图起点与现状一致（显式 (name,file)）。
- 组件测试覆盖：提交→卡入流→追问第二卡；崩溃符号判定（VERIFIED 首个）；深链 ?mode=incident。
- Canvas 拔除后：全仓 grep 无 chat-input / chat-submit / MessageBubble 残留；trace strip 仍渲染（重接线后断言）；`?mode=incident` 深链与 Top API→call-chain 链路回归绿。
- web 全量 vitest + typecheck + build 绿；gate 42 项回归绿。

## 非目标
- 不动 ADR-0011 服务端静态管线与 eval incident bucket 冻结题。
- 持久化归 Ticket 25.3（本 ticket 卡仍为内存流）。
- Dashboard/Canvas 全景探针矩阵化重组织：裁决①坚决排除，不纳入 v1，留待视觉专项。
