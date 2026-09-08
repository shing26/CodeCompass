# Ticket 24.1 — 图层指令契约(ADR-0013 实装)

## 目标
消灭"模型自绘边"迁移期缺口:LLM 永不出 mermaid 字符串,只出结构化图层指令;几何一律由引擎白名单渲染器产出。

## 状态:已完成(v0.16.0 后,Ticket 01)

## 改动点(实装)
- `repoqa-llm.ts`:
  - 新增 `LAYER_DIAGRAM_KINDS = ['call_chain','config_topo','tour']`、`LayerInstruction`、`ReActLLMResult.diagram?`;`mermaid` 标 `@deprecated`。**kind 枚举 v1 定案:不加 blast 图**(ADR-0013 open question 裁决)。
  - `CODE_LINK_MMERMAID_GUIDE` 整体替换为 `DIAGRAM_LAYER_GUIDE`(禁止模型出 mermaid,指示出 diagram 指令);buildAgentPrompt 的 JSON reply 行改为含 `"diagram"` 无 `"mermaid"`。
  - 新增 `sanitizeLayerInstruction(raw)`:**仅结构层** sanitize(kind 白名单、focus 字符串数组 cap 12、collapse clamp 1..20、annotations 单行 cap 80/160)。
  - `finalizeAgentResult`:`diagram = sanitizeLayerInstruction(...)`,**恒置 `mermaid: undefined`** —— 模型自绘 mermaid 不进任何 payload。
  - 整删模型 mermaid 辅助函数 8 个(`stripMermaidFence`/`CODE_BINDING_*`/`isCodeLinkBinding`/`sanitizeMermaidClicks`/`CodeLinkBinding`/`extractCodeLinkBindings`/`mermaidNodeIds`/`bindAnchorsToMermaid`),全仓无外部引用。
  - `ReActAgentOptions.onToolResult?`:text 循环与 native 循环在每个工具执行后回调(供 worker 收割会话证据)。
- `repoqa-worker.ts`:
  - 导出 `SessionGraphEdge {file, method, line}` 与 `DiagramSession {edges, failedTools}`;`collectSessionEdges` 识别 trace 行(`file|filePath, method|symbol, line>0`)与 diagnose `verifiedChain`;`harvestDiagramSession` 记 failedTools(error 结果)+ 收边。
  - `renderLayerInstruction(instruction, repo, symbols, session)` 公开分发器:
    - `call_chain` → `renderCallChainDiagram`:focus→findStartSymbol,fallback 用会话边反查符号;resolveCallChain 4 跳;trace<2 → undefined;**failedTools 非空 → 直接 undefined**(失败会话不出几何)。
    - `config_topo` → `renderConfigTopoDiagram`:focus 全不匹配任何 key → **undefined(不出全量兜底)**;`flowchart LR` + `id["key (sensitive)"]` + code:// click + group 节点边;nodeIdOf 清洗防碰撞。
    - `tour` → `renderTourDiagram`:buildTours,focus[0] 为 tour id(未知 → undefined,无 focus → main-flow);annotations 按 mermaidNodeIds 过滤后追加 note。
  - `traceToMermaid` 加可选 `annotations`:节点备注以 `%% note <name>: <text>` 追加(仅注释不改几何,键不在节点集丢弃)。
  - architecture 与 incident 两条 LLM 通路均接 diagramSession + onToolResult,mermaid 事件与 done payload 只出 `engineMermaid`(原 `real.mermaid` 引用全删)。
- 存在性校验**两层拆分**(与计划差异):结构层(llm,无 session 上下文,只做形状)/ 渲染层(worker,有符号表与渲染节点集,校验 focus 符号与 annotation 节点存在性)——职责已写进 JSDoc。
- 前端消费方无改动:done payload 的 mermaid 仍是引擎渲染产物,MermaidDiagram 渲染路径不变。

## 验收(实测)
- 全链路 fixture(`repoqa-http.test.ts`):模型返回 legacy mermaid 字符串 → `payload.mermaid` 为 undefined(两处测试均验证剥离);返回合法图层指令 `diagram:{kind:'call_chain',focus:['hello']}` → 引擎渲染 `hello[hello]` + `click hello "code://.../Controller.java#5"` + `click greet "code://.../DemoService.java#4"`,不含模型自绘节点(`Service[Service]` 不出现)。
- **边级溯源断言**:done.mermaid 中每个 `click` 节点名 ∈ 该会话 `trace_call_chain` 工具结果的 method 集合(从 ReAct prompt 的 tool result 提取)——几何全部可溯源到会话证据。
- eval 下线说明:repoqa-eval 冻结集中**本无 mermaid 断言**,无需改 eval;"下线"落在 http.test 的旧模型 mermaid code:// 绑定断言(#7/#4 来自模型锚点的断言已删除,改为引擎渲染断言 #5/#4)。
- 测试结果:repoqa-llm.test 33/33 + repoqa-http.test 64/64 = 97/97;control-plane 全量 **478/478**(基线 479:模型 mermaid helper 测试删除、新用例合并,-1 属预期);web **270/270**;golden eval 75 题 100%、incident hallucination 0%;closeout gate **37/37**;`npm run build` 四包全绿。

## 记忆锚点
- annotations 匹配的是节点名(trace 路径 method 名/配置 key/tour step symbol),不是清洗后的 mermaid id(traceToMermaid 中两者相同,config_topo 中 label=key)。
- http.test 的 ReAct 断言若从 prompt 提取 tool result,注意请求体是二次序列化:prompt 内嵌 JSON 已转义,正则需匹配 `\"method\":\"...\"` 形式。
