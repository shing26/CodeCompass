# CodeCompass 双轴评审报告（2026-09-25）

- **范围**：`git diff 76e2b21...HEAD`（fixed point = 上次审完 commit，2026-09-23 双轴评审现场修）——11 个提交、29 文件、+3786 行，覆盖票 18（两批）/20/21/19/17/03 与 v0.31 发布收口。
- **触发**：v0.31 批收口（npm 首发 + M4=1 达成）；HANDOFF §5「发布前 code-review（双轴）每个发布版本必过」——这批 5 个引擎提交（票 18/20/21/19/17）在评审时点均未审。
- **方法**：两轴并行 sub-agent（Standards / Spec），汇总后逐条处置。处置规则同前次：spec §6.5「任何不服务于 M1–M5 的改动一律不做」。

## Standards

### (a) 文档化标准违反

**1. `module` kind 的注释与代码自相矛盾（本 diff 内部漂移，需返工修正注释）**
- `services/control-plane/src/languages/TypeScriptAdapter.ts`（`moduleNode` 注释）：「It is deliberately NOT a graph node (`PRODUCTION_KINDS` does not list the kind)」；`services/control-plane/src/ingest/repoqa-repos.ts:193-199`：「deliberately not in `PRODUCTION_KINDS`, so it never becomes a graph node, a bucket candidate…」
- 但同一 diff 里 `services/control-plane/src/domain-radar-engine.ts` **把 `'module'` 加进了 `PRODUCTION_KINDS`**（注释明言"edge only counts when its source is a graph node"），HANDOFF §4 票 17 行也写「并进 `PRODUCTION_KINDS` 与 `effectiveStart`」。
- 仓库标准：注释承载"为什么"与实测证据（HANDOFF §2.2 / 仓库惯例），且本仓 review 流程把"实现漂移/文档漂移"记为 standards 违反（见 CONTEXT.md Status「四处实现漂移收口」先例）。两处注释对同一 diff 内的代码说反话——按"注释即事实源"纪律属硬伤（改注释即可）。

**2. `repoqa-parser.ts` `buildParseContext` 空表判据不一致（judgement call，偏 bug）**：`if (typescript.interfaces.size > 0 || typescript.returns.size > 0)` 忽略 `params`/`methods`——只有方法/形参表项的仓库会整表丢弃。方向 fail-closed（少绑不假绑），与 ADR-0002 不冲突，但与本文件"每个不能识别的形状 absent 而非 guessed"的诚实口径不一致。

**3. 其余红线全部合格**（正面确认，非违规）：票 21 的 `!call.dynamic && !call.receiverType` 是 ADR-0002 的正向执行；`Pick<T,K>` 越界即 dynamic、歧义名整表丢弃、掩码状态机保守边界（欠掩码优先）均符合；"新增须附精度论证"逐票有探针实测；ADR-0006/0016 无触碰；反向查询仍走 `buildFullCallersIndex`。

### (b) Baseline smells（均为 judgement call）

- **Speculative Generality**：`resolveTypeRef(raw, depth = 0)` 的 `depth` 从未被递归传入（全仓 9 处调用皆单参），`if (depth > 4)` 是死防线——删掉或接上递归。
- **Duplicated Code**：括号深度扫描手写六份——`splitTopLevel`、`parseInterfaceMembers`、`matchParen`、`matchAngle`、`classBodyBrace`、`typeTextBeforeBody`，各自带变体版 `=>` 跳过；注释自认"the same discipline"。可抽一个共享 tokenizer。同族：`annotatedParamNames` 重写 `collectParams` 配对规则（注释已自认）；`walkMountChain` 绕开 `resolveCallChain` 自走边（有实据：`StrictMode` 包装，属有意豁免）。
- **Data Clumps**：`(source, memberLookup, crossFile, typeStack, scope)` 五件套贯穿 `collectParams`/`callbackScopeFor`/`declaredReturnType`/`bindDestructuredFromCall`——可包成一个 parse-session 对象。
- **Divergent Change（轻）**：`TypeScriptAdapter.ts` 一文件现在同时承载掩码状态机、仓级声明扫描器、AST 行走三摊（+1182 行）；仓级表 `buildTypeScriptDeclarations` 或更属 ingest/ 域。
- **硬编码计数**：`scripts/smoke/packed-mcp-handshake.mjs` 两处写死 `17`，与 `closeout_gate.py` 的断言成第三份拷贝（HANDOFF §2.1 指定 gate 为工具数同步点）——建议读 tools/list 长度与 gate 单源对齐。

**结论**：无架构红线返工项；必改=1（两处 `module` 注释），建议改=2（空表判据、`depth` 死参），其余按 judgement call 登记。

## Spec

### 总体

七票验收清单在 diff 中均有实证对应：18 的三族反例单测（Pick 越界/`map(u=>new User)`/重命名解构）在 `TypeScriptAdapter.test.ts`；20 的三缺陷对应 `callbackScopeFor`/`scanMethodSignatures`/`collectParams` 空成员表分支 + 端到端"唯一实现绑定、双实现 dynamic"用例；21 的 `if (!call.dynamic && !call.receiverType)` 与"裸调用/this.foo() 回归钉"在 `repoqa-callchain.ts:655` 与 `repoqa-callchain.test.ts`；19 的单趟掩码器 4 用例；17 的中间件/模块节点/tour 三测试；复测留档在 `docs/reports/scan-precision-baseline-2026-09-16.md` §10–15；探针脚本 `.scratch/probe-*.ts` 齐全。MCP 17 工具冻结未破。

