# Spec: MCP 协议人体工学批(工具面签名零变化)

Status: ready-for-agent

## 背景

v1.8.0 双轴评审后的改进批:17 工具契约冻结(ADR-0021)不动,改进的是**协议层的使用方式**与驾驶舱对 agent 真实用量的可见性。四项实施 + 一项登记延期。

## 范围(本线声明触碰的文件)

- `services/control-plane/src/mcp/repoqa-mcp.ts`(MCP 面唯一主战场)
- `services/control-plane/src/mcp/*.test.ts`(同位测试)
- `services/control-plane/src/log-sink.ts`、`services/control-plane/src/http.ts`(审计读数端点,②)
- `apps/repoqa-web/src/`(驾驶舱新视图,②)
- `scripts/e2e/closeout_gate.py` 仅当 e2e 断言需要跟随时才动
- **共享区**:CHANGELOG / CONTEXT / HANDOFF / README / 版本五处——本批**不碰**,压到收口(并行协作铁律 2)

## 版本预占

**1.9.0**(2026-11-01,单线工作;git log 无并行线占号)。本批只写代码与测试,不推进版本五处——收口时再动。

## 改动清单

### 01 — Tool annotations(half day)

`McpToolMeta` 增加 `annotations`;15 个只读工具 `readOnlyHint: true`,`remove_repo` 加 `destructiveHint: true`,`index_repo` 加 `idempotentHint: false`。注册时透传给 SDK。tools/list 测试断言 annotations 在线。

### 02 — isError 结构化错误契约(1 day)

新增 `McpToolError`(code + hint)。可恢复错误(repo 不存在 / 未 ready / 参数缺失 / 符号找不到)从 rethrow 改为返回 `isError: true` 的 text content,载荷 `{ error: { code, message, hint } }`;未知错误维持 rethrow(协议级失败),audit 行为不变。code 枚举:`invalid_argument` / `repo_not_found` / `repo_not_ready` / `symbol_not_found`。

### 03 — 索引进度通知(ADR-0016 的 UX 补强,契约不变)

`McpDeps` 增加可选 `eventBus`(runMcpServer 注入,单测不注入保持密闭)。`index_repo` 命中客户端 `_meta.progressToken` 时,把 worker 的 `repoqa.index.progress` 事件转发为 `notifications/progress`(best-effort,响应返回后发的通知客户端可能忽略——轮询契约仍是权威路径,注释里写明)。

### 04 — Audit-driven cockpit 视图(2-3 day)

- 服务端:`GET /api/audit/mcp/summary` 读 ServerLogger 落盘的 `mcp/tool_call` 行,聚合 per-tool 调用数 / 成功率 / 延迟分布 / 最近失败样本,双保险 `maskSensitiveText` 出库。
- Web:驾驶舱新增「Agent 活动」视图,消费上述端点。定位是维护者 dogfooding(ADR-0021),不是第二个产品面。

### 05 — structuredContent + outputSchema(DEFERRED)

协议级契约校验价值最高但需动 17 个工具的全部返回载荷与测试,周级工作量,单独开线。本票登记不实施,Status: wontfix(本批)。

## 不做

- MCP sampling(破坏零 LLM 身份,明确拒绝)
- 新增/删除工具(面冻结)
- 版本推进与 CHANGELOG(收口批)

## Comments

- 2026-11-01 实施完毕(01–04 done,05 wontfix)。验证:控制面 921/921(73 文件)、web 444/444(42 文件)、双包 typecheck 绿、e2e closeout 门禁 74/0(含 MCP tools/list 17 工具名棘轮,annotations 未破坏签名)。
- 2026-11-01 收口完毕(用户指示):版本五处推进 1.9.0、CHANGELOG 顶部条目、README(徽章/路线图/版本实情/套件计数/基线)、HANDOFF v1.9.0 条目。双轴 code-review(fixed point `58d7a26`)见 `docs/reports/code-review-2026-11-01-v19.md`:0 硬违规;处置 7 修 1 如实化 3 披露——其中票 02 前提如实化(SDK 既有 isError 行为,本批为加性结构化)、audit 出库掩码扩为全字段、invalid_argument wire 测试补齐。门禁终态:控制面 921+/web 444+/bridge 26、e2e 74/0。commit 按 Mimosa 约定留给用户 shell;tag `v1.9.0` 与 npm 发布待用户执行。
- 2026-11-01 发布完毕:commit `b97b700` / tag `v1.9.0` 已推,Release workflow #41262518929 **success**(含 Artifact browser gate);npm `@codecompass/cli@1.9.0` 已发布(2026-11-01T02:01:20Z,`latest` = 1.9.0,临时前缀安装校验 1.9.0);README/CHANGELOG/HANDOFF 发布回写。
