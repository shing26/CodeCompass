# v1.5 — 交付也可验证（Deliverable Verification）

Status: done

## 定位（ADR-0021 通道 A 论证）

本批回答的误报类别：**agent 对工具返回体的误读与过度解释**。当前 17 个 MCP 工具的
输入签名冻结（ADR-0020），但返回体只有编译期 TS interface（packages/contracts），
没有运行时校验；证据字段（file:line、断链标记）的完整性对消费者是不可验证的断言。
本批把「宁可标记断链，绝不编造」从引擎内部纪律延伸为对外契约的一部分：

1. 每个证据承载型工具的返回体附带 **verification 回执**——锚点存在性、断链标记、
   证据完整性的机器可校验结果，任一项不过在回执里明确写明，绝不静默交付；
2. HTML 诊断工件内嵌 **重放校验入口**（repoId + commit + 本地重放命令）——工件脱离
   引擎环境后，读者仍知道如何回到可验证状态；
3. 收尾 R5-13 剩余半（无链路兜底文案）。

## 决策

- **回执是增量字段，不动 17 个签名**。verification 作为返回体顶层附加字段，
  输入 schema 与工具数量不变；破坏面为零。精度论证：压缩 agent「过度解释无证据
  返回体」的空间（HANDOFF §4 仍开放项 9 的同类思路）。
- **锚点存在性按物理事实校验**：从返回体递归提取 (file, line) 对，对照
  repo.localPath 文件系统存在性——与 chat 侧 raw-file 校验同一判据。
  缺失即回执 verdict=ANCHORS_MISSING，带 path 标注的 diagnostics；不删除载荷
  （签名冻结优先），但回执置于顶层且 diagnostics 逐条给路径。
- **断链标记计数**：BREAK/BROKEN/EXTERNAL/DYNAMIC/UNRESOLVED/SUSPECT 枚举值
  逐字段清点写进回执——消费者看到的是「这批结论里有多少条静态证据断口」的
  确定性读数，而不是自行猜测。
- **无证据返回体**（如纯文本答案）回执 verdict=NO_EVIDENCE，同样是确定性陈述。

## 文件面（开线声明）

- services/control-plane/src/mcp/repoqa-mcp.ts（出库 chokepoint 挂回执）
- services/control-plane/src/mcp/output-contract.ts（新）+ 同位测试
- services/control-plane/src/artifact-report.ts（重放戳）
- apps/repoqa-web/src（R5-13：Canvas / ChatRuntimeContext / App + 测试）
- 共享区（CHANGELOG / README / HANDOFF / 版本五处）：收口时一次性做（票 06）
- 不触碰：17 工具输入 schema、packages/contracts 镜像类型、e2e 断言数
  （若 e2e 需要新断言，只增不删）

## 票清单

- 01 output-contract 回执模块（提取/校验/诊断）
- 02 registerPlain 挂载回执 + 审计
- 03 export HTML 重放校验入口
- 04 R5-13 无链路兜底文案（Web）
- 05（登记 deferred）Go chunk 检索覆盖缺口
- 06 收口：版本 1.5.0 五处、CHANGELOG、README/HANDOFF、门禁

## 完成定义

- 回执随 trace_call_chain / diagnose / reverse_deps / get_pr_impact /
  get_subgraph_context / scan / refactor_plan 等证据型工具返回；
- 缺锚点场景（构造 fixture）verdict=ANCHORS_MISSING 且 diagnostics 带路径；
- typecheck 零错误；控制面/web 单测全绿；e2e gate ≥73 项全绿；
- CHANGELOG [1.5.0] 条目齐；README 路线图勾销 R5-13。

## Comments

- 2026-10-25 立项。P0 的 npm publish（1.4.2 已 tag）因本机 npm 凭证缺失由用户
  自行执行，不阻塞本批。