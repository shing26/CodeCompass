# Issue 21 — `dynamic:false` + 未知接收者类型仍退回按名解析（假边口子）

> 依据：票 20 实现期实测（2026-09-24，`.scratch/probe-stream.ts` 与 `resolveCall` 代码走查）
> 判据：HANDOFF §2.2「降低误报」——这是**假边**方向（比漏边更坏），且票 20 把它的暴露面拉宽了
> 波次：待排 ｜ 状态：**✅ 已落地（2026-09-24）** ｜ 依赖：票 20（已闭）

## 0. 结论：三仓 **1014 条假边**已消除；孤儿桶因此**变大**（诚实登记）

先量（`.scratch/probe-t21.ts`，三仓真索引）：

| 样本 | 有类型的调用 | 类型不在索引 | **其中此前被"按名"绑成边** |
|---|---|---|---|
| self | 1164 | 754 | **438** |
| lazygit | 9372 | 922 | **575** |
| petclinic | 130 | 20 | **1** |

典型假边（都是"用同名方法猜"）：

- self：`Error.constructor → HarnessRegistry.constructor`（**356 条**）、`Set.constructor`、`Database.close → FakeEventSource.close`（跨端跨语言，绑到 web 端的测试替身）；
- lazygit：`T.Run → IntegrationTest.Run`（**206 条**）、`T.Errorf → FakeFieldLogger.Errorf`、`strings.Builder.WriteString → gocui.View.WriteString`；
- petclinic：`ReactiveCircuitBreakerFactory.create → VisitResource.create`（第三方 Spring 类型绑到业务资源）。

**排除"真缺口"可能**：逐条核对了"类型名在本仓有符号、只是 kind 不在 `TYPE_KINDS`（class/interface/route/service/repository）"的情况——
self 25 条（全是票 19 的掩码缺陷造出的假方法名 `http_json`/`_mcp_roundtrip`/`last_json`）、lazygit 248 条（全是**同名巧合**：
仓里有个叫 `Mutex`/`Set` 的*方法*，而接收者是标准库类型）、petclinic **0 条**。**没有一条是真的"已声明但未登记"**，
故修复方向成立。

## 1. 缺陷

`engine/repoqa-callchain.ts::resolveCall` 的收尾段：

```ts
const candidateTypesList = candidateTypes(index, caller, call);
for (const typeName of candidateTypesList) {
  const info = index.types.get(typeName);
  if (!info) continue;            // ← 类型名不在索引里：跳过
  ...
}
// No statically bound receiver type: dynamic / RPC / external dispatch, or a
// legacy call without receiver info (fall back to name-based resolution).
if (!call.dynamic) {              // ← 于是走到这里
  const sameFile = index.methodsByFile.get(call.file)?.get(call.method);
  ...
  const global = index.methodsByName.get(call.method);
  ...                             // ← 按"方法名"全局找目标
}
```

问题在最后一跳的**触发条件**：`!call.dynamic` 同时覆盖两种情况，而它们语义相反——

| 情况 | `receiverType` | 含义 | 应走 |
|---|---|---|---|
| 裸调用 `foo(...)` / `this.foo()` | 无 | "没有接收者信息"，按名解析是 V31-02 的既定修复 | 按名解析 ✔ |
| `x.foo(...)` 而 `x: UnknownType` | **有**（`UnknownType` 不在索引里） | "接收者类型已知但不在本仓"（外部类型 / 解析不到） | **dynamic**（ADR-0002：不猜） |

第二种今天会落到"按名全局找 `foo`"——**用一个同名方法把外部类型的调用绑成真边**，正是 ADR-0002 禁止的猜测。

## 2. 为什么现在提（暴露面被票 20 拉宽）

票 20 让更多接收者拿到类型（回调注解形参、方法返回类型）。类型名不在索引里时（例如 `Pick` 之外的外部类型、
或名字打错/不可解析的注解），这些新定型的调用就会掉进按名回退。**实测形态**（票 18 的反例单测正是这个形状）：

```ts
useThing((c: SomethingUnresolvable) => c.pickFolder());
// receiverType='SomethingUnresolvable' 不在索引 → 按名全局找 pickFolder
// → 在真实仓库里会绑到 RepoQAClient.pickFolder：假边
```

## 3. 建议修法（一行，但须先度量）

```ts
if (!call.dynamic && !call.receiverType) { ...按名解析... }
```

即：**适配器既然声明了接收者类型，就只允许类型路径**；类型不在索引里 → `STATIC_ANALYSIS_BREAK_DYNAMIC`。

**先度量再动手**（本批纪律）：改前先量三仓里"`receiverType` 非空但不在 `index.types`"的调用边条数，
以及其中按名回退**成功**的有多少（成功 = 现存的潜在假边；一个都没有 = 这条口子目前没被踩，优先级下调）。
Java / Go / Python 适配器是否也设 `receiverType` 必须先核实（petclinic / lazygit 必须逐字节不变）。

## 4. 验收（2026-09-24 复核）

- [x] 先量：三仓 438 / 575 / 1 条（入上表），且**排除了"真缺口"**（见 §0 末段）
- [x] 先红：`x: UnknownType` 上调 `x.foo()` 不得绑到同名全局方法——实现前失败（`expected true to be false`）
- [x] 后绿：修后复量三仓 **0 条**；裸调用与 `this.foo()` 的按名/类型解析各有回归钉（`this.flush()` 经类型路径落到 `Caller.flush`）
- [x] 三仓复测：petclinic **13 → 13**（唯一那条假边掉了但总数未变——它绑的目标还有真调用者）；
      **self 237 → 246（+9）、lazygit 1807 → 1828（+21）**——见下
- [x] 97 题 eval 全阈值（9 桶 Recall@5 全 100%、幻觉 0%）；e2e 71/0；控制面 **718**（716 + 2 新例）；棘轮 self 246/2045 = **12.0%** < 17.1%

### 4.1 为什么孤儿桶**变大**了（必须与"修坏了"区分开）

去掉 1014 条假边 → 那些**只靠假边"被调用"**的符号现在真的零调用者了 → 它们进入孤儿桶。这是**假阴性一侧变得可见**：

- 桶声称的是"零静态调用者"这个**事实**；此前这些符号因为一条猜出来的边而**不出现**在桶里（假阴性）。
  修后它们出现，且出现得**正确**。
- 因此"孤儿数上升"在这里是**精度提高的信号**，不是回退；**M1（桶内假阳性率）与调用链正确性**都没退化，
  退化的是那个**代理指标的读数**。这正是本批反复强调的口径纪律：代理指标方向与真实质量方向可以相反。
- 棘轮是**天花板**（17.1%），self 12.0% 仍在界内，无需 `--ratchet-update`。

## 5. 风险（复核后）

1. 会**减少**边 → 已按"裸调用回归钉 + 三仓对照 + eval 九桶"证明只掉假边。
2. 四个适配器都把 `receiverType` 当**事实**填（不是提示），已核实：Go/TS/Python 都只在能确定类型时设它。
3. 与票 20 同因但不同文件（`repoqa-callchain.ts`），无需再串行。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/engine/repoqa-callchain.ts`（+test） | MCP 工具面 | `resolveCall` 收尾条件 |
| `services/control-plane/src/module-evolution-engine.test.ts` | MCP 工具面 | 两处 fixture 补声明 owning type（此前靠被修掉的回退成立） |
| `scripts/precision/out/`、`docs/reports/` | 共享区 | 三仓度量与留档 |
