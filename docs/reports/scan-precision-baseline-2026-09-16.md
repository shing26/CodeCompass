# scan 精度基线报告（v0.31 · V31-01 / V31-02 第一增量）

> 2026-09-16 ｜ 依据 spec：`.scratch/v031-precision/spec.md` §3（度量口径 M1/M2）
> 样本与 v0.21 dogfooding 取证同源，**可复跑**：`scripts/precision/scan_precision.ts`

## 1. 结论（先读这段）

1. **仓库此前从未度量过真实仓库精度**——只有 97 题合成 eval。本次建了 harness，三个真实仓可一条命令复跑。
2. v0.21 留下的 43% / 31% / 83% 是**孤儿桶占符号总数的比例**（噪声水位），**不是**假阳性率；真实假阳性由 top-10 抽样逐条核验，本次三仓均为 **10/10**。
3. 本次第一增量修掉四类根因后：**本仓孤儿 1182 → 689（−42%）**、**petclinic 184 → 45（−76%）**、lazygit 3288 → 3229（−2%，Go receiver 绑定未修，符合预期）。
4. 抽样仍 100% 假阳性，但**构成已换**：修复前是「该有边却没有边」，修复后主要是**类型声明**（class/interface/record 天生没有"调用者"概念）与**分派缺口**（Go 跨文件 receiver、构建器链、DOM 事件绑定、模块级 JSX）。这两类是下一步的靶心，见 §5。

## 2. 方法

```bash
# 首次需 network 或本机已有克隆（v0.21 的 ~/.mhw/clones/lazygit-* 会被自动复用）
node_modules/.bin/tsx services/control-plane/... # 见下方实测命令
cd D:/CodeCompass
NODE_OPTIONS=--max-old-space-size=4096 \
  services/control-plane/node_modules/.bin/tsx scripts/precision/scan_precision.ts self lazygit petclinic

# 复算 M1（读 out/*.json + verdicts/*.json）
… scan_precision.ts --score
```

- 索引链与产品一致：`worker.indexRepo` → `worker.getSymbolGraph` → `runScan`（与 MCP 工具同一条引擎路径）。
- 克隆复用并记录 HEAD sha；抽样用固定种子（`SEED=20260916`）保证跨轮可比。
- 判定为人工/agent 逐条核验，核验方式与理由写入 `scripts/precision/verdicts/<repo>.json`（外部引用 grep + 结构判断）。

## 3. 基线数字（before → after）

| 样本 | 版本 | 符号数 | 孤儿桶 total | 占符号比 | wiredExcluded | top-10 假阳性 |
|---|---|---|---|---|---|---|
| **self**（CodeCompass, TS） | v0.21 取证 | 1406 | 1166 | 83% | — | 8/10 |
| | 本次修复前 | 1745 | 1182 | 68% | 4 | 10/10 |
| | **本次修复后** | 1912 | **689** | 36% | 4 | 10/10（构成已换） |
| **lazygit**（Go） | v0.21 取证 | 45423 | 19629 | 43% | — | 10/10 |
| | 本次修复前 | 10523 | 3288 | 31.2% | 7 | 10/10 |
| | **本次修复后** | 10523 | **3229** | 30.7% | 7 | 10/10 |
| **petclinic**（Java） | v0.21 取证 | 595 | 184 | 31% | — | 9/10 |
| | 本次修复前 | 595 | 152 | 25.5% | 30 | 10/10 |
| | **本次修复后** | 595 | **45** | **7.6%** | 41 | 10/10（构成已换） |

注：lazygit 符号数 45423 → 10523 是 v0.22 的 vendor 排除生效（lazygit 约 44% 的 .go 文件在 `vendor/`），不是本次改动。

## 4. 本次落地的修复（V31-02 第一增量）

