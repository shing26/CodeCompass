# Changelog

## [0.31.0] - 2026-09-17

### Highlights

- **精度优先批（v0.31 票池，`.scratch/v031-precision/`）**：承《CodeCompass 方向定位-2026-09-16》裁决「A 主轴（给 coding agent 的确定性代码事实层，MCP-first）+ D 交付；Web 只减不增」，把度量单位从「功能数」换成**真实仓库假阳性率**，并把「确定性 = 精确」这个核心承诺首次放上真实仓库的刻度尺。(1) **票 01 度量先行**：仓库此前只有 97 题合成 eval、从无真实仓库精度 harness——新建 `scripts/precision/scan_precision.ts`（索引→五桶→固定种子抽样→人工判定入档→`--score` 复算 M1；本增量另加 `--edges` 边级归因），三样本（lazygit Go / spring-petclinic Java / 本仓 TS）一条命令可复跑，克隆复用 + HEAD 记录保证跨轮可比；首份基线报告落 `docs/reports/`。**口径校正**：v0.21 留下的 43%/31%/83% 是「孤儿占符号比」（水位），不是假阳性率；真实假阳性率须逐条核验（本次三仓均 10/10）。(2) **票 02 精度攻坚（三增量）**：第一增量修七项根因（TS 适配器纯 JS dialect 把类型注解与 JSX 全判为语法错误 / 裸调用丢边 / JSX 使用无边 / 局部变量类型不记录 / DI 注解白名单不全 / handler 方法误进孤儿桶 / DTO 访问器），本仓孤儿 −42%、petclinic −76%；第二增量做 Go receiver 绑定——**票面「跨文件是主因」经实测推翻**，真主因是同文件两件事（`:=` 短声明不记类型：它与 `var` 同为 `VarDecl` 节点但无 `VarSpec`，原实现恒读不到类型；裸调用误继承 selfType：Go 无隐式 receiver，却被打上所属类型而走错解析分支）＋ per-repo Go 包表覆盖跨文件跨包，lazygit 孤儿 −13.1%，而**边级增益大一个量级**（`dynamic` 边 −800、可解析边 +498）——孤儿桶只反映「目标此前无其他调用者」的一小撮，调用链才是产品核心；第三增量把 M2 桶污染归零（`deepChains` 是唯一不过滤测试路径的桶，fixture route 曾作为生产入口上榜）。(3) **票 03 发布就绪**：README 工具数 15→17、安装段与实现对齐，`docs/benchmark.md` 从 v0.16/75 题刷到 97 题 10 bucket 并与真实仓库精度分栏陈述，协作文档「版本六处」修正为**版本五处**（单一源 `version.ts`；`MCP_SERVER_VERSION` 为别名且受 gate 棘轮），CONTEXT「MCP 面冻结为 8 工具」校准为 17（数量只减不增、精度增强不受限）。(4) **票 06 冻结护栏**：放弃清单转成硬约束（不再为 Web 做视觉/文案战役、不加第 7 个 Tab 与第 18 个工具、本批只发两个锚点、无度量不立战役），HANDOFF 三处更新 + V27 余账六行处置留痕，并清除对外文案里不可测指标的承诺（Local-First 无遥测 ⇒ TTFP/Adoption 永不入文案）。(5) **本批最重要的结论**：三仓 top-10 假阳性率仍 100%，且**接收器绑定类工作不可能推动它**——top-10 是按位置取前 10（不是最差 10），构成为类型声明、接口方法与其实现、函数值引用、导出 API 与测试脚手架类型；全桶 1618/2805（58%）属**桶语义问题**而非精度问题（类型没有「调用者」概念；Go 接口多实现时 ADR-0002 要求保持 dynamic；「零静态调用者」不等于死代码；`buildRadarGraph` 丢弃测试路径的边来源），已如实出「可达下限 + 根因可解释性」结论并把裁决点交出，未按目标倒推口径。

### Added

- `scripts/precision/scan_precision.ts`（真实仓库精度 harness：`self|lazygit|petclinic` 索引并抽样、`--score` 从判定文件复算 M1、`--edges <sample>` 报边级归因）+ `scripts/precision/verdicts/*.json`（逐条判定留档，键 = `filePath:line`）。
- `docs/reports/scan-precision-baseline-2026-09-16.md`（三仓 × 五桶 × 假阳性率基线报告，含 §7 第二/第三增量）。
- `services/control-plane/src/languages/parse-context.ts`（可选跨文件 parse context 契约：单文件契约不变，缺省时每条查找退回文件内并以 `dynamic` 收口）。
- Go 适配器：`receiverTypeFromTypeNode`（指针 / 限定名 / `ParameterizedType` 的命名类型解析）、`collectGoDeclarations` / `buildGoPackageTable`（per-repo 包表，按包目录归并）、`declTypeName` / `resultTypesOf` / `collectParamNames`。
- 15 例 Go 适配器用例（局部定型、泛型实例化与泛型调用边、跨文件/跨包定型、无 context 时保持 dynamic 的单文件契约红线、遮蔽与歧义名的 fail-closed 守卫）+ 1 例 `deepChains` 测试路径回归钉。

### Fixed

- **Go 调用边丢失（lazygit 孤儿 3229 → 2805，−13.1%）**：`:=`/`var` 局部变量类型不回填 → 此后 `app.Method()` 全落 dynamic；裸调用误挂 selfType → 方法体内调包级函数走错解析分支；字段类型只读 `TypeName` → `*svc.Repo`/`io.Closer` 字段记成无类型；泛型调用点 `F[T](...)` 完全不记边；跨文件/跨包的函数结果无法定型。
- `deepChains` 桶不过滤测试路径（唯一漏网的桶）：测试夹具 route 曾作为生产入口点上榜，M2 目标 0 未达成；改为过滤候选而非输入，链深与其余条目不变。
- TS 适配器此前用纯 JS dialect 解析，类型注解与 JSX 全被判为语法错误节点（探针：8 token 的 `.tsx` 片段 9 个错误节点）——本仓符号 1745 → 1911。

### Changed

- README 工具数 15 → 17；安装段与 `MCP_TOOLS` 实现对齐。`docs/benchmark.md` 刷到 97 题 / 10 bucket，并把「合成基准」与「真实仓库精度」分栏陈述（不得混为一谈）。`docs/agents/parallel-collaboration.md` 版本面改为版本五处；`CONTEXT.md` Dual-Surface 词条校准为 17 工具。`docs/reports/` 新增真实仓库精度报告。
- 版本五处推进 0.30.0 → **0.31.0**（四本 `package.json` + `version.ts` 单一源；`packages/bridge-adapters` 独立 0.6.0 线不动）。

### 发布

- 首发物 **`@codecompass/cli@0.31.0`**（MCP-first 的确定性代码事实层）。发布动作由维护者本机执行（npm scope 归属确认 → `npm publish`；tag `v0.31.0` 触发 Release 管线）。
- M4 验收命令：干净机器 `npx @codecompass/cli mcp <path>` 完成 stdio 握手并返回 `list_repos`；发布后核验 `npm view @codecompass/cli version`。
- 发布前核验已完成：`npm pack --dry-run` 干净（160 文件 / 5.0 MB，`bin/` 与两份 `dist/` 齐全，无 `.env`、`.scratch`、`node_modules` 泄漏）。

### 质量门（v0.31.0 基线）

- 控制面 **650 → 666**（Go 适配器 15 例 + `deepChains` 回归钉 1 例）、web **363**、bridge **26**、e2e **63/63**（含 97 题 golden eval 全阈值：Recall@5 各桶 100%、幻觉 0%）；`tsc --noEmit` 四包净。
- 真实仓库精度（M1/M2，三样本同源可复跑）：M2 桶污染 **0/0/0**（vendor + 测试夹具进榜条数）；M1（top-10 逐条核验）**10/10 假阳性**——未达标，已按 spec §6.2 降级策略交出「可达下限 + 剩余噪声可解释性」而非按目标倒推口径。

### 契约稳定性

- **MCP 17 工具签名与数量冻结**为 v1 契约：本批零新增工具、零新增页签，只允许「同一工具输出更准」。`packages/contracts`、REST/SSE 端点形状零变化。
- 精度增强全部落在调用边的**确定性**解析上：ADR-0002 红线（跨文件绑定必须由 import 路径 / 包限定名确定；解析不到就保持 `dynamic`，不得按名字相似度猜）由单测把守——无 context、遮蔽名、歧义包名、同包重复声明四类全部 fail-closed。

### 续批（2026-09-18 / 09-20）：MCP 契约收口 · 桶语义裁决 · 外部评审两票 · TS 接收者定型 · 精度棘轮

**票 07 MCP 契约正确性收口**（用户 2026-09-18 批准，附两项硬条件）：(a) 新增 `MCP_SERVER_INSTRUCTIONS` 并传入 `ServerOptions`——17 个工具跨 5 个使用阶段却从无编排指引，ADR-0016 的轮询契约此前只写在 `index_repo` 自己的 description 里；(b) `zodForJsonType()` 取代 `type === 'string' ? z.string() : z.unknown()`——后者让唯一非 string 参数 `maxTokens` 形同无约束（`"500"` / `{}` / `true` / `[1,2]` 全通过），未识别类型现改为抛错；(c) `textResult()` 成为统一出库收口点（此前全文件仅 1 处脱敏，`diagnose` / `graphrag` 各自内部脱敏使出口本身无人把守）；(d) README 工具表改**由 `MCP_TOOLS` 生成**——票 03 只改了正文数字、漏了可枚举清单且打了 ✅，生成 + 双向 gate 断言根治该类漂移（硬条件①），配 `readme-tool-table-parity` / `readme-version` 两条 gate；**硬条件②**：`textResult` 层有独立单测（不得用各自已脱敏的两条路充当证据）。

**ADR-0018 桶语义三裁决 + 票 08 落地**（用户 2026-09-18 裁决 A / A→A′ / B）：孤儿桶的**声称范围**收窄为「可调用符号的零静态调用者」——类型声明（lazygit 623）与接口成员（375）不进候选并**按规则计数**（`census.excluded`），接口**实现**方法（620）以 `deferred` 规则显式登记待接口-实现关系表，仅被测试调用者加 `testOnly` 标注**不排除**。**lazygit 孤儿 2805 → 1807**（与裁决算术逐字吻合）。响应内 `census` 成为全桶归因的唯一权威口径（取代一次性诊断脚本），harness 对不守恒直接抛错。

**外部框架评审候选两票**（用户 2026-09-19 批准）：**票 09** 语言注册表单表派生——加一种语言此前要改 5 张手维护表且两个漂移方向都静默（文件被扫零符号／根本不入扫描），现 `language-extensions.ts`（唯一数据）+ `registry.ts`（唯一接线，派生 `SOURCE_EXTENSIONS` / `adapterFor`），`ParseContext.goPackages` 泛化为按语言键；**票 10** 错误码单一源 `packages/contracts/src/error-codes.ts`（30 码，wire 格式零变化）——前端 `Record<ErrorCode, string>` 编译执法、服务端 `code:` 字面量扫描哨执法、CONTEXT 表与代码双向对账。两票**零行为变更**（三仓精度逐字节不变）。

**票 11 TS 接收者定型**（dogfooding 实测驱动）：scan 孤儿 top-10 有 8/10 是 `RepoQAClient.*` 假阳性。归因实验推翻了票面「作用域链」假设——真拦路虎是 **lezer 把参数 `: Type` 注解放成 ParamList 的兄弟节点**，`typeAnnotationName` 只找直接子节点，**参数注解从未被读过**。四步递进：(a) 注解兄弟配对、(d) 解构参数（ObjectPattern）按类型字面量逐成员绑定、(链) `MethodScope.parent` 闭包链 + `declared` 遮蔽栅栏（最近声明处停，未定型不复活）、(h) `new X()` 记构造边。**self 孤儿 283 → 236**（−16.6%），lazygit/petclinic 每步复测逐字节不变。

**V31-05 精度棘轮**（长期缺口：精度回退从无门禁）：harness 增 `--ratchet`——结构不变量（普查守恒 / 污染为 0 / 候选只含可调用符号 / ADR-0018 排除规则在位 / 接口实现 deferred 仍声明）+ **冻结基线**的比值天花板（只能显式 `--ratchet-update` 抬升）；接进 e2e 门禁 → CI 自动执法。另修 `--score` 的**覆盖度隐患**：陈旧判定文件会静默缩小分母（未判定条目直接消失），现输出携带分母并对未覆盖样本标注 ⚠。

### Added（续批）

- `packages/contracts/src/error-codes.ts`（`ERROR_CODES` / `ErrorCode` / `ERROR_CODE_LIST`）；`packages/contracts/src/repoqa.ts` 增 `ScanCandidate.testOnly` / `ScanExclusion` / `ScanCensus` / `ScanBucket.census`。
- `services/control-plane/src/languages/language-extensions.ts`（唯一扩展名源）、`languages/registry.ts`（唯一接线表 + 派生）。
- `services/control-plane/src/error-code-guard.test.ts`（服务端错误码扫描哨）、`languages/registry.test.ts`（扩展名双向守恒）。
- `docs/adr/0018-orphan-bucket-semantics.md`；`.scratch/v031-precision/issues/07|08|09|10|11`。
- `scripts/precision/ratchet-baseline.json`（冻结基线）、`scripts/precision/verdicts/self.json` 重判、`package.json` 增 `precision` / `precision:ratchet` 脚本。
- `docs/reports/CodeCompass-补齐清单分析-2026-09-18.md`、`docs/reports/CodeCompass-框架补强建议分析-2026-09-19.md`。

### Fixed（续批）

- TS 适配器**参数类型注解从未被读取**（lezer 形状）+ 解构参数未配对 + 直接子箭头作用域不链外层 + `new` 不计构造边 → 自仓孤儿 283 → **236**。
- MCP `maxTokens` 类型护栏空转；MCP 出库无统一脱敏收口点；README 工具表与实现不一致（正文数字已改、清单漏改）。
- 加语言的 5 张手维护表 → 2 处；错误码三处手维护 → 单一源 + 三项执法。

### Changed（续批）

- README 工具表与版本串改由生成器/断言维护（`sync-mcp-tool-table.py` + `readme-version` gate）；README 两处 IDE 配置的 `npx codecompass` → `npx -y @codecompass/cli`（前者会解析到 npm 上他人同名包）。
- `CONTEXT.md` 错误码节标注单一源与「新码三处同动」流程。

### 双轴评审与 P1 修复（2026-09-21）

按 `HANDOFF.md:116`（发布前双轴 `code-review`，fixed point = 上次审完 commit，不可省）对 **v0.31 整条线**（`80c3ab1..HEAD`，7 提交 / 81 文件 / 7369 插入）补跑评审——该线段此前**从未评审**。报告：`docs/reports/code-review-2026-09-21.md`（两轴并排 + 主代理逐条自证与处置）。

