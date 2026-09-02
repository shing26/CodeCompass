---
status: accepted
---

# 演进建议工作台：自由文本意图入口，LLM 单次解析、引擎锚定

grilling 裁决（Issue 24 酝酿会话）。演进建议与推演是 Dual-Surface 矩阵三视图中唯一新建的视图（全景看板 = Dashboard 重组织、拓扑大屏 = Canvas 增量、Monaco 抽屉 = Inspector 既有）。入口定为自由文本意图：用户输入"给订单模块加 Excel 导出"级别的自然语言，LLM 仅做一次意图解析（intentType + 目标短语 + 扩展目标），目标落地由引擎既有意图锚点能力完成（domain_radar 模糊匹配链 + doc-chunk 证据 + 图排名，零 embedding）；解析结果回显在工件卡头部（resolved target + 备选清单），错了改一版重新投递——披露强制、不反问（Intent→Artifact，ADR-0012）。解析之后的模式嗅探（ADR-0014）、落位、清单全部在引擎侧，LLM 不再触碰事实层。工件卡四段结构：惯例清单（锚点 + 覆盖率）/ 落位表 / 下线级联死代码清单（DEPRECATE）/ 风险 Checklist。

理由：面向陌生代码库的用户填不出精确符号名，结构化表单把雷达的活推回给用户，"顾问"名不副实；LLM 单次意图解析属编排层职责（ADR-0005），事实层零 LLM 边界不破。否决方案：结构化表单为唯一入口（陌生仓库可用性差）；多轮澄清式解析（违 Intent→Artifact 单次完成度合约）。代价：意图解析错误率成为新质量面，需 eval bucket 度量（resolved target 是否命中用户所指）。

打包（4b 已裁决）：Issue 24 = 图层指令契约实装（ADR-0013）+ Pattern Ingestion 工具与 EXTEND/DEPRECATE 消费 + 本视图 v1；Issue 25 = IncidentView 工件流收编（ADR-0012 彻底执行）+ MCP 补演进类工具。实施随 Issue 24。
