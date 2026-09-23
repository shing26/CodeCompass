# Issue 17 — TS/JS 仓的 Tour 锚点族（V27-17 升级票）

> 依据：V27-17（`.scratch/v027-backlog.md`，2026-09-12 全功能回归走查 R2 实证）；2026-09-16 v0.31 方向裁决**升级为 A 线精度候选**
> 判据：HANDOFF §2.2「降低误报或提升精度」——**空 tours = agent 拿到空事实**（工具返回 `[]` 等于告诉宿主"这个仓没有上手路径"）
> 波次：v0.31.0 之后（tag 未重指前可搭车）｜ 状态：**已立项，待开工**

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