| # | 根因 | 修复 | 证据 |
|---|---|---|---|
| 1 | TS 适配器用**纯 JS dialect** 解析：类型注解与 JSX 全是语法错误节点（探针：8 token 的 .tsx 片段 9 个错误节点） | `parser.configure({ dialect: 'jsx ts' })`（`TypeScriptAdapter.ts`） | 本仓符号 1745 → 1911（终于读全了）；孤儿 1182 → 699 |
| 2 | **裸函数调用无调用边**（`foo()` 被 `parts.length < 2` 丢弃） | 补裸调用边，按 Python(v0.7)/Go(v0.22) 同名解析规则绑定 | 本仓孤儿继续下降；`App`/`onKeyDown` 等类 |
| 3 | **JSX 使用无调用边**（`<BrandMark />` 是组件被"使用"的唯一形式） | 新增 JSX 标签边（小写内建元素排除，`<Foo.Bar/>` 取末段） | 同上 |
| 4 | **局部变量类型不记录**（`const c = new RepoQAClient()` 无类型 → 其方法调用全部 dynamic；`scope.locals` 是只读的死字段） | 用类型注解或 `new X()` 初始化器回填 `scope.locals` | 本仓 693 → 689（部分生效，工厂返回实例仍待修） |
| 5 | **DI 注解白名单只到 @Bean/@FeignClient** | 补 `@Component/@Service/@Repository/@Controller/@RestController/@PostConstruct/@PreDestroy/@Scheduled` | petclinic wiredExcluded 30 → 41 |
| 6 | **HTTP handler 方法是入口点却进孤儿桶**（Java/FastAPI 的 handler 是带 displayPath 的 method，TS/Express 的才是 route kind） | 孤儿桶跳过「带 displayPath 的方法」，与 route 同一理由 | petclinic 的 `getOwnerDetails` 类消失 |
| 7 | **DTO 访问器**（record/bean 的 `owner.id()`，不带 get 前缀） | 新增 `isFieldAccessor`：方法名命中所属类型的字段名且 ≤5 行 → 视为访问器 | petclinic 152 → 45 的主因 |

## 5. 残余根因与下一步（按预期收益排序）

| 优先级 | 残余根因 | 观测 | 预期 |
|---|---|---|---|
| **P0** | **类型声明进孤儿桶**（class/interface/record 占三仓 top-10 的 6–7 条） | 类型没有"调用者"这个概念，除非追踪引用（import/字段类型/泛型）——目前所有适配器都不追踪 | 采样可过半改善；需裁决「收窄桶语义」或「补类型引用边」 |
| **P0** | ~~**Go 跨文件 receiver 绑定**~~ | **已处置（V31-02 第二增量，见 §7）**：实测主因不是跨文件，而是同文件 `:=` 声明不带类型 + 裸调用误挂 selfType；跨文件部分已由 per-repo 包表补齐 | 已落地 |
| P1 | **分派缺口**：构建器链（`OwnerDetails.builder()...`）、DOM 事件绑定（`onclick`/`addEventListener`）、模块级 JSX（`main.tsx` 的 `<App/>`）、属性值引用（`onKeyDown={fn}`） | 三仓各 1–3 条 | 中；部分可用「无 enclosing symbol 时挂到模块节点」统一解 |
| P2 | 测试脚手架目录（`cmd/integration_test/`）不在 `isTestPath` 模式内 | lazygit 1/10 | 小，补模式即可 |
| **P0（新）** | **接口实现方法进孤儿桶**：Go 接口多实现 → 引擎按 ADR-0002 判 dynamic，于是每个实现方法都被报"零调用者" | lazygit 624 条（`Instruction.Kind` 一族）；lazygit 376 条接口方法声明同源 | 需裁决：接口方法（声明或其实现）是否属"可静态判定死代码" |
| **P1（新）** | **仅被测试调用的符号**：`buildRadarGraph` 同时丢弃测试路径的节点与边来源，于是只在 `_test.go` 里被调用的生产方法 in-degree=0 | lazygit 94 条 | 需裁决：测试调用算不算"有调用者"（当前算法口径 = 不算） |

## 6. 口径与诚实性说明

- **抽样是 top-N，不是随机样本**：桶按位置排序取前 10，天然过代表"最显眼"的残余类；因此**不能用它直接估计全桶假阳性率**。全桶口径需要分层随机抽样（下一增量可加 `--sample seeded` 结果作为第二口径，harness 已同时输出 seeded 抽样）。
- **M1 目标 <5% 尚未达成**，本报告不给结论性数字替代品；下一步按 §5 P0 两项推进后再复测。
- v0.21 的 43%/31%/83% 与其 top-10 判定（10/10、9/10、8/10 假）在本文中分别记作「水位」与「率」，两者不可混用（这是定位文档 §1.5 引用时的口径歧义来源）。

