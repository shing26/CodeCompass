# Issue 09 — 语言注册表单表派生 + ParseContext 按语言键（外部评审 C2/C3）

> 依据：`docs/reports/CodeCompass-框架补强建议分析-2026-09-19.md`（C2 成立且加严、C3 成立）
> 判据：HANDOFF §2.2「降低误报或提升精度」——**漏登记扩展名 = 文件静默不入索引 = 交付给 agent 的事实层缺一块**，这是精度面缺陷不是结构洁癖
> 波次：v0.31.0（tag 未打，搭车）｜ 依赖：无 ｜ 用户裁决：2026-09-19 批准（「先做两条候选票」）

## 目标

把「加一种语言要改多处、漏改不报错」收敛为**单一数据源**：扫描侧扩展名集与适配器解析能力从同一张表派生，
漂移从"静默"变为"编译错/测试红"。

## 现状（2026-09-19 实测）

加一种语言要碰 **5 张手维护表**，任一漏改都是静默失败：

| 表 | 位置 | 漏改后果 |
|---|---|---|
| `ADAPTERS` 数组 | `repoqa-parser.ts:20` | 新适配器不被路由，文件零符号 |
| `SOURCE_EXTENSIONS` | `repoqa-scan.ts:24`（9 项） | 文件根本不入扫描 |
| 适配器私有扩展名表 ×4 | `TypeScriptAdapter.ts:22` / `GoAdapter.ts:19` / `PythonAdapter.ts:18` / Prisma `endsWith` | 文件入扫描但 `canParse` 拒绝 → 零符号 |

两个漂移方向都无报错。今日逐项比对恰好一致（无现行漂移），风险是结构性的。

## 内容

### (a) `languages/language-extensions.ts` —— 纯数据表（唯一扩展名源）

每个语言一条 `as const` 数组；**适配器的 `canParse` 与注册表都从它取**，两侧不可能再分叉。
独立成文件是为了避免 `registry → adapters → registry` 循环。

### (b) `languages/registry.ts` —— 接线表（唯一适配器源）

`{ id, extensions, adapter }` 数组 + 派生 `SOURCE_EXTENSIONS` + 派生 `adapterFor`。
`repoqa-parser.ts` 的 `ADAPTERS`/`adapterFor` 改为从注册表转发（保持导出，worker 不动）；
`repoqa-scan.ts` 删除本地定义改 import；`repoqa-diff.ts` 的 import 改到注册表。

### (c) `ParseContext` 按语言键（评审 C3）

`goPackages?: …` → `languages?: { go?: GoPackageDeclarations }`。领域接口不再被单一语言的细节命名；
后续语言加自己的键，不动 Go 的形状。消费方：`GoAdapter.ts:716/718`、构造方 `repoqa-parser.ts:60/84`、测试 2 处。
**行为零变化**（纯重命名 + 命名空间化）。

### (d) 双向守恒单测（`languages/registry.test.ts`）

- `SOURCE_EXTENSIONS` == 注册表 extensions 的并集（同源断言）；
- 每个 `SOURCE_EXTENSIONS` 成员恰有一个适配器认领（无缺口、无重叠）；
- 每个适配器 `canParse` 认领的扩展名 ⊆ 其注册表条目（防适配器私藏）。

**评审原验收「删掉一处常量后断言构建失败」的落点**：删 `language-extensions.ts` 里的一个扩展名 →
适配器 `canParse` 与扫描集**同时**收窄（编译期都过），registry.test 的双向断言红；删注册表条目 → 同理。
即：漏改从"静默"变"测试红"，比文档要求的"构建失败"弱一档但足够（构建红需要类型级接线，见风险 2）。

## 验收

- [x] 三仓精度复算**逐字节不变**（lazygit **1807** / petclinic **13** / self **283**；self 符号数 1949 → 1954 系新增测试文件所致，孤儿水位不动）——本票零行为变更的硬证据
- [x] `SOURCE_EXTENSIONS` 与适配器 `canParse` 的双向守恒有单测；人为删一个扩展名（'.mjs'）测试转红（实测记录见下）
- [x] 加语言的操作面收敛为：`language-extensions.ts` 加数组 + `registry.ts` 接线（2 处，漏一处测试红）
- [x] `ParseContext` 无单一语言命名字段（`languages?: { go?: … }`）；GoAdapter / parser / 测试全量更新；typecheck 四包净
- [x] e2e **68/68**；cp 单测 **673 → 680**（+4 registry +3 error-code-guard）

## 实施记录（2026-09-19）

- 新增 `languages/language-extensions.ts`（纯数据，5 语言扩展名各一条）与 `languages/registry.ts`
  （接线表 + 派生 `SOURCE_EXTENSIONS` / `adapterFor`）；四个适配器私有表与 Prisma/Java 的 `endsWith` 全部改为读共享数组；
  `repoqa-parser.ts` 删 `ADAPTERS` 改转发注册表（`adapterFor` 导出保持，worker/repoqa-diff 无感）。
- **转红实测（票面验收第 2 条）**：临时删掉 '.mjs' → `registry.test.ts` 第 1 断言红
  （`expected […8 项] to deeply equal […9 项]`），恢复后绿。
- **红实测暴露并修正了一个恒真断言**：初版第 1 断言的基准也读共享常量，删扩展名两侧同变、测试恒绿——
  已改为**逐字硬编码的 9 项清单**做基准（并注释"改这张清单属语言接入决策，重构不得静默改动"）。
  这是本次红实测最有价值的一课：守恒断言的基准必须独立于被测数据源，否则守恒是同义反复。
- `ParseContext.goPackages` → `languages.go`（按语言命名空间）；`registry.test.ts` 4 用例 +
  `GoAdapter.test.ts` 22 用例全绿。

## 风险

1. **repoqa-scan 从此传递依赖全部适配器模块**（经 registry）——esbuild 同包内联，无运行时影响；若未来要拆包需重估（D6 裁决范围内暂不适用）。
2. 编译期接线执法（删注册表条目直接 typecheck 红）需要 adapter 类型进数据表——本票不做，理由：接线表与数据表分离已把"漏改"压到测试红级别，为编译红引入的复杂度不成比例。
3. `ParseContext` 是 V31-02 刚落的接口，改名会撞未合流分支——按协作约定在票面登记（本票）后执行。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/languages/language-extensions.ts` | MCP 工具面 | **新增**：纯数据 |
| `services/control-plane/src/languages/registry.ts`（+test） | MCP 工具面 | **新增**：接线 + 派生 |
| `services/control-plane/src/languages/{TypeScript,Go,Python,Prisma}Adapter.ts` | MCP 工具面 | 私有扩展名表改 import（`JavaAdapter` 的 `endsWith` 同步收敛） |
| `services/control-plane/src/languages/parse-context.ts` | MCP 工具面 | (c) 接口泛化 |
| `services/control-plane/src/ingest/repoqa-parser.ts`、`repoqa-scan.ts`、`engine/repoqa-diff.ts` | MCP 工具面 | 改为从注册表派生/转发 |
| `services/control-plane/src/languages/GoAdapter.test.ts` | MCP 工具面 | context 构造随 (c) |
