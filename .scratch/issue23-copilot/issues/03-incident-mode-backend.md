# 03 — Incident 模式后端（工具面 / 6 步预算 / 标准 tool_calls）

Status: done

<!-- Done 2026-09-01. 实现要点:
- repoqa-llm.ts: INCIDENT_MAX_AGENT_STEPS=6 + INCIDENT_ZERO_HALLUCINATION_GUIDE; NativeToolSpec/AssistantToolCall/NativeChatMessage 类型; toNativeToolSpecs(缺 schema 回退 permissive object); parseToolCall(标准/扁平 shape 容错); completeNativeChat(非流式, 4xx 降级重试不带 tools → NativeToolsUnsupportedError 带原始 status); runReActAgent 加 nativeTools/guideExtra → runNativeToolsLoop(assistant.tool_calls 回放规范化、每个 tool_call_id 配对 role:'tool'、argsError 回填 {error:'invalid ...'}、reasoning_content/空 content 处理), 收到 NativeToolsUnsupportedError 降级旧文本 JSON 协议。
- repoqa-worker.ts: mode='incident' + stack 在门禁判断前分流 runIncidentQuery; LLM 路径=白名单工具(diagnose_chain/blast_radius/trace_call_chain/get_config_evidence/parse_stack_trace 带 parameterSchema)+6 步+nativeTools+零幻觉 guide, 锚点过 isValidAnchor 盖 commit, 豁免 1.5s 延迟门禁(ADR-0011 注释); 静态回退=parseStackTrace→resolveFramesToSymbols→runDiagnose+runBlastRadius+matchConfigSymbols 三段式中文回答, unmatched 帧 BREAK, tool.miss 事件, mermaid 由 verifiedChain 转 traceToMermaid; pickCrashSymbol(首个匹配帧→route→method 兜底)。
- http.ts: handleQuery 共用 handler 注册 GET+POST, body 参数优先于 query string, mode/stack/startName/startFile 统一 pickString。
- 缺陷修复: SSE 断连检测从 req.close 改为 res.close — POST + express.json() 时请求消息完成后 req 'close' 即触发, closed=true 导致流在首个事件前中断、响应挂死(POST 测试超时暴露); res 'close' 仅在连接真正断开时触发, GET/POST 全量 64/64 绿。
- 测试: repoqa-llm.test.ts 30/30(DeepSeek reasoning_content+tool_calls 回放断言、6 步收敛/超步、畸形 tool_calls 容错+配对断言、4xx 降级、NativeToolsUnsupportedError); repoqa-http.test.ts 64/64(新增 5: incident LLM 路径无门禁+白名单+guide+tool 配对+commit 锚点、静态回退 VERIFIED/BREAK+tool.miss、无 stack 症状兜底、GET SSE 透传、POST body+404/400); tsc --noEmit 干净。
-->


## 目标
- `repoqa-llm.ts`：
  - `INCIDENT_MAX_AGENT_STEPS = 6`；`runReActAgent` 升级为**标准 OpenAI `tools`/`tool_calls` 协议**（`tools:[{type:'function',...}]`、assistant.tool_calls、role:'tool' 结果回填）；保留旧文本-JSON 解析作为端点不支持 `tools` 时的回退（fixture 双轨）。
  - 处理 DeepSeek/OpenAI 兼容差异：`reasoning_content` 存在时取 `content`；`tool_calls` 与文本可并存；`finish_reason` 判定。
- `repoqa-worker.ts` `queryRepo` 新增 `mode: 'incident'` + `stack?: string`：
  - LLM 门禁路径放行 incident；工具白名单 = `diagnose_chain` `blast_radius` `trace_call_chain` `get_config_evidence` `parse_stack_trace`（新增，调用 01 的解析器）；`maxSteps: 6`。
  - 确定性回退路径（无 LLM/无门禁）：parseStackTrace → resolveFramesToSymbols → 以崩溃点/入口符号跑 diagnose 穿透 + blast 半径 + 配置证据，合成三段式回答；解析不到的边界输出 BREAK 说明。
- incident 回答执行零幻觉合约：链路断言仅来自工具返回；answer 中 file:line 交给既有 anchor 校验。
- `http.ts`：`/api/repos/:id/query` 接受 `mode=incident` 与 `stack` 查询参数（POST body 备选，GET 优先保持现状）。
- recordEvent：`query.start/done` intent 记 `incident`。

## 验收
- fixture mock：DeepSeek 风格（reasoning_content + tool_calls）与 OpenAI 风格各一；6 步循环收敛、超步终止、未知工具容错。
- worker 单测：incident LLM 路径、确定性回退路径、stack 解析进上下文；http 测试：mode/stack 透传、404/400。
- 现有测试全绿。
