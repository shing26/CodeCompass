# 02 — isError 结构化错误契约

Status: done

可恢复错误不再 rethrow(否则 SDK 转 JSON-RPC protocol error,agent 无法区分"参数错了"和"引擎炸了"):

- 新增 `McpToolError extends Error`,携带 `code` 与 `hint`
- code 枚举:`invalid_argument` / `repo_not_found` / `repo_not_ready` / `symbol_not_found`
- 现有 **17** 处校验/查库 throw 逐处归类改写(消息文本保持不变,tests 依赖这些文案)
- `registerPlain` catch:instanceof McpToolError → audit(照常记 ok:false)→ 返回 `{ isError: true, content: [textResult({ error: { code, message, hint } })] }`;其他错误 rethrow 不变

验收:repo_not_found / invalid_argument / symbol_not_found 三类 stdio 往返测试;rethrow 路径(内部错误)测试不回归。

## Comments

- 2026-11-01 双轴评审修正:**前提如实化**——SDK 本来就把 handler 抛错统一转为纯文本 isError(`repoqa-mcp.test.ts` 固定点已有该断言),本票的真实增量是**载荷结构化**(code + hint 可分类),不是「从协议错误到 isError 的解锁」。McpToolError 与 registerPlain 注释、CHANGELOG 均已按此改写。throw 计数实为 17(票面原写 20、CHANGELOG 首写 18,均系误计,已同步修正)。
