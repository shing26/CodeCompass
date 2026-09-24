# Issue 20 — 接口→实现关系表（ADR-0018 `deferred` 的 A′ step 2）

> 依据：ADR-0018 三裁决中的 `deferred` 项；票 18 复测后 self top-10 的流订阅族
> 判据：HANDOFF §2.2「降低误报」——self top-10 现有 `QueryStream.*`（4）+ `EvolveStream.*`（2）
> 波次：待排 ｜ 状态：**✅ 已落地（2026-09-24）** ｜ 依赖：票 18（同文件面，已串行）

## 0. 结论先说：**票面前提被实测推翻**

票面写的是"TS 侧接口→实现关系**根本没建表**，要新建"。实测（`.scratch/probe-stream.ts`，跑真索引）：

```
implsOfInterface: QueryStreamLike → [QueryStream]；EvolveStreamLike → [EvolveStream]
types: QueryStream kind=class interfaces=[QueryStreamLike] methods=15
```

**表早就存在且映射正确**（`buildCallIndex` 从 `symbol.interfaces` 建，TS 适配器的 `ClassDeclaration` 分支一直在填
`implements`）。真正打不通的是**调用点的接收者没有类型**——表在了，但没人拿它去查。于是本票的执行内容从
"建表"改成"把接收者定型"，并且**不动 `implsOfInterface` / `resolveCall` 一行**（Java 侧那套多实现消歧原样保留）。

## 1. 三处真缺陷（逐条实测定位，先红后绿）

| # | 缺陷 | 症状 | 修法 |
|---|---|---|---|
| ① | **回调注解形参无人采集**：`useCallback((stream: QueryStreamLike) => …)` 的箭头是**实参**，既不是 `const x = (…) =>` 声明也不是方法，`collectParams` 从没被调用 | 注解就写在文件里却从未生效；`useChat.ts` 四条流调用全 dynamic | `callbackScopeFor`：箭头/函数表达式一律取自己的**已注解形参**（无注解且无被调方签名则仍不推作用域，保持窄规则） |
| ② | **缺方法返回类型**：`const stream = client.evolveStream(…)` 只能靠 `RepoQAClient.evolveStream(…): EvolveStreamLike` 定型，而票 18 的表只有顶层 `function` | `useEvolutionSession.ts` 四条 evolve 流调用 dynamic | 表加 `methods`（`Type.method` → 原文返回注解），消费点按接收者类型 + Pick 允许集查表 |
| ③ | **具名接口分支吞注解**：`memberLookup(raw)` 对**空 Map 也是真值**，而 `QueryStreamLike` 是**方法型契约**（`parseInterfaceMembers` 只收 `name: type` 成员，方法签名一条不收 → 成员表为空） | 走"按成员绑定"分支 → 零绑定 → **且不再走普通类型分支** → 参数彻底未定型。这是"表在却打不通"的直接原因 | 只在 `members.size > 0` 时走成员绑定；否则按普通接收者类型处理（并只绑**裸标识符**形参，解构模式不是查找键） |

三处都是"静默失效"型：没有报错，只是精度不动。

## 2. 实测（三仓同源复跑，`npm run precision`）

| 样本 | 孤儿（前 → 后） | 说明 |
|---|---|---|
| self | **246 → 237**（−9） | 流订阅族**整族离榜**；12 个流调用点全部定型（`useEvolutionSession` 8 处：evolve 4 处 `EvolveStreamLike`、incident 4 处 `QueryStreamLike`；`useChat` 4 处 `QueryStreamLike`） |
| lazygit | **1807 → 1807** | 逐字节不变 |
| petclinic | **13 → 13** | 逐字节不变 |

普查守恒 `658 = 237 + 421`；棘轮 self 237/2045 = **11.6%**（天花板 17.1%）；控制面 716、web 364、bridge 26、e2e 71/0、97 题 eval 全阈值。

**复测后 top-10 的新面孔（都不是本票缺陷）**：

- `EvolveStream.close` —— 接收者是**成员链** `streamRef.current.stream`（`useEvolutionSession.ts:278`）。前缀链解析是新机制，登记为后续（见 §5）。
- `ChatMergeClient.listSessions/createSession/messages/switchModel/modelInfo`（5 条）—— **真阳性**：生产代码零调用，
  仅 `App.test.tsx` / `ChatView.test.tsx` 的**替身对象字面量**里出现（`listSessions: vi.fn()` 不是调用），
  所以既没有真调用者也没有 `testOnly` 标记。属 Web 面的死 API，与 `RepoQAClient.getRepo` 同类——**桶在做它该做的事**。

