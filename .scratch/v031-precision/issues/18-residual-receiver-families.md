# Issue 18 — 精度残余三族（top-10 剩 7 条 `RepoQAClient.*` 的拦路机制）

> 依据：票 11「登记不扩散」表（2026-09-19 dogfooding 实测）+ `scripts/precision/verdicts/self.json` 的四条 `utility-type-props` 判定
> 判据：HANDOFF §2.2「降低误报」——三族合计覆盖当前 self top-10 的 **7/10**（`RepoQAClient.*` 全族）
> 波次：待排 ｜ 状态：**已立项，待开工** ｜ 依赖：无（三族可独立落地）

## 现状（2026-09-21 复核）

self 孤儿桶 top-10 里 7 条是 `RepoQAClient.*`（`getRepo` 那条**已核为真阳性**，不在本票范围）。其余 6 条各卡在不同机制：

| 族 | 代表证据 | 机制缺口 |
|---|---|---|
| **(g) 工具类型 / 具名接口成员** | `EvolutionView.tsx:22`、`CiGateView.tsx:19`、`ArchitectureDeltaView.tsx:13`（`client: Pick<RepoQAClient,'radar'>`） | 接收者类型注解是**工具类型 + 具名 props 接口成员**；适配器只认内联类型字面量（票 11 的 (d)）与直接标识符，`Pick<T,K>` 与"具名接口的成员类型"都不展开 |
| **(f) `useMemo` 工厂 / 上下文类型流** | `App.tsx:38`（`const client = useMemo(() => clientProp ?? new RepoQAClient(...), [clientProp])`）、`App.tsx:156` | `NewExpression` 是**深层子节点**（在箭头体内），`getChild('NewExpression')` 取不到；上下文解构（`const { client } = useRepo()`）同理 |
| **(e) 闭包参数别名** | `useReverseDeps.ts:18`（`(c, repoId_, name) => c.listReverseDeps(...)`） | 回调参数 `c` 的类型由**被调方签名**决定（`useSymbolResource` 的第 4 参），需跨文件函数签名 + 泛型实例化推断 |

## 内容（逐族独立，**每族先归因实验再动手**——票 02 的教训：假设常被实测推翻）

### (g) 工具类型与具名接口成员（**6 条里占 5 条**）—— ✅ **已落地（2026-09-21）**

1. **归因实验先行，且推翻了票面假设**（四变体探针）：不是"两者可能只坏一个"，而是**两处独立都坏**——变体 B（内联字面量 + `Pick<>`）与变体 D（具名接口 + 普通类型）**各自单独失败**，而 A（内联 + 普通类型）通过。
2. **落地**：`ReceiverType { name, allowed? }` 贯穿 `params`/`locals`/`receiverTypeOf`；`resolveTypeRef` 解析注解**原文**（`X` / `Pick<X,'a'|'b'>` / `X | undefined`），其余 fail-closed；文件内 interface 成员表（`parseInterfaceMembers`）；调用点由 `receiverExposes` 判越界即 `dynamic`。
3. **实现中又由探针暴露两处真缺陷（已修 + 回归钉）**：
   ① **朴素 `split('|')` 撕裂 `Pick<X, 'a' | 'b'>`**——`|` 在 `<>` 内属 K 列表却被误判为"真联合"→ 直接 fail-closed；症状是"单名 Pick 通过、两名失败"，看似随机。修法：深度感知的 `splitTopLevel`。
   ② **`=>` 的 `>` 被当成泛型闭合** → 深度变负 → **函数类型成员之后的所有成员全部丢失**（`onNavigate?: () => void;` 排在 `client` 之前时即失效）。修法：两个文本切分器都忽略 `=>`。
4. **实测（三仓同源复跑）**：**四条目标全部离榜**——`radar` / `getArchitectureDelta` / `runGate` / `listGateRuns`；self 孤儿 **250 → 248**（净减，说明未制造新孤儿）；lazygit **1807** / petclinic **13** **逐字节不变**；普查守恒三仓成立。
5. **反例单测（防假边）**：`Pick<T,'a'>` 上调 `b()` 必须 dynamic；`A | B` 与 `Pick<X, keyof X>` 必须不绑；两名 Pick + 函数类型成员在前的组合有回归钉（adapter 18 用例全绿）。
6. **本次复测新露面的两条（不在 (g) 范围，按分工登记）**：`RepoQAClient.getSubgraphContext` 有**生产调用点**（`InspectorContext.tsx:72`）→ 假阳性，属 (f)/上下文 Provider 族；`QueryStream.onEvent/onError/onDone` 是流订阅 API（`RepoQAClient.ts:660-670`），待查是死 API 还是订阅模式未捕获。

