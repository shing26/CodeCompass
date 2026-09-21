# Issue 07 — MCP 契约正确性收口（提案，待裁决）

> **状态**：**已裁决 · 批准开工**（2026-09-18 用户裁决，附**两项硬条件**，见文末「裁决记录」）
> Spec：`.scratch/v031-precision/spec.md` §1.2（冻结面）、§3（M4）
> 波次：**Wave 1.5**（已由裁决确认；与票 03 共享 README 面，须串行） ｜ 依赖：无（不依赖票 01 精度数字）
> 依据：2026-09-17 MCP 搭建完善度审计（`.workbuddy/memory/2026-09-17.md`，每条含复现命令）

## 目标

**在不新增工具、不新增签名的前提下**，修掉 MCP 契约面上四处「声明与实现不一致」的存量缺陷。
全部证据来自实测，非体感；全部改动落在既有代码/文档面，属**缺陷修复**而非能力扩展。

与 A 主轴（「给 coding agent 的确定性代码事实层，MCP-first」）直接对齐：
MCP 是主面，则主面的契约正确性优先于任何 Web 面工作。

## 内容

### (a) server `instructions` 未设置 —— **本票最高杠杆项**

MCP 初始化握手支持 `ServerOptions.instructions`（SDK 1.30.0 `server/index.d.ts:7-15` 已确认可用），
CodeCompass 只传了 `{ capabilities: { tools: {} } }`（`repoqa-mcp.ts:979`），**instructions 缺席**。

后果：17 个工具跨 5 个使用阶段（索引 → 发现 → 定位 → 穿透 → 演进），但**没有任何一处告诉 agent
跨工具的工作流顺序**。尤其 ADR-0016 的异步契约（`index_repo` 立即返回 → 必须轮询 `list_repos`）
目前只写在 `index_repo` 自己的 description 里；agent 若先调别的工具，无从得知这条硬约束。

描述质量**本身是好的**（逐一核过：`diagnose` 说明入口格式与返回结构，`get_dashboard` 说明"一次调用替代…"）——
缺的不是描述，而是**跨工具的编排指引**。这恰是 `instructions` 的职责。

拟写入内容（约 15 行字符串）：
1. 工作流顺序：`list_repos` → （未索引则 `index_repo`）→ `scan` 找切入点 → `diagnose`/`trace_call_chain`/`reverse_deps` 定位 → `plan_evolution`/`get_conventions` 要方案。
2. 轮询契约：`index_repo` 立即返回 `indexing`，必须轮询 `list_repos` 至 `ready`/`error`（ADR-0016）。
3. 只读边界：除 `index_repo`/`remove_repo` 外全部只读；引擎永不改源码。
4. 事实边界：静态调用边 ≠ 运行时链路；`BREAK`/`SUSPECT` 标记不可叙述性补全（零幻觉合约）。

**契约影响**：无。`instructions` 是 initialize 期的服务端提示串，不改任何工具签名与数量。

### (b) `zodShapeFor` 类型护栏是空操作 —— 实测坐实

`repoqa-mcp.ts:961`：`const base = spec.type === 'string' ? z.string() : z.unknown();`

全库唯一非 string 参数是 `maxTokens: { type: 'number' }`。复刻该逻辑实跑 zod：

```
maxTokens 实际类型 => ZodOptional(包裹 ZodUnknown)
maxTokens="500"    accepted? true
maxTokens={"x":1}  accepted? true
maxTokens=true     accepted? true
maxTokens=[1,2]    accepted? true
```

**四种非数字类型全部通过**——不是"宽松"，是"没有"。当前靠 handler 内 `Number()` + 范围检查
（`:633-637`）事后兜住，属事后校验而非契约约束；且客户端拿到的 schema 中 `maxTokens` 类型不可读，
agent 无从得知该传数字。

修法：把三元表达式换成按 `spec.type` 的映射表（`string→z.string()`、`number→z.number()`、
`boolean→z.boolean()`、`array→z.array(z.string())`），**未识别类型抛错而非静默降级**；
顺带删掉 `:962` 的 `(base as z.ZodString).optional()` 伪断言（改为 `base.optional()`）。

**契约影响**：收紧既有参数的类型。属修复，非新签名。

### (c) MCP 出库无脱敏收口点