## 7. 第二增量（V31-02 Go receiver 绑定，2026-09-17）

### 7.1 结论

1. **§5 的 P0 假设被实测推翻**：lazygit 原 top-10 里被标为 `receiver-binding` 的是 **5 条**（`app.go:150/171/194/284/290`；§5 写的"7/10"沿用了票面旧数字，`verdicts/lazygit.json` 的原判是 5 条，本次校正）。其中 4 条（150/171/194/284）的机制是**同文件**的两件事：`app := &App{}` / `app, err := NewApp(...)` 这类短声明不记录局部变量类型（`:=` 与 `var` 是同一个 `VarDecl` 节点，短声明没有 `VarSpec`，原实现的 `typeNode` 恒为 undefined），以及**裸调用错误继承 selfType**——Go 没有隐式 receiver，但适配器给方法体内的 `helperFn()` 打上 `receiverType=<所属类型>`，解析因此走类型分支、在类型上找不到该函数而落断点。**主因不在跨文件**。
2. 第 5 条（`App.Close`）**不是绑定缺口**：全仓 grep 无任何静态调用者，它也不曾因定型失败而丢边——原判把它的 class 记作 `receiver-binding` 是误归因，本次已改为 `exported-api`（导出类型的导出方法，仓外调用者不在 AST 可见范围）。
3. 修复后 lazygit 孤儿 **3229 → 2851（−11.7%）**，原 top-10 中被绑定缺口卡住的 4 条全部离开榜单。
4. 跨文件绑定确有独立价值但**几乎不在孤儿水位上**：per-repo Go 包表（`declaredTypes` 按文件 → 按包）只再降 2851 → 2833（−18）。而在**边级**，它把 **800 条调用边**从 `dynamic:true` 变为带类型的 receiver、**498 条边**从断点变为可解析（§7.3，命令可复跑）。孤儿桶只看得见其中"目标此前无其他调用者"的 18 条——**这是本增量最容易被低估的一笔账**。
5. 泛型调用点（`F[T](...)` 此前完全不记调用边）补齐后 **2833 → 2801**；随后为堵住评审发现的 shadowing 漏洞而收紧规则（局部名即使定不出类型也算遮蔽），回调至 **2805**——这 +4 是 fail-closed 的代价，不是回退。
6. **M1 不动，且 receiver 绑定工作无法推动 M1**：三仓 top-10 假阳性率仍为 **10/10**（本次逐条重判并更新了 `verdicts/lazygit.json`，`--score` 可复算）。top-10 是**按位置取前 10**（不是"最差 10"），lazygit 这 10 条的构成是类型声明 ×3 + 接口方法 ×2 + 接口实现 ×2 + `deserializeInstruction`（作为函数值存进 map、被间接调用）+ `App.Close` + `flagInfo`，**没有一条是 receiver 绑定能解决的**。本增量最重要的结论：**精度工程已把"可修的都是可修的"，剩下的不是精度问题而是口径问题。**

### 7.2 分步 before/after（含口径限制）

行是**测量快照**，不是逐项隔离：第 1–3 项同属"receiver 定型"一个机制、同一批落地，未做单项隔离（隔离需对 2345 文件仓库各跑一次索引，收益不足以支撑）；第 4、5 项可分别归因。

