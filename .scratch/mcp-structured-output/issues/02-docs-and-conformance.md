# 02 — 契约文档 + 通用套件跟随

Status: done

> 依赖:票 01

## 内容

1. `docs/mcp-tool-contract.md` 增「structuredContent 与 outputSchema」节:
   - 声明 outputSchema 后 SDK 强制校验成功结果(引用 `server/mcp.js` 行为);
   - trace_call_chain 数组的 `{ items }` 包装约定(仅结构化通道);
   - 掩码同源声明(structuredContent 由掩码后文本反序列化,R1 双通道成立);
   - 错误路径(isError)不携带 structuredContent。
2. `scripts/e2e/mcp_conformance.py` 增一条零项目数据依赖断言:tools/list 中声明了 outputSchema 的工具,成功调用必须返回对象型 structuredContent(可对任意实现跑)。

## 验收

- [x] 文档节落地(第六节:三条硬规则 + schema 保真度规则 + 通用断言;第五节断言数 6→7)
- [x] conformance 探针 G self 绿(7/7,schema_tools=17 success_probes=1);假服务端 4 违规仍被抓,probe G vacuous 通过
- [x] `grep orphanedPublic scripts/e2e/mcp_conformance.py` = 0(零项目数据依赖不变)
