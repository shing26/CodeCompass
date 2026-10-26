# 票 01 — output-contract 回执模块

Status: done

新模块 services/control-plane/src/mcp/output-contract.ts：

- extractAnchors(value)：递归提取 (file|filePath, line|lineStart|callLine?) 锚点对象；
- countBreakMarkers(value)：清点 BREAK/BROKEN/EXTERNAL/DYNAMIC/UNRESOLVED/SUSPECT；
- buildVerificationReceipt({tool, value, resolveRoot})：锚点对照 root 做文件存在性校验，
  产出 { engineVersion, tool, verdict, anchorsChecked, anchorsMissing[], breakMarkers{}, diagnostics[] }；
  verdict ∈ VERIFIED / ANCHORS_MISSING / NO_EVIDENCE；diagnostics 逐条带 path（JSON 路径）。
- 同位测试 output-contract.test.ts：三 verdict 分支 + 嵌套数组 + 非字符串载荷。
- **2026-10-27 追认（v1.6.1 票 01，评审 L1）**：实现最终有**四种** verdict——票面写的三值之外多了
  `UNCHECKED`，用于「有锚点但校验没做完」（无仓库根 / 超出 `MAX_ANCHORS_CHECKED` 被截断）。
  它不是随手加的状态：v1.5.1 已经把「截断」与「无 root 跳过」都做成 `UNCHECKED` + 回执级诊断，
  少了它这两类只能谎报 `VERIFIED`。**以代码与 CHANGELOG 的四值为准**，票面三值属立项时的估计。