| 步 | 内容 | 修复 | lazygit 孤儿 |
|---|---|---|---|
| A | 短声明按 Go 语义回填局部类型：注解 > 复合字面量/取址/`new(T)`/类型转换 > 本文件或本包函数结果（按返回位序）；名字数与结果数不符则不绑定 | 三项一起落地（A+B+C） | 3229 → 2851 |
| B | 裸调用不再继承 selfType，交给解析器的「同目录优先」规则 | 同上 | 同上 |
| C | 字段类型支持 `*svc.Repo` / `io.Closer` / `ParameterizedType`（此前只读 `TypeName`）；切片、map、匿名结构体一律不记 | 同上；并激活引擎既有的 repo 级字段恢复路径（跨文件字段链此前已可解析） | 同上 |
| D | 泛型实例化 `NewMap[string, int]()` 参与定型 | 解包 `ParameterizedExpr`（语法层已把它与值下标 `IndexExpr` 分开），初始化器侧再要求内层名字是已声明函数 | ±0（lazygit 上无可观测变化） |
| E | 泛型**调用点**补记调用边（此前 `F[T](...)` 整体不记边） | 同上，作用于 CallExpr 分支 | 2851 → 2833 的一部分（−32） |
| F | per-repo Go 包表：跨文件 / 跨包定型 | `buildGoPackageTable` 按包目录归并，重名包目录、同包重复声明一律丢弃；经可选 `ParseContext` 注入 | 2851 → 2833 的 −18 |
| G | 评审后收紧：局部名（含定不出类型者）算遮蔽；文件内歧义名不得被包表复活 | `MethodScope.declared` + 包表合并折叠 `file.ambiguous` | 2801 → 2805（+4，fail-closed 代价） |

### 7.3 边级增益（per-repo 包表，lazygit 同一份源码）

可复跑：`NODE_OPTIONS=--max-old-space-size=6144 services/control-plane/node_modules/.bin/tsx scripts/precision/scan_precision.ts --edges lazygit`（不索引，直接解析 clone；同一份源码各解析一次，一次带包表一次不带）

| 口径 | 无包表 | 有包表 | Δ |
|---|---|---|---|
| 调用边总数 | 21715 | 21715 | 0 |
| 带类型的 receiver 边 | 8572 | 9372 | **+800** |
| `dynamic:true` 的边（无 receiver 类型） | 3804 | 3004 | **−800** |
| 其余（裸调用 / `pkg.Func`） | 9339 | 9339 | 0 |
| 可解析边 | 8042 | 8540 | **+498** |
| 断点边 | 13673 | 13175 | **−498** |

包表构建成本：1096 个 `.go` 文件、75 个包、**1.4s**（一次索引一次；增量保存只扫该文件所在目录）。无 Go 文件时返回 undefined，非 Go 仓库零成本。

### 7.4 三仓复测（本次，第二增量收口）

| 样本 | 符号数 | 孤儿桶 | 占符号比 | M1（top-10 假阳性） | 与第一增量相比 |
|---|---|---|---|---|---|
| lazygit（Go） | 10523 | **2805** | 26.7% | **100%（10/10）** | 3229 → 2805（−13.1%） |
| petclinic（Java） | 595 | **45** | 7.6% | **100%（10/10）** | 45 → 45（本增量不触 Java） |
| self（TS，含本增量新增文件） | 1940 | **692** | 35.7% | **100%（10/10）** | 689 → 692（符号 1912 → 1940，新增 `parse-context.ts` 等） |

M1 三仓均由 `--score` 从 `verdicts/*.json` 复算（lazygit 判定本次重判，另两仓沿用既有判定）。

**M2（vendor / 测试夹具进榜条数，目标 0）**：第三增量后三仓 **0 / 0 / 0**（`contaminationTotal`）。首测时本仓为 2——`deepChains` 是五个桶里唯一不经 `buildRadarGraph`、也不自带 `isTestPath` 判断的桶，`http-error.test.ts` 的两个 fixture route 因此作为生产入口上榜；修法为过滤入口候选而非输入（链深与其余条目不变），该桶 100 上限内的测试条目亦一并清除（本仓 total 56 → 48）。

复跑命令：`NODE_OPTIONS=--max-old-space-size=4096 services/control-plane/node_modules/.bin/tsx scripts/precision/scan_precision.ts self lazygit petclinic`

### 7.5 全桶归因（lazygit 2805 条）

`runScan` 只发布前 10 条候选，全桶分布需另行统计（本次用临时诊断复刻桶断言得出，非长期工具，见 §7.6 待办）。第一次统计即发现 top-10 的"残余类"与全桶并不一致：

