# Issue 17 — TS/JS 仓的 Tour 锚点族（V27-17 升级票）

> 依据：V27-17（`.scratch/v027-backlog.md`，2026-09-12 全功能回归走查 R2 实证）；2026-09-16 v0.31 方向裁决**升级为 A 线精度候选**
> 判据：HANDOFF §2.2「降低误报或提升精度」——**空 tours = agent 拿到空事实**（工具返回 `[]` 等于告诉宿主"这个仓没有上手路径"）
> 波次：v0.31.0 之后（tag 未重指前可搭车）｜ 状态：**✅ 已落地（2026-09-24）**

## 0. 结果：本仓 `get_tours` 由 `[]` 变为两条真实路线

```
auth-chain  鉴权与中间件链（4 steps）
  1. USE * → requestIdMiddleware（中间件注册）  [services/control-plane/src/http.ts:42]
  2. USE /api（中间件注册）                      [services/control-plane/src/http.ts:130]
  3. USE * → errorMiddleware（中间件注册）       [services/control-plane/src/http.ts:162]
  4. GET /api/chat/status（中间件后的首个路由）  [services/control-plane/src/chat/routes.ts:27]
main-flow   挂载链（5 steps）
  1. main（模块入口：挂载根组件）                [apps/repoqa-web/src/main.tsx:9]  ← createRoot(...).render(
  2. App                                        [apps/repoqa-web/src/App.tsx:34]
  3. constructor                                [apps/repoqa-web/src/client/RepoQAClient.ts:48]
  4. fetchWithTimeout                           [apps/repoqa-web/src/client/timeout.ts:44]
  5. constructor                                [apps/repoqa-web/src/client/timeout.ts:29]
error-handling  0 steps（TS 无 @RestControllerAdvice 概念，保持诚实空态）
```

锚点全部可点开核对（`main.tsx:9` 就是 `createRoot(...).render(` 那一行）。

## 1. 落地内容

### (a) 适配器：两个被丢掉的入口族

1. **命名中间件注册边**（`languages/TypeScriptAdapter.ts`）：`app.use(name)` 此前因"取不到字符串首参"整条被丢弃——中间件既没有锚点、自己也读成死代码。现在登记为 `route` 符号 `USE *`（带指向中间件的调用边）。**只收命名中间件**：内联箭头没有可锚定的名字、库工厂调用（`app.use(express.json())`）不是本引擎能锚定的中间件，两者都不登记（避免路由列表被匿名 `USE *` 淹掉）。
2. **模块节点**（`kind: 'module'`）：`main.tsx` 的 `createRoot(...).render(<App />)` 在**任何函数之外**，此前无 enclosing symbol → 边被丢弃 → 被挂载的根组件读成死代码。现在挂到**每文件模块节点**上（按文件命名，锚在该文件第一条模块级边所在行）。
   - 模块节点**只**由模块级 JSX 创建（模块级**调用**仍按原样丢弃——那是另一件全仓范围的事，需自己的度量）。
   - `effectiveStart` 增加一行：模块节点带边时与 route 一样可作为链起点（否则会落到"仓里第一个 method"的兜底）。
   - `PRODUCTION_KINDS` 增 `module`：**边的 in-degree 只有在起点是图节点时才计**，不加这条 `App` 仍会因"挂载不算调用者"留在孤儿桶里（实测：加了才离榜）。

### (b) Tour 构建器：TS 锚点族（`engine/repoqa-tours.ts`）

- `auth-chain` 的 TS 对应物 = **中间件链**（`USE …` 注册按位置排序）+ 其后的首个 HTTP 路由；**Java 的 filter/interceptor 家族非空时完全不启用**，故 Java 输出逐字节不变。
- `main-flow` 的 TS 对应物 = **挂载链**：从模块节点起走。这里**没有**用 `resolveCallChain`——模块的调用里含库包装（`render(<StrictMode><App /></StrictMode>)` 里 `StrictMode` 排第一），共享链解析器会在第一个绑不上的跳点停下，实测挂载链两步就断在 `StrictMode`。改为**逐跳取首个"能解析"的边**（源序确定），跳过库包装。
- **测试路径过滤**只加在 TS 家族上：本仓第一版把 `http-error.test.ts` 里的 fixture 注册排在了真 `http.ts` 前面（测试替身不是本仓的中间件链）。Java 家族保持原状，这正是"Java 侧不回退"的实现方式。
- **不编步骤**：没有中间件就**不**拿单个路由凑一条"鉴权链"，没有挂载点就**不**拿路由凑"主业务流"——两条都退回诚实空态（这条被 `repoqa-mcp.test.ts` 的"无路由仓诚实降级"用例当场抓住过一次）。
- MCP 空态 note 改口：不再自称"tours currently cover Java/Spring REST projects"，改为逐类说明各 tour 需要什么（filter/拦截器 或 `app.use(fn)`；REST 路由方法 或 渲染根组件的模块；`@RestControllerAdvice`）。

