---
status: accepted
---

# TS/JS 模块路径消解：读代码自己的声明，不猜

## 背景

- v1.4 票 06 对外披露的已知边界：TS/JS **不解析 import 声明**，跨文件调用按「符号名 + caller 自身文件优先 + 最早声明」绑定（`engine/repoqa-callchain.ts` 的 Issue 15 规则）；monorepo 同名符号存在错绑可能，`@/` 别名不报错。
- 度量（票 08 前置条件 1，`scripts/precision/import_resolution_probe.ts`）：self 仓 `38deb70` 跨文件调用 4055、同名歧义 3274、**import 唯一可钉死 1301**（≈32% / 歧义边 40%）。2026-10-26 于 v1.5.1（`13b1a34`）复核：4061 / 3280 / **1301**。
- 票 08 的「立项必须先做」三项：先量（已完成）、棘轮基线（票 02）、消解语义 ADR（本 ADR）。

## 决定

1. **消解的证据来源只有代码自己的声明**：import/export 语句、tsconfig 的 `baseUrl`/`paths`、package.json workspaces。任何「按类型推断」「按目录相似度猜」都不进本战役——那是猜测，违反零幻觉合约（`CONTEXT.md` Zero-Hallucination Contract）。
2. **证据强度分级**，只有 L1/L2 可钉死：
   - **L1** 相对路径 import（`./x`、`../y`）解析到仓内唯一文件 → 钉死；
   - **L2** tsconfig `paths`/`baseUrl` 别名展开后唯一命中 → 钉死；
   - **L3** bare package specifier（`react`、包名互引）→ 不参与消解，落既有 EXTERNAL/UNRESOLVED 语义；
   - **L0** 无声明，或声明存在但不唯一 → 见决定 4。
3. **模块表是索引期产物**：`file → resolved module` 在索引时构建、随 snapshot 落库（与 symbols 同一 commit 口径）；查询期只读。表缺失（旧索引）时**降级**回 v1.5 行为，且诊断要能说明「本次未启用模块消解」——不能装作已消解。
4. **「不猜」的落地分两阶段，刻意分开归因**：
   - **Phase 1（钉死）**：L1/L2 唯一命中的边改绑到声明文件；其余保持现状（caller 文件优先 → 最早声明）。这一阶段只让能确定的更确定，**不新增 BREAK**。
   - **Phase 2（把任意性显式化）**：名字在多文件声明、且 import 无法唯一钉死的边，从「静默绑定最早声明」改为显式 `SUSPECT`（不是 `BREAK`：调用确实存在，只是目标不确定），读数变化逐条解释 + 棘轮显式更新。**Phase 2 是零幻觉合约的要求，不是可选项**；拆两阶段只为让每次读数变化能单独归因。
5. **多语言边界**：只对 TS/JS 生效。Go（`go.mod`）/ Java（Maven module）各有包结构，本战役不动；lazygit / petclinic 读数前后**逐字节不变**是本战役最硬的回归断言。
6. **不新增对外契约**：17 个 MCP 工具输入签名与返回体结构不变；被消解的仍是同一批边，只是 `file:line` 更准。Phase 2 的 `SUSPECT` 沿用既有枚举，不加新值。

## 后果

- 索引时间与 DB 体积增加（每个 TS 文件一条 import 表）；旧索引必须重建才能启用（表缺失即降级，不报错）。
- Phase 2 会让「可疑」计数上升——这是把既有任意性搬到台面上，不是精度回退；M1 口径读法不变（看假边条数与逐条归因）。
- 走包名互引的 monorepo（workspaces）覆盖不到，那属 Phase 3，本 ADR 不给承诺。
