# 双轴 code-review —— v0.31 整条线（`80c3ab1..HEAD`）

> 日期：2026-09-21 ｜ 依据：`HANDOFF.md:116`「发布前 `code-review`（双轴，fixed point = 上次审完 commit，**每个发布版本必过，不可省**）」
> **固定点 `80c3ab1`**（v0.30 收口批最后一个提交；v0.31 段在 CHANGELOG 中**无任何评审记录**，故整条线未审）
> 范围：`git diff 80c3ab1...HEAD` —— 7 提交 / 81 文件 / 7369 插入 / 206 删除（31 ts、31 md、9 json、3 py、3 mjs）
> 待审提交：`2fb15ac`(spec+六票) `086a7b9`(V31-1 精度) `cb15585`(文档一致性+护栏) `80186e7`(V31-2 Go 绑定) `5700bbd`(M2 归零+版本) `ba00138`(票 07–11+棘轮+票 12–16) `3ba2793`(bin 修复)
> 方法：两个轴作为**并行子代理**独立运行（互不污染 context），本报告并排呈现，**不合并、不跨轴排序**（技能明确要求）；其后附**我（主代理）的自证与处置层**。

---

## Standards 轴（代码是否符合本仓记录的标准 + Fowler smell baseline）

### 硬违规（有据可依的标准违反）

1. **ADR 索引过期** —— `CONTEXT.md:4`、`HANDOFF.md:70`、`HANDOFF.md:87` 均写 `0001–0017`，而本次新增了 0018/0019（`ls docs/adr` = 19 份）。标准：HANDOFF §3（`CONTEXT.md` = "全部 ADR 索引"）与 §2.5（每次收口必须更新 `HANDOFF.md`）；讽刺的是 `cb15585` 正是"文档一致性批"。无 gate 覆盖 ADR 区间，故静默漂移。
2. **字段名与 ADR 不符** —— `packages/contracts/src/repoqa.ts:512` 落 `census.excluded`，而 ADR-0018 写 `excludedByRule`。ADR-0018 必要条件①要求 ADR / 代码 / README 对桶的声称面一致。

### 判断项（baseline smell，均为 heuristic）

- **Duplicated Code — Go 文件每轮索引被解析两次**：`buildGoPackageTable` 为取声明解析全部 Go 文件（`GoAdapter.ts:307`），随后 `parseGoSource` 再解析同一文件（`:708`）；`collectGoDeclarations`（`:215`）又重走同一批 `TypeDecl`/`FieldDecl`/`FunctionDecl` 节点。建议抽出单趟声明解析并把 tree 传下去。
- **Duplicated Code — 访问器规则里的魔法数**：`scan-engine.ts:124`（`<= 5`）与 `:137`（`> 5`）硬编码同一个 ≤5 行判定，`isFieldAccessor` 无法复用 `isAccessorLike`。
- **谓词在 5 个适配器重复**：`EXTENSIONS.includes(path.extname(filePath.toLowerCase()))` 出现在 `JavaAdapter.ts:794`、`PrismaAdapter.ts:55`、`PythonAdapter.ts:666`、`TypeScriptAdapter.ts:957`、`GoAdapter.ts:1172` —— 数据已去重，谓词没有。
- **Divergent Change — `scan-engine.ts:238-280`**：一个嵌套里叠加了全部孤儿排除（displayPath / accessor / wired / `CALLABLE_KINDS` / interface-member / testOnly），每条新规则都改这块。
- **Feature Envy — `repoqa-mcp.ts:1003`**：`zodForJsonType(meta, key, type)` 收 `meta`+`key` 只为拼错误消息。
- **守卫缺口 — `error-code-guard.test.ts:38`**：正则只认单引号小写字面量，双引号/模板形式的 `code:` 发射可整体溜过。
- **布局 — `scripts/out/mcp-model-in-the-loop.json` 被提交**：§2.5 规定报告归 `docs/reports/`、临时产物归 `.scratch/`；`.gitignore` 新忽略了 `scripts/precision/out/`，但没有 `scripts/out/` 规则。

### Standards 轴查清为合规的部分

版本五处全为 `0.31.0`（bridge-adapters 独立 0.6.0 例外守住）；`MCP_SERVER_VERSION = VERSION`（`repoqa-mcp.ts:57`）无字面量；17 工具三处一致（`MCP_TOOLS` / README 表 / gate parity）；错误码契约 38 处发射全在 `ERROR_CODES` 内、30 码全在 CONTEXT 表、唯一非字面量发射走常量（`http-error.ts:111`）；出库不变式——`textResult` 是唯一掩码收口点（`repoqa-mcp.ts:1040`）且审计复用 sink 深走 `sanitize`（`log-sink.ts:48`）；ADR-0002 fail-closed 遮蔽/歧义包名丢弃；ADR-0018 三裁决与棘轮一致；无新工具/新页签（§2.2 精度论证要求 N/A）。