## 3. 票面错误更正：**lazygit 的 620 条与 TS 不同源**

票面把 lazygit 的 620 条 `interface-implementation` 写成"同源"，**这是错的**，实测不变即证据：

- `implsOfInterface` 只能从**显式** `implements` 建（Java / TS）。**Go 没有 `implements`**——接口满足是隐式的（方法集匹配），
  需要一套 Go 方法集推断表才可能绑定。
- 更要紧的是 ADR-0018 已经裁决过这 620 条：**"Go 接口多实现时 ADR-0002 要求保持 dynamic"**，它们本就**该**留在桶里
  作为结构性噪声登记，而不是被"修掉"。

所以：**lazygit / petclinic 逐字节不变是本票的预期结果，不是"没生效"**。ADR-0018 的 `deferred` 说明与 census 断言
**无需改动**（其描述对 Go 仍然准确）。若日后要动 Go 隐式接口，那是另一张票（方法集推断），且要先过 ADR-0018 的裁决口径。

## 4. 顺带修的两处（都在本票触发路径上）

1. **方法返回注解被 `{` 截断**：`pickFolder(): Promise<{ canceled: boolean }>` 用 `indexOf('{')` 取到 `Promise<`（对象类型的
   花括号被当成方法体）。新增 `typeTextBeforeBody`：只有**角度/圆/方括号都闭合**时的 `{` 才是方法体，故
   `Promise<{ … }>` 能走到真正的方法体花括号。直接返回对象类型（`(): { a: string } {`）读作空注解 → 跳过（那类类型本来也解析不出接收者）。
2. **TS 表改为只取生产文件**（`isTestPath` 过滤，Go 表原样不动）：测试文件里的 `class X { … }` 是**测试替身**，不是生产
   调用要用的类型。实测**两次**被自己新加的 fixture 污染（票 18 的 `RepoContextValue`、本票的 `RepoQAClient.queryRepo`
   ——后者导致 `queryRepo` 从表里被歧义规则丢弃，症状是"incident 路径的四条流调用仍然 dynamic"）。
   这与票 19（多行模板串未掩码 → 幻影声明）是**两个独立问题**：本过滤挡住"测试文件里的真声明"，票 19 管"模板串里的假声明"。

## 5. 仍开放（不在本票范围，已登记）

1. **成员链接收者**：`streamRef.current.stream.close()` 需要前缀链解析（或给 `useRef<T>()` 这类泛型 API 定型）。
2. **票 21**：`resolveCall` 在 `dynamic === false` 但 `receiverType` 不在索引里时，仍会退回**按名解析**（同文件/全局方法名），
   这是**假边**方向的口子——本票新增的定型面把它暴露得更宽（见该票）。
3. Go 隐式接口的方法集推断（若要做，须先过 ADR-0018 口径）。

## 验收（2026-09-24 复核）

- [x] 先红：3 条新单测在实现前失败（两条接收者缺口 + `methods` 表缺失）
- [x] 后绿：唯一实现绑定（`resolveCallEdge` 落到 `QueryStream.onEvent`）；**两个实现保持 dynamic**（反例单测）
- [x] self 流订阅族离榜（`QueryStream.*` 4 + `EvolveStream.onEvent`/`connect`）；self 孤儿 246 → 237 且普查守恒
- [x] lazygit / petclinic 逐字节不变 —— **且更正了票面对该结果的预期**（Go 无 `implements`，见 §3）
- [x] 97 题 eval 全阈值不回退；e2e 71/0；控制面 716（基线 711 不降）；棘轮 11.6% < 17.1%

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/languages/TypeScriptAdapter.ts`（+test） | MCP 工具面 | 三处缺陷 + `methods` 表 + `typeTextBeforeBody` |
| `services/control-plane/src/languages/parse-context.ts` | MCP 工具面 | `TypeScriptDeclarations.methods` |
| `services/control-plane/src/ingest/repoqa-parser.ts` | MCP 工具面 | TS 表只取生产文件 |
| `scripts/precision/out/`、`docs/reports/` | 共享区 | 三仓复测留档 |
