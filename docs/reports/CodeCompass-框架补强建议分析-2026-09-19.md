# CodeCompass — 框架补强建议分析（对外部评审文档的核实）

> 分析日期：2026-09-19
> 被分析对象：`D:\WorkBuddyData\2026-09-19-02-48-20\code-review-agent\docs\全项目框架补强建议.md` §3.3（C1–C6）+ §四 共性项 1/3/4 + §六 优先级 3
> 核实基线：本机工作区 `D:\CodeCompass`，HEAD = `5700bbd` + 2026-09-18/19 工作区改动（issue 07/08 未提交）
> 结论一句话：**文档对 CodeCompass 的六条不足，四条成立（其中 C2 比文档说的还多一张表）、一条半对半错（C4 的关键子断言被证伪）、一条是有意设计（C6）；文档排的优先级第 3 项里，只有 C2(+C3) 和 C4 值得开票——C1 与本仓 D6 裁决直接冲突，C5 的手术 v0.28 已经做过一轮。**

---

## 一、逐条核实结果

### C1 ·「5 层里 4 层压在 services/control-plane 一个包内」——事实成立，但方案已被本仓裁决否决

**事实**：`routes/` `engine/` `ingest/` `mcp/` `languages/`（另有 `chat/` `eval/`）确实同属一个 npm 包，`src/` 根另有 57 个平铺 `.ts` 文件。接口层与领域层无编译期边界——属实。

**但文档不知道的两条仓库内事实**：

1. **D6 裁决**：`.scratch/v028-engine-refactor/spec.md` 硬约束白纸黑字——「**workspaces 化不做（D6 裁决）；包引用维持相对路径 + esbuild 内联模式**」。单包是这个仓库 2026-09-14 经 grill 定下的结构轴，不是欠账。
2. **手术已做过一轮**：v0.28 票 03 =「repoqa-worker.ts 2556 行拆分（头部工具外迁 + RepoQAWorker 按 ingest/persist/progress/graph 抽协作者）+ registerAnalysisRoutes 515 行拆注册」，已随 v0.28.0 发布（tag `3b917c0`）。现在的 2093 行是手术后的稳态。

**判定：不采纳**。单包内继续用目录归组；任何"拆包/加编译期边界"提案需先翻 D6 案，属决策不属补齐。

### C2 ·「加一种语言要改 4-5 处，其中 3 处字符串常量，漏改不报错」——成立，且实测比文档说的还多一张表

**核实**：`repoqa-parser.ts:20` 的 `ADAPTERS` 数组（行号逐字吻合）与 `repoqa-scan.ts:24` 的 `SOURCE_EXTENSIONS`（9 项）都在。**文档漏了第三层**：每个适配器还有自己的私有扩展名表——`TypeScriptAdapter.ts:22` `TYPESCRIPT_EXTENSIONS`（5 项）、`GoAdapter.ts:19`、`PythonAdapter.ts:18`、Prisma 用 `endsWith('.prisma')`。加一种语言实际要碰 **1 个适配器文件 + 2 张公共表 + 适配器私有表（可能还有依赖声明）**。

**漂移的两个方向都是静默的**：SOURCE_EXTENSIONS 认领而适配器不认领 → 文件进扫描、产出零符号；适配器认领而 SOURCE_EXTENSIONS 漏 → 文件根本不入扫描。**今日逐项比对：两表恰好一致，无现行漂移**——风险是结构性的，不是现行 bug。

**判定：采纳，本批唯一高优先**。理由符合 HANDOFF §2.2 开票判据：漏登记扩展名 = 文件**静默不入索引** = 直接损伤"确定性事实层"的交付承诺。修法即文档所提 `languages/registry.ts` 单表派生（`{extensions, adapter}`，scan 集与适配器从同一表派生），顺带把 C3 一起收。

### C3 ·「ParseContext 唯一字段是 goPackages」——成立（本仓 V31-02 自己引入的接口）

`parse-context.ts:24-32`：`ParseContext` 确实只有 `goPackages?` 一个字段，行号吻合。领域接口被单一语言细节侵入属实。

**判定：采纳，并入 C2 的票**（同文件族、同一动机）。改按语言键的 Map 是接口卫生；行为零变化。

### C4 ·「服务端无错误码对表；前端注释称权威表在 CONTEXT.md，实查无此节」——半对半错，关键子断言**被证伪**

**成立的部分**：服务端 code 是 throw 点字符串字面量（`http.ts:97` `'invalid_json'`、`:131` `'not_found'`，行号逐字吻合）；前端 `ERROR_COPY: Record<string, string>` 的键是裸 string，无共享类型约束。

**被证伪的部分**：`CONTEXT.md:82-90` 有完整的 **「Error Code Contract（v0.27-B R3）」** 节——七个域（通用/传输/仓库/clone/文件/delta·gate/chat）全码表，且前端 `errorCodes.ts` 头注释的引用**与实际相符**。文档 §8 自己标注这条"【勘察】，未自己打开 CONTEXT.md 核对"——核实结果：它没核对，也说错了。

