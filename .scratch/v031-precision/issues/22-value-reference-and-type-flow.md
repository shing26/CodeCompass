# Issue 22 — 值引用边 + 类型流（两族假阳性的新边机制）

> 依据：M1 重判（报告 §16）后的两族假阳性：**值引用**（函数作为实参/JSX 属性值传递，无调用边）与**成员链/类型流**（client 穿过 props/解构/字段访问后接收者失去类型）
> 判据：HANDOFF §2.2「降低误报」——两族覆盖当时 self top-10 的 8/10
> 波次：v1.0.0 锚点后 ｜ 状态：**✅ 落地（2026-09-27）** ｜ 依赖：票 18/20（同文件，已串行）

## 0. 结果

self 孤儿 **243 → 170（−73，−30%）**，孤儿/符号比 **11.8% → 8.2%**；top-10 **十席再次全部换血**——机制类假阳性（接收者定型失败）全部离榜，浮上来的是 test-only 组件/导出与遗留层（每条都有具名处置，见 verdicts/self.json）。lazygit **1828** / petclinic **13** 逐字节不变（机制 A–C 仅 TS 适配器）。

## 1. 机制 A：值引用边（`RepoSymbolCall.reference?: true`）

`window.addEventListener('keydown', onKeyDown)`、`onPick={handlePick}`——函数作为**值**传递，框架而非本调用点会调用它。没有边，被传递的函数读成死代码。

- **记录**：调用的**裸标识符实参**与 **JSX 属性值/子级的裸标识符**（`{handlePick}`）→ 记 `reference: true` 的边（`this`/`undefined` 除外；成员表达式与内联函数不是对仓内符号的引用）。
- **计数**：`buildFullCallersIndex` 照常解析（裸名 → 同文件/全局名解析）→ in-degree 计入 ✔。
- **跳过**：调用链 trace（`resolveCallChain`）与挂载链（`walkMountChain`）**跳过 reference 边**——trace 是调用序列，"被当值传递"不是调用。

## 2. 机制 B：`useRef<T>()` 定型 + `.current` 解引用

`const streamRef = useRef<QueryStreamLike | null>(null)` → `streamRef.current?.close()`：`useRef<T>` 的显式类型实参（白名单 `useRef`，经 `InstantiationExpression` 读 TypeArgList）定型 local 为 `T`（`| null` 剥离），`ReceiverType.ref` 标记后，`.current` 段解引用回 `T`。`QueryStream.close` 由此经唯一实现表绑定（真边）。**反例**：未类型的 `useRef()` 不绑（单测钉死）。

## 3. 机制 C：类型流（内联字面量 members + 段走 + 解构 + 跨文件字段表）

`ChatView`/`ModelSelect` 的 client 要过四道类型流才到方法调用：

1. **内联字面量参数**（`props: { client: RepoQAClient }`）：成员扁平绑定（既有）**加**参数名绑定 `{members}`（新）——否则 `const { chatClient } = props` 读不到来源。
2. **段走**（`resolveReceiverChain`）：整串查不到的接收者按段走——首段走闭包链（含栅栏），后续段依次过 `.current` 解引用 / 内联 members / 跨文件字段表；任一段落空即整体失败（部分解析=猜，ADR-0002）。
3. **解构自类型变量**（`const { chatClient } = props`）：初始化器是裸标识符时，从其绑定的 members 取类型。
4. **跨文件字段表**（`TypeScriptDeclarations.fields`，`Type.field` → 原文类型）：类扫描器扩展到属性声明（`readonly chat: ChatMergeClient;`，顶层 `;` 结束、含顶层 `{` 的初始化器跳过）；`client.chat`、索引访问 `RepoQAClient['chat']` 都经它解析。

## 4. 实测（三仓同源复跑）