全文件 1102 行、17 工具，`maskSensitiveText` **仅 1 处**（`:492`，只用于 `repo.error`）。
对比 HTTP/SSE 面：`http-error.ts:79`、`chat/routes.ts:52/187`、`repoqa-worker.ts` 多处收口。

**当前不是活泄露**：`diagnose` 的 `readSnippet`（`diagnose-engine.ts:110`）与
`graphrag`（`repoqa-graphrag.ts:359/457`）各自内部已脱敏，这两条路安全。
问题在于 `textResult()`（`:967`）作为**唯一出口对 payload 不做统一兜底**——新工具一旦返回含凭据字段
即静默出库，没有第二道网。

而这与 `CONTEXT.md` 自陈的「出库掩码不变式」覆盖「MCP stdio 事件」存在**实现漂移**（v0.29 立的红线）。
MCP-first 定位下，主面缺收口点应当补齐。

修法：`textResult()` 内对序列化后字符串过 `maskSensitiveText`（或复用现成 `maskEventPayload` 深走）。
一处改动覆盖全部 17 工具与未来所有新工具。

**契约影响**：输出值可能被掩码（本就是这个不变式的承诺）。

### (d) README 工具表与实现不一致 —— 票 03(b) 的 ✅ 被高估

票 03 (b) 验收写「README 工具数…与实现一致 —— `cb15585`（工具数 15 → 17）」，已打 ✅。

**实测复核**：
- README:163 正文「17 个」——✅ 已修。
- README:167-181 **工具表只有 15 行**——✗ 未修。
- `codecompass_get_conventions` 在 README 中**零出现**；`codecompass_plan_evolution`
  **仅作为 `module_evolution` 行内的交叉引用文字出现**（"已弃用，由 plan_evolution 接替"），无独立行。

即：改的是**正文数字**，漏的是**可枚举清单**。M4 验收目标是「陌生人照 README 一行命令即可接入」，
而清单里查不到的两个工具恰好是演进族（`plan_evolution` 还是 `module_evolution` 的接替者）——
读了表反而会去用已弃用的那个。

修法：**不再是"表格补 2 行"的一次性手改**（裁决硬条件①）——把工具表改为**从 `MCP_TOOLS` 生成**：
表格块用 `<!-- mcp-tools:begin -->` / `<!-- mcp-tools:end -->` 标记包裹，新增生成脚本按 `MCP_TOOLS` 的名称集合渲染，
用途文案取自脚本内的显式标签映射；**工具名缺标签、或标签对应不到工具，生成一律报错**（fail-closed，不静默少行）。
生成之后任何人改 README 或加工具，两侧都会立刻不一致 —— 由 gate 断言 `readme-tool-table-parity` 抓出
（双向集合相等，而非只数行数）。同时给 `module_evolution` 行加机器可读的弃用标注。

**契约影响**：无（纯文档）。

### (e) 建议加的门禁断言（4 条，对齐既有 gate 风格）

| 断言名 | 内容 |
|---|---|
| `mcp-server-instructions` | `createMcpServer` 传入了非空 `instructions` |
| `mcp-tool-schema-types` | 遍历 `MCP_TOOLS`，每个 `properties[k].type` 都能映射为具体 zod 类型（无 `unknown` 兜底命中） |
| `mcp-egress-masking` | `textResult` 对含 `password=` 的样本输出掩码成功 |
| `readme-tool-table-parity` | README 工具表行集合 == `MCP_TOOLS.map(name)`（集合相等，双向） |

## 验收

- [x] `instructions` 非空，且在真实 MCP 客户端 `initialize` 响应中可见（留 raw 帧）—— 947 字符；
      单测 `initialize carries non-empty instructions covering the ADR-0016 polling contract` 断言 raw `initialize` 帧可见；
      e2e 断言 `issue07 mcp-server-instructions` 同名复验
- [x] `maxTokens="abc"` / `maxTokens={}` / `maxTokens=true` 三类调用被 SDK 层拒绝（不再进 handler）—— **但验收措辞需按实测改写，见下方「实施记录」**：
      SDK 的输入校验失败**不是** JSON-RPC `error` 字段，而是被 call handler 的 catch 包成 `result.isError: true` + 文本 `Input validation error`
- [x] `textResult` 对含凭据样本输出掩码（**硬条件②** 已满足）—— 单测直接打在 `textResult` 这一层：
      运行时拼接的 AWS key 与 `password=` 赋值均已消失、`file:line` 锚点未被误伤、掩码后 JSON 仍可解析
