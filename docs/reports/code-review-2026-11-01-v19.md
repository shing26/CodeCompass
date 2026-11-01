# Code review 2026-11-01 — v1.9.0 MCP 协议人体工学批

- 固定点:`58d7a26`(= HEAD;本批为未提交工作树改动,+5 个新文件)
- 轴线:Standards / Spec 两个并行 sub-agent,独立取证后原样聚合(不合并、不重排)
- 处置:硬违规 0;两轴共 11 条 findings,修复 7 条、如实化 1 条、披露/登记 3 条(明细见文末)

## Standards

**Verdict: no hard ADR violations. R1 masking holds on all three egress paths; ADR-0016, ADR-0019, ADR-0021 are respected. Two misplaced-comment issues and a few judgement-call smells.**

### Documented standards — checked, compliant

- **R1 masking (ADR-0003, ADR-0019)**: the isError envelope masks (`errorResult` wraps the JSON payload in `maskSensitiveText`); the audit route re-masks `recentFailures[].error` read-side on top of the sink's write-side sanitize; the view labels the column "服务端已脱敏". Covered.
- **ADR-0016 (async contract)**: `mcpIndexRepo` still returns before indexing; progress notifications are explicitly documented as additive, with the polling contract kept authoritative. Compliant.
- **ADR-0021 (product-face discipline)**: `AgentActivityView` is a read-only cockpit readout over logs, zero new collection; TopBar entry goes in the "更多操作" menu, not first-class nav, and the comments answer the dogfooding gate. Compliant.

### Issues

1. **Stranded JSDoc (hard readability defect)** — the v0.18/ADR-0016 doc comment for `mcpIndexRepo` sat above `forwardIndexProgress`, leaving `mcpIndexRepo` with no doc comment and `forwardIndexProgress` with two stacked ones. 【已修:归位】
2. **Misplaced comment** — "票 03 — additive progress channel…" sat at the call site instead of the function doc block. 【已修:删除,归入 doc block】
3. **Latent trap in the annotations loop** (judgement call) — default `readOnlyHint: true` for every tool not named in the loop; a future write-side tool would silently advertise read-only. 【已修:加 AGING RULE 注释,与 e2e 工具名棘轮形成双闸】
4. **Duplicated wire type** (judgement call) — `McpAuditSummary` 在 `audit.ts` 与 web `types.ts` 各一份;与仓库「web 不 import contracts」既有惯例一致,漂移风险继承而非新增。【披露,记入票 04 Comments】
5. **Data clump** (judgement call) — `ts/tool/repoId` 三字段拼装在 read/summarize 两处重复。【保留:两处形状不同(源条目 vs 回显载荷),抽象收益低】
6. **Magic default in the client** (judgement call) — client 把服务端默认 200 硬编码进省略逻辑。【已修:总是显式传 limit】
7. Tests cover aggregation, fail-soft, read-side masking, rotation ordering; view test covers render paths.

## Spec

Tickets 01, 03, 04 are implemented as specified. Findings:

### (a) Missing / partial

1. **Ticket 02 stdio test for `invalid_argument` is missing.** 验收要求三类 stdio 往返测试,只覆盖了两类。【已修:补 bad maxTokens wire 测试】
2. **Closeout is half-done and contradicts the spec's own record.** 共享区文档只改了 CHANGELOG/README,HANDOFF/CONTEXT 未动,README 却指向 HANDOFF。【已修:收口批进行中——HANDOFF 条目随本报告补齐;spec Comments 同步更新】
3. **Throw-site count doesn't reconcile.** 票面 20、CHANGELOG 18、代码实为 17。【已修:统一为 17】

### (b) Scope creep

1. CHANGELOG/README/版本五处改动本身——非 creep:用户在本批实施完成后明确指示「做收口」,收口即版本五处+CHANGELOG+README+HANDOFF(并行协作.md 收口人制)。"golden eval 幻觉率 0%" 引自本次 e2e 门禁实跑输出,可对账。
2. Unspecified server details in ticket 04 (3-day log window, 50-failure cap, limit clamped to 500) — benign.【已披露,记入票 04 Comments】

### (c) Implemented but looks wrong

1. **Ticket 02's premise is overstated.** 固定点测试已断言未知 repoId 返回 `isError: true`(SDK server/mcp.js 把 handler 抛错转 isError)——本票是**加性**的结构化载荷(code/hint),不是从协议错误到 isError 的行为解锁;CHANGELOG「agent 从此能区分」措辞失实。【已修:McpToolError/registerPlain 注释、CHANGELOG、票 02 Comments 均如实化】
2. **maskSensitiveText double-cover is selective.** 仅失败样本 error 过掩码,`recentCalls`/`byTool` 回显 tool/repoId 未过(低风险但窄于 spec 行)。【已修:全回显字段统一过掩码】

Nav discipline (primary stays 5 items, `?mode=audit` deep link), annotations wire tests, progressToken gating/detach, and empty-summary fail-soft all check out.

## 一行总结

Standards 7 条(0 硬违规;最重 = JSDoc 错位,已修)、Spec 6 条(0 缺失残留;最重 = 票 02 前提夸大,已如实化)。两轴均无未处置 findings。
