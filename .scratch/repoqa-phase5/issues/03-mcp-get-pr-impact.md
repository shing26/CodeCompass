# 03 — MCP codecompass_get_pr_impact

**What to build:** 在现有 MCP 工具表新增 `codecompass_get_pr_impact` 工具。Agent 客户端可通过 `tools/list` 发现该工具，通过 `tools/call` 传入 `repoPath`、`base`、`head` 直接获得 PR 影响 JSON 报告；该工具不要求 repo 已提前索引，也不依赖 HTTP 服务，仍遵守只读 git 与配置值永不输出的约束。

**Blocked by:** 01 — PR Impact Report 契约冻结

**Status:** ready-for-agent

- [ ] `MCP_TOOLS` 包含 `codecompass_get_pr_impact`，输入 schema 包含 `repoPath` / `base` / `head`
- [ ] `tools/list` 能返回新工具的 description 与 input schema
- [ ] `tools/call codecompass_get_pr_impact` 对临时 git 仓库返回带 `schemaVersion` 的 JSON 报告
- [ ] 报告中的配置变更只含键名与位置，不包含配置值
- [ ] 不依赖已索引 repo；对无 SQLite 记录的 repo 也能直接分析
- [ ] MCP 测试覆盖新工具注册、调用与脱敏断言；typecheck 通过

## Comments

### 2026-08-25 implementation

- `MCP_TOOLS` 新增 `codecompass_get_pr_impact`，输入 `repoPath/base/head`。
- Handler 直接复用 `analyzeDiff`，不依赖已索引 repo，也不启动 HTTP 服务。
- MCP 测试覆盖 tools/list 注册、schema 与 tools/call 返回 `schemaVersion` 报告。