- [x] README 工具表由脚本生成且与 `MCP_TOOLS` 集合相等（**硬条件①** 已满足）—— 生成脚本 + `readme-tool-table-parity` 双向断言**双留证**；
      **实测记录**：手工在 `get_conventions` 行尾追加探针串 → 生成器 `--check` 退出码 1、gate 断言 `[FAIL]`（诊断精确到「工具集合相同、文案漂移」）→ 重新生成后 `[PASS]`，无残留
- [x] `npm test` + `closeout_gate.py` 全绿；MCP 工具数与签名**零变化** —— 控制面单测 **666 → 670**（+4）；
      e2e **63 → 68**（+5 条断言）；四包 `typecheck` 净；`tools/list` 仍 17 项、签名未动
- [x] 用真实 agent 复跑一轮 MCP 会话（dogfooding）——验证 instructions 是否真的改变了 agent 的调用顺序 ——
      **2026-09-19 部分补上（单样本、agent 即实现者，非外部用户）**：真实会话按 `instructions` 声称的顺序走通
      `list_repos` → `scan` → `reverse_deps` / `trace_call_chain`（本仓，索引 symbolCount 1954 与当日 harness 一致）。
      结果如实记录：`reverse_deps` 31 个调用点逐条抽验与事实吻合（含当日新增的 `textResult:1032`），**真有用**；
      hubs / oversized / oversizedFiles 三桶信号与事实全部吻合；`trace_call_chain` 前两跳行号精确、断点诚实但深度浅
      （断在 `Map.set`）；**scan 孤儿桶 top-10 实测仍 100% 假阳性**（8/10 为 `RepoQAClient.*`，`listRepos` 生产调用点
      grep 实锤 3 处——根因即 V31-02 登记的「工厂返回实例/实例字段分派缺口」，在前端 hooks 构造的 client 实例上复现）；
      `App` 被新逻辑正确标注 `testOnly`。→ 前端实例字段回填成为下一个精度根因候选。

## 实施记录（2026-09-18）

**已落地的四处代码/文档改动**（全部在本机工作区验证，未提交、未打 tag）：

| 项 | 落点 | 实测 |
|---|---|---|
| (a) `instructions` | `repoqa-mcp.ts` 新增导出 `MCP_SERVER_INSTRUCTIONS`（947 字符），传入 `ServerOptions` | raw `initialize` 帧可见；含 `list_repos` / `indexing` 轮询契约 |
| (b) 类型映射 | `zodForJsonType()` 取代三元表达式；string/number/boolean/array 四类映射，**未识别类型抛错**；删掉 `(base as z.ZodString)` 伪断言 | `maxTokens="500"` 在 schema 层被拒（handler 未进），`maxTokens=500` 正常通过 |
| (c) 出口脱敏 | `textResult()` 对序列化结果过 `maskSensitiveText`；为可测而 `export` | 单测覆盖该层；`diagnose` / `graphrag` 的内部脱敏不再被当作证据 |
| (d) 工具表生成 | 新增 `scripts/docs/sync-mcp-tool-table.py`；README 加 `<!-- mcp-tools:begin/end -->` 标记块，**正文数字与表格一并生成** | 17 行按 `MCP_TOOLS` 声明序；弃用行带机器可读 `deprecated` 令牌 |

**踏车改动（同文件一次性改完，归属票 03(b) 面，可单独回退）**：① README 两处 IDE 配置的 `npx codecompass` 改为 `npx -y @codecompass/cli`
—— 前者会让陌生人装到 npm 上他人的 `codecompass@1.0.0`（照做即出错，非"可能出错"）；② README 版本串 `v0.26.0` → `v0.31.0`，
并新增 `readme-version` 断言（`check_versions` 原本只覆盖 package.json / version.ts / CHANGELOG，README 是三处之外的第四处）。
**未加**清单建议的"内测期不经 npm 分发"免责声明：票 03 的 M4 目标是发布后照 README 一行命令接入，该声明发布即作废，属自找漂移。

**两条措辞修正（供后续引用时不要照抄旧稿）**：
1. (b) 的拒绝**表现为 `result.isError: true`**，不是 JSON-RPC `error`。本票实施时先按后者写了断言，实测红了才发现，
   gate 断言与单测均已按正确表层重写。
