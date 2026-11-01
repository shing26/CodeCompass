# 04 — Audit-driven cockpit:「Agent 活动」视图

Status: done

数据已在落盘(ServerLogger `mcp/tool_call`:tool/repoId/durationMs/ok/argsBytes/resultBytes/error),缺的只是消费端。

服务端:
- `GET /api/audit/mcp/summary?limit=N`(默认 200):读数据目录下 MCP 审计日志,聚合 per-tool {calls, ok, okRate, p50/p95 durationMs} + 最近失败样本(tool/repoId/error/at)与最近调用流
- 出库过 `maskSensitiveText`(R1 不变量);日志不存在时返回空聚合(非 404),Web 空态可用

Web(定位 ADR-0021 维护者 dogfooding,非产品面):
- 新视图「Agent 活动」:per-tool 调用表(调用量/成功率/p50/p95)、最近失败列表、最近调用流
- 接入一级导航;组件 + 同位 vitest 测试;client 走 RepoQAClient 惯例

## Comments

- 2026-11-01 实施:导航落位改为「TopBar 更多操作」菜单项 + `?mode=audit` 深链(spec 里写的「接入一级导航」按 v1.2 票 01 的 IA 纪律修正——一级保持 5 项,metrics 同款落点)。
- 服务端 `src/routes/audit.ts`(readMcpAuditEntries + summarizeMcpAudit + 路由,6 测试),Web `AgentActivityView.tsx`(3 测试),client 增 `fetchAuditSummary`,类型进 `types.ts`(McpAuditSummary / WorkbenchTab+audit)。读侧发现并修复两个自身 bug:文件数以数组误比数字、轮转代排序反向。
- 双轴评审补齐:①出库掩码从「仅失败样本 error」扩为**全回显字段**(tool/repoId/error 统一过 `maskSensitiveText`,identifier 类为 no-op 但契约不留例外);②参数披露——日志窗口近 3 个日期文件、失败样本上限 50、limit 钳位 1..500(默认 200);③已知取舍:`McpAuditSummary` 线类型在 `audit.ts` 与 web `types.ts` 各一份(与仓库「web 不 import contracts」既有惯例一致,漂移风险继承而非新增)。
