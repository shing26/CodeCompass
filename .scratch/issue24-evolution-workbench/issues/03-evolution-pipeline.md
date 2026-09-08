# Ticket 24.3 — EXTEND/DEPRECATE 消费 Pattern Ingestion

## 目标
`module_evolution` 管线接入惯例清单,落位建议与目标仓库规范机器可验收地一致。

## 改动点
- EXTEND 管线:`runModuleEvolution` 内前置 `runConventionScan`(targetSymbol 的同包近邻),落位表(规范包路径/注入点/事务边界)必须引用 convention 轴 verdict;一致性自查:落位包路径 ∈ 惯例包结构、注入方式 ∈ DI 风格 verdict,不一致 → 管线报 `convention-conflict` 而非静默输出。
- DEPRECATE 管线:不变(孤立级联与清理清单与惯例无关)。
- 骨架代码:ReAct 编排层 LLM 生成,输入从"原始上下文"改为 ConventionProfile;输出标 `suggestedPatchSource: 'llm-generated'`(ADR-0006 语义沿用),永不落盘。
- worker 输出结构:evolve 结果携带 `conventions: ConventionProfile` + `placement` + `teardown`(DEPRECATE)+ `risks`。

## 验收
- 单测:convention-conflict 路径;EXTEND 落位表锚点全部物理校验通过;
- CI(`codecompass` 无 LLM 路径)不依赖 LLM 可用性,骨架字段缺席合法。

---

## 实施记录(2026-09-01 完成)

### EXTEND 管线:惯例驱动落位与骨架(全部零 LLM、确定性)
- `runExtend` 在解析 attach point 后前置 `runConventionScan`(`targetSymbol` 派生近邻包,`nearPackages` 显式覆盖),`commit` 缺省 `unversioned`,worker/MCP 层传真实 `repo.commit`。
- **Placement Plan**(`placementFor`,仅 DIRECT_INJECTION 形态;事件/切面骨架为框架固定形态,不受惯例治理):
  - split 惯例 → 双文件(接口 + `${baseName}ExtensionImpl`);接口命名镜像仓库自身(`splitInterfaceNameFor`:同 feature 包 I 前缀接口占半数以上才加 I,不硬编码);plain → 单文件 `${baseName}Extension`。
  - `controller_return_type` 惯例裁决 Handler 签名:wrapped → `public ${wrapper}<String> on${baseName}(/* context */)`,bare → `public void ...`。
  - `di_style` 惯例生成依赖装配段:constructor → `private final` + 构造器赋值;field → `@Autowired` + 字段声明;unsupported → 注释提示手工接线。
  - 落位目录物理有效:取 attach point(或 nearPackages 邻居)真实文件目录,保留 repo 根前缀(如 `demo-shop/src/main/java/...`),不从点分包名反推;`packagePath` 独立用点分。`basedOn` 记录三轴 verdict 供追溯。
- **风险披露**(`risksFor`):覆盖率 <85% 的 supported 轴(return_wrapping/interface_impl_style/di_style)→ `convention-split` 软风险(divergentSamples 回显,不阻断);`transactionBoundaries` 非空且 goal 命中耗时 I/O 关键词(导出/excel/下载/上传/rpc/远程/耗时等)→ `transaction-warning`(建议 SPRING_EVENT_ASYNC 事务后事件解耦)。