- **Standards 轴**（8 条）：ADR 索引 `0001–0017` → **`0001–0019`**（三处，本批新增 0018/0019 后静默漂移，无 gate 覆盖该区间）；ADR-0018 字段名 `excludedByRule` 对齐实现 `census.excluded`；**错误码哨正则收双引号**（原 `/code:\s*'…'/` 使 `code: "x"` 整体绕过守卫）+ 形状断言钉住；`scripts/out/` 原始 dump 取消跟踪并入 `.gitignore`（沿用 `scripts/precision/out/` 先例）。
- **Spec 轴**（10 条）：补票 16 承诺的 `mcp:model-probe`；票 12(c) 字段表改正为实际落盘字段（`ok` 取代 `isError`；该层无稳定错误码故错误分布按文本聚合；截断由 sink 内部完成）；票 11 的 M1 行改为"已补做"（指向 `verdicts/self.json`，self 90.0%）；`.zcodeignore`（本会话工具生成的本地配置）取消跟踪。
- **P1 修复：普查守恒空转**——评审发现初版守恒断言是**同义反复**（`census.zeroCallers` 由 `total − testOnly` 反推，故 `zeroCallers + testOnly === total` 恒成立，harness 抛错守卫/棘轮不变量①/单测三处永不触发）。修法：引擎在**收窄规则之前**独立累加 `census.candidatesBeforeRules`（计数器不得由 `total + Σexcluded` 派生——独立性就是这条断言的全部价值），真等式 `candidatesBeforeRules === total + Σ excluded[].count` 落**四处**（census 构造处直接抛错 / harness 守卫 / 棘轮不变量① / 单测钉值）；转入红实测成立（计数器移到规则之后即精确报错）。**三仓实测复现收窄前总数**：lazygit **2805** = 1807+623+375、petclinic **45** = 13+31+1、self 668——与基线报告 §7.4/§7.5 逐字吻合，**ADR-0018 的裁决算术从此每次运行都被机器核对**。
- 未自证项（Go 每轮解析两次的性能、≤5 魔法数、Feature Envy、5 适配器谓词重复、`scan-engine` 排除块 Divergent Change）按 judgement call 登记在报告，未改码——**2026-09-21 逐条裁决**：5 条"不做"（均落在 spec §6.5「不服务 M1–M5 不做」之下，属整洁性偏好），Go 双解析留"待测量"入口（先量占比再决定是否合并两趟解析）。

### 台账刷新与 V30-9 关闭（2026-09-21）

- **V30-9 e2e gate hermetic 化（已闭）**：gate 在 spawn HTTP 服务端时显式清空 `REPOQA_LLM_BASE/URL/API_KEY`（`chat/llm.ts:121` 的 `{...dotEnv, ...thisEnv}` 保证进程环境优先；置空后 `!url && !base → return null` 走确定性降级），并留 `CLOSEOUT_GATE_LIVE_LLM=1` opt-in 供人工 eyeball。**实测：本机门禁 68/2 → 71/0**（两条红原为 provider HTTP 402）。**顺带发现**：402 曾**连带吞掉**下游 `ADR-0010 commit stamp` 断言——incident 无 done payload 时 `closeout_gate.py:732-734` 提前 return，该断言根本不记录；现已全绿 71 项。
- **V27-17 立项（票 17）**：TS/JS 仓的 Tour 锚点族。现场实测本仓 `get_tours` 返回 `[]`，且工具 note 自陈"tours currently cover Java/Spring REST projects"；根因 = 三个 tour 的锚点全为 Java/Spring 概念（Servlet Filter / 拦截器 / route 方法），而 TS 入口族（`app.use(fn)` 中间件注册、React Context 枢纽、`main.tsx` 模块级 JSX）**根本不进符号图**（`app.use(fn)` 因取不到字符串首参被 route 分支丢弃；模块级 JSX 无边 = 报告 §5 P1 已登记缺口）。
- **文档台账刷新**：`HANDOFF.md` §4 由"下一步 = 六票"改为**票池 01–16 现状表 + 仍开放清单**（§6 数字 650→693、63→69 项；§2.3-7 改为"已 hermetic + live opt-in"）；`CONTEXT.md` Status 补 ADR-0018/0019 与评估维批、棘轮；**V30-9 补进 `v027-backlog.md`**（此前只在 v030 spec 与 HANDOFF 提到，两账不对齐）。

### 精度残余族：(g) 工具类型/具名接口成员 + (f) 第一半（2026-09-21）

票 18 的两族落地（(f) 第二半与 (e) 待跨文件机制，见下）。**归因实验推翻了票面假设**——不是"两处可能只坏一个"，而是**两处独立都坏**：变体 B（内联字面量 + `Pick<>`）与变体 D（具名接口 + 普通类型）各自单独失败，而 A（内联 + 普通类型）通过。

- **落地**：`ReceiverType { name, allowed? }` 贯穿 `params`/`locals`/`receiverTypeOf`；`resolveTypeRef` 解析注解**原文**（`X` / `Pick<X,'a'|'b'>` / `X | undefined`），其余 fail-closed；文件内 interface 成员表 `parseInterfaceMembers`；调用点 `receiverExposes` 判 `Pick` 越界即 `dynamic`（**不把 `Pick<T,K>` 展开成 `T`**——那会造出类型系统没有的边，假阴性比假阳性更坏）。
- **实现中又由探针暴露两处真缺陷**（均已修 + 回归钉）：① 朴素 `split('|')` 撕裂 `Pick<X, 'a' | 'b'>`（`|` 在 `<>` 内属 K 列表）→ 症状是"单名 Pick 通过、两名失败"；② `=>` 的 `>` 被当成泛型闭合 → 深度变负 → **函数类型成员之后的所有成员全部丢失**。修法：深度感知切分 + 两个文本切分器都忽略 `=>`。
- **实测（三仓同源复跑）**：**四条目标全部离榜**（`radar` / `getArchitectureDelta` / `runGate` / `listGateRuns`）；self 孤儿 **250 → 248**（净减，未制造新孤儿）；lazygit **1807** / petclinic **13** **逐字节不变**；普查守恒三仓成立；adapter **18** 用例全绿（含越界反例、联合 fail-closed、两名 Pick 与函数类型在前的回归钉）。
- 复测新露面两条按分工登记：`getSubgraphContext` 有生产调用点（`InspectorContext.tsx:72`）属 (f)/上下文 Provider 族；`QueryStream.onEvent/onError/onDone` 待查死 API 或订阅模式未捕获。
- **(f) 第一半（`useMemo` 工厂的深层 `new`）**：窄规则白名单 `useMemo(() => new T(...))` / `useMemo(() => X ?? new T(...))`；**反例守死**——`items.map(u => new User(u))` 是实例的**集合**，整体定型会把 `users` 误判为 `User`（造出类型系统没有的边），单测含该反例。**实测它不推动 top-10**：`App.tsx:38` 的 `client` 仅作为 JSX 属性传给 `<RepoProvider>`，无方法调用（self 孤儿 248 不变，属预期）。
- **(f) 第二半与 (e) 经实测定位为同一件事：需要跨文件类型/成员表**。`pickFolder` 的调用点在 `App.tsx:52` 的 **`WorkbenchShell`**（不是 `App`），其 `client` 来自 `const { client } = useRepo()`；而 `useRepo(): RepoContextValue`（`RepoContext.tsx:423`）的返回类型接口**声明在另一个文件**。机制与 V31-02 的 Go per-repo 包表同源 → 扩 `ParseContext` 加 TS 条目（接口成员表 + hook 返回类型，歧义名丢弃）。**该增量已于 2026-09-24 落地，见下节。**

### 精度残余族收口：(f) 第二半 + (e) 跨文件类型/成员表（2026-09-24）

票 18 的后两族落地，**self top-10 的 `RepoQAClient.*` 由 7 条压到 1 条**（仅剩真阳性 `getRepo`）。机制 = 扩 `ParseContext.languages.typescript`（`TypeScriptDeclarations`：接口成员表 + 函数返回类型 + 形参类型），`buildParseContext` 建一次仓级表，**只扫不解析**（review 已把 Go"每轮解析两次"挂在"待测量"上，再给每个 TS 文件加一趟完整 parse 是更大的账）。

- **两个消费口**：① `const { client } = useRepo()`（ObjectPattern 不是 VariableDefinition，此前整条分支都进不去）——hook 返回类型（跨文件）+ 该接口成员表（第三个文件）；② 回调实参按**被调方签名**定型（(e)）——`useSymbolResource(…, (c, rid, n) => c.listReverseDeps(…))` 的 `c` 由第四个形参的函数类型决定。
- **表纪律**：一律存注解**原文**（`Pick<X,'a'>` 的限制必须活到调用点）；同名**异内容**整体丢弃（同 Go 包表规矩，歧义即不猜）；文件内声明优先于跨文件。
- **探针抓出两处真缺陷**（均修 + 回归钉）：① `argumentNodes(call).indexOf(node)` **恒为 -1**——lezer 每次访问都新建 `SyntaxNode`，同一实参永不引用相等，(e) 绑定**静默从不触发**；改按 `from/to` 位置匹配。② 重命名解构 `{ client: renamed }` 的目标在 lezer 里是 **VariableDefinition 而非 VariableName** → 首版守卫漏判，把 `client` 绑成 `RepoQAClient`（**假边**，本票最怕的方向）；改为"只有裸 `{ name }` 才定型"。
- **实测（三仓同源复跑）**：self 孤儿 **248 → 246**、top-10 `RepoQAClient.*` **7 → 1**；真索引复验 `pickFolder ← WorkbenchShell`、`listReverseDeps ← useReverseDeps`、`getSubgraphContext ← useSubgraphContext + handleCopyAgentContext`；lazygit **1807** / petclinic **13** 逐字节不变；普查守恒 `667 = 246 + 421`；棘轮 12.1%（天花板 17.1%）。
- **反例单测 13 条**（adapter 19 → 32）：无表/未知 hook 不绑、无返回注解不绑、重命名与默认值不绑、跨文件 `Pick<X,'runGate'>` 上调 `pickFolder` 必须 dynamic、本地接口压过跨文件同名、同名异内容丢弃、函数两处声明不一致则 returns 与 params 双双丢弃、(e) 侧自身注解优先（哪怕不可解析）、非函数类型/联合/未知被调方/实参多于形参一律不绑。
- **一处刻意未做（诚实登记）**：增量单文件刷新路径**不建 TS 表**（仓级表要在每次保存时读全仓 TS 文件，而该调用点只有变更路径）→ 单文件刷新后的 TS 文件丢跨文件边直到下次全量索引，即"这个表出现之前所有 TS 文件的状态"，永不比原来更差。Go 侧不受影响。
- **测量期自指陷阱（已记入票 19）**：首次复测 `pickFolder` 仍 0 调用者——不是代码坏，而是本票新加的**单测 fixture 自己声明了 `interface RepoContextValue`**（多行模板串未被掩码）与真声明同名异内容 → 歧义规则正确地丢了真表项。修法 = fixture 改名；掩码缺陷另立票 19——**一行加宽 backtick 分支会坏得更厉害**：注释里的反引号会与远处反引号配对，使真注释文字不被掩码，本仓 `TypeScriptAdapter.ts` 当场自伤（探针留证），正确修法是两阶段掩码。
- **新立两票**：票 19（多行模板串未掩码 → 幻影声明）、票 20（接口→实现关系表 = ADR-0018 `deferred` 的 A′ step 2；票 18 复测后新露面的 `QueryStream.*` / `EvolveStream.*` 属此族）。
- **门禁**：控制面 **698 → 711**、web 364、bridge 26、e2e **71/0**、97 题 eval 全阈值（Recall@5 100%、幻觉 0%）、四包 `tsc --noEmit` 净。

### 接口→实现表打通：接收者定型三处缺陷（2026-09-24，票 20）

**票面前提被实测推翻**：`implsOfInterface` **早已存在且映射正确**（`QueryStreamLike → [QueryStream]`、`EvolveStreamLike → [EvolveStream]`，由 `buildCallIndex` 从 `symbol.interfaces` 建，TS 适配器一直在填 `implements`）。打不通的是**调用点的接收者没有类型**——表在了，没人拿它去查。于是本票执行内容从"建表"改为"把接收者定型"，`implsOfInterface` / `resolveCall` **一行未动**。

三处真缺陷（都是静默失效型，逐条先红后绿）：

| # | 缺陷 | 修法 |
|---|---|---|
| ① | `useCallback((stream: QueryStreamLike) => …)` 的箭头是**实参**，既不是 `const x = (…) =>` 声明也不是方法，`collectParams` 从没被调用——注解写在文件里却从未生效 | `callbackScopeFor`：箭头/函数表达式一律取自己的**已注解形参**（无注解且无被调方签名则不推作用域，窄规则保持） |
| ② | 缺**方法返回类型**：`const stream = client.evolveStream(…)` 只能靠 `RepoQAClient.evolveStream(…): EvolveStreamLike` 定型 | 表加 `methods`（`Type.method` → 原文返回注解），按接收者类型 + Pick 允许集查表 |
| ③ | **具名接口分支吞注解**：`memberLookup(raw)` 对**空 Map 也是真值**，而 `QueryStreamLike` 是方法型契约（成员表为空）→ 走成员绑定分支、零绑定、**且不再走普通类型分支** | 只在 `members.size > 0` 时走成员绑定；否则按普通接收者类型处理（且只绑裸标识符形参） |

- **实测（三仓同源复跑）**：self 孤儿 **246 → 237（−9）**，流订阅族**整族离榜**（12 个流调用点全部定型：`useEvolutionSession` 8 处、`useChat` 4 处）；lazygit **1807** / petclinic **13** 逐字节不变；普查守恒 `658 = 237 + 421`；棘轮 11.6%（天花板 17.1%）。
- **票面错误更正**：原文把 lazygit 的 620 条 `interface-implementation` 写成"同源"——**错的**。`implsOfInterface` 只能从**显式** `implements` 建（Java/TS），**Go 没有 `implements`**（接口满足是隐式的），且 ADR-0018 已裁决那 620 条"Go 接口多实现按 ADR-0002 保持 dynamic"。**所以 lazygit 不变是预期结果，ADR-0018 的 `deferred` 说明与 census 断言无需改动**。
- **顺带修两处**：① 方法返回注解被 `{` 截断（`pickFolder(): Promise<{ canceled: boolean }>` 曾记成 `Promise<`）→ 新增 `typeTextBeforeBody`（只有角度/圆/方括号都闭合的 `{` 才算方法体）；② **TS 声明表改为只取生产文件**（`isTestPath` 过滤，Go 表原样不动）——测试文件里的 `class X { … }` 是测试替身，实测**两次**被自己新加的 fixture 污染（票 18 的 `RepoContextValue`、本票的 `RepoQAClient.queryRepo`）。
- **复测后 top-10 新面孔**：`EvolveStream.close`（接收者是**成员链** `streamRef.current.stream`，新机制，登记后续）；`ChatMergeClient.*` 5 条是**真阳性**（生产零调用，仅测试替身对象字面量出现）——桶在做它该做的事。
- **新立票 21**：`resolveCall` 在 `dynamic === false` 但 `receiverType` 不在索引里时仍退回**按名解析**（同文件/全局方法名）→ **假边**方向的口子，票 20 的定型面把它暴露得更宽（`(c: SomethingUnresolvable) => c.pickFolder()` 在真仓里会绑到 `RepoQAClient.pickFolder`）。
- **门禁**：控制面 **711 → 716**、web 364、bridge 26、e2e **71/0**、97 题 eval 全阈值、四包 `tsc --noEmit` 净。

### 按名回退假边口子收口（2026-09-24，票 21）

