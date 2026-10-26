# Code Review — v1.5.0（2026-10-26）

> 范围：`9c7adfd..cba13ab`（69 文件改动，+1485/−405，11 commits：v1.4.1 / v1.4.2 / v1.5.0）｜ 固定点：`9c7adfd` = 上次审完的 commit（`docs/agents/parallel-collaboration.md` 收口条款「fixed point 不可省」）｜ 形态：并行独立子代理只读评审（Standards 轴 + Spec 轴，两轴**不合并、不重排**）｜ 汇总：Standards 3 硬违规 / 7 判断项；Spec 11 条（缺失或半做 4 / 范围外 4 / 实现有误 3）｜ 裁决：**GO WITH NOTES**

背景：v1.5 批（票 01/02/03/04/06）按 `.scratch/v1.5-deliverable-verification/spec.md` 交付；`9c7adfd` 之后还夹着 v1.4.1（ADR-0021 定位定稿 + 死面清理）与 v1.4.2（Java 裸映射注解）两批修复，故本次范围大于 v1.5 单批。v1.5 票 05（Go chunk 覆盖）为 `deferred`，不属本次实现面。

## Standards

**硬违规（3）**

| # | 位置 | 违规 | 依据 |
|---|---|---|---|
| S-1 | `services/control-plane/src/mcp/output-contract.ts:23-31,88` | 断链标记表自造字面量（`'STATIC_ANALYSIS_BREAK'`、`'BREAK'`、…），永远匹配不上线上真实 wire 值；单一源 `packages/contracts/src/repoqa.ts:125-141` 产出的是 `'[Static Analysis Break: Dynamic/RPC Dispatch]'` 这类整句，`.has(node)` 恒不命中 | `CONTEXT.md:66` 零幻觉合约（静态不可达必须标记、禁止叙述补全）+ 既有 `isExternalDispatchReason` 就是为此存在 |
| S-2 | `output-contract.ts:100-103,114-124,166-171` | `VERIFIED` 仅凭 `fs.stat(file)` 断言，**行号从不校验**（`line` 甚至可为 `null`）；回执为它没做过的校验背书 | `CONTEXT.md:39`（Anchor 只有 raw file 校验通过才能展示）、`CONTEXT.md:66`（每个 file:line 必须过 raw-file 物理校验） |
| S-3 | `output-contract.ts:127,148-171` | 超过 500 条锚点后其余静默跳过，verdict 仍可为 `VERIFIED`；无字段、无 diagnostic 记录截断 | 违背模块自身 `output-contract.ts:17`「绝不静默交付」与 `CONTEXT.md:66` |

**判断项 / 坏味道（7）**

- **Duplicated Code** — `apps/repoqa-web/src/context/ChatRuntimeContext.tsx:248-253` 重新推导 useChat 的完成判据（`message.break === true && !message.anchors?.length && !message.diagram`），两把尺会漂移；流进行中还会报上一条消息的状态。
- **Speculative Generality** — `apps/repoqa-web/src/hooks/useEvolutionSession.ts:98` 单变体联合 `type WorkbenchStream = { kind: 'evolve'; stream: EvolveStreamLike }`；`kind` 标签与 `:59` 的 `IncidentCard` 都没有生产者。
- **Duplicated Code（且其中一份有缺陷）** — `scripts/precision/import_resolution_probe.ts:26` `const TS_EXT = /.(tsx?|jsx?|mjs)$/`（点未转义，`notes` 也会命中）vs `:48` `RESOLVE_SUFFIXES` vs `:137` `stripExt`：三份扩展名清单。
- **Speculative Generality** — `import_resolution_probe.ts:152,173` `aliasCalls` 赋值后无人读取。
- **Duplicated Code** — `services/control-plane/src/languages/JavaAdapter.ts:343-346` 在解析热路径上按方法 `new RegExp`，重复陈述 `:306` `MAPPING_ANNOTATIONS` / `:321` `mappingPathsFromAnnotations`。
- **Primitive Obsession** — `output-contract.ts:34-35,98-106` 靠猜字段名（`file|filePath`、`line|…`）识别锚点；载荷改个键名，证据就静默消失。
- **Error Code Contract 漂移** — `output-contract.ts:57` `ANCHOR_FIELD_INVALID` 声明后从不发射；两个 diagnostic code 作为新机器码落在 `packages/contracts/src/error-codes.ts` 之外（`CONTEXT.md:87`「新码先入本表再实现」），而哨兵 `error-code-guard.test.ts:43` 的 `[a-z]` 正则看不见 UPPER_SNAKE 码。

## Spec

**缺失或半做（4）**

