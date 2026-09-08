# 01 — PR Impact Report 契约冻结

**What to build:** 让 `codecompass diff --output=json` 与后续 `pr-summary`、MCP 工具共享一份带版本的 PR 影响报告契约：报告对象新增 `schemaVersion: 1` 与 `summary` 计数，既有字段保持原名只增不改。消费者可以在不读源码的情况下判断格式版本、依赖影响计数，并继续使用原来的 `affectedApis` / `configChanges` / `uncovered` 等字段。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `diff --output=json` 的 JSON 顶层包含 `schemaVersion: 1`
- [ ] JSON 顶层包含 `summary`，覆盖 `changedFiles` / `modifiedSymbols` / `affectedApis` / `configChanges` / `uncovered` 计数
- [ ] 既有 JSON 字段保持原名，未被重命名或删除；旧字段断言测试继续通过
- [ ] 核心分析函数可被 CLI 与 MCP 共用，输出 shape 一致
- [ ] 后端 typecheck 与新增/既有相关测试通过

## Comments

### 2026-08-25 implementation

- `DiffReport` 增加 `schemaVersion: 1` 与 `summary` 计数；既有字段保持原样。
- `repoqa-diff.test.ts` 覆盖 markdown fixture、analyzeDiff 与 CLI JSON 三种路径的契约断言。
- 验证：`tsc --noEmit` 通过；`repoqa-diff.test.ts` 16/16 通过。
