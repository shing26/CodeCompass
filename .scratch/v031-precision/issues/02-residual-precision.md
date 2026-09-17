# Issue 02 — 残余精度攻坚

> Spec：`.scratch/v031-precision/spec.md` §3（M1）、§6.2（降级策略）
> 波次：Wave 2 ｜ 依赖：票 01（没有基线不修） ｜ 阻塞：票 04

## 第二增量（2026-09-17，已落地）— Go receiver 绑定

**结论：票内"跨文件是主因"的判断被实测推翻**（详见 `docs/reports/scan-precision-baseline-2026-09-16.md` §7）。lazygit 原 top-10 的 5 条 `receiver-binding` 中，4 条的机制是**同文件**两件事：

1. **短声明不记类型**：`:=` 与 `var` 是同一个 `VarDecl` 节点，短声明没有 `VarSpec`，原实现的 `typeNode` 恒为 undefined → `app := &App{}` 之后所有 `app.Method()` 全落 dynamic。
2. **裸调用继承 selfType**：Go 没有隐式 receiver，但适配器给方法体内的 `helperFn()` 打上 `receiverType=<所属类型>`，解析走类型分支、在类型上找不到该函数 → 断点。

第 5 条（`App.Close`）不是绑定缺口（全仓无静态调用者），原判的 class 属误归因，已在 `verdicts/lazygit.json` 改为 `exported-api`。

落地七步：短声明按 Go 语义回填局部类型；裸调用不挂 selfType；字段类型支持 `*T`/`pkg.T`/`ParameterizedType`；泛型实例化 `F[T]()` 参与定型；泛型**调用点**补记调用边；per-repo Go 包表（`ParseContext`，按包目录归并，同名包目录/重复声明一律丢弃）覆盖跨文件与跨包；评审后收紧遮蔽语义（局部名即使定不出类型也算遮蔽、文件内歧义名不得被包表复活）。

**实测（lazygit，同一 HEAD）**：孤儿 **3229 → 2805（−13.1%）**；边级 `dynamic:true` **3804 → 3004（−800）**、可解析 **8042 → 8540（+498）**（`scan_precision.ts --edges lazygit` 可复跑）——调用链增益比孤儿桶可见的 −18 大一个量级。petclinic 45 → 45（不触 Java）；self 689 → 692（符号 1912 → 1940）。

**M1 未动，且本项工作无法推动 M1**：三仓 top-10 假阳性率均 100%（10/10）。lazygit 这 10 条 = 类型声明 ×3 + 接口方法 ×2 + 接口实现 ×2 + 函数值引用 + 导出 API + 测试脚手架类型，**没有一条是 receiver 绑定能解决的**。M1 只能由桶语义裁决推动 → 见下方"阻塞项"。

## 阻塞项（需用户裁决，不在本票文件面内）

全桶归因（lazygit 2805）：无引用 742 / 类型声明 623 / 接口实现方法 620 / 接口方法 375 / dynamic 已引用未绑定 351 / 仅被测试调用 94。其中 **1618 条（58%）不是精度问题而是口径问题**：

1. **类型声明进孤儿桶**（623）——类型没有"调用者"概念。
2. **接口方法与其实现进孤儿桶**（375 + 620）——Go 接口多实现时 ADR-0002 要求保持 dynamic，但"零静态调用者"并不等于死代码。
3. **仅被测试调用**（94）——`buildRadarGraph` 同时丢弃测试路径的节点与边来源（设计如此，issue 03）。

三条裁决落地后 lazygit 孤儿 **1187**，此时 M1 才可能离开 10/10。三项均需改 `scan-engine.ts` / `domain-radar-engine.ts`，**本增量不动**（见下方文件面声明的补登记）。

## 第三增量（2026-09-17）— M2 桶污染归零

票 01 验收第 4 条（M2 = vendor / 测试夹具进榜条数，目标 0）实测未达成：lazygit 0、petclinic 0、**本仓 2**——`services/control-plane/src/http-error.test.ts` 的两个 fixture route 进了 `deepChains` 桶。

根因：`deepChains` 是唯一直接 `pickTopApis(symbols, …)` 的桶，**没有测试路径过滤**；另外四个桶都经由 `buildRadarGraph`（丢测试节点与边来源）或自带 `isTestPath` 判断。修法取最小面：仍用完整符号表解析链（不改任何链深），只在**入口候选**上过滤测试路径，`total` 与列表同源。不动 `pickTopApis` 本身，避免波及 cockpit 面板（其 top APIs 语义另有归属）。

**另需决定**：全桶归因目前只能靠临时诊断（`runScan` 只发布前 10 条候选）。若要把它变成可复跑工具，需让 `runScan` 暴露未截断的桶内容或提供归因入口——建议单开一票（属票 01 面的自然延展）。

## 第一增量（2026-09-16，已落地）

修复 7 项根因（详见 `docs/reports/scan-precision-baseline-2026-09-16.md` §4）：TS 方言开 `jsx ts`、裸调用边、JSX 使用边、局部变量类型回填、DI 注解白名单补全、handler 方法视同入口点、字段型访问器过滤。

实测（top-10 抽样：修复前 → 修复后）：本仓孤儿 **1182 → 689（−42%）**、petclinic **152 → 45（−76%）**、lazygit **3288 → 3229（−2%）**。抽样仍 10/10 假阳性，但构成已从「该有边却没有边」转为「类型声明 + 分派缺口」。

## 残余根因（更新于第二增量后）