`resolveCall` 收尾的按名解析条件是 `!call.dynamic`，它把两种语义相反的情况混在一起：**"适配器没有接收者信息"**（裸调用 / 旧格式行——按名解析是 V31-02 的既定能力）与**"适配器声明了接收者类型、但索引不认识这个类型"**（外部类型：`Error`、`strings.Builder`、第三方工厂）。后者此前也会落到按名解析，**用同名方法猜出一条边**——ADR-0002 明确禁止。

- **先量**（新探针 `.scratch/probe-t21.ts`，三仓真索引）：**1014 条**这样的边被猜出来——self **438**、lazygit **575**、petclinic **1**。典型：`Error.constructor → HarnessRegistry.constructor`（**356 条**）、`T.Run → IntegrationTest.Run`（**206 条**）、`strings.Builder.WriteString → gocui.View.WriteString`、`Database.close → FakeEventSource.close`（跨端绑到 web 端测试替身）、`ReactiveCircuitBreakerFactory.create → VisitResource.create`。
- **排除"真缺口"**：逐条核对"类型名在本仓有符号、只是 kind 不在 `TYPE_KINDS`"——self 25（全是票 19 造出的假方法名）、lazygit 248（全是同名巧合：仓里有叫 `Mutex`/`Set` 的*方法*，接收者却是标准库类型）、petclinic 0。**无一条成立**。
- **修法**：条件改为 `!call.dynamic && !call.receiverType`，并加"裸调用 + `this.foo()` 不得回退"的回归钉。
- **修后复量**：三仓该类边 **0 / 0 / 0**。
- **⚠ 孤儿桶因此变大（self 237 → 246、lazygit 1807 → 1828、petclinic 13 → 13）——这是精度提高的信号，不是回退**：去掉假边后，那些**只靠假边"被调用"**的符号现在真的零调用者，于是进入桶。此前它们因一条猜出来的边而**不出现**（假阴性）；现在出现得**正确**。桶声称的是"零静态调用者"这个事实，事实没变，可见性变了。**调用链正确性与 M1 都没退化，变的是那个代理指标的读数**——代理指标方向与真实质量方向相反，正是本批反复强调的口径纪律。棘轮是天花板（17.1%），self 12.0% 仍在界内，未动 `--ratchet-update`。
- **顺带**：`module-evolution-engine.test.ts` 两处 fixture 此前**依赖被修掉的回退**（只声明了方法、没声明 owning type，如 `DateUtil`/`DayMath`/`CheckInPayloads`）——真实管线不会这样（类符号与方法总是同源，否则 TS/Java 都编译不过），已补上类型声明。
- **门禁**：控制面 **716 → 718**、web 364、bridge 26、e2e **71/0**、97 题 eval 九桶 Recall@5 全 100%、四包 `tsc --noEmit` 净。

### 掩码器改单趟状态机：幻影声明归零（2026-09-24，票 19）

`maskLiteralsAndComments` 的 `'`/`"` 分支按行（`[^\\\n]` 排除换行），所以**多行模板串只被掩到第一个换行**，其后的内容被当成**源码**扫描 → `interface X {` 之类的文字变成**幻影符号**。这个缺陷在两天内**咬了两次**：票 18 的单测 fixture 声明了 `interface RepoContextValue`、票 20 的 fixture 声明了 `class RepoQAClient`，都与真声明同名异内容，被跨文件表的歧义规则（正确地）丢弃真表项，症状一律表现为"**改了没用**"。生产代码同样暴露（`chat/agent.ts` 系统提示词、`engine/repoqa-export.ts` 导出模板都是多行模板串）。

- **为什么不能一行加宽 backtick 分支**（实测）：掩码器自身源码与注释里就有反引号，跨行匹配后注释里的反引号会与远处的反引号配对，**中间的真注释文字反而不被掩码**——本仓 `TypeScriptAdapter.ts` 当场自伤（它注释里那句 `` `interface RepoContextValue { … }` `` 成了幻影声明）。**配对只有在注释被排除之后才可信**，这是状态机问题不是正则强度问题。
- **落地**：改**单趟扫描式状态机**（同长空格替换，偏移契约不变），六类字面量各走各的状态：注释、`'`/`"`、模板串（**允许跨行**，处理 `${…}` 插值与插值内嵌套模板）、正则字面量（靠前导字符判"除法 vs 正则"，遇换行即判非正则，字符类内 `/` 不闭合）。**已知边界刻意保守**：`)`/`]` 之后的 `/` 一律当除法（`if (x) /re/.test(y)` 不被掩码）——少掩码只可能造幻影，多掩码会藏掉真代码。
- **量化（同树对照：`git stash` 只回退 adapter，测试文件不变）**：self symbolCount **2045 → 2030**（**幻影 15 个**，且这是在**新增 4 条单测**的前提下净减）；孤儿 **246 → 246（未上升）**；hubs 1631 → 1637；lazygit **10523/1828**、petclinic **595/13** 逐字节不变（Go/Java 不走这个掩码器）。
- **棘轮复算并留档**：self **246/2030 = 12.1%**（分母变小使比值自 12.0% 被动上升），天花板 17.1% 仍在界内，**未动 `--ratchet-update`**，`ratchet-baseline.json` 内容零变化。
- **单测 4 条**：多行模板 / 正则字面量 / 嵌套模板（实现前 3 条红）+ "注释里的反引号"（新实现的回归钉，用来挡"一行加宽"那类改法）。
- **门禁**：控制面 **718 → 722**、web 364、bridge 26、e2e **71/0**、97 题 eval 九桶 Recall@5 全 100%、四包 `tsc --noEmit` 净。

### TS/JS 仓的 Tour 锚点族 + 两个被丢掉的入口边（2026-09-24，票 17）

**本仓 `codecompass_get_tours` 从 `[]` 变为两条真实路线**（`2026-09-21` 现场实测曾是 `{"tours": [], "note": "…tours currently cover Java/Spring REST projects"}`）：

```
auth-chain 鉴权与中间件链（4 steps）：USE * → requestIdMiddleware [http.ts:42] → USE /api [http.ts:130]
                                    → USE * → errorMiddleware [http.ts:162] → GET /api/chat/status [chat/routes.ts:27]
main-flow  挂载链（5 steps）：main [main.tsx:9 = createRoot(...).render(] → App [App.tsx:34] → …
```

- **两个被丢掉的入口族（适配器）**：① `app.use(name)` 因"取不到字符串首参"整条被丢弃 → 中间件既无锚点、自己又读成死代码；现在登记为 `route` 符号 `USE *` 并记调用边（**只收命名中间件**：内联箭头无可锚定的名字、`app.use(express.json())` 这类库工厂不是本引擎能锚定的中间件，都不登记）。② `main.tsx` 的 `render(<App />)` 在**任何函数之外**，无 enclosing symbol → 边被丢弃 → 被挂载的根组件读成死代码；现在挂到**每文件模块节点**（新 kind `module`，锚在该文件第一条模块级边那一行）。模块级**调用**仍按原样丢弃（另一件全仓范围的事，需自己的度量）。
- **`PRODUCTION_KINDS` 增 `module`，`effectiveStart` 接受带边的模块节点**：边的 in-degree 只有在起点是图节点时才计——不加这条，`App` 仍会因"挂载不算调用者"留在孤儿桶（实测加了才离榜）。模块节点本身无调用者，落在既有 type-declaration 排除里，普查守恒。
- **Tour 构建器加 TS 锚点族**：`auth-chain` = 中间件链 + 其后首个 HTTP 路由；`main-flow` = **挂载链**（逐跳取"首个可解析的边"，跳过库包装——共享链解析器会在 `StrictMode` 上两步就断）。**Java 的 filter/interceptor 家族非空时完全不启用**，故 petclinic 输出逐字节不变。
- **不编步骤**：没有中间件就不拿单个路由凑"鉴权链"，没有挂载点就不拿路由凑"主业务流"——两条都退回诚实空态（这条被 `repoqa-mcp.test.ts` 的"无路由仓诚实降级"用例当场抓住一次）。**TS 家族过滤测试路径**：第一版把 `http-error.test.ts` 里的 fixture 注册排在了真 `http.ts` 前面。**MCP 空态 note 改口**：逐类说明各 tour 需要什么，不再自称 Java-only。
- **实测（三仓同源复跑）**：self 符号 2030 → **2066**（+23 模块节点 + 命名中间件符号）、孤儿 **246 → 243**、**`App` 离榜且不再带 `testOnly`**、deepChains 48 → 50；lazygit **10523/1828**、petclinic **595/13** 逐字节不变；普查守恒 `666 = 243 + 423`；棘轮 11.8%。
- **门禁**：控制面 **722 → 727**、web 364、bridge 26、e2e **71/0**、97 题 eval 九桶全 100%、四包 `tsc --noEmit` 净。
- **已知边界**：挂载链取"首个可解析的边"而非组件树遍历（需给边加 JSX 标记才能走纯组件树，契约面变更另议）；`error-handling` 对 TS 仍空（Express 四参错误中间件是确定性信号，未做）；跨文件中间件顺序按文件路径排序（tour 描述已披露）。

### 质量门（续批后基线，取代本节上方旧数值）

- 控制面 **666 → 686**、web **363 → 364**、e2e **63 → 69/69**（新增 5 条 MCP/文档断言 + 1 条精度棘轮）；`tsc --noEmit` 四包净。
- 真实仓库精度：lazygit 孤儿 **1807**、petclinic **13**、self **236**（普查三仓守恒）；**M1 self 首次离开 100%：90.0%（9/10）**，唯一真阳性 = `RepoQAClient.getRepo`（前端 client 方法全仓零调用者，仅测试替身 mock）。lazygit/petclinic 的判定文件仍覆盖 4/10 与 5/10（旧榜单），已由 `--score` 覆盖度守卫标注 ⚠，**不可与 self 的 9/10 混引**。

### 评分维补齐批（2026-09-21）：票 12–16

承外部评分（`项目评估结果/CodeCompass/20260920-MCP-431790b9.json`，63/81 = 77.78%）与《短板清单-20260921》《项目提升计划-20260921》，按「能护住已得成果」排序补齐四个评估维，另立通用协议套件消 E-M10 的口径争议。

- **票 12（E-M12 可观测与审计 1→3，全表最低分）**：`registerPlain` 是 17 个工具的唯一出口，审计挂在那里——`McpDeps` 增**可选** `logger`（单测不注入 ⇒ 不写文件），`runMcpServer` 从 dataDir 构造既有 `ServerLogger`（脱敏/截断/轮转/保留全套复用，**不自建序列化**）。落 `scope:'mcp'`、`msg:'tool_call'`，字段 `tool/durationMs/ok/argsBytes/resultBytes/args/result`。3 分证据：`npm run mcp:stats`（成功率/耗时分布/错误分布，零依赖脚本）+ 一次真实排障复盘（报告的案例：三步定位出"宿主凭猜测传 repoId"而非引擎故障）。新增 ADR-0019（记录入参出参与 HTTP sink "排除 body" 政策的差异理由）。
- **票 13（E-M7 幂等与副作用边界 2→3）**：先核契约再钉测试——`idempotency.test.ts` 三条（同路径复用 repoId 且 `created:false`／重复删除 fail-closed 不误伤／indexing 中拒绝删除），转红实测成立（禁掉 `findByLocalPath` 复用即红）；新增 `docs/mcp-tool-contract.md`（17 工具读写/副作用分类表 + 通用套件用法）；gate 增 `write_logged`（写工具必须留审计行）。
- **票 14（E-M10 可测试与可模拟）**：新增**通用** `scripts/e2e/mcp_conformance.py`（六项协议断言，探针全部运行时从 `tools/list` 发现，**零项目数据依赖**）+ 故意违规的假服务端 fixture（两种模式）。**双向验收**：本仓 6/6 绿；假服务端 `--mode=handshake` 抓出握手违规、`--mode=tools` 抓出 4 条（空描述/未知名静默成功/类型不匹配未拒/缺必填未拒），而真正合规的信封断言正确通过。`closeout_gate.py` **保持不动**（本仓业务语义回归资产），两者并存。
- **票 15（E-M4 上下文治理 2→3）**：真实 MCP 会话三档同 query 对比——默认档 **7309** 估算 token（`prunedCount=7`、`truncated=true`）vs 上限档 **12719**（`prunedCount=0`）⇒ **剪枝省 42.5%**；超限触发实测成立。实测纠正：初版用 200000 当"关剪枝"，被 handler（合法区间 1..100000）拒绝而脚本把 48 字符错误当输出，算出 −60808% 的荒谬数字——现被拒档位单列、不参与节省计算。
- **票 16（E-M5 自愈率 2→3；E-M2 仍 2）**：模型在环一轮（`deepseek-v4-flash`，20/20 调用，native tool calling）。**E-M5 = 7/7 = 100%**（口径：只有真失败的 7 个场景计入——另 3 个"首次调用其实没失败"的场景已剔除并标注）；**E-M2 误调率 60%（4/10）仅作前向基线，不声称 3 分**，且报告指出该数字主要被 `instructions` 的"list_repos first"指令污染（6 次选错中 5 次是选 `list_repos`），要拿 3 分须先改测量协议。
- **记账**：spec §4 票池加 12–16 与 **E-M\* 命名约定**；`CONTEXT.md` 增「交付指标 M1–M5 / 评估维 E-M1–E-M12」词条（两套编号撞号，文档一律带前缀）；`probe.py` 复算对照：结构化日志 **73 → 122**、工具schema 35→47、上下文治理 61→69、MCP服务端 19→20；E-M7 的 `幂等键` 5→5 系探针按设计排除测试文件，其 3 分证据由票面与契约表承载（已登记）。

**门禁状态如实说明**：本批六条新断言（issue12 审计 / issue14 通用套件双向 / precision-ratchet / readme 两条）全部通过；收口时本机 gate 为 **68 passed / 2 failed**，两条失败均为 `incident SSE` 与 `chat SSE`，根因是 **provider 返回 HTTP 402（额度不足，独立探测确认）**而非代码——CI 无 `.env` 时该两检查走确定性降级，最近 6 次 CI 全绿为证。额度是否被票 16 的模型在环实验（40 次调用）耗尽**无法确定**；**复跑实验与本地全绿门禁都需先恢复额度**。是否让 e2e gate 支持 stub 回退（Release 冒烟门已有 `scripts/smoke/stub-llm.mjs`）属门禁语义决策，待裁定，本批只登记证据。

## [0.30.0] - 2026-09-16

### Highlights