### (f) `useMemo` 工厂与上下文解构（**次高**）—— 第一半 ✅ 已落地；第二半待跨文件机制

1. **第一半（`useMemo` 工厂的深层 `new`）已落地（2026-09-21）**：窄规则 = 仅当初始化器是
   `useMemo(() => new T(...))` 或 `useMemo(() => X ?? new T(...))`（白名单 `useMemo`）才定型；
   **反例守死**：`items.map(u => new User(u))` 是**实例的集合**，整体定型会把 `users` 误判为 `User`（造出类型系统没有的边）。
   单测含该反例（19 用例全绿）。
   **但它不推动 top-10**：`App.tsx:38` 的 `client` 只作为 JSX 属性传给 `<RepoProvider client={client}>`，没有方法调用 ——
   实测 self 孤儿 248 不变（预期）。
2. **第二半（上下文解构）经实测定位为跨文件问题，待开工**：
   `pickFolder` 的调用点（`App.tsx:156`）其实在 **`WorkbenchShell`（`App.tsx:52`）** 里，其 `client` 来自
   `const { client } = useRepo()`（`:54`）；而 `useRepo(): RepoContextValue`（`RepoContext.tsx:423`）的返回类型接口
   **声明在另一个文件**。因此需要：① hook 调用的**返回类型**（跨文件函数签名）+ ② 该接口的**成员表**（跨文件）。
   机制与 V31-02 的 Go per-repo 包表同源 → **扩 `ParseContext` 加 TS 条目**（per-repo 接口成员表 + hook 返回类型，
   歧义名一律丢弃），worker 两条解析路径各注一次。
3. 复测：`pickFolder`（`App.tsx:156`）应离开 top-10 —— **本增量未达成，卡在跨文件机制**（见上）。

### (e) 闭包参数别名（**成本最高，可最后**）

1. 需要：被调方（`useSymbolResource`）的**参数类型签名**进符号表 + 调用点按位置绑定实参类型给回调形参。
2. 若签名跨文件/泛型化导致不可确定性解析 → **保持 dynamic**（ADR-0002），并在票面记录不可达理由。
3. 复测：`listReverseDeps` 应离开 top-10。

## 验收

- [ ] 三族各自的归因实验留档（最小复刻 + 断点定位），**先红后绿**
- [ ] (g) 的 `Pick<>` 受限展开有单测：`Pick<T,'a'>` 上调用 `b()` **不得**解析成边（防假边）；具名接口成员表含歧义丢弃用例
- [ ] (f) 的窄规则有反例单测：`arr.map(u => new User(u))` **不得**把 `arr` 定型为 `User`
- [ ] self top-10 中 `RepoQAClient.*` 从 7 条降到 ≤1 条（`getRepo` 真阳性可留）
- [ ] 三仓复测：lazygit / petclinic **逐字节不变**（不触其语言）；self 孤儿数下降且普查守恒（`candidatesBeforeRules` 等式仍成立）
- [ ] 97 题 eval 全阈值不回退；e2e 全绿；cp 单测基线不降；棘轮不变

## 风险

1. **假边 > 漏边**：三族都在"多解析一条边"的方向上，任何一条过度展开都会把假阳性换成假阴性（更危险）。故每族都必须有**反例单测**（越界/集合构造/歧义名），且以 `dynamic` 为默认收口。
2. (e) 可能被证明不可确定性实现 → 允许只交付 (g)(f)，并把 (e) 的理由写入票面（诚实下限，与报告 §6 口径一致）。
3. 改动集中在 `TypeScriptAdapter.ts` 与 `repoqa-*` 类型表，需三仓复测确认只动 TS。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/languages/TypeScriptAdapter.ts`（+test） | MCP 工具面 | 三族主战场（与票 11/17 同文件，须串行） |
| `services/control-plane/src/engine/repoqa-callchain.ts`（+test） | MCP 工具面 | 受限类型记录的解析收口（若需） |
| `scripts/precision/out/`、`docs/reports/` | 共享区 | 三仓复测与判定重判留档（`verdicts/self.json` 需按新 top-10 重判） |