---

## Spec 轴（代码是否忠实实现来源 spec）

### (a) 缺失或未完成

1. 票 16 文件面声明 `package.json` 增 `mcp:model-probe`——**缺失**（`:21-24` 只有 `precision`/`precision:ratchet`/`mcp:stats`/`mcp:token-compare`）。
2. 票 12(c) 声明的字段契约未全实现：`repoqa-mcp.ts:1106-1115` 落的是 `error`（消息文本）+ `args`/`result`，无 `isError`/`errorCode`；gate 因此把"字段齐全"降为四字段检查（`closeout_gate.py:1198-1204`），`audit_stats.mjs:71` 的错误分布按消息文本而非 errorCode 聚合。
3. spec §3 的 M1（<5% 三样本）与 §8 的收口判据（M1<5% + M4=1 + M5≥3）**未达成**：self 90%（9/10）；lazygit/petclinic 判定文件曾只覆盖 4/10 与 5/10。票 03(a) 与票 04/05 的验收框仍未勾。

### (b) 范围外新增（scope creep）

- **无新 MCP 工具**（`MCP_TOOLS` 仍 17）、无页签改动 → §1.1/§1.2 守住；唯一 Web 改动是 `errorCodes.ts`（票 10 文件面内）。
- 两处**无票面**新增：`.zcodeignore`（78 行根文件，agent 工具本地配置，与 `.gitignore` 重复）与 `scripts/out/mcp-model-in-the-loop.json`（原始 dump；票 16 只声明 `scripts/eval/*` 与 `docs/reports/*`）。dump 内无凭据（已核）。

### (c) 看似实现、实则不满足验收框

1. **票 08 的守恒验收是空转**：`orphanCensus.zeroCallers = orphanItems.length - testOnlyCount`、`testOnly = testOnlyCount`（`scan-engine.ts:315-317`）→ `zeroCallers + testOnly === total` **恒成立**，harness 的"不守恒即抛错"与棘轮不变量①以及那条单测**永远不会红**；真正该守恒的跨规则等式（2805 = 1807+623+375）从未被断言。
2. **CHANGELOG 声称 "M1 self 首次离开 100%：90.0%(9/10)"，而票 11 的验收框写 M1 未重判**，且 `verdicts/self.json` 的 `_meta` 锚在"`5700bbd` + v0.31 未提交批"——一个在 HEAD 不存在的状态，故 90% 无法从任何已发提交逐字复现。
3. `ratchet-baseline.json` 只冻结 `self`，`precision:ratchet` 只跑 `--ratchet self` → lazygit/petclinic 无回归守卫。
4. 票 15 的 42.5%（5410/12719）算术成立且默认参数可复跑；但"默认档剪枝生效"这一档本身 `truncated=true`（7309 > 6000 预算），标签低估了"默认已超预算"这一事实。

### Spec 轴查清为合规的部分

`instructions` 非空且已接线（`repoqa-mcp.ts:59-83,1053`）；`zodForJsonType` fail-closed；`textResult` 掩码收口 + 专用单测（硬条件②）；README 生成块 + `readme-tool-table-parity`/`readme-version` 双 gate（硬条件①）；ADR-0018 的排除/`deferred`/`testOnly` 三语义符合 A/A′/B 裁决，且类型声明计数与 `wiredExcluded` 分离；ADR-0019 掩码真实（深走 sanitize + 4096 截断）；票 09 registry 守恒测试带独立硬编码基准；票 10 的 30 码 = 30 个 `Record<ErrorCode,string>` 键 + 服务端扫描哨；票 14 套件零项目耦合（`grep orphanedPublic` = 0）且有反向证明 fixture；票 06 的 HANDOFF 纪律与六行 V27 余账落地。

---

## 主代理自证与处置层

两个轴的结论并非同等可信：**我方逐条自证后再处置**，未自证的一律标注为 judgement call（不自证不修）。