- **去极客化战役（v0.30 票池 G1–G8，`.scratch/v030-degeekify/`）**：承 2026-09-12 用户反馈「太工程化/极客」，grill D1–D8 定案「主战役包」射程——文案+视觉，零行为变更铁律全程守住。(1) **G1 双哨基建（销 V27-10）**：黑名单权威词表升格 `packages/contracts`（`USER_COPY_BLACKLIST` + `USER_COPY_ENGLISH_RETIRED`，web copy-guard 与控制面 `copy-guard.server.test.ts` 物理共表）；英文退役词判据从 2 个 testid 位点升为「JSX 文本节点+字符串字面量」区域扫描（注释/标识符免疫，注入/免疫/活性三证防空转）；服务端文案哨首立（agent 提示词/chat routes/export 模板/worker 中文 label 四面，burn-down 挂账+区域活性判定防僵尸豁免）。(2) **G2 字号降密（销 V27-11①）**：111 处任意值字号收两档——11px→text-xs(12px)、9/10px→新语义档 text-micro(10px)，`grep text-\[Npx\]` 归零（Monaco/SVG 豁免登记）。(3) **G3 chrome 中文化（销 V27-11②+V27-14）**：~55 英文短语全量人话化（文件监视/导入仓库/快速导览/结构规模/上下游/基线引用…），工程通用语保留清单（HTTP 动词/语言名/API/Git/Token/LLM/品牌）；空态降噪（接口零数不印计数、浏览提示中文化）；英文退役表首批 38 词入表；导出模板标题中文化随本票代偿（「架构指标」挂账首摘）。(4) **G4 枚举展示映射+徽章双件（销 V27-11④）**：契约值零动，`client/statusLabel.ts` 统一映射（已验证/断链/存疑/通过/未通过/低中高 风险/扩展挂载/安全下线/增改删+惯例五轴+role）；9 徽章家族收进 `ui/Badge`（6 tone×mono×outline）+`ui/CountPill` 双件，testid 逐文件集合比对零改名。(5) **G5 黑话清扫（销 V27-11③）**：波及→影响、落位→方案系、锚定→定位、孤岛→孤立代码、工件→方案卡/方案流、演进推演→方案生成（了结「前端哨禁词、服务端在用」的闸门冲突活例）、AST 提取→代码解析、2-Hop→上下游；前端 STAGE_LABEL 与控制面 worker 中文 label 双侧同步（stage id/契约零动，五阶段 SSE 断言绿为证）；黑名单扩 16 词，扩表先行残居自报（60 处全在测试，fixture/断言/注释同票清）。(6) **G6 styles.css 销号（销 V27-11⑤）**：85 行 4 段全量迁 Tailwind 语义类（rgba 硬编码色退场、自动跟双主题），mermaid 伪元素角标 BROKEN→断链，`--shadow-neon` 去字面量复刻改 token 引用，A02 时代语义别名层八枚随消费者退役——全仓视觉语言只剩 index.css 一套 token 源。(7) **G7 命名族归一（销 V27-2/3/4）**：agent 系统提示词「拆除计划」→「下线方案」（显式保留删除/清理/下线同义触发词，工具灵敏度零回归）；README 五处、CONTEXT 八词条+新增「用户文案规范（User-Facing Copy）」词条；CiGateView 导览三段化；ADR 正文「模式嗅探」不改写（历史记录），术语演化由词条曾用名承载；cp 挂账清零。(8) 验收三轨：运行时文本门（六视图 innerText：退役词/英文 chrome 零命中+中文 chrome 在场）、双视口布局几何门（裁切/溢出/横滚零回归）、11 页实拍 PNG（`D:/zcode-tmp/v030-shots/`，视觉眼检移交 maintainer）。

### Added

- `packages/contracts/src/copy-blacklist.ts`（`USER_COPY_BLACKLIST` 23 词 + `USER_COPY_ENGLISH_RETIRED` 38 词——双哨共表权威）。
- `services/control-plane/src/copy-guard.server.test.ts`（服务端文案哨：全文扫+字符串区域扫+burn-down+灵敏度自证）。
- `apps/repoqa-web/src/client/statusLabel.ts`（+3 例测试）、`components/ui/Badge.tsx`、`components/ui/CountPill.tsx`；tailwind `text-micro` 档。
- CONTEXT 词条「用户文案规范（User-Facing Copy）」。

### Changed

- Web 界面 chrome 全中文化、机器枚举出中文徽章、字号两档化、导出 ONBOARDING 模板标题与表行中文化（契约字段不动）。
- 控制面演进 SSE `label` 中文化（`stage` id 与事件序不动）；chat 系统提示词措辞更新（触发语义不变）。

### Removed

- `apps/repoqa-web/src/styles.css`（85 行）及其语义别名层八枚 CSS 变量。

### Tests

- 基线：control-plane **650**、web **363**、bridge 26、e2e 62 checks（含版本一致性门与 golden eval 97 题零翻车）；UI 冒烟四链路绿；新增运行时文本门/布局几何门/实拍 gallery 三轨视觉证据。
- 新发现立账 **V30-9**：e2e gate 在根 `.env` 在场时实走远程 LLM（外网慢=红位漂移），hermetic 化留后续（对照组纪律：清空 `REPOQA_LLM_*` 跑 gate）。

## [0.29.0] - 2026-09-16

### Highlights

- **安全+韧性收口批（v0.29 票池，`.scratch/v029-resilience-hardening/`）**：承 2026-09-12 生产就绪度评估与 v0.27 台账 V27-18..23，七票全落；两处授权假设（V27-20 拆票、V27-21 强尺统一）经用户批准执行。(1) **T1/V27-21 掩码强尺统一（P0）**：14-pattern `maskSensitiveText` 升为唯一「出库权威」——chat 摘要换尺、scan 超限分支改 parse masked（raw 旁路关死）、native tool loop 成功路径补上侦察新逮的第四把「零尺」裸面、3-pattern 弱尺 `maskSecrets` 整函数废除；CONTEXT.md 新增「出库掩码不变式」词条。(2) **T2/V27-18 clone 网络瞬断重试**：`isTransientGitFailure` 永久优先分类器（authentication/403/not found/timed out 不重试）+ `cloneGitRepo` 内聚 1s/2s 双指数退避 + onRetry 落日志。(3) **T4/V27-22 深链展示面对齐**：`config.ts::cockpitBaseUrl` 单一权威（displayHost+port 与 R4 绑卡规则同源），MCP 五处硬编码 localhost 统一改引；closeout gate 深链断言同 commit 成对改判据。(4) **T3/V27-20 前半**：EvolveStream 改走注入 `TimedFetch`（15s 首字节预算生效 + hang→onError 回归钉）；后半 import 202+WS 化拆新账 **V29-1** 挂账不排期。(5) **T5/V27-23**：StatusStepper 进度条常驻不清——RepoContext 补目录轮询复位 effect（当前仓离开 active 三态即清）。(6) **T6 异名对收口**：`Anchor` re-export 等值消亡手工镜像；web 名不符实的 `IndexingProgress` 改名立实 `StepperProgress`（步进条诚实窄化投影，wire 真身 `RepoQaIndexProgress` 原名直出——计划中的 re-export+兜底路线会引入 phase 全集运行时问题，偏离经票面记录裁决）。(7) **T7/V27-19 企业套件裁决销项**：/metrics、外置告警、fail-fast+.env.example 三项按 Local-First 身份全不做，重评触发条件登记在票面。

### Fixed

- LLM 出库面凭据泄漏残余通道（chat 摘要/scan 超限摘要/native 工具结果三面统一过 14-pattern 强尺）。
- clone 网络瞬断一次即败：瞬断类 2 次指数退避重试，永久类错误（鉴权/404/超时）直抛不重试。
- SIGTERM 优雅关闭回归钉（V27-31 遗产）在 CI 两平台的 flaky：shutdown/bind 用例预算相撞类修复（测试级 timeout 15s、观察窗 8s，真挂死仍 8s 内报 hung）；runner segfault 类以重跑裁决，两类纪律入 spec。

### Changed

- MCP 深链宿主跟随控制面实际绑定面（默认 127.0.0.1），不再恒印 localhost。
- web 类型面：`IndexingProgress` 语义收窄为 `StepperProgress` 本地投影，wire 真身单一源化。

### Tests

- 基线：control-plane 644、web 356、bridge 26、e2e 62 checks；golden eval 97 题随 T1 重跑零翻车；UI 冒烟四链路绿。

## [0.28.0] - 2026-09-15

### Highlights

- **全模块验证驱动的结构治理批（B 批四票，v0.28，`.scratch/v028-engine-refactor/`）**：承 2026-09-14 全模块独立+集成验证与 grill 定案（结构轴、零行为变更、全门禁护航）。(1) **B1/V27-28** bridge-adapters 从「仅 typecheck」到 26 例单测进 CI matrix（4 适配器生命周期/事件序列/取消短路/shell 真实子进程，零 token 零外网；`StubAdapter.type='shell'` 按现状钉死注明）。(2) **B2/V27-29** web→contracts 类型单一源手术：types.ts 16 个手工镜像型改 re-export（TokenUsage=RepoQaTokenUsage 别名桥、delta 族异名别名、ImpactedApi 派生自 Report），先考古后动刀 tsc 一次收敛。(3) **B3/V27-30 前三段**：worker-helpers.ts 外迁头部 280 行纯函数+re-export 桥（95a2860）；registerAnalysisRoutes 515 行巨注册拆 graph/gate/stream 三域+23 行组成根（720e85f）；diagram 簇 232 行抽 `WorkerDiagram` 协作者（DiagramContext 双缝注入 symbolIndexFor/findStartSymbol，b23ba54，新增 4 契约钉）。(4) **B4/V27-30 第四段** repoqa-* 目录归组：42 文件 `git mv` 入 `ingest/ engine/ mcp/ eval/` 四子域 + 78 文件 import 重写（vi.mock 字符串路径=import 之外的第二解析通道，教训入票 04），根级集成测试有意留根。

### Added

- `packages/bridge-adapters/src/adapters.test.ts`（26 例）+ vitest devDep + 根 `test:bridge` 脚本 + ci.yml matrix 步骤。
- `services/control-plane/src/ingest/{worker-helpers,worker-diagram,worker-diagram.test}.ts`、`engine/`、`mcp/`、`eval/` 四子域结构。
- `contract-mirror.test.ts` 棘轮升级：web 手写定义 ∩ contracts 导出名 = ∅（白名单仅 TokenUsage），手工重镜像回潮即红。

### Changed

- web `types.ts`：16 型 re-export contracts（`import type` 构建期擦除，bundle 零增量）；EvolutionView `injection.signature` 死分支删（服务端恒发 codeSnippet）；EvolutionView.test fixture 补 `transactionBoundaries: []`。
- `repoqa-worker.ts` 2556→2087 行（工具外迁+diagram 委托）；`routes/analysis.ts` 515→23 行组成根；src/ 平铺文件 −42。
- `package.json` eval 脚本、`closeout_gate.py` eval_ts、`profile-index.ts` import 随目录同步；ci.yml e2e-gate job 名「33→62 checks」修正。
- 分工留档：Mimosa 拦 bash 层 git mv/mv/rm -f——纯改名移交用户本机 .cmd，内容重写全走 Write/Edit 受扫描通道。

### 质量门（v0.28.0 基线）

- 控制面 **634→638**（diagram 契约钉 +4）、web **351→354**（哨升级 2→5）、bridge **0→26**（新建）、e2e **62** 维持、UI 冒烟全链绿、docker 全层重建+容器 /health+SPA 200、`tsc --noEmit` 四包净；bridge-adapters 独立 0.6.0 版本线维持不牵连。
- 搬家大提交 CI 三平台矩阵+docker-build+e2e 远端全绿（327a35b）；票面账 `.scratch/v028-engine-refactor/issues/01-04` 全 closed，总账 V27-24..31 全线划销。

### 契约稳定性

- MCP 17 工具面零变化；REST/SSE 端点形状零变化（目录重组全在 import 层，`repoqa-worker.ts` re-export 桥守住全部既有导入路径；vi.mock/动态路径同步清）。
- 结构手术零行为变更验收方式固化：tsc 清单驱动收敛 + 638/e2e 62/UI 冒烟/docker 实跑护航，每段独立 commit 可回滚。

## [0.27.0] - 2026-09-14

### Highlights

- **生产就绪度批（v0.27-B R1–R7，`.scratch/v027-production-readiness/`）**：五维评估（容错/日志/配置/监控/错误处理）差距逐项收口。R1 全局 error 中间件+asyncHandler 13 处（async rejection 不再悬挂、500 一律 JSON 且堆栈不出网）；R2 传输层韧性（fetch 首字节预算分层 + WS 指数退避自动重连）；R3 错误码契约五面 28 稳定码入 CONTEXT 权威表 + chat 人类化；R4 **控制面默认绑 127.0.0.1**（见 Breaking）；R5 服务端最小日志 sink（dataDir/logs jsonl，级别+轮转+retention+fail-soft）；R6 /health 深检（DB/dataDir 探针+TTL）+ /api/runtime 进程指标（仅回环）；R7 UI 冒烟进 Release 门（真 chromium 四链路 + stub LLM 零 token，销 V27-13）。
- **UI 对话补课批（v0.27-UI 三票）**：ChatView Tailwind 对话界面落地（骨架 CSS 从未存在的补课）+ AskDock 全局常驻对话条（「问现状」心智落到物理位置）+ **chatGuardSend 把 repoId 当 sessionId 的 P0 修复**（真实前端 chat 自 v0.25 批3 全坏，computer-use 走查抓包；330 单测全绿零拦——该事故直接催生 R7 冒烟进门）。
- **全模块验证收口批（本批 A1–A4，2026-09-14 逐模块独立+集成验证的产物）**：Docker 镜像恢复可构建并进门禁、版本单一源、契约镜像守卫哨、web flaky 根治。

### Breaking

- **控制面默认绑定 127.0.0.1**（R4，销 V27-1）：零鉴权服务不再默认全网卡可达；LAN 展示场景须显式 `MHW_CP_HOST=0.0.0.0`（启动日志告警），Docker 镜像内部预设逃生。`--network host` 无 -p 把门，慎用。
- **Docker 基座 node:20 → node:24**（A1/V27-24）：与 `engines>=24` 契约对齐；`/health` version 字段自 `0.6.0`（v0.6 时代硬编码残留）起回显真实产品版本（A2/V27-25）。

### Added

- **A1（V27-24）**：Dockerfile 补 `COPY packages/ packages/`——镜像自 monorepo 化后从未构建成功（esbuild `Could not resolve ../../../packages/bridge-adapters/src`），CI/Release 亦从未构建故无人知；`ci.yml` 新增 `docker-build` job（构建 + 容器内 /health 冒烟），monorepo 引用漂移自此有门。
- **A2（V27-25）**：`services/control-plane/src/version.ts` 版本单一源（cli/server 共引，e2e 检查射程从 cli.ts 挪至此处）；e2e `check_versions` 扩射——新增 Dockerfile `FROM node:N` == engines 下限断言、`/health` payload version == 常量断言（60→62 项）。
- **A3（V27-26）**：`contract-mirror.test.ts` 镜像守卫哨——web `types.ts` 与 `packages/contracts`（src/repoqa.ts + v1.ts）共享类型名集合钉死为 16 项关注清单，任何一侧新增/删除镜像类型而未显式登记即红（字段级等值留 V27-29 单一源手术）。
- **R5/R6 面**：`ServerLogger` 日志 sink、`/health` `checks` 三态（ok/error/skipped+TTL）、`/api/runtime`（llm mode 掩码 + uptime/rss/indexingJobs，非回环 403）。

### Changed

