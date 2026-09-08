# 04 — CI 消费端回归 gate

**What to build:** 把 Phase 5 的消费端验证固化为一个回归 gate：在同一组固定 base→head fixtures 上，确认 CLI `pr-summary`、MCP `codecompass_get_pr_impact`、`diff --output=json` 三者的核心分析结果一致，`--fail-on-impact` 退出码符合预期，报告不含配置值。这个 gate 代表“PR/CI 机器人可以从确定性的证据面安全消费”这一完成标准。

**Blocked by:** 02 — codecompass pr-summary CLI、03 — MCP codecompass_get_pr_impact

**Status:** ready-for-agent

- [ ] 同一 fixture 下，`pr-summary --output=json`、`diff --output=json`、MCP 返回的核心字段一致
- [ ] `--fail-on-impact` 在影响非空时返回 `2`，空影响时返回 `0`
- [ ] 输出文件/JSON 不含配置值或敏感内容
- [ ] 测试使用现有 diff tests 的临时 git fixture 模式，不新增真实外部 repo 依赖
- [ ] 作为 Phase 5 完成标记：相关测试 suite 与 typecheck 均通过

## Comments

### 2026-08-25 implementation

- 新增 CI gate 测试：同一 repo 上 `diff --output=json` 与 `pr-summary --output=json` 的核心分析字段一致。
- 完整后端 suite 273/273 通过，typecheck 通过。