| 类 | 条数 | 占比 | 是否真"死代码" |
|---|---|---|---|
| 无任何引用 | 742 | 26% | 多半是（未逐条核验） |
| 类型声明 | 623 | 22% | ❌ 类型没有"调用者"概念 |
| 接口实现方法（被接口分派调用） | 620 | 22% | ❌ `Instruction.Kind` 一族在 `ToEnvVars` 里被调用 |
| 接口方法声明 | 375 | 13% | ❌ 契约成员 |
| dynamic 引用了但未绑定 | 351 | 13% | ❌ 至少被某处调用 |
| 仅被测试调用 | 94 | 3% | ❌（口径内：`buildRadarGraph` 同时丢弃测试路径的节点与边来源） |

**可达下限（诚实口径）**：即使把所有"引擎可判定"的项都修完，孤儿水位仍有 **1618 条**（类型声明 623 + 接口实现 620 + 接口方法 375，占 58%）的骨架需要**桶语义裁决**而不是代码修复。三条裁决项（§5 的 P0×2 + 新 P0）落地后，lazygit 孤儿为 **1187 条**（2805 − 623 − 620 − 375），此时 M1（top-10）才可能离开 10/10。

### 7.6 本增量未做与理由

- **未改桶语义**（类型/接口方法/接口实现不进候选）：`scan-engine.ts`、`domain-radar-engine.ts` 均不在票 02 的文件面声明内，且票内已写明"需裁决"。建议由裁决驱动，不要由 agent 单方面改口径。
- **未做全桶归因的常驻工具**：需要 `runScan` 暴露未截断的桶内容（引擎侧改动，属票 01 面的自然延展）。§7.5 的分布由临时诊断复刻桶断言得出，**不可复跑**——请把 §7.5 当证据而非工具；§7.3 的边级数字则是可复跑的（harness 新增 `--edges`）。
- **未做 Go 接口分派的唯一实现绑定**：`impls.length === 1` 时引擎已绑定；多实现时 ADR-0002 要求保持 dynamic，不猜。
- **未做 Go 包表的 `new(T)`/`T(v)` 之包外定型**：本期把 `typeNames` 也纳入包表（跨文件类型转换已可用），但**跨包**类型引用仍需解析被导包的类型声明，属下一增量。

## 8. 第三增量（V31-03 桶语义收窄，2026-09-18）

§7.6 第一条写的是"未改桶语义……**建议由裁决驱动，不要由 agent 单方面改口径**"。裁决已于 2026-09-18 作出
（A/A→A′/B，规范记录见 `docs/adr/0018-orphan-bucket-semantics.md`），本增量即其落地。**本节的数字全部来自可复跑路径**，
§7.5 的临时诊断已被响应内的 `census` 字段取代。

### 8.1 三仓复算（收窄后）

| 样本 | 符号数 | 孤儿桶 | 类型声明排除 | 接口成员排除 | 对照（收窄前） |
|---|---|---|---|---|---|
| lazygit（Go） | 10523 | **1807** | 623 | 375 | 2805 → 1807（−998） |
| petclinic（Java） | 595 | **13** | 31 | 1 | 45 → 13（−32） |
| self（TS） | 1949 | **283** | 411 | 0 | 692 → 283（−409；符号数同期 1940 → 1949） |

**lazygit 的 623 / 375 与 §7.5 的归因逐字吻合**——这正是"裁决算术"的检验点：预测 2805 − 623 − 375 = 1807，实测 1807。

### 8.2 普查守恒（`census` 字段，三仓）

| 样本 | zeroCallers | testOnly | total | 守恒 |
|---|---|---|---|---|
| lazygit | 1693 | 114 | 1807 | ✅ |
| petclinic | 13 | 0 | 13 | ✅ |
| self | 279 | 4 | 283 | ✅ |

harness 现在对不守恒**直接抛错**：留一份"数字对不上"的快照比留空更糟。

### 8.3 一处口径差异（需对账，不影响裁决）

§7.5 记"仅被测试调用 94 条"，本次实测 **114 条**（lazygit 同一 commit `c07f4d3`）。差异来自判定定义：§7.5 的 94 出自临时诊断，
本次用 `buildFullCallersIndex`（全量调用者，测试调用者计入）。裁决 3（B：标注而非排除）在两种定义下结论相同——
这些条目都留在桶内。**94 不得再作为规范数字引用**；`census.testOnly` 是该类的唯一权威口径。

