# Issue 20 — 接口→实现关系表（ADR-0018 `deferred` 的 A′ step 2）

> 依据：ADR-0018 三裁决中的 `deferred` 项（接口实现方法"仍在 total 内"）；票 18 复测后 self top-10 的流订阅族
> 判据：HANDOFF §2.2「降低误报」——self top-10 现有 `QueryStream.*`（4）+ `EvolveStream.*`（2）；lazygit 侧同源 620 条
> 波次：待排 ｜ 状态：**已立项，待开工** ｜ 依赖：票 18（同文件面，须串行）

## 现状（2026-09-24 票 18 复测后）

票 18 把 `RepoQAClient.*` 从 self top-10 的 7 条压到 1 条（仅真阳性 `getRepo`），**新露面的第一名换成流订阅族**：

| 符号 | 调用点写法 | 接收者类型 |
|---|---|---|
| `QueryStream.onEvent` / `onError` / `onDone` / `connect` | `stream.onEvent(fn)` | **接口** `QueryStreamLike` |
| `EvolveStream.onEvent` 等 | 同上 | **接口** `EvolveStreamLike` |

实现是 `QueryStream` / `EvolveStream` **类**，接口声明与实现同文件（`client/RepoQAClient.ts:494-504`、`:700+`）。
所以这不是"找不到类型"，而是**接口成员调用没有实现侧落点**：`resolveCall` 已经会查 `index.implsOfInterface`
（Java 侧 `implsOfInterface` 有实现时走 `resolveImpl`），TS 侧的接口→实现关系**根本没建表**。

## 内容

1. **建表**：`buildCallIndex` 收集 `class X implements I` 与 `class X implements I, J`（Java 的 `implements`
   已在 `RepoSymbol.interfaces`；TS 适配器同样填了 `implements`，见 `ClassDeclaration` 分支）→ `implsOfInterface`。
2. **唯一实现即绑定**：`implsOfInterface.get(I)` 恰好 1 条 → 该接口成员的调用绑到实现方法；**多条一律 fail-closed**
   （Spring 那套 `@Primary`/`@Qualifier` 消歧**不照搬**——TS 没有等价语义，猜就是造假边）。
3. **注意反向**：本次是"接收者=接口、目标=实现方法"，与 Java 侧"接口方法被谁调用"是同一个表的两面，别建两张。
4. 复测口径：self 流订阅族离榜；lazygit 的 620 条 `interface-implementation` `deferred` 计数应显著下降
   （ADR-0018 的 `deferred` 登记随之收窄，**需同步改 ADR-0018 的 `deferred` 说明与 census 断言**）。

## 验收

- [ ] 先红：单测钉住 `const s: QueryStreamLike = ...; s.onEvent(fn)` **不得**在无实现表时绑定
- [ ] 后绿：唯一实现时绑定成功；**两个实现时保持 dynamic**（反例单测）
- [ ] self top-10 的 `QueryStream.*` + `EvolveStream.*` 离榜；self 孤儿数下降且普查守恒
- [ ] lazygit / petclinic 复测：lazygit 的 `interface-implementation` 计数下降（记录前后），petclinic **逐字节不变**
- [ ] 97 题 eval 全阈值不回退；e2e 全绿；棘轮不变或按新数复算留档

## 风险

1. **多实现消歧是最大假边来源**：TS 无 Spring 的 bean 语义，`@Primary`/`@Qualifier` 那套不适用 → 只做"唯一实现"。
2. 接口与实现可能跨文件、跨目录（本仓同文件是巧合，别假设）→ 表必须是**仓级**的，与票 18 的表同源可复用注入路径。
3. 会动 ADR-0018 的 `deferred` 语义与 `census` 断言 → 属**契约面变更**，需与 `closeout_gate.py` 的棘轮不变量④同步。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/engine/repoqa-callchain.ts`（+test） | MCP 工具面 | `implsOfInterface` 建表与唯一实现绑定 |
| `services/control-plane/src/scan-engine.ts`（+test） | MCP 工具面 | `deferred` 计数与守恒断言（ADR-0018 口径） |
| `docs/adr/0018-*.md`、`scripts/e2e/closeout_gate.py` | 共享区 | `deferred` 说明与棘轮不变量同步 |
