---
status: accepted
---

# Incident Copilot：Web 端改造、纯静态边界、零幻觉合约作 CI 门禁

构建排障副驾驶时三个决定一并拍板。**形态**：在现有 repoqa-web 上改造（新增 Incident 视图 + 模式参数），不另起应用——锚点切片、mermaid 深链、脱敏等基建已存在，重建是纯返工。**边界**：v1 输入仅"文字描述 + 粘贴堆栈/日志"，由确定性 `parseStackTrace` 提取 `Class.method(File.java:123)` 反查符号表，坚决不接 APM/日志流——守住本地优先与零外部依赖（ADR-0001），代价是运行时定位不在射程内。**信任模型（零幻觉合约）**：每条调用链断言必须逐字来自本次会话工具返回的 Call Edge，每个 file:line 引用必须过 raw-file 物理校验，静态不可达边界强制标 BREAK/SUSPECT，禁止叙述性补全；叙述性总结与逻辑串联不要求逐句锚定（否则可用性归零）。验收 = golden eval 新增 incident bucket 幻觉率 0%，作为发布 gate（延续 ADR-0004）。Copilot 模式独立 6 步 ReAct 预算（普通问答保持 3 步不变），主测 DeepSeek 与 OpenAI 的 OpenAI 兼容端点，tool-call 兼容性以标准 `tools`/`tool_calls` JSON 规范做 fixture 与 mock。