| 样本 | 符号 | 孤儿（前 → 后） | 说明 |
|---|---|---|---|
| self | 2066 → **2072** | **243 → 170** | +2 = 冒烟脚本的符号；值引用边接通上百个"被当值传递"的符号 |
| lazygit | 10523 → 10523 | 1828 → **1828** | 逐字节不变（机制 A–C 仅 TS） |
| petclinic | 595 → 595 | 13 → **13** | 逐字节不变 |

普查守恒 `593 = 170 + 423`；棘轮 self **8.2%**（天花板 17.1%）；控制面 **733**、web 364、bridge 26、e2e 71/0；单测 6 条新例（值引用正例 ×2、useRef 正/反例、类型流正例 ×2）。

## 5. M1 重判（top-10 十席换血，全部已知类）

机制类假阳性清零后，新 top-10 是另一个总体：**10/10 均为已知类**，无一是新的接收者定型失败：

| 类 | 条目 | 处置 |
|---|---|---|
| test-only 组件 | EvidenceCard / Markdown / SourceTraceDrawer / StackTraceInput | 死 UI——Web 面只减不增的移除候选 |
| test-only 导出 | brandColor / escapeMermaidLabel | 导出工具仅自有测试消费 |
| 遗留层 | BrowserAdapter.connect/disconnect | `packages/bridge-adapters`（结构评审 §12 遗留层），仅自有测试消费 |
| 成员链 + 联合歧义 | EvolveStream.close | `streamRef.current?.stream.close()`——联合两个 `.stream` 类型不同，目标真歧义，按 ADR-0002 保持 dynamic（判别联合收窄超出范围，登记） |
| 值引用同名遮蔽 | handleExport（RepoContext） | App 的引用边按名绑到了同名的 TopBar.handleExport——两个同名函数都活着，名字碰撞是按名解析的已知边界 |

**M1 读数为 100%——但构成是"每条都有具名处置的已知类"**，与 09-16 那个 100%（真机制失败、三仓全假、根因未知）不可同日而语。这是 top-10 按位置取样的构成敏感性第三次显形（前两次：票 18 后换血、票 21 后孤儿桶变大）。

## 6. 验收（2026-09-27 复核）

- [x] 机制 A：值引用边有单测（addEventListener ×2 + JSX 属性值），trace/挂载链跳过有断言
- [x] 机制 B：useRef 定型 + 解引用有端到端单测（经唯一实现表落到 `QueryStream.close`），未类型 `useRef()` 反例
- [x] 机制 C：四道类型流有端到端单测（索引访问参数、解构、字段链、三方法全绑），字段表有单测断言
- [x] 三仓复测：self **243 → 170**、lazygit/petclinic 逐字节不变
- [x] 门禁：cp 733 / web 364 / bridge 26 / e2e 71/0；棘轮 8.2% 未动 baseline
- [x] verdicts/self.json 十条重判入档（每条附 grep 证据），`--score` 覆盖守卫不再标 ⚠

## 7. 已知边界（诚实登记）

1. **EvolveStream.close**：判别联合收窄（`streamRef.current.kind === 'evolve'`）超出静态范围，诚实保持 dynamic。
2. **值引用按名解析的同名遮蔽**（handleExport 双定义）：按名绑定取 earliest——两个同名函数都活着但只有一个被计数；候选修法 = 引用边也走类型（需类型流的引用变体），未做。
3. **引用边数量**：裸标识符实参全量记边会放大符号负载（self +数百条）——实测可接受，若未来成为存储问题再收窄白名单。
4. 机制 C 不处理联合类型成员查表（EvolveStream.close 即此类的实例）。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/languages/TypeScriptAdapter.ts`（+test） | MCP 工具面 | 机制 A/B/C |
| `services/control-plane/src/ingest/repoqa-repos.ts` | MCP 工具面 | `RepoSymbolCall.reference` |
| `services/control-plane/src/engine/repoqa-callchain.ts` / `repoqa-tours.ts` | MCP 工具面 | trace/挂载链跳过 reference 边 |
| `scripts/precision/verdicts/self.json`、`docs/reports/` | 共享区 | 十席重判与留档 |
