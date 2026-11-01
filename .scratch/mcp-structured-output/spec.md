# Spec: MCP 返回载荷协议级校验(structuredContent + outputSchema)

Status: ready-for-agent

## 版本预占

**1.10.0**(2026-11-02,单线工作;git log 无并行线占号)。加性批,17 输入契约冻结不动。

## 背景

v1.9 票 05 登记 deferred 的解冻批。v1.9 把**错误面**结构化(isError 载荷,票 02);本批把**成功载荷**也升级为协议级可校验:17 工具声明 `outputSchema`,成功结果同时携带 `structuredContent`。文本通道逐字节不变——老客户端零影响,这是加性批。

## 前置事实(2026-11-02 实证,SDK 1.30 源码 + handler 全量盘点)

- SDK 行为:工具声明 `outputSchema` 后,SDK 对每个成功(非 isError)结果强制校验——缺 `structuredContent` 或不符 schema 直接抛 `McpError InvalidParams`(`server/mcp.js:186-209`)。isError 结果不校验(错误契约不受影响)。
- 因此 schema 与真实载荷必须严格一致;按工具逐个声明,wire 测试钉死。
- zod v3 普通 object shape 经 SDK `toJsonSchemaCompat` 不产生 `additionalProperties: false`——加性字段(`verification` 回执、未来增量)天然兼容。
- 17 handler 成功形状(全量盘点,2026-11-02):16 个返回对象(全部附 `verification: VerificationReceipt`,additive);`codecompass_trace_call_chain` 唯一返回**裸数组**(7 字段 hop 对象数组,无回执);无裸字符串返回;`module_evolution`/`plan_evolution` 有双形状分支(计划结果 vs `{error, conventionConflict}` 约定冲突)。
- 条件字段一律 `undefined` 丢弃(`JSON.stringify` 语义)——schema 中必须 `.optional()`,否则某分支缺字段即运行时红。含 `null` 的字段(如 trace hop 的 `line: number|null`)必须 `.nullable()`。

## 设计决策

### D1 — R1 掩码不变性:structuredContent 从掩码后文本反序列化

`textResult`(全 17 工具唯一出库咽喉,repoqa-mcp.ts:1222)扩展:掩码后的 JSON 文本 `JSON.parse` 回对象,作为 `structuredContent` 与 text 并列返回。**绝不从原始 value 直接序列化**——那会绕过 R1(ADR-0003/0019)。文本通道逐字节不变。parse 结构上不可能失败(text 是 JSON.stringify 输出、凭据模式不含引号故掩码替换不跨 JSON 字符串边界)——若未来掩码规则破坏该不变量,parse 抛错、调用响亮地转为 isError(评审修正:声明 outputSchema 后不存在软路径,text-only 成功会被 SDK 硬拒,原 fail-soft 设计是死路,已删)。

### D2 — 裸数组的对象化包装(仅 trace_call_chain)

MCP 规范 `outputSchema.type` 必须为 `object`,`structuredContent` 必须是对象。trace_call_chain 的数组包装为 `{ items: [...] }`——**仅结构化通道**;文本通道仍是裸数组(逐字节不变)。schema 声明包装后的形状。

### D3 — 两档保真度(防漂移与运行时红的平衡)

- **顶层字段**:精确——字段名、zod 类型、枚举字面量、`.optional()`/`.nullable()` 按 D0 事实逐工具核对。
- **`verification` 回执**:完整精确(它是 v1.5 定名的对外契约,`mcp/output-contract.ts` VerificationReceipt;单独 shape 复用于 16 个工具)。
- **嵌套条目对象**:核心数组元素同样精确(契约冻结自 v1.0,漂移即红是对的);但全部用普通 zod object(非 strict),加性字段不炸。
- module_evolution/plan_evolution 双形状:**原设计 z.union 被 SDK 实测否决**——`normalizeObjectSchema` 顶层只认对象 schema(union 返回 undefined,`safeParseAsync` 直接崩,`_zod` 读取错误);退化为单对象形状(两支字段全 optional,仅 `verification` 必填),代价与理由记入 output-schemas.ts 注释与契约文档。

### D4 — 出库辅助:文本与结构化逐字节同源

wire 测试断言:`parse(text)` 深等于 `structuredContent`(数组工具除外——text 是数组、structured 是 `{items}` 包装)。同源保证两通道永不漂移。

## 改动清单

### 05 — outputSchema + structuredContent(本批主体)

- 17 工具的 outputSchema 集中在单一注册表 `mcp/output-schemas.ts`(`MCP_OUTPUT_SCHEMAS`,按工具名索引),`registerPlain` 以 `MCP_OUTPUT_SCHEMAS[meta.name]` 透传;17 名全覆盖由 ratchet 测试钉死。评审修正:原设计「McpToolMeta 增字段、meta 内逐工具声明」未采用——集中注册表是更优形状(覆盖棘轮 + 单一文件),spec 文本随实现修正。
- `registerPlain` 透传 `outputSchema`;`textResult` 按 D1/D2 扩展(签名加 tool name 以支撑数组包装判定,或以 value 类型判定)。
- 单测:textResult 单元(掩码双通道 parity / 数组包装 / string 不带 structuredContent)+ wire 测试(代表性工具断言 structuredContent 存在、validates、与 text 同源)+ tools/list 断言 outputSchema 在线。
- e2e `closeout_gate.py` 17 工具名棘轮如被 outputSchema 触碰则跟随。

### 06 — 契约文档 + 通用套件跟随

- `docs/mcp-tool-contract.md` 增「structuredContent 与 outputSchema」节(D2 包装约定、错误路径不带 structuredContent、掩码同源声明)。
- `scripts/e2e/mcp_conformance.py` 增一条**零项目数据依赖**通用断言:tools/list 中声明了 outputSchema 的工具,成功调用必须返回对象型 structuredContent(可对任意实现跑)。

## 不做

- 工具签名/输入 schema 变更(17 输入契约冻结不动)
- 错误路径结构化(票 02 已完成,isError 结果不携带 structuredContent——SDK 也不校验错误结果)
- 文本通道任何变化(逐字节不变,老客户端零迁移)

## 验证口径

- 控制面全量 + web + bridge typecheck 全绿;e2e closeout gate 74+/0
- wire 测试:文本/结构化同源 parity 全绿;掩码 secret 双通道不可见
- conformance 套件新断言 self 绿 + 假服务端反向仍红

## Comments

- (实施后回写)
- 2026-11-02 收口完毕:版本五处推进 1.10.0(bridge-adapters 保持 0.6.0 独立版本线)、CHANGELOG 顶部条目、README(徽章/路线图/版本实情/套件计数 931/基线)、HANDOFF v1.10.0 段。双轴 code-review(fixed point `24ed360`)见 `docs/reports/code-review-2026-11-02-v110.md`:0 硬违规,修 4 / 如实化 2 / 披露 2。门禁终态:控制面 931(2 例负载敏感单跑复绿)/ web 444 / bridge 26、e2e 74/0、conformance 7/7。commit 按 Mimosa 约定留给用户 shell;tag 与 npm 发布待用户执行。
