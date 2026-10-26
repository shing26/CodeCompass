# 票 06 — v1.5.0 收口

Status: done

版本五处推进 1.5.0（四本 package.json + version.ts 单一源；bridge-adapters 0.6.0
独立线不动）；CHANGELOG [1.5.0]；README 路线图勾销 R5-13 + 补 v1.5.0 条目；
HANDOFF §4 划销 R5-13；门禁：typecheck + 控制面/web/bridge 单测 + e2e ≥73 全绿。
提交由用户本机执行（Mimosa 拦截 ZCode 层 commit）。
- **2026-10-27 追认（v1.6.1 票 01，评审 L4）**：`scripts/e2e/closeout_gate.py:1904-1912` 把
  「断言 `Lifecycle (v1.0)` 存在」改成了「断言其**不存在**」。这**不是**削弱门禁：被断言的占位
  已按 ADR-0021 删除，不改则门禁必红。门禁记录条数未变（`record(` 95 处，改前改后一致）。
  spec:39-40 的字面要求「只增不删」被这一次反转触到，特此追认——后续同类改写请一并记在这里。