| # | 轴 | 发现 | 我方自证 | 处置 |
|---|---|---|---|---|
| 1 | Standards | ADR 索引 0001–0017 过期 | **证实**：`CONTEXT.md:4`、`HANDOFF.md:70/87`；`ls docs/adr` = 19 | **现场修毕**（三处 → `0001–0019`，并补 0018/0019 的一句话摘要） |
| 2 | Standards | ADR-0018 字段名 `excludedByRule` 与代码 `census.excluded` 不符 | **证实**：ADR 出现 2 次，契约 `repoqa.ts:512` 是 `excluded` | **现场修毕**（ADR 对齐实现名 + 说明 rule/count/detail 形状） |
| 3 | Standards | 错误码哨只认单引号 | **证实**：正则 `/code:\s*'([a-z][a-z_]+)'/g`；已加双引号探针 | **现场修毕**（正则收双引号 + 形状断言钉住；改后 3/3 绿，且全库无双引号表外码） |
| 4 | Standards | `scripts/out/*.json` 被提交 | **证实**：`git ls-files` 命中；`.gitignore` 已忽略 `scripts/precision/out/` 有先例 | **现场修毕**（入 `.gitignore` + `git rm --cached`，文件保留在盘） |
| 5 | Spec | 票 16 承诺的 `mcp:model-probe` 缺失 | **证实**：`package.json` 无该脚本 | **现场修毕**（补脚本，并以 `--budget 0` 干跑验证接线） |
| 6 | Spec | 票 12(c) 字段契约与实现不符 | **证实**：实落 `ok`/`args`/`result`/`error` | **现场修毕**（票面改正为实际字段，并写明三条偏差理由：`ok` 取代 `isError`；该层无稳定错误码故按文本聚合；截断由 sink 内部完成故不重复落布尔） |
| 7 | Spec | CHANGELOG 90% 与票 11「未重判」自相矛盾 | **证实**：票 11 该行确写未重判，而 `verdicts/self.json` 已于 2026-09-20 重判 | **现场修毕**（票 11 该行改为"已补做"+ 证据路径与守卫说明） |
| 8 | **Spec** | **票 08 守恒验收空转（同义反复）** | **证实**：`scan-engine.ts:315-318` 是差值赋值，恒等式 | **现场修毕（当日）**——独立计数器 `census.candidatesBeforeRules`（不得由 `total + Σexcluded` 派生）+ 真等式四处断言（census 构造处抛错 / harness / 棘轮不变量① / 单测钉值）；**三仓实测复现收窄前总数**：lazygit `2805=1807+623+375`、petclinic `45=13+31+1`、self `668=250+418+0`（与基线报告 §7.4/§7.5 逐字吻合）；**转红实测成立**（计数器移到规则之后 → 守卫精确报错）。ADR-0018「必要条件②」状态同步改为已落地 |
| 9 | Standards | Go 文件每轮解析两次 | 未自证（judgement call） | **登记**：需先测（本仓"先测再修"纪律），量出收益再动 `GoAdapter` 两次解析 |
| 10 | Standards | ≤5 魔法数重复 / Feature Envy / 谓词重复 / Divergent Change | 未自证（均为 judgement call） | **登记**：谓词重复是本次"数据去重、谓词未去"的已知取舍；其余留待下次触碰该文件时顺手 |
| 11 | Spec | `.zcodeignore` 无票面（本会话工具生成） | **证实**：会话起始 `git status` 无此文件 | **现场修毕**（与 dump 一并 `git rm --cached` + 入 `.gitignore`；文件保留在盘，若要版本化可一条命令恢复） |
| 12 | Spec | ratchet 仅覆盖 self / M1<5% 未达 / 票 03–05 未勾 / 默认档标签 | **证实**，但均为**本批既定如实状态**（票面与报告已登记） | **记录不改** |

### 6 条 judgement call 的逐条处置（2026-09-21 裁决，规则 = spec §6.5「任何不服务于 M1–M5 的改动一律不做」）

