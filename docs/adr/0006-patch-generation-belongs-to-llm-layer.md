---
status: accepted
---

# 补丁生成归 LLM 编排层，确定性工具不产补丁

DiagnoseResult 契约保留 `suggestedPatch` 字段，但确定性工具恒不填充；补丁只在 ReAct 编排模式下由 LLM 基于确定性链路证据生成，并标注 `suggestedPatchSource: 'llm-generated'` 提示人工审核。理由：补丁是生成式产物，若由"确定性工具"输出会伪装成验证过的事实，破坏证据面（Evidence Plane）的信任模型；CI 场景（`codecompass diagnose` JSON）因此完全不依赖 LLM 可用性。代价：报告里的补丁不保证可编译，必须人工审核后才能落盘。
