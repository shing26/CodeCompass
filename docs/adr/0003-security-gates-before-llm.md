---
status: accepted
---

# 安全门禁先于任何 LLM 调用与前端渲染

HANDOFF 原顺序把 sensitive config masking 放在 ReAct/LLM 集成之后，这与 NFR-3 冲突。决定：secret masking 与 `/file/raw` 路径穿越防护是首次真实 LLM 调用前的硬 gate，并同时覆盖 LLM 上下文、前端证据卡、Dashboard 与导出内容；配置只展示 key 名，不展示值或本地绝对路径。理由：泄漏不可逆，而延迟几天接入 LLM 的成本很低；masking 结果应记录为最小事件，以保证安全和产品输出都可解释。