## 2. 实测（三仓同源复跑）

| 样本 | 符号 | 孤儿（前 → 后） | 说明 |
|---|---|---|---|
| self | 2030 → **2066** | **246 → 243** | 新增 23 个模块节点 + 命名中间件 `USE *` 符号；`App`（票面点名的假阳性）**离榜**，且不再带 `testOnly`；deepChains 48 → 50 |
| lazygit | 10523 → 10523 | 1828 → **1828** | 逐字节不变（Go 无 JSX/Express） |
| petclinic | 595 → 595 | 13 → **13** | 逐字节不变（Java tour 输出不变） |

普查守恒 `666 = 243 + 423`；棘轮 self 243/2066 = **11.8%**（天花板 17.1%）；控制面 **722 → 727**、web 364、bridge 26、e2e **71/0**、97 题 eval 九桶 Recall@5 全 100%。

## 3. 验收（2026-09-24 复核）

- [x] 本仓 tours 非空（auth-chain 4 steps / main-flow 5 steps），锚点逐条对应源码行
- [x] Java 侧不回退：petclinic 符号与孤儿**逐字节不变**；单测断言 Java 仓仍走 Java 家族（标题「鉴权与拦截链」/「核心主业务流」、无"中间件注册"步骤）
- [x] `app.use(fn)` 边有单测（含"库工厂调用不登记"）；模块级 JSX 边有单测（含"函数级 JSX 仍归函数"与"模块级调用仍不建节点"的断言）
- [x] cp 单测基线 722 → 727 不降；e2e 全绿；棘轮 11.8% 未动 baseline；self 孤儿 **246 → 243（下降）**
- [x] 复测留档：本节表格 + `docs/reports/` §15

## 4. 已知边界（诚实登记）

1. **挂载链取"首个可解析的边"**，不是组件树遍历：适配器不在数据里区分 JSX 边与普通调用边，所以 `App` 之后可能先走 `new RepoQAClient` 而不是 JSX 子树。要走纯组件树，需给边加一个 JSX 标记（契约面变更，另议）。
2. **`error-handling` 对 TS 仍为空**：Express 的四参错误中间件（`(err, req, res, next)`）是确定性信号，但需要把实参个数记进符号或独立成族，本票未做。
3. **跨文件中间件顺序**按文件路径排序（同一文件内才是真实注册顺序），tour 描述里已披露，不宣称。
4. 模块节点**每文件一个**（含测试文件，共 23 个），它们是符号表里的新条目但不在 UI 符号树（`buildSymbolTree` 只认既有 kind）、不进桶（非 `CALLABLE_KINDS`，落在既有 type-declaration 排除里，普查守恒）。

## 5. 风险

1. 模块节点若被后续工序误当"类型"，会污染 `index.types` 与按名解析——它不在 `TYPE_KINDS`，且 `resolveCallEdge` 只按接收者类型查表（模块名不会是接收者）。
2. `PRODUCTION_KINDS` 增 `module` 会让模块节点参与 PageRank——实测未进 hubs 榜（生产模块节点出边仅 1–2 条）。
3. 与票 18/19/20/21 同文件面，五票已全部串行落地完毕。

## 现状（2026-09-21 现场实测）

```
codecompass_get_tours(repo=本仓) → { "tours": [], "note": "No routes detected in this repo —
tours currently cover Java/Spring REST projects (auth-chain / main-flow / error-handling)." }
```

工具自己的 note 就承认了缺口。根因（`engine/repoqa-tours.ts`，356 行）：

