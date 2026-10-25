# 票 01 — output-contract 回执模块

Status: done

新模块 services/control-plane/src/mcp/output-contract.ts：

- extractAnchors(value)：递归提取 (file|filePath, line|lineStart|callLine?) 锚点对象；
- countBreakMarkers(value)：清点 BREAK/BROKEN/EXTERNAL/DYNAMIC/UNRESOLVED/SUSPECT；
- buildVerificationReceipt({tool, value, resolveRoot})：锚点对照 root 做文件存在性校验，
  产出 { engineVersion, tool, verdict, anchorsChecked, anchorsMissing[], breakMarkers{}, diagnostics[] }；
  verdict ∈ VERIFIED / ANCHORS_MISSING / NO_EVIDENCE；diagnostics 逐条带 path（JSON 路径）。
- 同位测试 output-contract.test.ts：三 verdict 分支 + 嵌套数组 + 非字符串载荷。
