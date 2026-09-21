# Issue 14 — 通用 MCP 协议层一致性套件（评估维 E-M10：口径边缘 → 名实相符）

> 依据：短板清单 E-M10 边际说明「`closeout_gate.py` 虽为协议层黑盒，但硬编码了本项目数据形状（如 `'"orphanedPublic"' in scan_text`），故它是『对本项目实现可跑的标准套件』，而非『对任意实现皆可跑的一致性套件』——若要求后者，此项应退 2 分」
> 分档要件（§2.1）：**3 分** = 有标准测试套件可对任意实现跑
> 波次：v0.31.0 ｜ 用户裁决：2026-09-21 批准（选「新增通用协议层套件」）

## 口径裁定（已定，记录在案）

**不通用化 `closeout_gate.py`**——它断言的是本仓数据的业务语义（五桶/图谱/门禁史），是本仓回归资产，通用化会削弱它。
**新增一个并行的通用套件**，只断言协议层。两者并存，职责不同：

| 套件 | 断言对象 | 输入 | 适用面 |
|---|---|---|---|
| `closeout_gate.py` | 本仓业务语义 + 数据形状 | 本仓 fixture 仓 | 只对本项目 |
| `mcp_conformance.py`（本票） | **协议层形状与约定** | 任意 stdio MCP 服务端命令 | 任意实现 |

## 内容

新增 `scripts/e2e/mcp_conformance.py`：`--server-cmd "<启动命令>"`（默认本仓 `node services/control-plane/dist/cli.js mcp .`），逐项断言：

1. `initialize` 握手返回 `protocolVersion` / `serverInfo.name` / `capabilities.tools`；
2. `tools/list` 每项有 `name` / `description` / `inputSchema.type === 'object'`，且 `name` 唯一；
3. `tools/call` 成功路径信封合规：`content[0].type === 'text'`；
4. 未知工具名 → 明确失败（`isError` 或 JSON-RPC error），不得静默返回空成功；
5. 非法参数类型 → 被拒（`isError` + 校验信息），不得进 handler；
6. 空参数调用必需字段缺失 → 明确失败。

**零项目数据依赖**：不出现 `orphanedPublic` 等本仓字段名，不依赖具体工具数量（只要求 ≥1）。

## 验收（双向，缺一不算）

- [x] 对本仓服务端跑：**6/6 全绿**（探针全部运行时发现：17 工具、`list_repos` 作零参工具、`trace_call_chain.repoId` 作 string 属性——零硬编码）
- [x] 对故意违规的假服务端：`--mode=handshake` → 抓出握手违规（rc=1）；`--mode=tools` → 抓出 **4 条**（空描述 / 未知名静默成功 / 类型不匹配未拒 / 缺必填未拒），而真正合规的信封断言正确通过——逐条对应，不是笼统失败
- [x] `grep -c orphanedPublic scripts/e2e/mcp_conformance.py` = **0**（零项目数据依赖）
- [x] 接入 gate：`issue14 mcp-conformance (portable suite + reverse proof)` —— 一次检查内跑三遍（self 必须 0 退出；两种违规模式必须非 0 退出）
- [x] 反向验收在 CI 内自动执法（gate 71/71）

**口径裁定记录**：`closeout_gate.py` **保持不动**（它断言本仓业务语义，是回归资产）；通用面由本套件并行承担，两者并存。

## 风险

1. 协议细节随 MCP SDK 版本漂移——断言只取协议稳定面（信封形状/错误语义），不锁死 SDK 私有实现。
2. 套件与 `closeout_gate.py` 的 MCP 段有重叠（都起 stdio 会话）——重叠部分保留在 gate（业务语义），套件只做通用面；重复成本约 10s 可接受。

## 文件面声明

| 文件 | 归属 | 说明 |
|---|---|---|
| `scripts/e2e/mcp_conformance.py` | 新增 | 通用协议套件 |
| `scripts/e2e/fixtures/mcp-bad-server.mjs` | 新增 | 反向验收用的违规服务端 |
| `scripts/e2e/closeout_gate.py` | 共享区 | 加一条调用通用套件的检查（与票 12/13 同处） |
| `docs/mcp-tool-contract.md` | 与票 13 同文件 | 附一节：如何用本套件验证任意 MCP 服务端 |