**真实缺口比文档说的窄**：不是"没有表"，是"**表在 Markdown 里，编译期与 gate 都不执法**"。新码是否先入 CONTEXT.md 表，靠纪律不靠机器。

**判定：采纳但降级**。修法（`packages/contracts/src/error-codes.ts` 单一源 + 前端 `Record<ErrorCode, string>`）与刚收口的 issue 07「readme-tool-table-parity」是同一哲学（单一源 + 执法），值得做；但成本半天级、收益是防漂移而非救火。可 gate 断言（服务端字面量集合 ⊆ contracts 表）或编译期类型二选一，倾向后者（新增码漏改直接编译错）。

### C5 ·「queryRepo 293 行 / 8 职责；indexRepo 275 行 / 6 职责」——量级成立，数字高估

**实测**（方法声明行到同缩进闭括号）：`queryRepo` = `repoqa-worker.ts:904–1182` = **279 行**；`indexRepo` = `:368–622` = **255 行**。文档 293/275 各高估 14–20 行（【勘察】未复核的典型偏差），"两个 ~260–280 行 pipeline 函数"的定性成立。

**判定：不做**。理由：① v0.28 票 03 已对该文件做过结构手术，现长度是手术后稳态；② 再拆属结构擦亮，与 spec §6.5「任何不服务于 M1–M5 的改动一律不做」直接冲突；③ 拆 pipeline 有回归风险，唯一划算的时机是**下次因功能原因动这两个函数时顺手抽**——把这条记进票面备注即可。

### C6 ·「日志 level 非法值 fail-soft 到 info」——行为属实，但这是写进头注释的有意设计

`log-sink.ts` 头注释自述：「`MHW_LOG_LEVEL` 控制，大小写不敏感，**非法值 fail-soft 到 info**」，同注释还写明整个 sink 的哲学：「写失败永不冒泡……日志是辅助设施，不许杀主服务」。让日志配置炸掉主服务启动与该哲学矛盾。

**判定：不改**。至多加一条"非法值 stderr 一次性警告"（可选，收益很低）。

### metrics（`engine/metrics.ts` + `/metrics`）——落点不存在，但与冻结期方向冲突

`/metrics` 端点实测不存在 ✓（建议未过时）。但：v0.27 生产就绪度评估的差距清单未把 metrics 列为必做；spec §6.4 明令"不可测指标不写进对外文案"；Local-First 无遥测的定位下，指标端点的消费者只有本机自己。**判定：挂起**，等 D 交付（公开放大）出现真实部署需求再议。

### §四 #3 原始报文归档——对 CodeCompass 不成立为"缺口"

`chat` 面已有 SessionLogger（进程内事件独立 jsonl、会话取证语义，`log-sink.ts` 头注释明确"两者不混写"）；engine 面的评测走 97 题 golden eval。文档把它算进"8/9 缺归档"对 CC 不公允——CC 缺的是 LLM 原始报文落盘，但 v0.31 定位里 LLM 编排本就在宿主侧（ADR-0005/0006/0012），CC 不经手原始 LLM 报文。**判定：不适用**。

---

## 二、与仓库既有裁决的对账（文档视角盲区）

| 文档建议 | 仓库内既有裁决 | 结论 |
|---|---|---|
| C1 隐含的拆包/分层 | **D6：workspaces 化不做**（v0.28 spec 硬约束） | 不采纳；翻案属决策 |
| C5 拆 pipeline 函数 | **v0.28 票 03 已做一轮** worker 结构手术；spec §6.5「不服务 M1–M5 不做」 | 不做，功能改动时顺手 |
| C6 fail-fast 日志级别 | log-sink 自述设计哲学「日志不杀主服务」 | 不改 |
| metrics 端点 | spec §6.4 禁不可测指标；v0.27 差距清单未列 | 挂起 |
| C2 registry / C3 ParseContext / C4 错误码单一源 | HANDOFF §2.2 判据（降误报/提精度）——C2 直接受益（漏登记=静默不索引） | **值得开票** |

## 三、我的优先级（按本仓自己的判据重排，替换文档 §六 #3 的笼统排序）

| 序 | 动作 | 判据 | 成本 | 备注 |
|---|---|---|---|---|
| 1 | `languages/registry.ts` 单表派生（含 C3 的 ParseContext 泛化） | 精度/交付：消除"漏改不报错"的静默不索引 | 0.5 天 | 可加一条 gate 断言：两表派生自同源 |
| 2 | `packages/contracts/src/error-codes.ts` + 前端 `Record<ErrorCode, string>` | 契约正确性（与 issue 07 同哲学） | 0.5 天 | 编译期执法优于 Markdown 表 |
| 3 | C5/C6/metrics/归档/C1 | — | — | 不做或挂起（理由见上） |

**排序依据**：本仓 spec §3 的 M1–M5。C2 直接护"确定性事实层不漏文件"；C4 护 agent/前端契约不漂移；其余不服务 M1–M5。

## 三′、裁决与落地记录（2026-09-19，用户裁决「先做两条候选票，再做你的建议」）

