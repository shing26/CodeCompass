# v1.6.1 — 回执面评审遗留项（Receipt Leftovers）

Status: in_progress

## 定位（ADR-0021 通道 A 论证）

`docs/reports/code-review-2026-10-26.md` 的双轴评审里，与回执相关的硬伤（S-1 断链计数、
S-2 行号校验、S-3 截断可见）已在 v1.5.1 修完；**剩下四条口径问题没人认领**，本批一次清掉。

降低哪类误报：回执/工件的「自我描述」与实现不一致——读者按票面或回执文字理解行为，
拿到的却是另一套事实（第四种 verdict 未入册、重放命令写错、repoPath 越权、门禁反转未追认）。

**不是产品面扩张**：17 个工具输入签名与返回体结构零变化；唯一代码改动是收窄 repoPath 的生效面。

## 决策

1. **以实现为准、票面追认为辅**：L1/L2/L4 是「文字与实现不一致」，实现侧是对的
   （四 verdict 是必需的、`export` 才是能复现工件的命令、门禁反转是 ADR-0021 删除占位的必然）；
   历史票面**只追加 Comments**，不改正文（`docs/agents/issue-tracker.md` 的约定）。
2. **L3 是代码缺陷，必须改代码**：`repoPath` 只存在于 `codecompass_get_pr_impact` 的输入里，
   其余工具拿它当仓库根 = 替调用方猜仓库，锚点校验基准不可信。收窄到单一工具，其余忽略。
3. **本批不碰共享区**：CHANGELOG / README / HANDOFF / CONTEXT / 版本五处留给下一个收口
   （v1.7.0 正在收口，本批只出代码与票面，合入后由下一个收口带版本车次）。

## 文件面（开线声明）

- `services/control-plane/src/mcp/repoqa-mcp.ts`（收窄 repoPath + 导出纯函数便于测试）
- `services/control-plane/src/mcp/verification-root.test.ts`（新）
- `.scratch/v1.5-deliverable-verification/issues/01|03|06-*.md`（只追加 Comments）
- 本目录 `.scratch/v1.6.1-receipt-leftovers/`
- **不碰**：CHANGELOG / README / HANDOFF / CONTEXT / 版本五处 / `export-artifact.ts`（v1.7 线在改）

## 票清单

- 01 评审遗留四项（L1 四 verdict 追认 / L2 重放命令追认 / L3 repoPath 收窄 / L4 门禁反转追认）

## 完成定义

- `receiptRootFromRepoPath` 只对 `codecompass_get_pr_impact` 返回路径，其余工具 undefined；
- 控制面 typecheck 零错、`src/mcp` 测试全绿、全量单测不回归；
- 三条追认评论落在对应票面 Comments 下，历史正文未改。

## Comments

- 2026-10-27 立项：来源 `docs/reports/code-review-2026-10-26.md` 的 Spec 轴未销项，四项合为一批。
  在独立 worktree（`v1.6.1-receipt-leftovers`）开工，避免与 v1.7 线的 dirty 工作树互相污染。