- `/health` version 改由 `version.ts` 单一源驱动（旧值 `0.6.0` 为 server.ts 硬编码残留，e2e 版本一致性检查历史上不覆盖该端点——盲区已随 A2 封堵）。
- `types.ts` 头注改准：历史上它自称 mirror `contracts/src/repoqa.ts`，实际 `Repo`/`RepoStatus` 族镜像的是 control-plane HTTP 载荷（`repoqa-repos.ts`），contracts 只覆盖 delta/radar/evolve 等 16 型——注释误导一并修正。
- web `MermaidDiagram.test.tsx` BROKEN 用例断言包 `waitFor`（A4/V27-27）：文件内唯一裸正向注入断言，对 `[svgHtml, traceSteps]` 两段链式 effect 的提交时机敏感，全量并跑偶发红（首轮验证亲踩），对齐姊妹用例模式根治。
- **R7 冒烟「R2 锁」断言升级 + 由此坐实的产品级优雅关闭挂死修复（V27-31，v0.27.0 Release CI 首跑实战）**：旧判定赌 `status-progress` DOM 出现时机（重连/广播帧/React 提交三方赛跑），ubuntu headless-shell 上两轮皆红而同期服务端 reindex 落定绿、且失败无诊断。`ui_smoke.mjs` 重建为双证据源时间戳判据——页内 `__wsLog` 探针（`addInitScript` 记录 /ws 的 open/close/message + `__pageId` 反证未刷新）+ Playwright CDP 级 `page.on('websocket')` 跟踪（不经页面 JS，reload/崩溃骗不了），按 killTs 窗口合并裁决；确认重连（新 open）后才 POST reindex（消灭「202 早于重连即丢帧」），`repoqa.index.progress` 帧到达为主证据，DOM 进度条降级附加信息（渲染时机属 V27-23 面），失败必 dump 双源时间线。断言语义（未刷新+重连+收到进度）不变。
  - **真 bug（双源诊断把「flaky」证成缺陷）**：SIGTERM 优雅关闭里 `RunningServer.close()` 的 `wss.close()`+`server.closeAllConnections()` 均**不销毁已升级的 WebSocket 连接**（ws@8+Node24 探针实测：close 回调不触发、客户端无 close 事件），故 `await server.close()` 永挂、进程到不了 `process.exit`——半死进程攥着 `/ws` socket，浏览器既收不到 `close` 也永不重连，R2 无机会表演。Windows `child.kill()`=TerminateProcess 强杀完全掩盖；Linux CI/`docker stop` 走优雅路径才暴露。**修复**：`server.close()` 前 `for (const c of wss.clients) c.terminate()`（探针：修复后 close 回调即 resolve、客户端可观察 close）。**回归钉** `server-shutdown.test.ts` 三例 + 变异检验（拆 terminate→2/3 红报「close() hung」、复原→634/634 绿）。

### 质量门（v0.27.0 基线）

- 控制面单测 **588→634**（R 系列 + UI 批 + open-browser P1 1 + server-shutdown V27-31 3）、web **320→351**（+本批镜像哨 2 + flaky 复钉）、bridge-adapters **0→26**（V27-28 首建单测）、e2e **60→62**（版本/health/基座三扩）、UI 冒烟真 chromium 全链路绿、docker 实构建+容器 /health 冒烟绿、`tsc --noEmit` 四包净；bridge-adapters 独立 0.6.0 版本线维持未被牵连。
- 收口依据：2026-09-14 全模块独立验证（四包 typecheck/build/单测/启动全绿）→ 集成验证（e2e 60/60、UI 冒烟 PASS、MCP stdio 实连、npm CLI doctor）→ 破损清单四张入册（V27-24..27，`.scratch/v027-production-readiness/issues/08-11`）。

### 契约稳定性

- MCP 17 工具面零变化；REST/SSE 端点形状不变（`/health` 仅 version 值修正 + R6 checks/runtime additive；R4 改默认绑定面属部署契约，载荷形状无变化）。
- 台账：V27-24..27 随本批关闭；V27-28..30（bridge 单测、web→contracts 单一源、control-plane 结构轴手术）入 v0.28 候选池。

## [0.26.0] - 2026-09-12

### Highlights

- **门禁运行史（v0.26-B 三票，ADR-0017）**：变更审计（CiGateView）从纯静态展示升级为「配置→执行→回看」工作台内闭环。(1) **B01 数据面**：新表 `gate_runs` + `gate_run_routes`（子表物化受影响路、`ON DELETE CASCADE`、策略快照不回溯、dirty 独立流 Q12），单一写入口 `saveGateRun`（表+子表+`gate.run` event 同事务），`POST /api/repos/:id/gate/run` 服务器端跑 `analyzeDiff`+`evaluateDiffPolicy` 并落库、`GET /api/repos/:id/gate-runs` newest-first 回放——历史语义=**服务器端执行史**（非 CI 遥测；CLI `--report-to` 降为预留 additive 口）。(2) **B02 三段化**：视图纵向三段（现状区不动→「运行并记录」→「门禁运行史」表），策略旋钮升级为 runGate 入参，PASS 绿/FAIL 红/dirty 徽章 + 行内趋势 div 条（零图表库，dirty 从标尺过滤），400 失败走票 14 错误面且折叠原始输出。(3) **B03 受波及树**：展开历史行→route→symbols 两层 + 风险徽章（HIGH 红/MEDIUM 橙/LOW 灰），route 节点点击跳 Inspector（票 11 navSeq 契约复用），blob 防御解析逐元素把关（对象叶不崩树）。
- **问答/演进口心智分离（v0.26-A 四票）**：确立产品语言 canonical 对子「**问现状**→架构问答 / **要方案**→规范演进」，共享底线「引擎只读，改动由你执行」在两入口与产出物常驻。(1) **A01** 定位句落地读侧动线（TopBar tooltip 含补修 `title` 从未挂 DOM 的死配置、ChatView 去「助手」+「新对话→新会话」+空态底线句、Canvas 空态两动词前置、Dashboard「提问→查调用链」只改名不改接线）。(2) **A02** PlanCardView 重塑为「方案摘要」（Plan Digest）：底线升头部常驻 + CTA「在规范演进中展开→」跳 evolve；**实拍发现并接线 styles.css**——该文件自 446473d 创建即漏挂加载链、chat 样式从未生效（monaco #12 同型），一并补齐 8 个缺失 CSS 变量别名。(3) **A03** 演进侧工件命名族归一（惯例冲突/落位表/死代码清单/风险 Checklist/拆除清单按 intentType 收口、Sidebar 中文门牌）。(4) **A04** 文案回归哨总闸：`copy-guard.test.ts` 文件系统级 grep 八词黑名单零命中（含注释、拆分构造自豁免）+ 两视口截图人工核对。

### Added

- `gate_runs` / `gate_run_routes` 表 + `saveGateRun`/`listGateRuns` store 方法 + `POST gate/run`/`GET gate-runs` 路由（复用 `requireRepo` 守卫与 `resolveRepoCommitSync` 三态）。测试 `repoqa-gate-runs.test.ts`；e2e 新增五条落库/回放/event 双写/票 14 契约/失败行入库存活断言（55→60）。
- `RepoQAClient.runGate`/`listGateRuns`、`GateRunRow`/`GateRunPolicyOptions` 类型镜像；CiGateView 三段化与行内两层受波及树（expandedIds 多行独立、切库清空）。
- `PlanCardView` CTA `onOpenEvolution`（可选 prop，无回调不渲染保既有挂载点零破坏）；`copy-guard.test.ts` 三例（黑名单/门牌/存在钉）。
- ADR-0017（gate 运行史=服务器端执行史）；CONTEXT glossary 新增 问现状/要方案、Plan Digest、Gate Run 三词条。

### Changed

- 读侧动线文案：`TABS` 补 `title` 接线并修正 topo/metrics 两条从未生效的失实 tooltip（Mermaid 图/异常大文件→按组件现状）；ChatView/Canvas/EvolutionView/Sidebar/PlanCardView 命名族统一（详见 A01–A04 票 Comments）。
- `main.tsx` 挂 `import './styles.css'`；`index.css` 两主题块补 `--accent/--text/--muted/--danger/--warn/--ok/--border/--panel-2` 语义别名（治 `var(--accent)` IACVT 致 CTA 边框消失 + 存量 4 处误用）。

### Security（收口双轴 review P1-2）

- `analyzeDiff` 咽喉 + architecture-delta / gate/run 两路由前置 `^-` ref 守卫：挡 `git diff --output=<path>` 一类选项注入（server 绑全网卡无鉴权暴露面）；校验失败 400 不落 error 历史行、票 14 响应形状不受碰。127.0.0.1 绑定收敛与 LAN 评估立 `.scratch/v027-backlog.md` V27-1。

### 质量门（v0.26.0 基线）

- 控制面 **587→588**（analyzeDiff `^-` 咽喉守卫 +1 例；gate 注入断言并入既有用例）、web **284→320**（B 系列 +23、A 系列 +13，逐票加和票面可追）、e2e **55→60**、`tsc --noEmit` 净；bridge-adapters 独立 0.6.0 版本线未被牵连（六处 bump 核验通过）。
- 收口双轴 review：三硬约束（A01 只改名/B01 票14契约冻结/A04 两视口核对）逐条给证；跨票 CiGateView seq 守卫与树态正交、A01→A03→A04 文案链三闸同向；P1×2 现场修毕、P2×12 处置/登记（v0.27 台账 9 项）。
- **A04 人工核对**：`.scratch/v026-mind-split/qa/a04-shots/` 12 图 × 两视口，maintainer 眼验通过（含 chat 样式首秀、风险 Checklist 混排无 CHECKLIST 全大写）；截图台 `rig.mjs` 已加失败非零出口（收口 P1-1：杜绝「声称 12 图实存 11」）。

### 契约稳定性

- MCP 17 工具面零变化（gate 走 REST，未加 MCP 工具）；REST/SSE 既有端点形状不变（新增 gate 两表面 additive、`--output` 守卫仅新增一类 400）；`planCards`/`onPlan`/`chatSend` CM-04 载荷协议冻结面守住（A02 纯前端渲染重塑、零 services/client diff）。

## [0.25.0] - 2026-09-10

### Highlights

- **P0 工程结构批（v0.25.0 三批）**：两条 600+ 行巨石完成拆域，行为零变化——(1) `services/control-plane/src/http.ts` 1030 行按域缩为 ~110 行组装层（workbench/repos-catalog/analysis/repos-ingest 四组共 37 条路由），路由文件统一 `register(app, deps: HttpDeps)` 显式参数注入、子路由零 cross-import（批次 2 暗礁防御）；(2) `apps/repoqa-web/src/App.tsx` 650 行单体分片为 `context/` 三片（RepoContext / InspectorContext / ChatRuntimeContext），Provider 挂 `<App/>` 内部最外层、不迁 main.tsx，`render(<App/>)` 自带完整上下文（批次 3 暗礁防御）。
- **原生目录选择器（批次 1）**：Windows 下 `GET /api/dialog/folder` 拉起系统 FolderBrowserDialog（`-NoProfile -STA` 保 COM 线程模型、Form 置顶防被浏览器遮挡），契约 `{supported, canceled?, path?}`——非 Windows 返回 `supported:false` 前端隐藏按钮并降级手输；请求挂起时前端 15s 超时自动降级。根治"浏览器沙箱拿不到绝对路径"导致导入必须手打的痛点。
- **原生目录选择器（批次 1）**：Windows 下 `GET /api/dialog/folder` 拉起系统 FolderBrowserDialog（`-NoProfile -STA` 保 COM 线程模型、Form 置顶防被浏览器遮挡），契约 `{supported, canceled?, path?}`——非 Windows 返回 `supported:false` 前端隐藏按钮并降级手输；请求挂起时前端 15s 超时自动降级。根治"浏览器沙箱拿不到绝对路径"导致导入必须手打的痛点。

### 真实使用反馈轮（v0.24.0 tag 后落地，随本版发布）

- 首批六项（`8ac9bea`）：导入动线、空态导览、tab 重命名与悬停简介、chat 去黑话。
- 四步改造（`a53fdd5`）：按需抽屉、拓扑首屏即图、组件化问答初始屏、场景导览。
- Top3（`446473d`）：CM-04 拆除计划卡片化 v2（新增 SSE `plan` 事件与 PATCH `/api/chat/sessions/:id` 标题更新——本组端点变化属此轮而非重构批）、CM-03 会话标题摘要升级、CM-01 DSML 裁决（StreamLeakFilter 拆除，出口 stripTextToolCalls + done.answer 重写为防线）。
- F-02（`769c78c`）：LLM .env 发现在 cwd 漂移下硬化。

### Added

- `services/control-plane/src/dialog.ts`：`pickFolderDialog()`——PowerShell execFile 常量脚本（零用户输入拼接）、空 stdout=canceled、spawn 崩溃/超时降级 canceled 不拒绝；单测 5 项（STA 参数/路径解析/取消契约/崩溃降级/超时降级）。
- `ImportRepoModal` "📁 浏览文件夹…"按钮：选中即填路径+自动 preview+自动填名称；取消静默；不支持平台显示手输说明。
- e2e gate 零新增断言（纯重构轮）：批次 2 验收 = 原 55 项全绿证明路由注册顺序行为契约不变。

### Changed

- `services/control-plane/src/routes/{deps,workbench,analysis,repos}.ts`：HttpDeps 与 `ACTIONS` 上收 deps.ts；repos 拆为 catalog（读取面）与 ingest（导入/preview/dialog/delete/reindex/clone/file-raw）两函数，以保住原注册顺序（catalog 在 analysis 前、ingest 在 events 后）。
- `apps/repoqa-web/src/context/`：RepoContext 持有 catalog/符号/导览/仪表盘/视图路由/URL 同步/FS-watcher 热更新；InspectorContext 持有文件符号导航/2-Hop 反查/子图/移动抽屉/命令面板聚焦/拷贝脱敏提示；ChatRuntimeContext 持有 runtime 探测/consent 门/程序化调用链/演进流/首屏自动 trace。
- `RepoQAClient.pickFolder` 调用方法 POST→GET，与路由对齐（批次 1 遗留错位顺手修）。
- 双轴 review + QA 定点回归修正（v0.25 批内）：**QA-01 [P0]** TopBar 未透传 `onPickFolder` 致浏览按钮在交付构建恒不渲染（批次 1 自带缺陷、组合层零覆盖）——补透传与 2 条 TopBar 集成测试，真实 Chromium 双画像复核（Win32 渲染 / 非 Win 隐藏）；dialog 端点防御兜底不再外泄错误字符串、严格守住响应契约；ImportRepoModal 落实 15s 超时降级与非 Windows 隐藏按钮；dialog 单测补 execFile 超时 killed 降级用例；routes/deps.ts 清除死 import。
- MCP 17 工具契约零变化；批次 2/3 为纯重构轮——REST/SSE 端点与响应形状零变化，该两批验收时 270 条 web 测试与 579 条控制面测试断言零修改全绿（断言文案改动只发生在真实使用反馈轮，属其自身验收范围）；收口 QA 修复后基线 web 272 / 控制面 580。

## [0.24.0] - 2026-09-07

### Highlights

- **chat-merge：对话式智能体融入 Workbench**——compass-copilot 框架毕业进主线（`services/control-plane/src/chat/` 六模块），Web 端新增"智能体对话"tab（ChatView 替换 incident 排障卡流），CLI 新增 `codecompass chat [path]` REPL 子命令。编排层进程内直调引擎 handler（InMemoryTransport，零子进程），17 工具面自动派生，回答带 [cite: N] 溯源且角标可跳转拓扑定位。QA 三轮淬炼的防线全部随迁：文本假调用泄漏过滤、空答案重试、会话级串行、悬空 cite 剔除、SSE 断连韧性。
- **决策记录**：`.scratch/chat-merge/spec.md`（grill 六问裁决 + 四层验收标准）；incident 深链 `?mode=incident` 兼容重定向至 chat；独立 `chat_sessions`/`chat_messages` 表与 workbench_cards 工件回放语义分离（ADR-0001 #2）。

