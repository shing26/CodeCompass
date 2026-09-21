# Issue 11 — TS 嵌套作用域接收者定型（实例字段回填）

> 依据：2026-09-19 首次真实 agent 会话 dogfooding（`issues/07` 验收末条，证据已回写票面）
> 判据：HANDOFF §2.2「降低误报」——本票直击 scan 孤儿桶 top-10 的 **8/10 假阳性**（M1 实测仍 100% 的直接构成）
> 波次：v0.31.0（tag 未打，搭车）｜ 依赖：无（不阻塞发布面）｜ 状态：**已实施**（2026-09-19，见「实施记录」；验收 5/6 勾，M1 重判待下一增量）

## 现象（2026-09-19 实测，可复核）

本仓 `scan` 孤儿桶 top-10 中 8 条是 `RepoQAClient.*`（constructor/listRepos/getRepo/importRepo/deleteRepo/reindexRepo/cloneRepo…），
全部报"0 static callers"。**grep 实锤为假阳性**：`client.listRepos()` 在 `apps/repoqa-web/src/hooks/useRepoCatalog.ts:45/83`
有生产调用点（`:104` 的 `importRepo` 同理）。前一年 V31-02 报告 §4 第 4 项就登记过"工厂返回实例仍待修"——本次定位到更准的机制。

## 根因（已定位到行，非猜测）

**嵌套作用域不链外层**。`client` 是外层 hook 的参数（`useRepoCatalog(client: RepoQAClient, …)`，`:30`，带类型注解），
调用点在 `useCallback(async () => { client.listRepos() })` 的**嵌套箭头函数**里。适配器侧：

- `collectParams`（`TypeScriptAdapter.ts:255-269`）**每个函数新建独立 `MethodScope`**（`locals: new Map()`），参数注解本身有捕获（`:261-265`）；
- `receiverTypeOf`（`:271+`）只查**当前** scope 的 locals/params + typeStack 字段，不向外层函数作用域链查。

即：类型信息在，**作用域链断了**。React 组件/钩子代码几乎全部长在 `useCallback`/`useEffect`/事件回调的嵌套箭头里，
所以这一类缺口覆盖了前端的"实例方法调用"主形态——这也解释了为什么 8/10 全是同一个类的假阳性。

## 内容（禁止盲修，归因先行——票 02 的教训）

1. **归因实验先行**：单测复刻最小结构（外层函数带注解参数 + 嵌套箭头内 `param.method()`），实测当前断点；
   同场验证 `typeAnnotationName` 对 lezer 参数节点的捕获是否如预期（若捕获也断，属同票第二处）。
2. **修法（最小面）**：`MethodScope` 增外层链（`parent?: MethodScope`），`receiverTypeOf` 沿链查 params/locals；
   **沿用票 02 的 fail-closed 遮蔽规则**：内层同名声明遮蔽外层；查不到类型保持 dynamic，不猜。
3. **顺带核验第二跳**：接收者定型为 `RepoQAClient` 后，跨文件类方法表（`index.types`）能否命中 `listRepos`
   ——类符号已在符号表（孤儿条目带 parentType 为证），预期可命中；命中不了则属另一缺口，**登记后再议，不顺手修**。
4. **复测**：`scan_precision.ts self` —— 预期孤儿 283 明显下降（RepoQAClient 一族 + 其他 hook 持有实例），
   top-10 构成变化入档；lazygit/petclinic 不触 TS，应逐字节不变。

## 验收

- [x] 归因单测在位（嵌套箭头 + 注解参数 → 调用边 `dynamic: false`）——**先红后绿**，且红的位置推翻了票面初始假设（见实施记录）
- [x] fail-closed 保持：查不到类型仍 dynamic；**遮蔽栅栏有单测**（内层未定型重声明阻止外层定型复活——`receiverTypeOf` 走链时在最近的**声明**处停下，无论其有无类型）
- [x] `self` 孤儿桶显著下降：**283 → 236（−47）**；原单一根因族（参数注解）清空——listRepos/importRepo/deleteRepo/reindexRepo/cloneRepo 全部获得调用边；**但 top-10 仍有 7 条 `RepoQAClient.*`，各自卡在实施中新登记的不同机制族**（见下），"不再被占据"未完全达成
- [x] 97 题 golden eval 全阈值不回退（幻觉 0%）；e2e **68/68**；cp 单测 **680 → 686**（+6）；四包 typecheck 净
- [x] 三仓复测数字入档：lazygit **1807** / petclinic **13** **逐字节不变**（每步增量都复测过）；self 普查守恒
- [ ] M1（top-10 假阳性率）复算留档——**未重判**（`verdicts/self.json` 的判定仍描述改动前的榜单构成，需下一增量重判后再算 M1）

