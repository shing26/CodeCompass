# Issue 25(占位,待 Issue 24 收官后开工)

依据 ADR-0012/0015 的打包裁决(4b),以下内容明确延后:

1. **IncidentView 工件流收编** — 聊天消息流 → Artifact Stream 时间线;Incident 收编为推演台内专用堆栈诊断控制台(ADR-0011 边界不变)。
2. **MCP 演进类工具** — `codecompass_get_conventions`(惯例清单)、`codecompass_plan_evolution`(EXTEND/DEPRECATE 引擎管线,意图解析在宿主侧);遵循 Dual-Surface 原则:纯引擎、零 LLM、与 Web 同一份引擎输出。
3. **Artifact Stream 服务端持久化** — v1(Issue 24)前端按 (repoId, commit) 隔离;跨会话持久化在此评估。
4. **Dashboard/Canvas 重组织** — 全景探针矩阵化(品牌徽标/模块边界/入口扫描三卡布局)与 Level-1 API 路由矩阵增量。

前置:Issue 24 全部 ticket 通过 gate;v0.16.0 已提交(版本一致性 gate + closeout_gate.py)。
