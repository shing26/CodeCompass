# Issue 21 — `dynamic:false` + 未知接收者类型仍退回按名解析（假边口子）

> 依据：票 20 实现期实测（2026-09-24，`.scratch/probe-stream.ts` 与 `resolveCall` 代码走查）
> 判据：HANDOFF §2.2「降低误报」——这是**假边**方向（比漏边更坏），且票 20 把它的暴露面拉宽了
> 波次：待排 ｜ 状态：**已立项，待开工** ｜ 依赖：无（但与票 20 同因，建议紧随）

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

## 4. 验收

- [ ] 先量：三仓"声明了类型但类型不在索引"的边数 + 其中按名回退成功的条数（入报告）
- [ ] 先红：单测钉住 `x: UnknownType` 上调 `x.foo()` **不得**绑到同名全局方法（当前必红）
- [ ] 后绿：裸调用 / `this.foo()` 的按名解析**不回退**（V31-02 的既有能力必须有回归钉）
- [ ] 三仓复测：petclinic / lazygit 逐字节不变；self 孤儿数与普查守恒留档
- [ ] 97 题 eval 全阈值不回退；e2e 全绿；棘轮不变或按新数复算留档

## 5. 风险

1. 会**减少**边（去掉按名回退），可能把真边也去掉 → 必须靠"裸调用回归钉 + 三仓对照"证明只掉假边。
2. 若某语言的适配器把 `receiverType` 当"提示"而非"事实"填，这条改动会误伤 → 先核实四个适配器的语义。
3. 与票 20 同因，若两票合并落地须重新分配文件面（`repoqa-callchain.ts` vs `TypeScriptAdapter.ts`）。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/engine/repoqa-callchain.ts`（+test） | MCP 工具面 | `resolveCall` 收尾条件 |
| `scripts/precision/out/`、`docs/reports/` | 共享区 | 三仓度量与留档 |