## 实施记录（2026-09-19，三轮递进）

**归因实验推翻了票面的初始假设**。票面假设"嵌套作用域不链外层"是主因；实验（先红）显示调用边已捕获、断点在
**参数类型捕获**：lezer 把参数的 `: Type` 注解放在 **ParamList 层（VariableDefinition 的兄弟节点）**，
而 `typeAnnotationName` 只找直接子节点——**参数注解从未被读过**。真实根因序列（每步修完即复测）：

| 步 | 根因 | 修法 | self 孤儿 |
|---|---|---|---|
| (a) | 参数注解是 ParamList 的兄弟节点，从未被捕获 | `collectParams` 配对 VariableDefinition 与其后的 TypeAnnotation 兄弟 | 283 → 265 |
| (d) | 解构参数 `{ client }: { client: X; … }` 是 **ObjectPattern**（非 VariableDefinition），注解是类型字面量 | ObjectPattern/ArrayPattern 进配对；类型字面量按**成员**逐个绑定（仅显式标识符类型，fail-closed） | 265 → 261 |
| 链 | `const handleX = async () => …` 直接子箭头建**新空作用域**，外层定型不可见（票面原假设对这类成立） | `MethodScope.parent` 闭包链 + `declared` 遮蔽栅栏（最近声明处停，未定型不复活） | 261 → 261* |
| (h) | **`new X()` 不记构造边**——constructor 无论类多活永远读作孤儿 | NewExpression → `constructor` 调用边（receiverType=类名；`callShape` 不可用——其 firstChild 读到 `new` 关键字） | 261 → **236** |

*链本身的增益体现在 (d) 之后的下一步（RepoContext 的 handleCloneRemote 族在链落地后才离开榜单）。

**登记不扩散（top-10 剩余 7 条 `RepoQAClient.*` 各自的拦路族，每条都有 file:line 证据）**：

| 族 | 证据 | 需要的机制 |
|---|---|---|
| (g) `Pick<RepoQAClient,'radar'>` 工具类型 / 具名接口成员 | `EvolutionView.tsx:22`、`CiGateView.tsx:19`、`ArchitectureDeltaView.tsx:13` | 接口成员类型解析 + Pick 展开（跨"参数注解"边界，新机制） |
| (e) 闭包参数别名 | `useReverseDeps.ts:18`：`(c, …) => c.listReverseDeps(…)`——`c` 的类型由被调方签名决定 | 回调参数的签名级推断 |
| (f) `useMemo(() => new RepoQAClient())` / 上下文解构流 | `App.tsx:38/156` | 类型流分析（深搜 NewExpression 有误定型风险，如 `arr.map(u => new User(u))`，需更窄的判定） |

另：top-10 的 `App`/`onKeyDown`/`brandColor` 是报告 §5 早已登记的 JSX 分派缺口（与 `RepoQAClient` 无关）。

**副产物**：`getRepo` 疑似**真孤儿**（web src 内 grep 无生产调用点）——这正是收窄后孤儿桶该报的东西，留给下一次逐条核验确认。

## 风险

1. **作用域链引入误绑定**：箭头函数捕获的外层变量在运行时才赋值（TDZ/重赋值），按声明定型有理论误判面——
   以"注解显式存在"为定型前提可把风险压到最小（不推断无注解值）。
2. lezer AST 的函数节点遍历顺序若自内向外构建 scope，链的方向要实测确认（归因实验覆盖）。
3. 本票只修 **TS 适配器**；Java/Go 的同类形态（匿名类/闭包捕获）不在本票，发现即登记不扩散。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/languages/TypeScriptAdapter.ts`（+test） | MCP 工具面 | 主战场：MethodScope 链 + receiverTypeOf |
| `scripts/precision/out/self.json` | 共享区（harness 产物） | 复测留档 |
| `docs/reports/scan-precision-baseline-2026-09-16.md` | 共享区 | 复测段（收口时一次性追加） |

**边界**：不动 `parse-context.ts`（跨文件机制本票不触）、不动引擎布局约束（HANDOFF §2.2）、
不加工具不加 Tab（spec §1.1 冻结面）。