- **spec:30**「无证据返回体（如纯文本答案）回执 verdict=NO_EVIDENCE」——代码对非对象载荷直接早退，纯文本体**连回执都没有**：`repoqa-mcp.ts:1147` `if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;`。
- **票 02:7**「无 root 时锚点校验记 skipped」——没有 skip，`anchorsChecked` 照加：`output-contract.ts:151-153` 先 `receipt.anchorsChecked += 1`，再看 `exists === null` 置 `missingRoot = true` 后 `continue`。
- **票 03:5-6** 重放块须带「repoId、commit、生成时间、本地重放命令（`codecompass trace <symbol>`）」——生成时间缺失；命令不对：`artifact-report.ts:111` 是 `codecompass export "${input.entrySymbol}"`。措辞也不同：`export-artifact.ts:241` 写「file:line 锚点以生成时的仓库状态为准」，票面写「锚点以本地同一 commit 为准」。
- **spec:13**「任一项不过…绝不静默交付」——500 条之外的锚点被静默丢弃：`output-contract.ts:127` `MAX_ANCHORS_CHECKED = 500`、`:148` `anchors.slice(0, MAX_ANCHORS_CHECKED)`，没有任何字段或诊断记录截断，`VERIFIED` 可覆盖未校验锚点。

**范围外（4）**

- **第四种 verdict** `UNCHECKED`（`output-contract.ts:44-50`，赋值于 `:168-169`）——票 01 把 verdict 定为 `VERIFIED / ANCHORS_MISSING / NO_EVIDENCE`；它甚至被写进了 `CHANGELOG.md` [1.5.0]。
- **多出的标记** `'STATIC_ANALYSIS_BREAK'`（`output-contract.ts:30`，全仓无任何发射方）；**多出的键** `'startLine'`（`:35`）超出票 01 的键清单。
- **e2e 断言被改写**，触及 spec:39-40「e2e 断言数（若 e2e 需要新断言，只增不删）」：`scripts/e2e/closeout_gate.py:1904-1912` 把 `and "Lifecycle (v1.0)" in content` 换成 `and "Lifecycle (v1.0)" not in content and "Dataflow (v1.0)" not in content`——既有正向断言被移除，且没有新增记录。
- **越过开线声明的文件面**（spec:34-38）：`languages/JavaAdapter.ts`（+34）与其测试（+88）、`apps/repoqa-web/src/hooks/useEvolutionSession.ts`（−207）、`cli.ts`、`http.ts`、`routes/snippet.ts`、`routes/repos.ts`、新 `docs/adr/0021-*.md`——均为 v1.4.1 评审修复搭车。

**实现有误（3）**

- **断链标记在 trace 载荷上恒为空。** 真实发射方写的是 `'[Static Analysis Break: Dynamic/RPC Dispatch]'` / `_UNRESOLVED` / `_EXTERNAL`（`packages/contracts/src/repoqa.ts:125-141`），消费方靠 substring 匹配（`repoqa-snippet.ts:66`）；这些字符串都不在 `BREAK_MARKER_VALUES`（`output-contract.ts:23-31`）里。spec:27-29 要求逐值清点的读数，对恰好描述的那类载荷返回空表。
- **root 解析过宽。** 票 02:7 只允许 `get_pr_impact` 用 `repoPath`；`repoqa-mcp.ts:1157-1158` 对所有工具生效：`if (!root && typeof repoPath === 'string' && repoPath) root = path.resolve(repoPath);`。
- **诊断码是死的。** `ANCHOR_FIELD_INVALID`（`output-contract.ts:57`）从不发射，只有 `ANCHOR_FILE_MISSING`（`:161`）存在，因此畸形锚点字段不会产生任何带路径的诊断。

## 汇总（一轴一行，不合并、不重排）

- **Standards**：3 条硬违规 + 7 条判断项；最重一条是 S-1——回执宣称的「断链标记清点」在 trace 类载荷上恒为空（diagnose 面部分命中，见「Lead 核验」），等于给零幻觉合约加了一个读数恒为零的仪表。
- **Spec**：11 条（4 / 4 / 3）；最重一条是「断链标记在 trace 载荷上恒为空」——spec 决策 27-29 的核心读数没落地，且票面把 done 打了勾。

两轴**独立收敛到同一处**（`output-contract.ts` 的断链标记表）。这是两条独立路径各自发现的同一事实，不是合并后的单一结论。

## Lead 核验（独立复算，非子代理结论）