### 8.4 尚未收窄的一项与 M1 的位置

接口**实现**方法（§7.5 的 620 条）按裁决 A′ 属"第二步"：判定需要接口→实现关系表（Go 是隐式实现），
本次以 `deferred` 规则显式登记在响应里。它落地后 lazygit 孤儿为 **1187**。

**M1 仍为 100%（10/10）**：1807 里仍有 620 条 deferred（结构上不可判定）与 1693 条"零调用者"（**未逐条核验**）。
收窄只让 M1 **有资格**变动，不保证达标——下一步应是这 1693 条的抽样核验与 deferred 项的接口-实现表，
而不是继续收窄口径（§3 度量纪律：不允许按目标倒推）。

## 9. 第四增量（V31-04 TS 接收者定型，2026-09-19，票 11）

起点是票 07 dogfooding 的实测发现：self 孤儿 top-10 有 8/10 是 `RepoQAClient.*` 假阳性（`listRepos` 有 3 个生产调用点，grep 实锤）。
归因实验推翻了票面"作用域链"的初始假设，真实根因序列（每步修完即复测，数字可复跑）：

| 步 | 根因 | self 孤儿 |
|---|---|---|
| (a) 参数 `: Type` 注解是 ParamList 的**兄弟节点**（lezer 形状），`typeAnnotationName` 只找直接子节点——参数注解从未被读过 | `collectParams` 兄弟配对 | 283 → 265 |
| (d) 解构参数是 **ObjectPattern**，注解是类型字面量 | ObjectPattern 进配对 + 类型字面量按成员绑定（仅显式标识符，fail-closed） | 265 → 261 |
| 链 | `const handleX = () => …` 直接子箭头建新空作用域 | `MethodScope.parent` 闭包链 + `declared` 遮蔽栅栏（最近声明处停） | 
| (h) `new X()` 不记构造边 | NewExpression → `constructor` 边（receiverType=类名） | 261 → **236** |

**三仓**：self **283 → 236**（−16.6%）；lazygit **1807**、petclinic **13** 每步复测**逐字节不变**（不触其语言）。普查三仓守恒；97 题 eval 全阈值幻觉 0%；e2e 68/68；cp 680 → 686。

**登记不扩散**（top-10 剩余 7 条 `RepoQAClient.*` 的拦路族，各有 file:line 证据，见票 11）：(g) `Pick<…>` 工具类型/接口成员解析、(e) 闭包参数别名（类型由被调方签名决定）、(f) `useMemo` 工厂/上下文类型流。另：`RepoQAClient.getRepo` 疑似**真孤儿**（web src 无生产调用点）——收窄后孤儿桶开始报出真信号的第一个候选，待逐条核验。

**方法教训（与 §7.1 同源）**：票面的初始归因假设（作用域链）被"先红"的归因实验部分推翻——真拦路虎是注解捕获；而作用域链在 (a)(d) 落地后对 `handleCloneRemote` 形态**又**成为必要。归因和修法必须交替进行，一次性设计没有意义。

## 10. 第五增量（V31-06 精度残余 (g) 族：工具类型与具名接口成员，2026-09-21）

票 18 的第一族。**归因实验再次推翻票面假设**：票面写"`Pick<>` 不展开与具名接口不查表，两者可能只坏一个"；四变体探针实测为**两处独立都坏**——B（内联字面量 + `Pick<>`）与 D（具名接口 + 普通类型）各自单独失败，A（内联 + 普通类型）通过。

**实现中又由探针暴露两处真缺陷**（均已在代码里修掉并加回归钉）：

| 缺陷 | 症状 | 修法 |
|---|---|---|
| 朴素 `split('|')` 撕裂 `Pick<X, 'a' \| 'b'>`——`\|` 在 `<>` 内属 K 列表，却被联合剥离逻辑误判为"真联合"→ 直接 fail-closed | **单名 Pick 通过、两名失败**（症状看似随机，实为确定性） | 深度感知 `splitTopLevel`（与成员切分同一纪律） |
| `=>` 的 `>` 被当成泛型闭合 → 深度变负 → 分隔符不再生效 | **函数类型成员之后的所有成员全部丢失**（`onNavigate?: () => void;` 排在 `client` 之前时即失效） | 两个文本切分器都忽略 `=>` |