### convention-conflict 判决(fail-closed)
- **SPLIT/WEAK(覆盖率 <85%)**:容忍披露,不阻断——plan 顺从多数派,dissidents 作为 `convention-split` 风险回显。
- **STRICT(仲裁后覆盖率 ≥85%,无样本数下限,`isStrictAxis`)**:意图正面对冲(六组确定性 INTENT 正则:裸返回↔包装、纯类↔拆接口、字段注入↔构造器注入)→ 抛 `ConventionConflictError`,携带结构化 `ConventionConflictDetail`(受阻轴/verdict/coverage/anchors/合规改写建议)。
- **循环依赖**(已确认口径①:目标类已在 bean 字段依赖图成环):`beanCycleContaining` 对 bean 类型字段图(`parentType → field.type`,bean=service/repository/mapper/interface)DFS,DIRECT_INJECTION 命中环 → 抛错(`axis: 'injection-cycle'`,环段回显)。意图对冲口径②:`extensionGoal` 确定性关键词,零 LLM。STRICT 口径③:`coverage.match/total ≥ 0.85` 即判,不设 n 下限。
- worker 层 `instanceof ConventionConflictError` 结构化捕获 → `{ error, conventionConflict }`(不 crash);MCP/CLI 层由 SDK 兜底 `isError`。

### DEPRECATE 管线
- 完全复用现有 fixed-point 孤立级联 + 五类清理清单,未改一行;仅补测试:legacy 模块唯一调用方的 DTO payload 方法(`toCheckInPayload`)随模块退役入度归零、级联孤立;live DTO(MoneyDto)保持存活。说明:call-graph 入度载体是方法符号,class 符号本身不承载调用入度,故 DTO 级联测试挂在类内方法上(与真实适配器产出一致)。

### 统一契约(packages/contracts/src/repoqa.ts)
- `ConventionAxisId/ConventionAnchor/ConventionCoverage/ConventionAxis/ConventionProfile` 从 control-plane 迁入 contracts(`ConventionAxis` 增 `primary?`),`repoqa-conventions.ts` re-export 保 24.2 导入兼容;contracts 不反向依赖 control-plane。
- `ModuleEvolutionParams` 增 `nearPackages?`/`commit?`;`ModuleEvolutionResult` 增 `conventions?`/`placement?`/`risks?`;新增 `EvolutionPlacement(File)`/`EvolutionRisk`/`ConventionConflictDetail` 类型。
- diagram 汇流归 **Ticket 24.5**,24.3 不做。

### worker/MCP 接线
- `repoqa-worker.ts`:`module_evolution` 工具 description 注明 ADR-0014 placement 与 fail-closed;parameters 增 `nearPackages`;execute 数组化透传 + `commit: this.repoqa.getRepo(repoId)?.commit ?? 'unversioned'`;冲突结构化捕获。
- `repoqa-mcp.ts`:`mcpModuleEvolution` 同步透传 `nearPackages` 与真实 `commit`。

### 测试(43 个用例覆盖本域;全量见下)
- conventions(新增 2):primary 镜像五态(ApiResult/bare/split/plain/constructor);STRICT 门限(3/5=60% 弱、5/5=100% STRICT、unsupported 不设门)。
- engine(新增 9,旧断言零改动):①split 双文件落位+双骨架+CREATE×2+basedOn 三轴;②plain 单文件+void handler+@Autowired;③wrapped/bare handler 签名两态(①②覆盖);④constructor/field 注入段两态(①②覆盖);⑤@Transactional+「导出对账单」→ transaction-warning+SPRING_EVENT_ASYNC 建议;⑥STRICT wrapped 仓库+「直接返回裸数据」→ throw ConventionConflictError(axis=return_wrapping, coverage 5/5);⑦3/5 弱惯例+中性 goal → 只披露 convention-split+divergentSamples;⑧A→B→A bean 字段环+DIRECT_INJECTION → throw(axis=injection-cycle);⑨落位目录物理有效(nearPackages 邻居目录+repo 根前缀)+DEPRECATE DTO 级联。

### 验证结果
- `module-evolution-engine.test.ts` + `repoqa-conventions.test.ts`:43/43;
- control-plane 全量:**511/511**(501 基线 + 新增 10);
- web:**270/270**;`npm run build` 通过;closeout gate:**37/37**(evolution 冻结题 evo-4/evo-5 与 extend findOwners+异步敏感词审查用例均兼容,零回归)。
