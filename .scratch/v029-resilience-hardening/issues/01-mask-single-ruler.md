# 01：T1 — 掩码强尺统一，三裸面收编（销 V27-21）

> *Parent spec：`.scratch/v029-resilience-hardening/spec.md`（grill 假设 B 授权：强尺统一）。*

Status: closed
标签：安全 / P0 / 来源：v0.27 台账 V27-21（R3 review P1-2 残余）+ 2026-09-15 侦察升级。

## 现状（侦察实测，比台账更重）

1. 强尺 `engine/repoqa-masking.ts::maskSensitiveText` = **14-pattern**（pem/jwt/github/openai/aws/aliyun/tencent/bearer/url-userinfo/credential-assignment…）。
2. 弱尺 `chat/llm.ts::maskSecrets` = 3-pattern（AKIA/sk-/Bearer），chat copilot 成功路径工具结果过它出库（`chat/agent.ts:282` summarizeIfLarge）——注释自认「full 13-pattern set stays in CodeCompass」。
3. **scan 旁路**：`chat/agent.ts:289-313` codecompass_scan 超限分支 summary 从 **raw** 构造，未经任何掩码。
4. **native tool loop 裸面（台账未记）**：`engine/repoqa-llm.ts:814-817` `capPrompt(JSON.stringify(executed))` 无掩码 push 进 messages（:829）。

风险定性：密钥可随「成功」的工具结果进入 LLM 上下文再被回声——错误路径 R3 已强尺，成功路径是三处缺口。

## Agent Brief

**Summary:** 三处统一改 `maskSensitiveText`（scan 分支改从 masked 构造 summary；native loop push 前过尺；chat summarizeIfLarge 换尺）；`maskSecrets` 先 grep 消费者：若仅 agent.ts 一处则删除，否则标 `@deprecated V27-21` 保签名。CONTEXT.md 增「出库掩码不变式（outbound masking invariant）」词条（glossary 现无 masking 条目，ADR 不发）。
**Acceptance:** ①三裸面各一例「植入伪密→断言出库文本无明文」（词面拆分构造防 copy-guard 自燃）；②golden eval 97 题全阈值绿（eval 走确定性引擎不经聊天面，预期零翻车——翻车即停票上账）；③e2e 62 + UI 冒烟（chat 链路实战）绿。

## Comments（2026-09-15 实施收口）

- 落地：①`chat/agent.ts` summarizeIfLarge 换强尺且 **scan 分支改 parse masked**（替换只落 JSON string 值内部，结构可解析；parse 失败兜底仍回 masked，不留 raw 通路）；②`engine/repoqa-llm.ts:817` native loop 工具结果 `capPrompt(maskSensitiveText(...))`（对齐 text loop :750 既有做法）；③`chat/llm.ts` 弱尺 `maskSecrets` 整函数删除（消费者仅 agent.ts + chat.test 各一处），chat.test trio 例随废。
- 侦察修正：台账只记「弱尺两把」，实测**三处并存 + scan 旁路零掩码 + native loop 全裸**——第四把是「零尺」，票面现状节已升级。
- 词条：CONTEXT.md 新增「Outbound Masking Invariant（出库掩码不变式）」——单一尺、无分级豁免、错误面与成功面对称；ADR 不发（词条承载即可）。
- 测试：`repoqa-llm.test.ts` +1（native 入 messages 前掩码，ghp_/sk- 假密拆构造）、`chat.test.ts` +1（scan 超限 summary 无明文含 [REDACTED）；cp **639/639**（+2−1 账平）、tsc 净、esbuild 成功、**e2e 62/62（golden eval 零翻车，假设②兑现）**、UI 冒烟 PASS（chat 链路实战）。