**三仓复测（同源可复跑）**：

| 样本 | 孤儿（本增量前 → 后） | 说明 |
|---|---|---|
| self | **250 → 248**（净减） | 四条目标 `radar`/`getArchitectureDelta`/`runGate`/`listGateRuns` **全部离榜**；净减说明未制造新孤儿 |
| lazygit | **1807 → 1807** | 逐字节不变（不触 Go） |
| petclinic | **13 → 13** | 逐字节不变（不触 Java） |

普查守恒（`candidatesBeforeRules` 等式）三仓成立；adapter 18 用例全绿（含 `Pick` 越界必须 dynamic 的反例、`A | B` 与 `Pick<X, keyof X>` 的 fail-closed、两名 Pick 与函数类型在前的回归钉）。

**复测新露面两条（按票 18 分工登记，不在 (g) 范围）**：`RepoQAClient.getSubgraphContext` 有**生产调用点**（`apps/repoqa-web/src/context/InspectorContext.tsx:72`）→ 假阳性，属 (f)/上下文 Provider 族；`QueryStream.onEvent/onError/onDone`（`RepoQAClient.ts:660-670`）是流订阅 API，待查是死 API 还是订阅模式未捕获。

### 10.1 (f) 第一半：`useMemo` 工厂的深层 `new`（同批落地）

窄规则（白名单 + 反例守死）：仅 `useMemo(() => new T(...))` 与 `useMemo(() => X ?? new T(...))` 才把变量定型为 `T`；
`items.map(u => new User(u))` 这类**实例集合**必须保持 dynamic（否则 `users` 被误判为 `User`，造出类型系统没有的边）。
单测同时钉正例与反例。

**实测它不推动 top-10**（诚实登记）：`App.tsx:38` 的 `client` 只作为 JSX 属性传给 `<RepoProvider client={client}>`，**没有方法调用** ——
self 孤儿 248 不变属预期，不是"改了没用"。

### 10.2 (f) 第二半与 (e)：同一件事 —— 需要跨文件类型/成员表

复测定位（推翻"机制简单"的预判）：`pickFolder` 的调用点（`App.tsx:156`）在 **`WorkbenchShell`（`App.tsx:52`）** 内，
其 `client` 来自 `const { client } = useRepo()`（`:54`）；而 `useRepo(): RepoContextValue`（`RepoContext.tsx:423`）的
返回类型接口**声明在另一个文件**。因此两族共同缺的是：① 跨文件的 hook/函数**返回类型**、② 跨文件的接口**成员表**。
机制与 V31-02 的 Go per-repo 包表同源（`ParseContext` 已为此建过契约与注入路径），可照搬扩 TS 条目（歧义名一律丢弃）。
**该增量已于 2026-09-24 落地，见 §11。**

## 11. 第六增量（V31-06 精度残余 (f) 第二半 + (e)：跨文件类型/成员表，2026-09-24）

票 18 的收官。**归因先行**（`.scratch/probe-f2e.ts`）：四条目标逐文件 before/after 对照，`before`（无 context = 增量前行为）全红、`after` 全绿。

| 目标 | 调用点 | 机制 |
|---|---|---|
| `RepoQAClient.pickFolder` | `App.tsx:156`（`WorkbenchShell`） | (f)2 解构 + 跨文件 hook 返回类型 |
| `RepoQAClient.previewRepo` | `App.tsx:148` | 同上 |
| `RepoQAClient.getSubgraphContext` | `InspectorContext.tsx:72` | 同上（另有 `useSubgraphContext` 经 (e)） |
| `RepoQAClient.listReverseDeps` | `useReverseDeps.ts:18` | (e) 回调实参按被调方签名定型 |