### Added

- `codecompass chat [path]` 子命令：终端对话 REPL（/tools /model /status，模型热切换）
- `/api/chat/status|sessions|model|sessions/:id/messages` 路由组（SSE delta/citations/done/regenerate）
- e2e gate +3 项：chat 会话创建、SSE 回合（open/citations/done，确定性 fallback 即合约）、双表隔离

### Changed

- IncidentView 退役（Q1 吸收式裁决）：排障场景由 chat 承接（超集能力），Canvas 纯拓扑与 evolve 工作台不变（v0.21 裁决延续）
- MCP 17 工具契约零变化；外部消费者（IDE/autoApprove）无感知

## [0.23.0] - 2026-09-07

### Highlights

- **scan 信号提纯第二轮（dogfooding issues 04 + 06）**：spring-petclinic 取证显示孤儿桶 top10 约 9 成是 DI/入口假阳性且 nextAction 引导去 DEPRECATE 拆除（危险），hubs 榜首是 getter——本版把两类噪声从榜单清除，候选只留真实的死代码线索。
- **孤儿桶 wired 过滤**：携带 `@Bean`/`@FeignClient`/`@EventListener`/`@Configuration`/`@SpringBootApplication` 的符号与 `main` 入口（Java/Go 通用）不再进孤儿桶候选与 total，改由新增的 `ScanBucket.wiredExcluded` 计数单列（contracts additive optional，零破坏）。note 同步披露，DEPRECATE 引导与 note 的矛盾消除。白名单常量与 `wiredKindOf` 集中在 scan-engine，供多语言复用。
- **hubs 榜单 accessor 降权**：`^get/^set/^is` 命名且方法体 ≤5 行的 accessor（如 petclinic 榜首 `Vet.getSpecialtiesInternal`、`Visit.setPetId`）不再占 hubs 榜单与 total——它们 PageRank 高只因每次读写都路过，无重构信号。双条件保护 `getOrCreateX` 类带真实逻辑的方法不误伤；PageRank 全图计算不动，仅滤榜单展示。

### Dogfooding 遗留与归属

- 取证与决策记录：`.scratch/scan-purify-v023/spec.md`（grill 定案：LLM 节点池热切换**整件归智能体工作台线**——worker 会话编排在那边，本线保持纯 MCP 分析工具面）。
- 遗留（后续增量候选）：方法体级 AST 提取器（backlog #1，oversized 桶从行跨度代理升级为真实复杂度度量）；Go 跨文件类型引用（`declaredTypes` 按文件，跨文件 `g *Gui` 不绑定——lazygit 孤儿率残余噪声主因）。

## [0.22.0] - 2026-09-06

### Highlights

- **scan dogfooding 回访闭环（issue 01/02/03/05）**：用真实仓库（lazygit Go 45k 符号、spring-petclinic-microservices Java 多模块）压测五桶后修掉四个硬伤——(1) `IGNORED_DIRS` 补 `vendor`，lazygit 44% 的 .go 文件（第三方/生成代码）不再污染 hubs/oversized/oversizedFiles 榜单；(2) Go 裸调用与 import 限定调用（`pkg.Func`）从 dynamic 改为静态解析，新增 `resolvePkgQualifiedCall` 确定性桥 + 同目录优先的名字兜底，lazygit 孤儿桶 43% → 31%，lazygit 实锤误报 `Run`（entry_point.go:177 有真实调用点却报零调用者）消灭；(3) `isTestPath` 补 `*.test.ts(x)`/`*.spec.*`/`*_test.go`/`test_*.py` 文件名模式（此前只认 Java 目录式路径），并让 worker 复用同一实现；(4) 空桶 `nextAction` 不再指向"对不存在的候选运行某工具"（lazygit deepChains 空桶引导失效），改为中性说明。

### Fixed

- issue 01（dogfooding）：`vendor/` 加入 `IGNORED_DIRS`（索引层排除），hubs / oversized / oversizedFiles 三桶不再被第三方符号占据。
- issue 02（dogfooding）：Go 调用边大面积丢失——`GoAdapter` 裸调用恒标 `dynamic`（`repoqa-callchain` 对 dynamic 跳过名字解析），包级/跨包调用边全不可见。修复分三层：裸调用 `dynamic:false`；`RepoSymbolCall` 新增可选 `pkg` 字段（限定符来自 import 块），`resolvePkgQualifiedCall` 按目录名唯一匹配解析；名字兜底加同目录优先（Go 包作用域语义），修掉同名符号跨包误绑（lazygit `Run` 曾绑到三个包之外的 `IntegrationTest.Run`）。`trace_call_chain`/`diagnose`/`refactor_plan` 共用此解析器，同步受益。
- issue 03（dogfooding）：`isTestPath` 只认 `/test/`、`test/java` 目录式路径，TS/Go/Python 测试文件全部漏过——本仓库孤儿桶 top10 有 8 个是 `App.test.tsx` mock 方法。补文件名模式后统一为单一实现（移至 `repoqa-callchain`，`diagnose-engine` 转发导出，`repoqa-worker` 删除私有镜像改为复用）。
- issue 05（dogfooding）：空桶 `nextAction` 引导失效（lazygit deepChains `total:0` 仍提示 "Run codecompass_diagnose on an entry"）。空桶返回中性文案，字段恒存在，零契约变更。

### Dogfooding 取证与遗留

- 取证报告与 issue 分流：`.scratch/scan-dogfooding-v021/`（spec + issues 01–06）。环境基线 HANDOFF §6 全绿后取样。
- 遗留（needs-triage，未入本版）：issue 04 孤儿桶 DI/入口点假阳性（petclinic `@Bean`/`@FeignClient`/`main` 进候选，nextAction 有 DEPRECATE 危险引导）；issue 06 hubs 桶 getter/setter 占榜。Go 跨文件类型引用（`declaredTypes` 按文件，`g *Gui` 跨文件不绑定）是孤儿率残余噪声的主因，与 issue 04 一并设计。

## [0.21.0] - 2026-09-05

### Highlights

- **Issue 25 Copilot 整合收官（Ticket 01–04）**：IncidentView 重建为卡流时间线、Canvas 回归纯拓扑工作台（Ticket 01）；演进感知 MCP 工具 `codecompass_get_conventions`/`codecompass_plan_evolution` 落地，工具面 15 → 17，`module_evolution` 转为向后兼容别名（Ticket 02）；工件卡首次服务端持久化——`workbench_cards` 按 (repoId, commit) 流落库 + `GET /api/repos/:id/workbench-cards` 回放 + 前端切桶自动 hydrate（Ticket 03）；版本收口与 CHANGELOG 重排（Ticket 04）。
- **codex 真实使用反馈闭环**：codex（Python+React 仓库 dogfooding）靠逐文件阅读才发现的文件级技术债（"db.py 47 KB 是技术债"），scan 现在直接给出——新增第五桶 `oversizedFiles`（索引符号覆盖跨度 ≥600 行的文件，top-10 + 全量 total + 跨度/符号数 detail）。它专补方法级桶的盲区："很多中等方法堆成的大文件"。
- **定位显性化**：README 新增"给 agent 的确定性检索层"定位声明（精确检索工具而非理解工具、上下文经济性、大仓库优先）；scan/dashboard 工具 description 补上下文经济性引导；CONTEXT.md Candidate Scan 词条更新五桶 + 定位红线（scan 只报事实，判断属 agent）。

### Added

- **Canvas 拔气泡 + Incident 卡流重构（Issue 25 / Ticket 01）**：Canvas 精简为纯拓扑工作台——props 裁到 repo/anchors/traceSteps/focus 链 8 项，通用聊天气泡（composer/MessageBubble/chat-empty/totalUsage/流式状态五块）拔除，trace strip 保留重接线；外部焦点请求（Cmd+K/trace-step 跳转）激活时压制 trace-start 闪现，显式焦点唯一闪现。IncidentView 重建为卡流时间线：每问一张 IncidentCard（latest 默认展开/历史折叠可回看），卡内分阶段 reveal（stack 回显/answer/mermaid/证据/provenance/usage），break 标注与永久失败终态，crashTarget 从最新 done 卡证据解析；App 收窄 useChat 解构，incident 提交统一走 `evolutionSession.submitIncident`（与 evolve 双流互斥），EvolutionView 过滤 `kind==='evolve'` 共享 App 会话桶。`chat.test.tsx` → `incident-stream.test.tsx` 全量重写（12 测）+ IncidentView 8 测 SessionHost 模式。
- **演进感知 MCP 工具落地（Issue 25 / Ticket 02）**：`codecompass_get_conventions`（第 16 个）与 `codecompass_plan_evolution`（第 17 个）把 ADR-0014 的五轴惯例画像与演进规划直送 MCP 宿主——NLU 留宿主端，引擎只收物理意图；`ConventionConflictError` 在 MCP 层结构化捕获为 `{error, conventionConflict:{axis, verdict, coverage, anchors, suggestion}}`，与 Web worker 同构、禁裸异常（双端对等）。`codecompass_module_evolution` description 标记 Deprecated 前缀，行为不变向后兼容。
- `codecompass_get_conventions` MCP 工具（Ticket 02）：入参 repoId/targetSymbol?/nearPackages?，同步转发 `worker.runConventionScan`；nearPackages 兼容数组与逗号分隔字符串两种宿主方言。
- `codecompass_plan_evolution` MCP 工具（Ticket 02）：入参 repoId/intentType(EXTEND|DEPRECATE)/targetSymbolOrModule/extensionGoal?/nearPackages?；intentType 白名单校验 fail-closed，冲突走结构化载荷。
- MCP 冲突双端对等（Ticket 02）：`mcpPlanEvolution` 与重构后的 `mcpModuleEvolution` 均 try/catch `ConventionConflictError` 返回 `{error, conventionConflict}`；repoqa-mcp.test.ts 新增 makeConflictRepo 夹具 + 4 测（画像/规划/冲突拦截+双工具同构/intentType 与 Deprecated 前缀），29/29。
- `_McpSession`（gate 基建）：单 stdio 进程多轮 roundtrip——`codecompass_index_repo` 是 fire-and-forget（ADR-0016），进程被回收会让新仓库冻在 `indexing`；Issue 25 段全程共用一个活会话完成索引→就绪轮询→计时画像→冲突拦截。
- **工件卡服务端持久化与 Hydrate 回放（Issue 25 / Ticket 03）**：SQLite 新表 `workbench_cards` 按 (repoId, commit) 流落地演进/排查终态卡——`UNIQUE(repo_id, commit_hash, seq)` 幂等防线（显式 `INSERT OR REPLACE`，网络重放不双写），五处终态落库点（worker evolve done / evolve 惯例冲突 catch / incident LLM 与 fallback done、http 层双 catch 的 error 卡），落库对象一律过 maskEventPayload；SSE done/error 终态载荷披露服务端 `cardId`/`cardSeq`，前端采纳替换临时卡 id（模块级 `nextCardId` 计数器退役→`crypto.randomUUID()`）。`GET /api/repos/:id/workbench-cards?commit=` 按 seq 升序全量回放（缺省当前物理流 `repo.commit ?? 'unversioned'`，+dirty 原样存储天然隔离）；`useEvolutionSession` 切桶 hydrate 回放按 id 去重合并（incident evidence 由 `parseEvidenceFromAnswer` 从落库 answer+anchors 确定性重算，断线中断卡不回写）；`deleteRepo` 事务级联清理（一处覆盖 MCP `remove_repo` 与 HTTP DELETE 双入口）。
- `scan-engine.ts`：`oversizedFiles` 桶——按文件聚合索引符号的行跨度（纯索引副产品，零额外 I/O），`OVERSIZED_FILE_LINES = 600` 阈值导出；契约 `ScanBucket.id` 联合类型扩展。
- 测试：方法级盲区用例（3 个 210 行方法堆出 630 行文件，方法桶零命中、文件桶命中）；e2e gate scan 冒烟扩五桶断言。

### Changed

- `scripts/e2e/closeout_gate.py`：`check_mcp_composite_tools` tools/list 断言 15→17（含两个新工具名）；新增 Issue 25 五项检查——conflict repo 经 MCP 索引并轮询就绪、get_conventions 画像（含 5s 同步红线实测断言，实测 0.20s）、plan_evolution 结构化冲突拦截、legacy 工具同构对等。
- `codecompass_module_evolution` 工具 description 头部加 `[Deprecated: Superseded by codecompass_plan_evolution]`；入参/行为不变，向后兼容。
- e2e gate：新增 `check_workbench_cards_hydrate` 三断言（evolve done 载荷披露服务端 cardId/seq；hydrate 回放同 id 同 seq 同内容；conflict 流 error 卡回放含结构化 conflict）——用户裁决：Hydrate 冒烟提前至 Ticket 03 交付（repo spec 原文「扩项归 25.4」由本条取代）。
- 契约类型扩展（Ticket 03）：`RepoQaEvolveDone`/`RepoQaEvolveError`/`RepoQaQueryDone` 增可选 `cardId`/`cardSeq`（contracts src + v1 + web types 镜像三处）；web 新增 `WorkbenchCardRow` 回放行类型与 `RepoQAClient.getWorkbenchCards`（404→null 仿 getDashboard）。
- 测试：`repoqa-workbench-cards.test.ts` 新增 6 测（Evolve/Incident 混合顺序、显式 seq REPLACE 幂等、deleteRepo 级联、+dirty commit 隔离、2 条 HTTP 集成含「落库 JSON 与 GET 响应均不含敏感串」脱敏断言），control-plane 545/545；web hydrate 组件测试 3 条，284/284。
- 版本推进 0.20.0 → 0.21.0：root / `apps/repoqa-web` / `services/control-plane` / `packages/contracts` 四个 package.json 与 `cli.ts` `VERSION`、`repoqa-mcp.ts` `MCP_SERVER_VERSION` 六处（`packages/cli` 包不存在；`packages/bridge-adapters` 0.6.0 为独立版本线，不随主版本推进）。

### Notes

- Ticket 03 两处分歧裁决（以 repo spec 为准）：工件卡分列存储（echo/result/conflict/mermaid 独立列）而非单 payload blob；端点名 `workbench-cards` 而非 `workbench/cards`。列名 `commit_hash`（`commit` 为 SQLite 保留字，沿 db.ts `repos.repo_commit` 先例）。
- CHANGELOG 收口裁决（Ticket 04）：[0.20.0] 保持纯 Scan 引擎记录（336a26f 占用版本号），Issue 25 Ticket 01–03 条目自 [0.20.0] 收拢至本章节；oversizedFiles 第五桶与定位显性化（codex 反馈闭环）并入本版本。
- grilling 三问：定位=守检索（用户作答）；文件桶与定位叙事未获作答按推荐默认执行并记录（v0.6 先例）。

## [0.20.0] - 2026-09-04

### Highlights