| # | judgement call | 处置 | 理由 |
|---|---|---|---|
| 9 | Go 文件每轮解析两次（`GoAdapter.ts:307` 包表 + `:708` 符号趟） | **不修，登记为「待测量」**（HANDOFF §4 仍开放 #5） | 索引耗时是用户可感成本，但"先有度量，再有战役"（spec §1.1）：需先量出 Go 解析在 lazygit 索引耗时中的占比，再决定是否值得合并两趟。**没有数字不动它** |
| 10a | ≤5 行魔法数在 `scan-engine.ts:124/137` 重复 | **不做** | §6.5；且两处语义不同——一处是 `get/set/is` 前缀命名规则、一处按"所属类型的字段名"匹配。抽共享常量会把两条独立规则耦合，属为整洁牺牲可读性 |
| 10b | `zodForJsonType(meta, key, type)` Feature Envy（`repoqa-mcp.ts:1003`） | **不做** | §6.5；形参只用于错误消息定位，改成对象参数是纯风格改动，零行为收益 |
| 10c | 5 个适配器重复同一 `EXTENSIONS.includes(...)` 谓词 | **不做（记录为有意取舍）** | 本次去重的是**数据**（`language-extensions.ts`）；谓词留在各适配器是刻意的——"该适配器能解析什么"属适配器契约的一部分，抽公共函数会多一层间接而收益仅是少 5 行 |
| 10d | `scan-engine.ts` 排除块 Divergent Change（一个嵌套叠加全部排除规则） | **不做** | 排除规则**集中在一处是优点**：候选域被哪些规则裁剪一眼可见，且刚修复的 P1 守恒等式正是靠这个集中的位置才写得出来。拆散会让"守恒"更难核对 |
| 11 | `ratchet-baseline.json` 只冻结 `self` | **记录不改（设计使然）** | CI 无 lazygit/petclinic clone；本地可跑全样本——`npm run precision -- --ratchet self lazygit petclinic`（脚本支持任意样本名），只是未进 CI |

**共同理由**：以上 5 条"不做"全部落在 spec §6.5 的硬规则下——它们都不降低误报、也不提升精度，属整洁性偏好；按本批纪律不为其动代码。唯一例外是 Go 双解析（有真实性能面），故给它留了"待测量"的入口而非直接否决。

### P1 登记 → **当日已修复**：普查守恒空转（轴 Spec ③，我方证实）

**现象**：`census.zeroCallers` 由 `total − testOnly` 反推，故 `zeroCallers + testOnly === total` 是赋值恒等式；harness 的"不守恒即抛错"、棘轮不变量①、单测断言三处**永不触发**。规则**在场性**另有棘轮不变量④把守（`type-declaration` 计数 > 0、`interface-implementation` 必须 `deferred`），所以"某条规则被悄悄删掉"是被抓得住的；**抓不住的是算术本身**——例如计数错位、双重计数、`wiredExcluded` 与 `excluded` 相互吞噬，都不会报警。

**为什么算 P1**：ADR-0018 的必要条件②（"被排除的类必须是可复算的计数…不接受数字变小了但说不清少了什么"）是这条裁决的**验收核心**；恒等式让它在机器层面只完成了一半——数字报出来了，但没有任何东西证明它们加起来仍然守恒。

**修法（已落地，四处 + 转红实测）**：
1. `scan-engine.ts`：在**收窄规则之前**独立累加 `candidatesBeforeRules`（刻意不放在规则之后、也不由 `total + Σexcluded` 派生——**计数器的独立性就是这条断言的全部价值**）；
2. `packages/contracts/src/repoqa.ts`：`ScanCensus` 增该字段（可选，向后兼容）；
3. 断言改为跨规则等式 `candidatesBeforeRules === total + Σ excluded[].count`，落在 **census 构造处（直接抛错）/ harness 守卫 / 棘轮不变量① / `scan-engine.test.ts` 钉值**四处；
4. **转红实测**：把计数器移到规则之后 → 守卫以精确诊断报错（`candidatesBeforeRules(0) != total(1) + excluded(2) — a rule is miscounting or the pre-rule counter moved out of position`）。

**验收证据（三仓同源可复跑）**：`candidatesBeforeRules` 精确复现基线报告的**收窄前总数**——lazygit **2805** = 1807+623+375、petclinic **45** = 13+31+1、self 668 = 250+418+0。即 ADR-0018 的裁决算术（2805 → 1807）从此**每次运行都被机器核对**，而非只在报告里成立一次。

---

## 结论（按轴分别给，不跨轴排序）

- **Standards 轴**：8 条发现（2 硬违规 + 6 判断项）→ **4 条现场修毕、4 条登记**；最严重的是**错误码哨可被双引号绕过**（守卫空转类，已修）。
- **Spec 轴**：4 条缺失/偏差 + 2 条范围外 + 4 条"看似实现实则不满足" → **5 条现场修毕**（含当日修复的 P1）、其余为本批既定状态的如实记录；最严重的是**票 08 的守恒验收是同义反复**（ADR-0018 必要条件②只交付一半，**当日已补齐并三仓复现**）。
- 两轴均未发现：违反 ADR-0002 的猜测式绑定、新工具/新页签、契约破坏、凭据外泄。

**修复后复验（2026-09-21）**：四包 `tsc --noEmit` 净；控制面 **693** 单测；构建净；e2e 本机 **68/2**（两条为 provider 402，非代码）；棘轮用新真等式通过（self 250/1997 = 12.5%，天花板 17.1%）。