**候选 ①（C2+C3）→ 已实施**（`.scratch/v031-precision/issues/09-language-registry.md`，验收全勾）：
`languages/language-extensions.ts`（唯一扩展名源）+ `languages/registry.ts`（唯一接线表，派生 `SOURCE_EXTENSIONS`/`adapterFor`）；
`ParseContext.goPackages` → `languages.go`（按语言命名空间）。**零行为变更实锤：三仓精度逐字节不变**
（lazygit 1807 / petclinic 13 / self 283，census 守恒）。转红实测：删 '.mjs' → 守恒断言红。
实施中发现并修正了一处恒真断言（守恒基准也读共享常量，两侧同变则恒绿）——已改为逐字硬编码基准。
cp 单测 673 → 680。

**候选 ②（C4）→ 已实施**（`.scratch/v031-precision/issues/10-error-code-contract.md`，验收全勾）：
`packages/contracts/src/error-codes.ts` 单一源（30 码，键=值恒等，wire 格式零变化）；前端
`ERROR_COPY: Record<ErrorCode, string>`（30 键本就齐全，零新文案）；服务端取**扫描哨**而非 38 处逐点替换
（copy-guard 同形态；`http-error.ts` 三元发射点单点常量化）。三项转红实测全成立：
表外码探针被抓（报错含 file:line 与修复指引）、删前端 copy 键 → `TS2741`、
CONTEXT.md 表 ↔ 代码双向对账测试在位。web 单测 363 → 364。

**其余项 → 裁决为不做/挂起**（本条即"再做你的建议"的执行记录）：

| 项 | 处置 | 依据 |
|---|---|---|
| C1 拆包/分层手术 | **不做**（翻案需重开 D6） | v0.28 spec 硬约束「workspaces 化不做（D6 裁决）」；v0.28 票 03 已做过 worker 结构手术 |
| C5 拆 queryRepo/indexRepo | **不做**，功能改动时顺手 | spec §6.5「不服务 M1–M5 不做」；实测 279/255 行为手术后稳态 |
| C6 日志级别 fail-fast | **不做** | log-sink 自述设计哲学「日志不杀主服务」；fail-soft 是有意行为 |
| `/metrics` 端点 | **挂起** | spec §6.4 禁不可测指标承诺；Local-First 无遥测，无真实消费者；待 D 交付出现部署需求再议 |
| 原始报文归档 | **不适用** | LLM 编排归宿主侧（ADR-0005/0006/0012），CC 不经手原始 LLM 报文 |

**验证基线（本批后）**：四包 typecheck 净；cp **680**；web **364**；e2e **68/68**；build 净；三仓精度逐字节不变。

## 四、对文档 §8「未核实项」的闭环（本分析代为核实）

| 文档标注 | 核实结果 |
|---|---|
| C5 行数【勘察】 | 实测 279 / 255（文档 293 / 275 高估） |
| `errorCodes.ts` 注释称权威表在 CONTEXT.md 而实际缺失【勘察，未核对】 | **证伪**：CONTEXT.md:82-90 「Error Code Contract」节完整存在 |
| C2「3 处字符串常量」【勘察】 | 成立且加严：实为 1 扫描集 + 4 适配器私有表，共 5 张手维护表；今日恰好一致、无现行漂移 |
| C6 fail-soft【勘察】 | 属实，但是文档注释里写明的有意设计 |

文档 §7 的教训——「当两份二手结论冲突时，唯一可靠的办法是自己 diff」——在 C4 上再次应验：它对 CONTEXT.md 的断言正是没有自己打开看。

---

## 附：核实用到的可复现命令

```bash
# C2 两张表
sed -n '20p' services/control-plane/src/ingest/repoqa-parser.ts
sed -n '24,36p' services/control-plane/src/ingest/repoqa-scan.ts
grep -n "TYPESCRIPT_EXTENSIONS = " services/control-plane/src/languages/TypeScriptAdapter.ts   # :22
grep -n "GO_EXTENSIONS = \|PYTHON_EXTENSIONS = " services/control-plane/src/languages/*.ts    # Go:19 Py:18

# C3
sed -n '24,32p' services/control-plane/src/languages/parse-context.ts

# C4
grep -n "invalid_json\|not_found" services/control-plane/src/http.ts        # :97 :131
sed -n '82,90p' CONTEXT.md                                                   # 「Error Code Contract」节存在
grep -n "ERROR_COPY" apps/repoqa-web/src/client/errorCodes.ts               # Record<string, string>

# C5 行数（方法声明行 → 同缩进闭括号）
awk 'NR>=904 && /^  \}$/ {print NR; exit}' services/control-plane/src/ingest/repoqa-worker.ts   # 1182 → 279 行
awk 'NR>=368 && /^  \}$/ {print NR; exit}' services/control-plane/src/ingest/repoqa-worker.ts   # 622 → 255 行

# C1 既有裁决
grep -n "workspaces" .scratch/v028-engine-refactor/spec.md                   # 「workspaces 化不做（D6 裁决）」

# metrics
grep -rn "'/metrics'" services/control-plane/src/*.ts                        # 空 = 不存在
```
