# Issue 18 — 精度残余三族（top-10 剩 7 条 `RepoQAClient.*` 的拦路机制）

> 依据：票 11「登记不扩散」表（2026-09-19 dogfooding 实测）+ `scripts/precision/verdicts/self.json` 的四条 `utility-type-props` 判定
> 判据：HANDOFF §2.2「降低误报」——三族合计覆盖当前 self top-10 的 **7/10**（`RepoQAClient.*` 全族）
> 波次：待排 ｜ 状态：**✅ 三族全落地（(g) 2026-09-21；(f) 两半 + (e) 2026-09-24）** ｜ 依赖：无（三族可独立落地）
> 复测口径：全量索引（`npm run precision`），三仓同源可复跑

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

### (f) `useMemo` 工厂与上下文解构（**次高**）—— ✅ **两半全落地**（第一半 2026-09-21，第二半 2026-09-24）

**第一半（`useMemo` 工厂的深层 `new`，2026-09-21）**：窄规则 = 仅当初始化器是 `useMemo(() => new T(...))` 或
`useMemo(() => X ?? new T(...))`（白名单 `useMemo`）才定型；**反例守死**——`items.map(u => new User(u))` 是**实例的集合**，
整体定型会把 `users` 误判为 `User`（造出类型系统没有的边），单测含该反例。它**不推动 top-10**（`App.tsx:38` 的 `client`
只作为 JSX 属性传给 `<RepoProvider>`，无方法调用），属预期而非"改了没用"。

### (f) 第二半与 (e) —— ✅ **已落地（2026-09-24）**：跨文件类型/成员表

1. **归因先行**（`.scratch/probe-f2e.ts`，逐文件 before/after 边对照）：`pickFolder` / `previewRepo` / `getSubgraphContext` / `listReverseDeps` 四条目标**全部由 MISSING 变 EDGE**；`before` 侧即"无 context"（增量前行为）为红。
2. **机制**：扩 `ParseContext.languages.typescript`（`TypeScriptDeclarations` = `interfaces` 成员表 + `returns` 返回类型 + `params` 形参类型），`buildParseContext` 一次建表（**只扫不解析**——review 已把 Go"每轮解析两次"挂在"待测量"上，再给每个 TS 文件加一趟完整 parse 是更大的账）。
   - 表内一律存注解**原文**（`Pick<X,'a'>` 的限制必须活到调用点）；名字在两处以**不同内容**声明即整体丢弃（同 Go 包表规矩，歧义即不猜）。
   - `resolveTypeRef` 的 `interfaceMembers` 死参移除；成员查表改为 `MemberLookup`（**文件内优先**，跨文件兜底）。
   - 消费点三处：`const { client } = useRepo()`（ObjectPattern，非 VariableDefinition）、`const x = useRepo()`（返回类型）、回调实参按**被调方签名**定型（(e)）。
3. **实现中由探针抓出的两处真缺陷（均已修 + 回归钉）**：
   ① `argumentNodes(call).indexOf(node)` **恒为 -1** —— lezer 每次访问都新建 `SyntaxNode` 包装，同一实参永不引用相等 → (e) 绑定**静默从不触发**（"改了没用"型哑弹）；改按 `from/to` 位置匹配，并留"回调在第 3 个实参位"的回归钉。
   ② 重命名解构 `{ client: renamed }` 的目标在 lezer 里是 **VariableDefinition 而非 VariableName** → 首版守卫漏判，把 `client` 绑成了 `RepoQAClient`（**假边**，正是本票最怕的方向）。改为"只有裸 `{ name }` 才定型"，且重命名/默认值/剩余项仍进作用域栅栏。
4. **实测（三仓同源复跑，`npm run precision`）**：

| 样本 | 孤儿（前 → 后） | 说明 |
|---|---|---|
| self | **248 → 246** | top-10 中 `RepoQAClient.*` **7 → 1**（仅剩真阳性 `getRepo`）；`pickFolder`/`listReverseDeps`/`getSubgraphContext` 三条**全部离榜**（真索引复验：`pickFolder ← WorkbenchShell`、`listReverseDeps ← useReverseDeps`、`getSubgraphContext ← useSubgraphContext + handleCopyAgentContext`） |
| lazygit | **1807 → 1807** | 逐字节不变（不触 Go） |
| petclinic | **13 → 13** | 逐字节不变（不触 Java） |