### (a) 缺失/部分

1. **spec 自身未回写**：spec §4 波次行仍写"**19 待开工**"、票 19 行无 ✅，但 3b10e95/68cca37 已落地 19/17/21；且票 19 行写"两阶段掩码"，交付为"单趟状态机"（票 19 §3/§4 有推翻论证）——spec 文本与实现脱节。
2. **M1 人工核验产物不可复核**：spec §3"逐条人工核验…数字入 docs/reports/ 留档"。报告在档，但 `scripts/precision/out/`（verdicts/self.json 重判）不入库，本 diff 无法核对"M1 诚实下限"的逐条判定。

### (b) 未请托的改动

- `scripts/e2e/closeout_gate.py` 的 V30-9 hermetic 化（清空 LLM env + `CLOSEOUT_GATE_LIVE_LLM` 逃生口）随票 18 提交 a56fec0 搭车落地，不在任何票的验收/文件面声明（HANDOFF 有 V30-9 留痕）。
- README 首句定位改写——票 03 记为用户 09-24 当场指示，可接受。

### (c) 看似实现但有疑点

1. **两处注释与代码相反**：`repoqa-repos.ts:197` 与 `TypeScriptAdapter.ts` moduleNode 文档均称 module"deliberately NOT in PRODUCTION_KINDS / never becomes a graph node"，而 `domain-radar-engine.ts:60` 已把 `'module'` 加入 `PRODUCTION_KINDS`（票 17 记录"加了才离榜"）。代码对、注释错，会误导后续工序。
2. **TS 表保留门槛漏两项**：`repoqa-parser.ts` 仅在 `interfaces.size>0 || returns.size>0` 时携带表；只有类方法返回注解（票 20 的 `methods` 表）或只有函数参数表（(e) 的 `params`）的仓会整表丢弃，使票 20 ②/(e) 静默失效——与本仓未触发，但与票 20"表加 methods"的意图不符。
3. 票 21 修后 `receiverType` 非空且不在索引时落入末尾 `STATIC_ANALYSIS_BREAK_DYNAMIC` 分支，语义正确。

其余：fixture 已改名 `FixtureContextValue`、`isTestPath` 双向使用、`parseInterfaceMembers`/`splitTopLevel` 的 `=>` 处理与票面缺陷记录一致。

## 逐条处置（2026-09-25，当日闭环）

| # | 轴 | 发现 | 处置 | 说明 |
|---|---|---|---|---|
| 1 | 两轴 | 两处 `module` 注释称"不在 PRODUCTION_KINDS" | **当场修** | 两处注释改为终态事实：module 是图节点（边计入度所必需），但不可调用（落既有 type-declaration 排除）、非类型、不进符号树 |
| 2 | 两轴 | `buildParseContext` 空表判据漏 `params`/`methods` | **当场修** | 判据改为四表任一非空——否则只有方法返回类型/函数形参类型的仓会让票 20②/(e) 静默失效 |
| 3 | Standards | `resolveTypeRef` 的 `depth` 死参（Speculative Generality） | **当场修** | 删参数与死防线（9 处调用皆单参，函数不递归） |
| 4 | Spec | spec 票 17/19 行与波次行未回写 | **当场修** | 票 17/19 行改 ✅（含交付形态修正：两阶段→单趟状态机），波次行改 Wave 6 全落地 |
| 5 | Spec | M1 逐条判定不可复核（verdicts/self.json 停在 09-20 旧榜） | **当场补做** | 按当前 top-10 重判入档 `scripts/precision/verdicts/self.json`（10 条全换血：3 条旧榜存活 + 7 条新面孔），报告 §16；**M1 = 4/10 = 40%（09-20 为 90%）**，`--score` 复算通过、覆盖守卫不再标 ⚠ |
| 6 | Standards | 六份手写括号扫描器（Duplicated Code） | 登记不改 | §6.5：不服务 M1–M5；且各扫描器规则有细微差别（`=>` 跳过点、括号种类），强抽共享 tokenizer 会把六条独立规则耦成一条 |
| 7 | Standards | 五件套参数 Data Clumps | 登记不改 | §6.5；同上（纯风格） |
| 8 | Standards | TypeScriptAdapter.ts 三摊职责（Divergent Change） | 登记不改 | §6.5；拆分属结构手术，等有下一个功能增量顺路做 |
| 9 | Standards | 冒烟脚本写死 17（第三份拷贝） | 注释对齐 | gate 是单源执法点；脚本加注释指明同步点（读 gate 的 TS 表超出脚本职责） |
| 10 | Spec | V30-9 搭车落地（a56fec0） | 记录不改 | HANDOFF/backlog 已有 V30-9 独立行（09-21 补登记），两账对齐 |
| 11 | Spec | README 定位改写 | 记录 | 用户 09-24 当场指示（定位口径对齐 MCP 主轴），票 03 已记 |

**门禁（评审修复后）**：控制面 727、web 364、bridge 26、e2e 71/0、四包 typecheck 净；`--score self` M1=40%。