- **`codecompass_scan` 自荐发现引擎（第 15 个 MCP 工具）**：补齐"陌生仓库该动哪里"的主动发现闭环——此前 14 个工具全部要求点名 targetSymbol，scan 首次让引擎主动回答"该看哪"。四桶候选全部确定性产出（零 LLM，ADR-0002/0005 同族）：`orphanedPublic`（零静态调用者的生产符号，排除 route 入口，note 声明反射/动态代理误报边界）、`hubs`（PageRank 波及热点，引导 refactor_plan）、`oversized`（≥150 行方法，行距为方法体级 AST 落地前的代理信号）、`deepChains`（最深入口链，引导 diagnose）。每桶 top-10 + 全量 total + file:line 锚点 + 确定性 nextAction。

### Added

- `services/control-plane/src/scan-engine.ts` + 测试：四桶引擎，一次 `buildRadarGraph` + `computePageRank` 复用（radar 图内建生产 kind 过滤与测试路径排除），`pickTopApis` 复用为深链桶；同仓库两次调用输出逐字节一致。
- `packages/contracts/src/repoqa.ts`：`ScanCandidate`/`ScanBucket`/`ScanResult` 契约。
- `codecompass_scan` 工具注册（同步查询契约——图已驻留内存缓存，毫秒级，不触发 ADR-0016 异步门槛）；`mcpScan` handler。
- e2e gate：scan 冒烟断言（四桶结构）+ 工具数 15 精确断言。
- CONTEXT.md 词条 Candidate Scan。

### Notes

- 立项访谈未获作答项按推荐默认执行并记录（v0.6 收口先例）：独立工具形态、四桶清单、同步契约、无 buckets 选择参数（Speculative Generality 防线）、挂载点桶推迟。

## [0.19.0] - 2026-09-04

### Highlights

- **演进工件会话流（Issue 24 / Ticket 05）**：EvolutionView 重构为会话式 append-only 工件卡流——`useEvolutionSession` 按 (repoId, commit) 分桶归组，同仓库同 commit 的演进结果追加成卡不互相覆盖，意图回声/工件卡/图谱卡随帧落入会话。
- **Intent Eval Bucket（Issue 24 / Ticket 06）**：golden eval 冻结集 75 → 97 题——新增 `evolve-intent`（14 题：DEPRECATE 动词族、EXTEND doc-chunk 桥、拉丁类名、显式路径锚定，覆盖确定性回退与 LLM 双路径的准确率与确定性）与 `convention`（8 题：repo-d 五轴实测值固化）两 bucket；`expectedAbsent` 命中即计幻觉，incident / evolve-intent / convention 三 bucket 幻觉率 0% 纳入 closeout gate 必查。
- **Closeout Gate 纳管演进管线（Issue 24 / Ticket 06）**：#15 `POST /api/repos/:id/evolve` SSE 五阶段顺序 + done 四工件结构（intentEcho / checklists / commit / 可选引擎 mermaid）；#16 STRICT 轴惯例冲突流式返回结构化 `conventionConflict`（计划的产出而非崩溃）；MCP tools/list 断言收紧为 ==14（含 v0.18 `codecompass_remove_repo`）。

### Changed

- 版本推进 0.18.1 → 0.19.0（root / cli.ts / MCP server / control-plane / web / contracts 六处）。
- `docs/adr/0013`：删除"迁移期披露"句——图层指令契约已落地，incident 模型自绘边不再是已知缺口。

## [0.18.1] - 2026-09-04

### Fixed

双轴 code-review findings（v0.18.0 发布后补审）修复：

- **幽灵防线位置与声明对齐**：第一处存在性断言移到 `saveFiles` **之前**（原实现靠 `foreign_keys=ON` 兜底、且会走 catch 广播 error 而非静默终止），与 ADR-0016 §4「写入前断言」及代码注释三方一致。
- **fire-and-forget 不再静默吞错**：`indexRepo` try 块之前的入口检查（fs.stat/upsert）若 reject，`.catch` 现在把 repo 行翻转为 `error` + 根因，消除"永久卡 `indexing`"的僵尸记录（ADR-0016 §3 禁止项）。
- **`list_repos` 的 error 字段过 `maskSensitiveText`**（ADR-0003）：错误摘要可能携带 git stderr/本机路径，流出前过敏感信息过滤器。
- **`matchedBy` 收窄为两值**：`graph-rank` 在 `base > 0` 门禁下不可达（死值），从 contracts/引擎/前端 types/CONTEXT.md 词条中移除——只保留 `identifier` | `doc-chunk`，不承诺不存在的溯源值。
- **config 扫描补"顶层"语义**：UPPER_SNAKE 正则现在要求零缩进（`line.startsWith(trimmed)`），函数/类内缩进的赋值不再混入 config topology。
- basename 兜底抽共享 helper `deriveLocalRepoName`（repoqa-repos.ts 导出），worker 与 MCP handler 各写一份的重复消除。

## [0.18.0] - 2026-09-04

### Highlights

- **`codecompass_index_repo` 全异步化（ADR-0016）**：真实 agent 反馈（BossHunter）暴露致命缺陷——同步契约下大仓库索引必然撞 30s stdio 超时，且 clone 期间 repo 行不存在导致"仓库消失"。现在同步部分只剩校验 + clone（≤60s）+ localPath 前置门禁，repo 行建立后立即返回 `{repoId, status: 'indexing', pollHint}`，索引 fire-and-forget，agent 轮询 `list_repos` 至 `ready`/`error`（error 行带根因摘要）。同步失败（URL 非法/路径不存在）坚决不落库。
- **新增 `codecompass_remove_repo`（第 14 个 MCP 工具）**：补齐仓库管理闭环——删除索引记录并级联清除符号/chunks/文件/事件，磁盘克隆保留；indexing 状态拒删（镜像 DELETE /api/repos/:id 的 409 语义）。
- **幽灵索引防线**：worker 在两处数据表写入点（`saveFiles` 前、`upsertSymbols/upsertChunks` 前）断言 repo 行仍存在，中途被删的索引静默终止，不再复活孤儿数据。

### Added

- `services/control-plane/src/repoqa-mcp.ts`：`codecompass_remove_repo` 工具 + `mcpRemoveRepo` handler；`mcpListRepos` 返回体增 `symbolCount`/`localPath`/`error` 字段。
- `services/control-plane/src/repoqa-worker.ts`：`indexRepo` 返回类型放宽 `Repo | null`（幽灵路径），全部调用点（cli/http/eval/mcp）空值防护。
- `docs/adr/0016-mcp-long-ops-return-immediately.md`：MCP 长操作立即返回 + 轮询观测的架构决策（含对后续新工具的约束）。
- `domain-radar-engine` + contracts：锚点新增 `matchedBy`（`identifier` | `doc-chunk` | `graph-rank`）——匹配来源可溯源，agent 可对措辞敏感的锚点降权；前端 types 副本同步。

### Fixed

- config topology 噪音（BossHunter 反馈）：Python/TS 扫描只收 UPPER_SNAKE 顶层赋值，`content`/`temporary_path` 类模块状态不再混入配置证据。
- `get_tours` 半残感（BossHunter 反馈）：空步 tour 过滤（对齐 HTTP 层行为），非 Java 仓库返回 `{tours: [], note}` 诚实说明 Java/Spring 边界，不再返回三个空壳。

### Changed

- `codecompass_index_repo` 契约破坏性变更：v0.17 同步返回 `ready` → v0.18 异步返回 `indexing` + 轮询。已安装用户重启 MCP 会话后生效；工具 description 已重写说明轮询方式。

## [0.17.0] - 2026-09-03

### Highlights

- **MCP 工具面新增 `codecompass_index_repo`**：agent 会话内可直接克隆 GitHub 仓库或索引本地目录，返回 repoId 后立即使用其他 12 个工具——打通"陌生仓库分析"闭环的第一环。远程仓库走 `git clone --depth 1`（60s 超时、`validateGitUrl` 安全校验），本地目录走 `worker.indexRepo` 管线。MCP 工具总数升至 **13 个**。

### Added

- `services/control-plane/src/repoqa-mcp.ts`：新增 `codecompass_index_repo` MCP 工具（含 url 克隆 + localPath 两条分支）、`mcpIndexRepo` handler、`McpDeps` 加 `dataDir` 字段、`McpToolHandlerArgs` 加 `url/localPath/branch/name` 入参。
- `services/control-plane/src/repoqa-mcp.test.ts`：4 项新测试（localPath 索引成功、路径不存在报错、双参数冲突报错、无参数报错）+ 三处工具名单更新至 13 项。
- `scripts/e2e/closeout_gate.py`：`check_mcp_composite_tools` 新增 `codecompass_index_repo` 冒烟断言（索引本地 demo-polyglot → 验证 `status: ready`），工具数量断言提升至 `>=13`。
- `MCP_SERVER_VERSION` 同步至 0.17.0（此前落后于产品版本 0.9.0）。

## [0.16.0] - 2026-09-01

### Highlights

- **Architecture & Incident Copilot（排障副驾驶，Issue 23）**：新增 `mode=incident` 查询通路——粘贴 Java/TS 堆栈即可获得物理级锚定的排障分析。静态路径确定性解析堆栈帧→符号（`repoqa-stacktrace.ts`，Java/V8/通用兜底三格式 + 噪声帧过滤），LLM 路径走白名单工具（diagnose_chain / blast_radius / trace_call_chain / get_config_evidence / parse_stack_trace）6 步 ReAct 预算（ADR-0011 静态边界）。
- **零幻觉合约进发布 gate**：每条调用链断言逐字来自本次会话工具返回，`file:line` 过 raw-file 校验；不可证的边界强制 BREAK/SUSPECT，永不编造。eval 新增 incident bucket（10 题），`hallucinationMaxFor('incident') = 0%` —— 幻觉率非零即 gate 失败。
- **物理锚点四元组（ADR-0010）**：锚点升级为 `repoId + commit + file:line-range + symbolId`，索引时钉住 `HEAD` commit 并在锚点/回答 payload 盖章；前端 EvidenceCard 按 VERIFIED / BREAK / SUSPECT 三徽标呈现证据，VERIFIED 行点击直达 Inspector 源码切片。

### Added

- `services/control-plane/src/repoqa-stacktrace.ts`：堆栈解析 + 帧到符号解析 + `stackTraceSummary`，13 项单测。
- `repoqa-worker.ts`：`runIncidentQuery`（LLM 白名单工具路径 + 确定性静态回退三段式回答）；incident 豁免 1.5s 延迟门禁（六步深度工具遍历，ADR-0011）。
- `GET /api/repos/:id/query?mode=incident&stack=...`；done payload 增 `commit` 与 `provenance`。
- 前端：`IncidentView` / `StackTraceInput`（IME 安全 Enter 提交）/ `EvidenceCard` 三徽标 + commit chip；`components/evidence.ts` 纯确定性断言解析（叙事文本不产生证据行）；TopBar 新增「排障」Tab，深链 `?mode=incident`。
- eval：incident bucket 10 题冻结 + repo-e fixture（orders 链）+ 幻觉判定（file:line grounded）；`docs/benchmark.md` 刷新至 75 题 / 5 fixture。
- ADR：`docs/adr/0010-physical-anchor-pins-commit.md` ~ `docs/adr/0015-evolution-workbench-freeform-intent.md`（均 accepted）——0012–0015 为架构雷达 / 演进顾问定位 grilling 裁决（Intent→Artifact、引擎垄断图谱渲染、Pattern Ingestion、自由文本意图入口），实装随 Issue 24/25。
- 证据链兜底：`unionIncidentAnchors`（repoqa-llm.ts）——堆栈锚点优先合并 LLM 返回锚点，去重并丢弃格式残缺项，答案中的 `file:line` 不再因模型漏报锚点而失证。
- 前端：IncidentView 动作条（爆炸半径 / 调用链溯源 / 重跑）+ 每条证据溯源链 + mermaid 断点图可点击跳转 Inspector；`App.tsx` 接线「排障」Tab。
- 测试根修：`repoqa-http.test.ts` 以 `vi.mock('./repoqa-scan', importOriginal)` 将文件预算收窄至 60，file-limit 用例不再 flaky。

### Fixed

- POST + `express.json()` 场景下客户端断连检测误用 `req.on('close')`，改为 `res.on('close')`（此前正常完成的 POST 查询会被误判为中断）。

## [0.15.0] - 2026-08-31

### Highlights

- **大型仓库规模化**：文件预算可配置化（`REPOQA_MAX_FILES`/`REPOQA_MAX_LINES`），默认上限从 3000 提至 12000。对 spring-boot（11,482 文件 / 58,535 符号）实测全量索引 **26.3s / 438MB**——已达 v1.0 GA 目标区间（≤30s / ≤500MB），基线报表见 `docs/profiling.md`。旧 3000 上限会截断该仓库约 75% 的代码。
- **Prisma 数据层（TS/Node.js 四层穿透补全）**：新 `PrismaAdapter` 解析 `schema.prisma` 为实体（`repository`）与操作（`sql`）符号；确定性桥接 `prisma.<model>.<op>()` → schema 操作节点，TypeScript 工程由此获得与 Java/MyBatis 同级的 `DATA_MAPPER` 跳层。

### Added

- `services/control-plane/src/languages/PrismaAdapter.ts`（schema 解析 + 15 种 Prisma 操作白名单）+ 测试。
- `repoqa-callchain.ts`：`prismaStatements` 索引与 `resolvePrismaCall` 桥接（大小写归一、单命中才解析）。
- `scripts/profile-index.ts`：大仓库索引 profiling 工具；`docs/profiling.md` 基线报表。
- 扫描预算纳入 `.prisma` 扩展。


## [0.14.0] - 2026-08-30

### Highlights

- **npm 首发**：包名 `@codecompass/cli`（bin 命令仍是 `codecompass`），`npx @codecompass/cli mcp <repo>` 一键拉起；补齐 keywords/LICENSE/repository 元数据，`npm pack` 实测 2.8MB / 155 文件。
- **安装器生态扩至 6 家 IDE**：新增 Windsurf（`~/.codeium/windsurf/mcp_config.json`）、Cline 与 Roo Code（VS Code globalStorage，支持 autoApprove 白名单），沿用幂等 merge/备份/dry-run 机制。
- **Release 管线**：tag 触发 GitHub Actions——全量验证后 `npm publish`，GitHub Release 附带开源 fixture 生成的示例 `architecture-artifact.html`。

### Added

- `.github/workflows/release.yml`（v* tag 触发）。
- `LICENSE`（MIT）。


## [0.13.0] - 2026-08-30

### Highlights

- **评测基线落地（ADR-0004 → accepted）**：golden eval 从 50 条扩至 **65 条**，新增三个 bucket 覆盖 v0.8/v0.9 复合引擎——`intent-anchor`（中文意图→doc-chunk 桥接命中）、`diagnose-chain`（四层穿透 + 断点判定，含负例）、`evolution`（固定点级联孤立 + 三级事务边界 + 解耦模式）。全部 **Recall 100%、幻觉率 0%**（`docs/benchmark.md`）。
- **CI 硬性门禁**：GitHub Actions 三平台矩阵（ubuntu/windows/macos × Node 24）跑 typecheck + 全部单测 + 构建；35 项 e2e 门禁（含 1 项新增 eval 冒烟）跑 ubuntu 专属 job；README 挂真实 CI badge。
- e2e doctor 检查容忍 warning（CI 容器无 Ollama 不再误伤）；`codecompass install` 输出至 12 工具。