普查守恒三仓成立（self `667 = 246 + 421`）；棘轮 self 246/2039 = **12.1%**（天花板 17.1%）；adapter 32 用例、控制面 **711**、web 364、bridge 26、e2e **71/0**、97 题 eval 全阈值通过。
5. **反例单测（防假边）**：无表/未知 hook 不绑；hook 无返回注解不绑；重命名与默认值不绑；跨文件 `Pick<X,'runGate'>` 上调 `pickFolder` **必须 dynamic**；本地接口压过跨文件同名；同名异内容整体丢弃；函数两处声明不一致则 returns 与 params **双双**丢弃；(e) 侧：自身注解优先（哪怕不可解析也不许被被调方签名顶替）、非函数类型/联合/未知被调方/实参多于形参一律不绑。
6. **一处刻意未做（诚实登记）**：**增量单文件刷新路径不建 TS 表**（`buildParseContextForFile` 对 TS 返回 undefined）。TS 表是**仓级**的（hook 与它返回的接口常在不同目录），诚实的增量建表要在每次保存时读全仓 TS 文件，而该调用点只有变更路径。后果 = 单文件刷新后的 TS 文件丢跨文件边，直到下次全量索引——**即"这个表出现之前所有 TS 文件的状态"**，所以永不比原来更差，只是不如全量索引完整。Go 侧不受影响（包=目录，原样保留）。
7. **测量期踩到的一个自指陷阱（已记入票 19）**：首次复测 `pickFolder` 仍是 0 调用者 —— 不是代码坏，而是**本票新加的单测 fixture 自己声明了 `interface RepoContextValue`**（多行模板串未掩码，见票 19），与真声明**内容不同** → 歧义规则（正确地）把真表项丢了。修法 = fixture 改名（测试不该与真仓库标识符同名异义），掩码缺陷另立票 19。

### (f)/(e) 之后剩下的：流订阅族（**不在本票范围，已登记**）

复测后 self top-10 的 `RepoQAClient.*` 只剩 `getRepo`（真阳性），但 `QueryStream.*`（`onEvent`/`onError`/`onDone`/`connect`）与 `EvolveStream.*`（2 条）**进入榜单**。机制与三族都不同：调用点写的是 `stream.onEvent(...)`，而 `stream` 的类型是**接口**（`QueryStreamLike` / `EvolveStreamLike`），实现是 `QueryStream` 类——需要**接口→实现关系表**才能把接口成员调用绑到实现方法，正是 ADR-0018 显式 `deferred` 的 A′ step 2（lazygit 620 条同源）。**故不在本票修，另开 A′ 票。**

### (e) 闭包参数别名（**成本最高，可最后**）—— ✅ 已落地（2026-09-24，见上）

1. 需要：被调方（`useSymbolResource`）的**参数类型签名**进符号表 + 调用点按位置绑定实参类型给回调形参。
2. 若签名跨文件/泛型化导致不可确定性解析 → **保持 dynamic**（ADR-0002），并在票面记录不可达理由。
3. 复测：`listReverseDeps` **已离开 top-10**（真索引复验 `listReverseDeps ← useReverseDeps`）。

## 验收（2026-09-24 复核）

- [x] 三族各自的归因实验留档（`.scratch/probe-f*.ts` / `probe-g*.ts` / `probe-f2e.ts`），**先红后绿**
- [x] (g) 的 `Pick<>` 受限展开有单测：`Pick<T,'a'>` 上调用 `b()` **不得**解析成边（防假边）；具名接口成员表含歧义丢弃用例
- [x] (f) 的窄规则有反例单测：`arr.map(u => new User(u))` **不得**把 `arr` 定型为 `User`
- [x] self top-10 中 `RepoQAClient.*` 从 7 条降到 **1 条**（仅 `getRepo` 真阳性）
- [x] 三仓复测：lazygit **1807** / petclinic **13** 逐字节不变；self 孤儿 **248 → 246** 且普查守恒（`667 = 246 + 421`）
- [x] 97 题 eval 全阈值不回退；e2e **71/0**；cp 单测 711（基线 698 不降）；棘轮 12.1% < 17.1%
- [x] (e) 的确定性边界已写明（自身注解优先；非函数类型/联合/未知被调方/实参多于形参一律不绑），**不需要**退到"不可确定性"的诚实下限

## 风险（复核后）

1. **假边 > 漏边**：三族都在"多解析一条边"的方向上，任何一条过度展开都会把假阳性换成假阴性（更危险）。故每族都必须有**反例单测**（越界/集合构造/歧义名），且以 `dynamic` 为默认收口。
   **实证**：本次实现中 ② 号缺陷（重命名解构）正是这一类，被反例单测当场抓住——守卫先写成"只认 VariableName"，而 lezer 用 VariableDefinition 表达重命名目标。
2. (e) 已确定性落地（被调方签名里不含类型参数的位置可静态解析）；含泛型实参的类型参数位置仍 fail-closed，无需要退下限。
3. 改动集中在 `TypeScriptAdapter.ts` / `parse-context.ts` / `repoqa-parser.ts`，三仓复测确认只动 TS。
4. **表与真索引的口径差（新登记）**：跨文件表是**仓级**的，增量单文件刷新不建表（见上文 6），故"单文件保存后的边"与"全量索引的边"会有差；判据一律以全量索引（harness/CI）为准。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/languages/TypeScriptAdapter.ts`（+test） | MCP 工具面 | 三族主战场（与票 11/17 同文件，须串行） |
| `services/control-plane/src/engine/repoqa-callchain.ts`（+test） | MCP 工具面 | 受限类型记录的解析收口（若需） |
| `scripts/precision/out/`、`docs/reports/` | 共享区 | 三仓复测与判定重判留档（`verdicts/self.json` 需按新 top-10 重判） |