**机制**：`ParseContext.languages.typescript` = 接口成员表 + 函数返回类型 + 形参类型，`buildParseContext` 一次建表。
**只扫不解析**：接口成员沿用既有正则切分器（成员取自**原文**，掩码视图只用来定位）；函数签名用「掩码视图定位 + 原文切片」的括号配对扫描——
本报告 §7 已把 Go「每轮解析两次」挂上"待测量"，再给每个 TS 文件加一趟完整 lezer parse 是更大的账。
歧义纪律同 Go 包表：**同名异内容整体丢弃**；文件内声明优先于跨文件。

**实现中由探针抓出的两处真缺陷**（均已修 + 回归钉）：

| 缺陷 | 症状 | 修法 |
|---|---|---|
| `argumentNodes(call).indexOf(node)` 恒为 -1（lezer 每次访问都新建 `SyntaxNode` 包装，同一实参永不引用相等） | (e) 绑定**静默从不触发**——"改了没用"型哑弹，无报错 | 改按 `from/to` 位置匹配；留"回调在第 3 个实参位"的回归钉 |
| 重命名解构 `{ client: renamed }` 的目标在 lezer 里是 **VariableDefinition** 而非 VariableName | 首版守卫漏判 → 把 `client` 绑成 `RepoQAClient`（**假边**，本票最怕的方向） | 只有裸 `{ name }` 才定型；重命名/默认值/剩余项仍进作用域栅栏 |

**三仓复测（同源可复跑）**：

| 样本 | 孤儿（前 → 后） | 说明 |
|---|---|---|
| self | **248 → 246** | top-10 的 `RepoQAClient.*` **7 → 1**（仅真阳性 `getRepo`）；三条目标离榜（真索引复验调用者） |
| lazygit | **1807 → 1807** | 逐字节不变 |
| petclinic | **13 → 13** | 逐字节不变 |

普查守恒 `667 = 246 + 421`；棘轮 246/2039 = 12.1%（天花板 17.1%）；adapter 32 用例、控制面 711、web 364、bridge 26、e2e 71/0、97 题 eval 全阈值。

### 11.1 测量期踩到的自指陷阱（→ 票 19）

首次复测 `pickFolder` 仍是 **0 调用者**，而同源码 + 同表的探针显示边已建立。真因**不是代码**：

> 本增量新加的**单测 fixture 自己声明了 `interface RepoContextValue`**（多行模板串，`TypeScriptAdapter.test.ts`），
> 与真声明 `RepoContext.tsx` 的**内容不同** → 歧义规则（正确地）丢弃了真表项 → 绑定失败。

根因是 `maskLiteralsAndComments` 的 `'`/`"` 分支**按行**（`[^\\\n]` 排除换行），**多行模板串只被掩到第一个换行**，
其后内容按源码扫描 → 模板串里的 `interface X {` 变成**幻影声明**。生产代码同样暴露（`chat/agent.ts` 提示词、
`engine/repoqa-export.ts` 导出模板都是多行模板串）。

**一行加宽 backtick 分支会坏得更厉害**（实测）：掩码器自身源码与注释里就有反引号，跨行匹配后注释里的反引号会与
远处的反引号配对，使中间的真注释文字**不被掩码**——本仓 `TypeScriptAdapter.ts` 当场自伤（探针输出
`masked@29859 line=760`：它注释里那句 `interface RepoContextValue { … }` 成了幻影声明）。
**这是顺序问题不是正则强度问题**：必须先把注释/引号掩掉，才可能安全地按模板串匹配反引号。故本增量**只改 fixture 命名**
（测试不该与真仓库标识符同名异义），掩码缺陷立为**票 19**（两阶段掩码 + 反引号正则边界）。

### 11.2 复测后新露面的族（→ 票 20）

`RepoQAClient.*` 压到 1 条后，top-10 的新面孔是**流订阅族**：`QueryStream.*`（`onEvent`/`onError`/`onDone`/`connect`）
与 `EvolveStream.*`。机制与三族都不同——调用点是 `stream.onEvent(...)`，而 `stream` 的类型是**接口**
（`QueryStreamLike` / `EvolveStreamLike`），实现是 `QueryStream` **类**：需要**接口→实现关系表**，
正是 ADR-0018 显式 `deferred` 的 A′ step 2（lazygit 620 条同源）。立为**票 20**。


