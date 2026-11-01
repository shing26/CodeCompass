# 01 — outputSchema + structuredContent(批主体)

Status: done

> Spec:`../spec.md`(设计决策 D1–D4、前置事实、验证口径)

## 内容

1. `McpToolMeta` 增 `outputSchema?: Record<string, z.ZodType>`;`MCP_TOOLS` 17 工具逐一声明:
   - `verification` 回执 shape(`mcp/output-contract.ts` VerificationReceipt)单独定义、16 个对象工具复用;
   - `trace_call_chain` 结构化形状为 `{ items: hopSchema }`(D2 包装);
   - 条件字段一律 `.optional()`,含 null 字段一律 `.nullable()`(盘点表逐工具核对);
   - `module_evolution`/`plan_evolution` 用 `z.union`(计划形状 / `{error, conventionConflict}` 冲突形状)。
2. `textResult` 扩展(D1/D2):掩码后文本 `JSON.parse` → 对象即 `structuredContent`;数组即 `{ items: [...] }`;parse 失败 fail-soft 只回文本。文本通道逐字节不变。
3. `registerPlain` 透传 `outputSchema` 给 SDK `registerTool`。

## 测试

- 单测:`textResult` 掩码双通道 parity(secret 在 text 与 structuredContent 均不可见)/ 数组包装 / 掩码↔JSON 有效性(引号/反斜杠/换行/secret 混入后 parse(text) 与 structuredContent 深等)。
- wire:tools/list 断言 outputSchema 在线;代表性工具断言 structuredContent 存在、通过其 schema 校验、与 `parse(text)` 同源;错误路径(isError)无 structuredContent。
- e2e:closeout gate 17 工具名棘轮如被 tools/list 新增 outputSchema 触碰则跟随。

## 验收

- [x] 17 工具 outputSchema 全部在线(tools/list 可见;wire 断言 + conformance schema_tools=17)
- [x] 成功调用双通道同源 parity 全绿(list_repos 对象 / trace_call_chain {items} 包装,wire 实证)
- [x] R1:secret 双通道不可见(textResult 单测,AKIA 探针双通道均不可见)
- [x] 错误路径不携带 structuredContent(repo_not_found wire 实证)
- [x] 门禁:控制面 929/73(1 例 repoqa-diff 负载敏感瞬时失败,单跑复绿——README 记载形态)/ web 444 / bridge 26 / typecheck 双绿 / e2e 74/0

## Comments

- 2026-11-02 实施完毕。设计修正一处:module_evolution/plan_evolution 原设计 z.union 被 SDK 实测否决(normalizeObjectSchema 顶层只认对象 schema,union 校验直接崩),退化为全字段 optional 单对象形状(仅 verification 必填),理由与代价记入 output-schemas.ts 注释与契约文档第六节。
- SDK 强校验使既有全部 wire 测试(45 例 MCP 测试 + 全量套件中所有 MCP 调用)成为 schema 校验器——13/17 工具获得免费覆盖;domain_radar/diagnose/refactor_plan 无 wire 调用,由 schema 静态形状 + 同源构造保证。

- 2026-11-02 双轴评审处置(报告 `docs/reports/code-review-2026-11-02-v110.md`):修 4——getConventions 复用 profile shape;MCP_OUTPUT_SCHEMAS 收窄为 `Record<string, Record<string, z.ZodType>>` 删 ZodTypeAny 死分支;textResult 删 fail-soft 死路(声明 outputSchema 后 text-only 成功必被 SDK 硬拒,parse 失败即掩码 bug,响亮转 isError 并在注释写明结构不变量);补 domain_radar/diagnose/refactor_plan 三工具 wire 测试(17/17 全覆盖,refactor_plan 需 changeType 必填参数)。如实化 2——spec D1 fail-soft 措辞、spec「McpToolMeta 逐工具声明」改为集中注册表。披露 1——schema 类型自 contracts/engine 手工重声明(contracts 无 zod schema,SDK 校验运行时值),平行编辑代价记入 output-schemas.ts 注释与契约文档 §六。