### Fixed

- `runModuleEvolution` 对 intentType 做大小写归一——'extend' 不再静默落入 DEPRECATE 管线。
- 事务边界三级回溯补齐**接口方法级** `@Transactional`（Spring 代理最常见的声明位置），实现类经 `interfaces` 列表回溯接口方法注解。


## [0.11.0] - 2026-08-30

### Highlights

- **技术栈品牌徽标**：Mermaid 图节点按 `filePath` 扩展名 / `kind` / `annotations` 自动推断技术栈并注入内联 SVG 徽标（Spring / MyBatis / FastAPI / React / TS / Go / SQL 等），`?badges=0` 可关闭；徽标走后渲染 DOM 注入，绕开 mermaid 标签白名单，点击跳转与节点搜索不受影响。
- **Cmd+K 命令面板**：居中磨砂玻璃面板，300ms 防抖请求后端确定性雷达（复用 `runDomainRadar` + doc-chunk 证据），符号结果带出入度徽标；内置"切换主题 / 返回看板"命令；Enter 触发射击式画布居中 + Inspector 同步。
- **Inspector 面包屑 + 实时演播带**：Inspector 顶部 `Repo > 文件 > 符号` 可点击面包屑；Canvas 底部浮动"调用链步进"条（Prev / Step N/M / Next），步进时联动画布居中 + Monaco 切片高亮，BROKEN/HTTP 状态即时可见。

### Added

- `apps/repoqa-web/src/brand-marks.ts`：品牌推断 + 内联 SVG 徽标映射 + `?badges=0` 降级（+11 单测）。
- `apps/repoqa-web/src/components/CommandPalette.tsx`：Cmd/Ctrl+K 全局快捷键、防抖雷达检索、键盘导航（↑/↓/Enter/Esc）（+7 单测）。
- `services/control-plane/src/http.ts`：`GET /api/repos/:id/radar?query=` 路由 + 60s `(repoId, query)` TTL 缓存。
- `apps/repoqa-web/src/client/RepoQAClient.ts`：`radar(repoId, query)` 方法。

### Changed

- `packages/contracts/src/repoqa.ts`：`DomainRadarAnchor` 新增 `inDegree` / `outDegree`；`domain-radar-engine.ts` 在锚点输出中携带图度数。
- `apps/repoqa-web/src/components/MermaidDiagram.tsx`：新增 `symbols` / `focusRequest` 受控 prop，注入品牌徽标并支持外部画布居中。
- `apps/repoqa-web/src/components/Canvas.tsx`：传符号目录给图元、托管焦点请求、新增实时演播带（+2 单测）。
- `apps/repoqa-web/src/components/Inspector.tsx`：新增 `repoName` / `onBackToDashboard` 与面包屑（+4 单测）。
- `scripts/e2e/closeout_gate.py`：新增 radar HTTP 返回结构断言。


## [0.10.0] - 2026-08-30

### Highlights

- **Mermaid 质感对齐**：画布跟随 clean/cyber 主题注入 themeVariables（暗色不再白底），节点圆角统一 8px；主题切换即时重渲染，不再残留旧主题缓存。
- **语义边与状态胶囊**：查询 trace 的 BROKEN/HTTP/async 证据直接渲染为红脉冲虚线边、紫青流光 HTTP 边与黄虚线异步边；节点标签追加 GET/POST/BROKEN 胶囊，一眼分辨调用链状态。
- **trace 契约前置**：`RepoQaTraceHop.http` 字段（optional）把浏览器 HTTP 桥接方法/URL 带给前端，控制面在 AST 证据层确定性标注（零 LLM 猜测），旧序列化不受影响。

### Added

- `apps/repoqa-web/src/client/mermaidRenderer.ts`：按主题注入 mermaid themeVariables，主题键驱动重新 initialize（+6 单测）。
- `apps/repoqa-web/src/client/mermaidGraph.ts`：`escapeMermaidLabel` 与 `edgeAnnotationsForTrace`，标签转义覆盖 `[]"` 与中文路径，trace 边语义有序映射（+4 单测）。
- `apps/repoqa-web/src/components/MermaidDiagram.tsx`：消费 `traceSteps`，向 SVG `g.edgePath`/`g.node` 注入语义 class（+4 单测）。
- `services/control-plane/src/repoqa-worker.ts`：`annotateTraceHttpMethods` 将 `frontendCallersForRoute` 桥接证据写入 trace hop（+4 单测）。
- `index.css`：BROKEN 脉冲、HTTP 流光、async 虚线、节点状态胶囊，全部走设计 token（无硬编码 hex）。

### Changed

- `packages/contracts/v1.ts`：`RepoQaTraceHop` 新增 optional `http` 字段。
- `useChat` 消费 `done.payload.trace` 归一化为 `TraceStep[]`，供画布语义注入与后续演播带使用。


## [0.9.0] - 2026-08-29

### Highlights

- **模块演进副驾**：`codecompass_module_evolution` —— DEPRECATE 管线做模块聚类、全图反向引用扫描与**固定点级联孤立死代码检测**（被独占的公共工具会被二次波及一并标出），输出五类清理 Checklist；EXTEND 管线定位挂载点、回溯方法/类/接口三级 `@Transactional` 事务边界证据，按可解释规则匹配解耦模式（Spring Event 异步 / AOP 切面 / 直接注入）并产出确定性代码脚手架。
- **领域全景雷达**：`codecompass_domain_radar` —— 全图出入度统计 + 确定性 PageRank（阻尼 0.85、悬挂节点权重每轮均匀重分配不外泄、TS fetch→Controller 桥接边计入 Controller 入度），三栏全景（Top APIs / Hub 节点 / 持久化底座）；自然语言意图锚点 = 标识符模糊匹配链 + doc-chunk 证据（中文意图的确定性桥接）+ 图排名增益，**零 embedding**。
- **多视图工件**：`codecompass export` 升级为 Architecture + Sequence 双视图 Tab（Sequence 惰性渲染，规避隐藏容器 0 宽高陷阱）；Lifecycle/Dataflow 以"v1.0 证据采集排期中"占位——没有方法体级 AST 证据就绝不渲染假图；品牌徽标（Spring/Redis/MySQL 等，依依赖关键词贴标）与 Story Beats 分步演播带（Prev/Next 联动代码切片）。
- MCP 工具升至 **12 个**；CLI 新增 `radar` 与 `evolve` 子命令。

### Added

- `services/control-plane/src/domain-radar-engine.ts`：度数聚合、确定性 PageRank、意图锚点融合打分（+7 单测）。
- `services/control-plane/src/module-evolution-engine.ts`：DEPRECATE/EXTEND 双管线（+9 单测）。
- e2e 门禁新增 7 项 v0.9 检查（radar 全景/意图锚点、evolve 双意图、多视图工件断言、两个新工具的 MCP stdio 往返），总检查 **33 项**。

### Changed

- `export-artifact.ts` 重构为多视图渲染器；CLI `export` 输出 sequence 视图、品牌徽标与 Story Beats。


## [0.8.0] - 2026-08-29

### Highlights

- **专精 Agent 复合工具**：`codecompass_diagnose`（跨栈根因穿透：前端组件 → 路由 → Service → MyBatis XML，逐层 VERIFIED/BROKEN/SUSPECT）与 `codecompass_refactor_plan`（重构爆炸半径：直接/间接调用方、受波及路由与前端组件、风险评级与迁移步骤）。两者 100% 确定性、零 LLM、可单测可重放。
- **Zero-Config 安装器**：`codecompass install --ide <cursor|zcode|claude|all>` 把 stdio MCP 入口写入各 IDE 配置（Cursor 含 autoApprove 白名单），幂等合并 + 自动备份 + `--dry-run`。
- **驾驶舱深链**：`?focus=<symbol>&traceId=<id>` 现场还原、`?mode=diff` 直达架构差异视图，workbench tab 与 URL 双向同步。
- **单文件 HTML 工件**：`codecompass export` 输出自包含诊断工件（内联 mermaid 运行时，断网可渲染，可随 PR 归档），断链在拓扑图中红色描边。

### Added

- `services/control-plane/src/diagnose-engine.ts`：4 层可降级穿透引擎（Java 全栈四层全开，其他语言按实际索引层级输出），确定性 traceId 与 cockpitDeepLink、代码切片。
- `services/control-plane/src/blast-radius.ts`：覆盖全部符号（含路由）的反向邻接 + BFS 间接调用方聚合 + 风险打分（路由暴露 ×2、前端组件 ×3、REMOVAL 加权）。
- `services/control-plane/src/installer.ts`：Cursor（mcp.json + autoApprove）/ZCode（mcp.servers）/Claude Desktop 三家适配器，幂等 merge、备份、dry-run。
- `services/control-plane/src/export-artifact.ts`：自包含 HTML 渲染器，monorepo 内解析本地 mermaid，找不到时回退 CDN 并告警。
- MCP 注册 `codecompass_diagnose`、`codecompass_refactor_plan`（现共 10 工具）；内置 ReAct 编排挂载 `diagnose_chain`/`blast_radius` 工具。
- CLI 新增 `diagnose` / `refactor-plan` / `export` 子命令（CI 可直接消费 JSON/HTML）。
- e2e 门禁新增 MCP stdio 复合工具往返、CLI 三命令与 install --dry-run 检查，并接入 `npm run e2e`。

### Changed

- `repoqa-callchain.ts`：路由匹配将数字路径段按 `{id}` 折叠（与既有 `{id}`/`:id` 归一化同一语义），前端具体 URL 可桥接到占位符路由。
- MCP 启动时安装全局 console 劫持（log/info/warn → stderr），第三方依赖无法污染 JSON-RPC 流；新增真实子进程 stdout 纯净性测试。


## [0.6.0] - 2026-08-27

### Highlights

- **Resilience**：超大文件（>3000 行或单行 >1000 字符）不再拖垮索引，降级为 Tier 3 轻量提取；MCP 进程致命失败时 stdout 仍保持合法 JSON-RPC，Agent 侧不会读到半截流。
- **doctor 自诊断**：新增 `codecompass doctor`（`--json`），一键体检 Node 版本（>=24）、SQLite 原生 ABI/WAL、端口可绑定、数据目录可写与磁盘余量、本地 Ollama 健康。
- **分阶段索引**：索引进度按 DISCOVERY → AST_EXTRACTION → CROSS_LANG_BRIDGE → FINALIZING 四阶段广播（SSE/WebSocket），前端 StatusStepper 实时呈现。
- **架构差异视图**：`POST /api/repos/:id/architecture-delta` 返回新增/删除路由、断边、受影响 API 与 mermaid 图；Web 新增 ArchitectureDeltaView。

### Added

- `services/control-plane/src/doctor.ts`：五项只读体检（含临时探针文件自清理）。
- `services/control-plane/src/large-file.ts`：大文件分级提取策略。
- `packages/contracts/src/repoqa.ts`：`IndexingPhase` 与架构差异契约（含 `mermaid` 字段）。
- Web：`ArchitectureDeltaView`（统计卡片 + 路由/断边/受影响 API 列表 + Markdown 报告复制）、`StatusStepper`。
- PythonAdapter 增强：FastAPI/Flask 生态解析扩展（+161 行）。

### Changed

- 全部 package.json 与运行时版本同步到 `0.6.0`。

## [0.5.1] - 2026-08-27

### Highlights

- **消费侧多语言化**（D3/D4/D5）：techStack 识别 Java/TypeScript/Python/Go；configKeys 支持 `package.json`、`pyproject.toml`（PEP 621 + Poetry）、`.env`、yaml/properties；topApis 覆盖 Express/FastAPI/Flask 路由——dashboard/tours/MCP 不再只对 Java 有效。
- **跨语言桥接加固**（D8）：TypeScript 侧提取 `fetch`/`$fetch`/`ofetch`/`axios`（含 `axios.create`）与 `apiClient` 等封装；调用链按归一化路径（含 `/api`、`/api/v1` 变体）唯一匹配后端路由才连边，歧义显式 Static Analysis Break；新增 `GET /api/repos/:id/reverse-deps` HTTP 端点。
- **大仓导入口径修正**（D1）：行数只计源码扩展名（`.java/.ts/.tsx/.js/.jsx/.mjs/.py/.go`），日志/文档/JSON 不再误伤；超限时返回 `suggestedSubdirs` 建议而非硬报错。
- `/symbols` 返回真实 `symbolType` 枚举（CLASS/INTERFACE/FUNCTION/ROUTE/SERVICE/REPOSITORY/ADVICE/CONFIG/FIELD/MAPPER/SQL/DEPENDENCY），`.mjs` 纳入 TypeScript 解析与扫描范围（D6/D7）。

### Changed

- 全部 package.json 与运行时版本同步到 `0.5.1`。

## [0.5.0] - 2026-08-27

### Highlights

- **Polyglot AST 解析**：`LanguageAdapter` 抽象层统一 Java、TypeScript/JavaScript、Go、Python 的符号提取与调用边建模，跨语言调用链可在同一个证据面上连通。
- **跨语言契约桥接**：TypeScript/JavaScript 的 `axios` / `fetch` 调用可直接桥接到 Java Spring、Express、Gin/Fiber、FastAPI/Flask 路由，调用链不再止步于前端 API 层。
- **8 大标准 MCP 工具**：新增 `codecompass_get_subgraph_context`，与仓库发现、调用链、看板、配置证据、Tour、反向依赖、PR 影响面共同组成完整 Agent 工具集。
- **Graph RAG 子图提取**：基于 `resolveStartSymbolForQuery` 做 1-Hop Caller + 1~3 Hop Callee 双向检索，类骨架折叠、优先级队列 Token 剪枝与 13 类凭据脱敏，纯本地确定性输出。

### Added

- `services/control-plane/src/repoqa-graphrag.ts`：Graph RAG 子图提取核心算法。
- `LanguageAdapter` 与 `JavaAdapter`、`TypeScriptAdapter`、`GoAdapter`、`PythonAdapter`。
- MCP 工具：`codecompass_list_repos`、`codecompass_reverse_deps`、`codecompass_get_subgraph_context`。
- CLI：`codecompass context <query> [repoPath]` 子命令。
- HTTP：`GET /api/repos/:id/subgraph-context`。
- Web：Inspector“复制 Agent 上下文”按钮、侧边栏即时检索、按仓库保留聊天记录、Local-First 隐私药丸与 Token 溯源。
- MyBatis XML 数据层穿透：Mapper/DAO 最后跳可定位到 XML 中的 SQL 与物理行号。
- 官方分发与 CI 协同：npm 单包 `codecompass`、`.github/actions/architecture-diff` PR 评论门禁。

### Changed

- 统一入口解析为 `{ symbol, fallback, confidence }`，architecture 与 call-chain 共享语义解析链路。
- 全部 package.json 与运行时版本同步到 `0.5.0`。
- 大仓导入进度改为实时 `parsed/total`，Worker 内存符号图缓存避免重复全表扫描。

### Fixed

- 修复“静默编造答案”：兜底入口强制标记 low-confidence 并输出固定提示。
- 修复浏览器历史、冷启动 glow、API JSON 404、临时目录污染索引等体验缺陷。
