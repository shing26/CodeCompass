---
status: accepted
---

# 图谱几何由确定性引擎垄断渲染，LLM 不产出连线

grilling 裁决（Issue 24 酝酿会话）。现状缺口：`finalizeAgentResult` 对模型自绘 mermaid 仅做 click 绑定格式过滤（`sanitizeMermaidClicks`），边（`A --> B`）从不过 Call Edge 校验——模型可以编造连线并原样抵达用户屏幕，与零幻觉合约（ADR-0011）"每条调用链断言必须逐字来自本次会话工具返回的 Call Edge"相抵。决定：图谱几何骨架一律由确定性引擎从物理边表渲染；LLM 产出契约从 mermaid 字符串降级为结构化图层指令（图型枚举 + focus 符号集 + 折叠层级 + 节点注释），引擎负责几何与 code:// 深链，LLM 只做注释与折叠。准入渲染器白名单（已存在）：`traceToMermaid`（trace hop 物理建图）、驾驶舱配置拓扑、Issue 11 Tour 路线；新图型必须先在引擎实现。

否决方案一：边级校验（保留模型画图、finalize 逐边核验 Call Edge、未知边剥除或降级）——本质是用解析器"批改作业"的反向工程：重载方法、接口别名、内部类使符号消歧漏检率无法归零，且 Mermaid 解析 + 消歧器徒增运行时代价；底层解析器本已掌握精确到 AST 物理行号的 Caller→Callee 边表，让模型凭概率猜连线再回头校验是倒退。

否决方案二：按主张分级（代码关系主张的图引擎出图、"纯叙事装饰图"允许模型画）——排障现场不存在不含代码主张的箭头：工程师默认屏幕上每条连线都是物理事实并顺着它查代码，一条脑补边即触发零幻觉违约；该纪律靠评审自觉维持必然渗漏。

代价：叙述性可视表达受限（模型不能再自由画示意图），新图型有引擎实现前置成本——叙事补充由工件卡文字与表格承载。波及面（实施随 Issue 24）：`runReActAgent` prompt（CODE_LINK_MMERMAID_GUIDE 改写为图层指令规范）、`finalizeAgentResult`（mermaid 字段改为引擎渲染产物）、eval（模型自绘 mermaid 相关断言项下线）。迁移期披露：图层指令契约落地前，incident 模型自绘边继续存在（已知缺口），现 eval gate 只覆盖文字断言不覆盖边。