2. (c) 的 gate 级断言（原 (e) 表的 `mcp-egress-masking`）**未实现，改由单测承担**：gate 走的是真实工具调用，
   而 17 个工具**按设计都不返回凭据值**（`get_config_evidence` 只回 file:line），门禁层没有可用的阳性样本；
   硬造一个就得往生产工具里注入假凭据，属为门禁改产品。单测直打 `textResult` 是本层唯一诚实的证据。


## 风险

- **冻结面边界需明确**：spec §1.2 写「不允许加签名、加工具」。本票 (a)(c)(d) 明确不动签名；
  (b) **收紧了既有参数类型**——虽属修复，仍建议在 spec §1.2 补一句「类型/校验收紧与输出掩码属修复，不受冻结限制」，
  否则下一个人会把它当越界。
- 加严 `maxTokens` 类型后，若已有客户端在传字符串（如 `"500"`）会被拒绝。`Number()` 兜底路径的存在说明
  作者预期过宽松输入——**建议先在真实 agent 会话里观测一轮**，或保留字符串数字的 coerce 分支（`z.coerce.number()`）
  作为过渡。
  **实施决策（2026-09-18）**：取严格 `z.number()`，**未**采用 coerce 过渡——两条建议互斥：`z.coerce.number()` 会把 `true` 强转成 `1`，
  与验收项「`maxTokens=true` 被拒绝」直接冲突。要 coerce 就得先改验收，二者不能同时成立。
  代价是 `"500"` 这类字符串调用会开始被拒；若真实 agent 会话里确有此调用，应按「改验收 + coerce」重开，而不是悄悄放宽。
- 门禁断言 `readme-tool-table-parity` 会在未来加工具时同步报红——这是**期望行为**（强制清单同步），
  但需在 HANDOFF 的「新增工具需同步」清单里补上这一项。**新增工具的流程现在是两步**：加 `MCP_TOOLS` 条目 →
  在 `scripts/docs/sync-mcp-tool-table.py` 的 `LABELS` 补文案（缺标签时生成器直接报错，不会静默少一行）。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `services/control-plane/src/mcp/repoqa-mcp.ts` | 共享区 | (a)(b)(c) 三处；MCP 线主文件，开工前需与 workbench 线对齐认领 |
| `services/control-plane/src/mcp/repoqa-mcp.test.ts` | 共享区 | 增 4 条断言对应单测 |
| `scripts/e2e/closeout_gate.py` | 共享区 | 增 4 条 gate check |
| `README.md` | 共享区 | (d) 工具表改为标记块生成；与票 03 同文件，**需与票 03 串行或合并** |
| `scripts/docs/sync-mcp-tool-table.py` | 共享区 | **新增**（硬条件①）：工具表生成脚本；新增文件，不与既有脚本撞面 |
| `.scratch/v031-precision/spec.md` | 共享区 | 若裁决纳入，补 §1.2 冻结边界一句 + 票池加第 7 票 |
| `CHANGELOG.md` | 共享区 | 随所属版本批次写，不单独占条目 |

**边界**：本票**不含**任何能力面扩展（`annotations` / `outputSchema` / `resources`），
那些属冻结面外延，需单独裁决，见下方「未纳入项」。

## 裁决记录（2026-09-18）

**裁决：批准开工。** 附两项硬条件——两条都不是可选项，未满足即不算收口：

| # | 硬条件 | 落成的验收 | 为什么加 |
|---|---|---|---|
| ① | **README 生成同步** | 工具表由 `scripts/docs/sync-mcp-tool-table.py` 从 `MCP_TOOLS` 生成（标记块内），gate 增 `readme-tool-table-parity` 双向集合断言；验收含「手工改坏一行 → gate 转红」实测 | 票 03(b) 的教训是**只改了正文数字、漏了可枚举清单**，还打了 ✅——一次性手改治不了这类漂移，只能靠生成 + 断言 |
| ② | **脱敏测试覆盖** | `textResult` 层必须有独立单测（含凭据样本进 → 掩码出）；不得用 `diagnose` / `graphrag` 的内部脱敏充当证据 | (c) 的全部价值就是「统一出口兜底」；而那两条路**各自已收口**，恰是唯一无法证明本层生效的地方 |

**边界确认（对应本票「风险」第一条）**：(b) 收紧 `maxTokens` 类型、(c) 输出掩码，**均属修复而非能力扩展**，
不受 spec §1.2「只减不增」冻结限制 —— 该句已在 spec §1.2 补入。

