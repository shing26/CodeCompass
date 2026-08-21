# 05 - Deterministic call-chain query

**What to build:** Let a developer trace a route end to end using deterministic AST call edges, with explicit static analysis breaks instead of guesses.

**Blocked by:** 03 - Symbol extraction and browse; 04 - SSE query skeleton

**Status:** ready-for-human

- [x] Call-chain resolution uses persisted call edges, starting with same-file explicit calls
- [x] At least one real cross-layer route chain resolves in the fixture repo
- [x] Unresolvable edges render as Static Analysis Break and are never auto-completed
- [x] Call-chain results are exposed through the SSE query contract

## Comments

### 2026-08-20 implementation

- 新增 `repoqa-callchain.ts`：从 method symbol 出发按 `calls[]` 优先 same-file、再 fallback 到同 repo method；深度受控并去重/防环。
- 未解析的 call 输出为 `break: true` 的 trace hop，绝不补全为猜测；contract 增加 `RepoQaTraceHop` 表达该能力。
- `queryRepo(mode=call-chain)` 从问题词匹配 method symbol，解析结果为 mermaid/trace/anchors，并通过既有 SSE token/mermaid/anchors/done 流程暴露。
- fixture 增加 `DemoService.greet()`，Controller.hello 跨 layer 调用 `demoService.greet()`，覆盖真实 route->service 静态链。
- 测试：新增 2 条 call-chain 集成测试（真实跨层、Static Analysis Break）；控制平面 11 条测试全通过，typecheck 通过。