| Tour | 现行锚点 | 是否 Java 专属 |
|---|---|---|
| `auth-chain` | `filterClasses`（Servlet Filter）+ `interceptorClasses`（Spring 拦截器）+ route 方法（`:226-254`） | ✅ Java/Spring |
| `main-flow` | route 方法链（`:266`） | ✅ Java/Spring |
| `error-handling` | 同上族（`:322`） | ✅ Java/Spring |

三个 tour 的入口条件都是"存在 route 符号"，而 TS 仓的入口族（Express 中间件注册、React Context 枢纽、模块级 JSX 挂载）**根本不进符号图**：

- `app.use(authMiddleware)`：`EXPRESS_METHODS` 含 `use`、`isRouterReceiver('app')` 为真 → 走 route 注册分支 → 但 `firstStringArg` 取不到字符串（参数是函数）→ **整条边被丢弃**；
- `main.tsx` 的 `createRoot(...).render(<StrictMode><App /></StrictMode>)`：模块级 JSX **无 enclosing symbol 承载边**（基线报告 §5 P1 已登记的同类缺口）。

## 内容（分两步，第二步依赖第一步）

### (a) 适配器补齐 TS 入口族边（`languages/TypeScriptAdapter.ts`）

1. **中间件注册边**：`app.use(fn)` / `router.use(fn)` / `app.use('/p', fn)` 记录到 `fn` 的调用边（receiver 为 router 时；`fn` 为标识符或内联箭头时取标识符）；
2. **模块级 JSX 边**：无 enclosing symbol 时把边挂到**模块节点**（报告 §5 P1 建议的统一解）——这条同时消掉 `App.tsx:34` 的假阳性（当前 top-10 之一，靠 `testOnly` 标注兜着）。

### (b) Tour 构建器加 TS 锚点族（`engine/repoqa-tours.ts`）

`auth-chain` 的 TS 对应物：**中间件链**（注册顺序 = 执行顺序，天然可排序）→ 受保护路由 → handler；
`main-flow` 的 TS 对应物：**挂载链**（`main.tsx` render → 根组件 → 首个 Provider/路由表）。
锚点仍是物理 `file:line`，且**只报确定性事实**（注册点/handler 声明点），不做"这个中间件是鉴权用的"这类语义推断（HANDOFF §2.2 红线：scan 只报事实）。

## 验收

- [ ] 本仓 `codecompass_get_tours` 返回**非空**且每条 step 的锚点可点开验证（`file:line` 与源码一致）
- [ ] Java 侧不回退：`nexus-campus` / petclinic fixture 的三 tour 仍非空、内容不变（对照跑）
- [ ] `app.use(fn)` 边有单测；模块级 JSX 边有单测；两者均含"无 enclosing symbol 时挂模块节点"的断言
- [ ] cp 单测基线不降；e2e 全绿；精度棘轮不变（self 孤儿数不得上升——模块级 JSX 边应当**下降**）
- [ ] 复测留档：self 孤儿数前后对照入 `docs/reports/`

## 风险

1. **tours 是启发式内容**：TS 仓结构千差万别（Next.js / Vite / CRA 入口各不同），需按"有则报、无则空"处理，**不得为凑数编造步骤**；空态 note 要按仓型改口（不能再说"tours currently cover Java/Spring"）。
2. 中间件顺序语义依赖源码书写顺序，跨文件注册（`app.use` 分散在多文件）时顺序不可静态确定 → 按文件+行号排序并在 note 披露该限制。
3. 与 (a)2 的模块级 JSX 边同批落地会影响其他桶（deepChains/孤儿）——必须三仓复测确认只有预期变化。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/languages/TypeScriptAdapter.ts`（+test） | MCP 工具面 | (a) 中间件边 + 模块级 JSX 边 |
| `services/control-plane/src/engine/repoqa-tours.ts`（+test） | MCP 工具面 | (b) TS 锚点族 |
| `services/control-plane/src/mcp/repoqa-mcp.ts` | 共享区 | `get_tours` 的空态 note 按仓型改口（与票 07/12 同文件，串行） |
| `scripts/precision/out/`、`docs/reports/` | 共享区 | 三仓复测留档 |