1. **P0 类型声明进孤儿桶**：lazygit 623 条（22%）。需裁决：收窄桶语义（类型不进候选）或补类型引用边。
2. **P0 接口方法/实现进孤儿桶**：lazygit 375 + 615 = 990 条（35%）。需裁决：ADR-0002 下它们是"诚实断点"还是"不该进候选"。
3. **P1 仅被测试调用**：lazygit 94 条。需裁决测试调用是否计入调用者。
4. **P1 函数值引用**（`deserializeInstruction[*X]` 存进 map、`onKeyDown={fn}`）：符号被当作值引用而非调用，当前无引用边。
5. **P1 分派缺口**：构建器链、DOM 事件绑定、模块级 JSX。
6. **P2** `cmd/integration_test/` 类目录不在 `isTestPath` 模式内。
7. ~~P0 Go 跨文件 receiver 绑定~~ —— **已处置**，见第二增量。

## 目标

把三样本真实仓库假阳性率（M1）压到 **< 5%**；若不可达，给出**可达下限 + 剩余噪声的可解释性**（诚实口径，不允许按目标倒推度量）。

## 现状证据（已登记主因）

- **Go 跨文件类型引用**：`GoAdapter.ts` 的 `declaredTypes` 是**按文件**构建的类型表，跨文件 receiver 类型（如 lazygit `g *Gui`）无法绑定 → 调用边落回 `dynamic: true` → 孤儿桶假阳性。CHANGELOG 两处明确记为主因（`CHANGELOG.md:209`、`:227`）。
- v0.22 已解决的部分：vendor 排除、裸调用 + `pkg.Func` 限定调用静态化、`isTestPath` 文件名模式、空桶 nextAction；v0.23 已解决 DI/入口点白名单与 accessor 降权。
- **未验证的剩余面**：petclinic（Java，DI 容器反射）与本仓（TS，barrel/动态 import）修复后从未复测——归因分布未知，**先测再修**。

## 方法（禁止盲修）

1. 用票 01 的基线对假阳性逐条归因，产出**根因分布表**（例：Go 跨文件 receiver 占 X%、Java 反射 Y%、TS 再导出 Z%、其他 W%）。
2. 按 Pareto 排序修，每修一项复跑基线，记录单项增益。
3. ~~先做 Go 跨文件类型表~~ → 已做（第二增量），但归因表先行一步就发现主因在同文件；**该顺序本身是本票最值钱的一条经验**。

## 架构约束（违反即返工）

- **真理之源红线（ADR-0002）**：跨文件绑定必须是确定性解析（import 路径 / 包限定名），**解析不到就保持 dynamic**，不得用名字相似度猜。
- 反向邻接必须走 `buildFullCallersIndex`（HANDOFF §2.2）。
- 引擎布局：改动落在 `src/languages/*Adapter.ts` 与 `src/engine/repoqa-callchain.ts`；若需跨文件类型缓存，放 worker/ingest 侧，不污染 adapter 单文件契约。

## 验收

- [x] **可达下限 + 根因可解释性**已出（报告 §7.5；M1<5% 经证不可由引擎精度达成，见"阻塞项"）
- [x] 97 题 golden eval 全阈值不回退（Recall@5 全桶 100%、幻觉 0%；e2e 63/63）
- [x] 控制面单测基线 650 不降（**665**，新增 15 例 Go 用例）
- [x] 每条根因修复在基线报告里留单项 before/after（报告 §7.2；A–C 三项同机制同批落地，未做单项隔离，已在表内声明）
- [x] M1 三仓逐条重判并入档（`verdicts/*.json`，`--score` 可复算）

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/languages/GoAdapter.ts`（+test） | MCP 工具面 | 主战场 |
| `services/control-plane/src/languages/parse-context.ts` | MCP 工具面 | **新增**（第二增量）：跨文件 parse context 契约 |
| `services/control-plane/src/languages/LanguageAdapter.ts` | MCP 工具面 | **新增改动**：两个方法各加可选 `context` 形参（可选 → 其余适配器零改动） |
| `services/control-plane/src/engine/repoqa-callchain.ts`（+test） | MCP 工具面 | 本期未改（字段链恢复路径为既有能力） |
| `services/control-plane/src/ingest/repoqa-parser.ts`、`repoqa-worker.ts` | MCP 工具面 | 构建并注入包表（全量 + 增量两条路径） |
| `services/control-plane/src/scan-engine.ts` | MCP 工具面 | **补登记**：第一增量已改（入口点跳过 / 访问器降权 / wiredExcluded）却未登记，现补；第三增量在此修 M2 |
| `scripts/precision/scan_precision.ts` | 共享区（票 01 面） | **新增 `--edges <sample>`**：边级 Go 归因，使 §7.3 可复跑 |
| `scripts/precision/verdicts/lazygit.json` | 共享区（票 01 面） | **重判**：top-10 构成已变，旧判定描述的是改动前的榜单 |
| `scripts/e2e/closeout_gate.py` | 共享区 | 本期未改 |
| `docs/reports/scan-precision-baseline-2026-09-16.md` | 共享区 | 追加 §7（收口时一次性） |

**关于"跨文件类型缓存放 worker/ingest 侧"约束的读法**：包表的**构建与注入**确实在 ingest 侧（`repoqa-parser.ts` 负责何时构建、如何注入；`repoqa-worker.ts` 两条解析路径各注一次），adapter 的**单文件契约未被污染**——`context` 是可选形参，缺省时每条查找都退回文件内并以 `dynamic` 收口（有专门的单测守这条红线）。把 Go 源码的解析逻辑留在 GoAdapter 内是刻意的：Go 的语法知识不该散落到 ingest 层。若用户认为该约束要求连解析也移出 adapter，请指出，我按裁决改。