- **已证实并加精确化**：`packages/contracts/v1.ts:132-151` `RepoQaTraceHop` 的断口是 `break?: true`（布尔）+ `reason?: string`（整句），两者都不进 `BREAK_MARKER_VALUES` 的裸字符串匹配——**trace 类载荷的 `breakMarkers` 确实恒为 `{}`**；但 `DiagnoseChainStep.status`（`repoqa.ts:179`）的 `BROKEN / SUSPECT / EXTERNAL` 是裸枚举值，**会被正常计数**。故 S-1 的准确表述是「trace 面恒空、diagnose 面部分命中」，不是「永远为空」。
- **已证实**：`anchorsChecked` 在 `exists === null` 时照加（`output-contract.ts:152-156`）；`MAX_ANCHORS_CHECKED` 截断无任何记录（`:148-171`）；`ANCHOR_FIELD_INVALID` 全仓零发射；`ANCHOR_FILE_MISSING`/`ANCHOR_FIELD_INVALID` 不在 `packages/contracts/src/error-codes.ts`（grep 零命中）。
- **已证实**：票 03 与实现的三处偏差（命令 `export` vs 票面 `trace`；无重放块内生成时间；措辞不同）。
- **已修正一处**：spec 轴「e2e 断言数只增不删」——`closeout_gate.py` 的门禁记录条数未变（`record(` 出现 95 次含函数定义，改前改后一致），变动是把「断言该 ✓ 存在」改成「断言其不存在」，因为被断言的东西已按 ADR-0021 删除；不改则门禁必红。**这不算削弱门禁**，但「只增不删」的字面要求确实被改写，属于需要票面追认的处置。
- **已降级一处**：spec 轴「纯文本体无回执」——17 个 MCP handler 全部返回对象（`repoqa-mcp.ts` 无 `=> string` / 数组返回），该分支当前不可达，属字面偏差而非实际缺陷。
- **已排除**：`export-artifact.ts:291` 里硬编码的 `CodeCompass v0.9` 是旧行（本 diff 未触及），不构成本批违规；但它确实违反了 `version.ts:4`「不要把版本号硬编码到别处」，建议随下批清掉。

## v1.6：TS 模块解析战役 —— 判定开

依据 `.scratch/v1.4-usable-tool/issues/08-deferred-ts-module-resolution.md` 自设的 `立项时必须先做的事`：

1. **先量（已完成）**：2026-10-25 的评论用 `scripts/precision/import_resolution_probe.ts` 在 self 仓（`38deb70`）实测——跨文件调用 4055 条，其中同名多文件声明歧义 **3274 条**；若解析 import 声明（只走相对路径，self 无 `@/` 别名、无 tsconfig paths），**1301 条可被唯一钉死**——占全部跨文件调用 1301/4055 ≈ 32%，占歧义边 1301/3274 ≈ 40%（票面按后者记作 40%），报告落在 `scripts/precision/out/import_probe_self.json`。度量门槛已过。
2. **棘轮保护（立项时做）**：先冻结三仓（self / lazygit / petclinic）orphan 计数与假定边计数基线，字节级差异必须逐条解释。
3. **ADR（立项时做）**：写清「模块路径解析」与「不猜」原则的关系——specifier 缺席时 EXTERNAL/UNRESOLVED 的语义细化。

判定与边界：

- **开**，以 v1.6 立项，**分阶段**：①只做 import/export 声明解析 + 相对路径模块表；②再谈 tsconfig `baseUrl`/`paths`；③最后谈 workspaces。理由：self 仓不含别名，**别名覆盖度在本批度量里是零样本**，一步到位会把未测量的面当成已测量。
- **硬停条件**：lazygit（Go）/ petclinic（Java）前后字节必须不变；self 仓 3274 条歧义只能下降、不得以「更聪明的猜测」换数字——与 `CONTEXT.md:40` 一致。
- **诚实披露**：触发线 1（真实用户可复现的错绑）尚未出现，本战役是**机会驱动而非事故驱动**；`README` Known Limitations 现有的披露（不解析 import、按符号名绑定、同名可能错绑）在战役落地前必须保留。
- 竞争候选：v1.5 票 05（Go chunk 覆盖）仍 `deferred`，其触发线（「AST 命中但 chunk 未命中」真实案例）未出现，优先级低于本战役。

## 未验证 / 边界

- 断链标记「恒空」只在类型与发射方层面证实，未对真实返回体做端到端取样；建议补一条 fixture：造一条 `break: true` 的 trace 载荷，断言 `breakMarkers` 非空——这条断言会红，正好作为修复的 red test。
- 锚点行号校验（S-2）理想的判据是「读文件、确认行号落在文件行数内」，本评审未验证 chat 侧 raw-file 校验的具体实现是否已如此，故 S-2 的严重度按「回执自称校验但未校验」计，而非按「已产生错误结论」计。
- `import_resolution_probe.ts` 的 `TS_EXT` 未转义点号确实会多匹配，但该脚本只产出度量报告、不参与门禁，未评估其对 1301/3274 这两个数字的实际影响；**立项第一步应重跑并复核该数字**。
