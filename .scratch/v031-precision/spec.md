# Spec: v0.31 精度优先 —— 方向落地批

> **依据**：`D:\WorkBuddyData\CodeCompass-方向定位-2026-09-16.md`（裁决：A 主轴 + D 交付方式，B 延伸，C 副产品）
> **立项**：2026-09-16 ｜ **前置**：v0.30.0 + 整理批（`2c0f82c`/`80c3ab1` 已推）｜ **版本预占**：`v0.31.0`（工程批）→ `v1.0.0`（宣告批）
> **性质**：方向落地。本 spec 只规划，不实现；实现走 `issues/`。

---

## 0. 一句话

**把「确定性 = 精确」这个核心承诺在真实仓库上兑现到 <5% 假阳性，然后把门装上（npm 真发布），再用真实数字兑付成外部可验证资产。不开新能力面、不再打磨界面。**

---

## 1. 方向裁决（继承定位文档，落地为可执行约束）

- **定位一句话**：给 coding agent 的确定性代码事实层（MCP-first）；Web 工作台降级为演示厅与调试面。
- **主轴 A｜引擎精度 + 真发布**：度量单位是「真实仓库假阳性率」，不是「功能数」。
- **交付 D｜影响力兑付**：v1.0.0 宣告 + 带真实数据的技术文 + 可复现 benchmark。
- **延伸 B｜团队门禁**：触发条件见 §5，不在本批。
- **副产品 C｜交付件导出**：不投入，随 A 的自然产出走。

### 1.1 放弃清单（写下来才算裁决 —— 转成硬约束）

| 放弃项 | 落成的约束 |
|---|---|
| 不再为 Web 面做视觉/文案/响应式战役 | 前端改动只允许「收敛与非破坏性修复」；`copy-guard` 双哨维持执法，但不立新文案战役 |
| 不再增加第 7 个 Tab、第 18 个 MCP 工具 | 新增 MCP 工具/界面必须附「降低误报或提升精度」的论证（写入 HANDOFF §2.2 纪律） |
| 不再追版本号节奏 | 本批只发 **v0.31.0** 与 **v1.0.0** 两个锚点；中间不打 tag |
| 不再让体感驱动战役 | **先有度量，再有战役**：无 ticket 01 的数字，不立优化票 |

### 1.2 冻结面（只减不增）

- **Web 6 Tab → 条件收敛为 3**（票 05；D 目标下可整票裁剪）：`chat`/`gate`/`delta` 保留一级导航，`topo`/`metrics`/`evolve` 降为深链页面。
- **MCP 17 工具**：签名与数量冻结为 v1 契约；本批只允许「同一工具输出更准」，不允许加签名、加工具。
  **类型/校验收紧与输出掩码属修复，不受此限**（2026-09-18 随票 07 裁决确认）；唯一新增的服务端字段是
  initialize 期的 `instructions` 提示串，不改任何工具签名与数量。

### 1.3 待用户裁决的一项（不阻塞本批）

定位文档 §5 的问题——**「这个项目对你是什么？」**（产品 or 资产）。本 spec 按文档给出的决策规则取默认：

> **默认执行「先 D 后 A」**（D 是 A 的前置：没有公开放大的精度数字，A 拿不到第一批用户）。
> 影响面：票 05（Web 收敛，D 目标可省）与票 04 的对外投放力度。若用户后续裁决为「只做资产」，票 05 直接关闭；若为「要做产品」，票 04 后追加分发渠道票。

---

## 2. 实证修正（规划期核实，与定位文档有出入之处）

| 定位文档的判断 | 仓库实证（本 spec 核实） | 规划结论 |
|---|---|---|
| §4 Step 1「清掉 scan-dogfooding 五个 issue」 | **六个 issue 已全部实现**：v0.22 修 01/02/03/05，v0.23 修 04/06 | Step 1 重定义为**「复测 + 残余根因」**，不是修 issue |
| 假阳性率 43% / 31% / 83% | 修复后唯一实测数字 = lazygit **43% → 31.3%**（v0.22 验收）；petclinic 与本仓库**无修复后数字** | 三个数字都要重测；距 <5% 目标尚差约 6 倍 |
| `docs/benchmark.md` 可直接补真实仓库段 | 该文档停在 v0.16 / **75 题**；当前 eval 实为 **97 题**（10 个 bucket） | 需先刷新再补真实仓库段 |
| README 已自我修正到 P2 定位 | 定位正确，但写着「**15 个**确定性工具」（实际 17）；安装方式 `npx @codecompass/cli` 经 npm registry 实查 **404** | 发布前必须与实现对齐 |
| 证据索引 `docs/repoqa-prd.md:7-12` 等 | 这些路径已随整理批（V30-11）迁至 `docs/archive/` | 引用按新位置读 |
| 「MCP 面冻结为现有 8 工具」（`CONTEXT.md:79`） | 实际 17 工具，其中演进族已补齐（Issue 25） | 该词条属**历史冻结记录**，与 §1.2 的新冻结语义不同，票 03 一并校准 |
| 「版本六处」协作约定（`docs/agents/parallel-collaboration.md`） | 已过时：主版本单一源 = `src/version.ts`（V27-25），`MCP_SERVER_VERSION` 为别名且受 gate 棘轮（V30-11） | 票 03 修正该文档 |

---

## 3. 度量口径（先有度量，再有战役）

| # | 指标 | 口径 | 当前值 | 目标 |
|---|---|---|---|---|
| M1 | **真实仓库假阳性率** | 三样本（lazygit Go / spring-petclinic-microservices Java / 本仓 TS），scan 孤儿桶取 top-N 候选（与 v0.21 取证同口径，n=10）逐条人工核验 | lazygit 31.3%（修复后）/ petclinic 31%、本仓 83%（**修复前**，待重测） | **< 5%** |
| M2 | 桶污染率 | vendor / 测试夹具符号进入 hubs、oversized、oversizedFiles 榜单的条数 | 未测 | **0** |
| M3 | 合成回归护栏 | `npm run eval`：97 题、Recall@5 ≥85%、幻觉率 ≤2%（incident 0%） | 全阈值通过 | 不回退 |
| M4 | 发布可用性 | 干净机器照 README 抄一行命令完成 MCP 握手并返回 `list_repos` | **1（2026-09-25 达成：npm 首发 + 干净目录实测）** | 1 ✔ |
| M5 | 工程资产 | 公开可验证物：npm 发布物 / 技术文 / 可复现 benchmark / 公开精度报告 | 0 | ≥3 |

**度量纪律**：M1 的采样与判定脚本必须可复跑（票 01），数字入 `docs/reports/` 留档；**不允许按目标倒推口径**——若 <5% 不可达，诚实写出可达下限与代价。

---

## 4. 票池

| 票 | 标题 | 依赖 | 关键验收 |
|---|---|---|---|
| [01](issues/01-precision-baseline.md) | 精度复测基线（度量先行） | — | 一条命令产出三仓五桶 + 抽样清单；人工核验后出 before/after 对照表 |
| [02](issues/02-residual-precision.md) | 残余精度攻坚 | 01 | M1 三仓 <5%；不可达则给可达下限与根因清单 |
| [03](issues/03-release-readiness.md) | 发布就绪（npm 首发 + 文档一致性）—— **✅ 已发布（2026-09-25，M4=1）**：`@codecompass/cli@0.31.0` 上 npm，干净目录实测握手 17 工具 | 01 | M4=1 ✔；包内容干净 + 打包产物端到端握手；README/benchmark/协作文档/CONTEXT 四处与实现一致；发布拦路（scope/2FA/PowerShell `&&`）与解法入档 |
| [04](issues/04-impact-delivery.md) | 影响力兑付（v1.0.0 + 技术文 + 公开评测） | 02、03 | M5 ≥3；tag 双绿；benchmark 数字可由命令复现 |
| [05](issues/05-web-convergence.md) | Web 收敛 6→3（**条件票**，D 目标可裁剪） | — | 一级导航 3 项；深链全可达；web 单测全绿且净减 |
| [06](issues/06-freeze-guardrails.md) | 冻结护栏与 V27 余账归位 | — | 三文档口径一致；六项 V27 余账处置留痕 |
| [07](issues/07-mcp-contract-closeout.md) | MCP 契约正确性收口（**2026-09-18 裁决批准，附两项硬条件**） | — | `instructions` 非空；`maxTokens` 三类非法输入被拒；`textResult` 掩码有独立单测；README 工具表由脚本生成且受双向 gate 断言 |
| [08](issues/08-bucket-semantics.md) | 孤儿桶语义收窄（**ADR-0018**，2026-09-18 裁决 A / A→A′ / B） | 02 | lazygit 孤儿 2805 → 1807；排除计数守恒且可解释；接口实现项以 `deferred` 显式登记；M1 复算留档（允许仍 100%） |
| [09](issues/09-language-registry.md) | 语言注册表单表派生 + ParseContext 按语言键（外部评审 C2/C3，**2026-09-19 批准**） | — | 加语言操作面收敛为 2 处；扩展名双向守恒单测；三仓精度复算逐字节不变 |
| [10](issues/10-error-code-contract.md) | 错误码单一源 contracts/error-codes.ts（外部评审 C4，**2026-09-19 批准**） | — | 前端 `Record<ErrorCode,string>` 编译执法；服务端扫描哨；CONTEXT 表 ↔ 代码双向对账；wire 格式零变化 |
| [11](issues/11-nested-scope-receiver-typing.md) | TS 接收者定型（实例字段回填；**2026-09-19 已实施**） | — | self 孤儿 **283 → 236**（原根因族清空）；lazygit/petclinic 逐字节不变；fail-closed 遮蔽单测；剩 7 条 top-10 分属 (g)(e)(f) 三族已登记 |
| [12](issues/12-mcp-audit-log.md) | MCP 审计日志接线（**评估维 E-M12：1→3**，2026-09-21 批准） | — | 收口点接线 + 可选 logger 注入；e2e 断言审计行字段齐全；`mcp:stats` 出成功率/耗时分布/错误分布 |
| [13](issues/13-idempotency-and-side-effects.md) | 幂等与副作用边界（**E-M7：2→3**） | 12 | 三条重复调用测试（身份幂等/重复删除 fail-closed/indexing 中拒绝）；`docs/mcp-tool-contract.md` 读写分类表 |
| [14](issues/14-mcp-conformance-suite.md) | 通用 MCP 协议层一致性套件（**E-M10：口径边缘→名实相符**） | — | 6 项协议断言可对任意服务端跑；对违规假服务端必须报错；零项目数据依赖 |
| [15](issues/15-context-budget-comparison.md) | 上下文治理 token 剪枝对比（**E-M4：2→3**） | — | 两档对比表 + 超限触发实测（`truncated=true`）；脚本可复跑 |
| [16](issues/16-model-in-the-loop.md) | 模型在环一轮实验（**E-M5：2→3；E-M2 仅前向基线仍 2**） | — | 自愈成功率 + 误调率基线入报告；≤20 次调用；口径声明齐全 |
| [17](issues/17-ts-tour-anchors.md) | TS/JS 仓的 Tour 锚点族（**V27-17 升级票**；2026-09-21 立项待开工） | 11（同域 TS 解析） | 本仓 `get_tours` 非空且锚点可验证；Java 侧不回退；模块级 JSX 边使 self 孤儿**下降**；三仓复测留档 |
| [18](issues/18-residual-receiver-families.md) | 精度残余三族（(g) `Pick<>`/具名接口成员 · (f) `useMemo` 工厂/上下文解构 · (e) 闭包参数别名；**✅ 三族全落地 2026-09-21/24**） | 11（同文件，须串行） | self top-10 的 `RepoQAClient.*` **7 → 1**（仅真阳性 `getRepo`）；三族各有反例单测；lazygit/petclinic 逐字节不变 |
| [19](issues/19-multiline-template-masking.md) | 多行模板串未掩码 → 幻影声明（**票 18 实测暴露，2026-09-24 立项**） | 18（同文件，须串行） | 多行模板里的 `interface X {` 不得产出符号；两阶段掩码；三仓复测 + 棘轮按新 `symbolCount` 复算 |
| [20](issues/20-interface-implementation-table.md) | 接口→实现关系表（**✅ 已落地 2026-09-24**；**票面前提被推翻**：表早已存在，真缺口是接收者定型） | 18（同文件，已串行） | self 流订阅族整族离榜、孤儿 246 → 237；lazygit/petclinic 逐字节不变（**Go 无 `implements`，不变是预期**） |
| [21](issues/21-named-fallback-false-edge.md) | `dynamic:false` + 未知接收者类型仍按名回退（**票 20 实测派生，2026-09-24 立项**） | 20（同因） | 先量三仓"声明了类型但类型不在索引"的边数；`x: UnknownType` 上调 `x.foo()` 不得绑同名全局方法 |

**波次**：Wave 1 = 01 + 06（可并行，零冲突）；Wave 2 = 02 + 03（02 动引擎、03 动发布与文档，文件面不撞）；Wave 3 = 04（收口人制，含 v1.0.0 版本五处推进）；05 视 §1.3 裁决择机；
**07 = Wave 1.5**（2026-09-18 裁决批准；与 03 共享 `README.md`，须串行或合并提交——本批 v0.31.0 尚未打 tag，07 可在 tag 前搭车收口）；
**08 = Wave 2.5**（2026-09-18 三裁决落地；排在票 02 之后，因为它消费票 02 的基线，且与 07 共享 `repoqa-mcp.ts` 与 README 生成块，须串行）；
**09 + 10 = Wave 3.5**（2026-09-19 批准，外部框架评审 C2/C3/C4 的候选票；09 动 languages/ingest 面、10 动契约与前端错误码面，文件面不撞，可并行）；
**12–16 = Wave 4**（2026-09-21 批准，外部评分维补齐批：E-M12→E-M7 串行（13 依赖 12 的日志），14/15 可并行，16 需模型在环且排在最后——它是唯一花 token 的一项）。
**17/18 = Wave 5**（2026-09-21/24 落地：18 三族全闭，self top-10 的 `RepoQAClient.*` 7 → 1；17 待开工）。
**19/20 = Wave 6**（2026-09-24 由票 18 实测派生：19 = 多行模板未掩码的幻影声明；20 = 接口→实现关系表。**20 已落地**——前提被实测推翻，实为接收者定型三处缺陷；**19 待开工**；**21 由 20 派生**（按名回退假边口子），与 19 均须与 `TypeScriptAdapter.ts` / `repoqa-callchain.ts` 串行）。
**命名约定**：评估维写作 **E-M1…E-M12**（外部评分标准 §2.1），与本 spec §3 的交付指标 **M1–M5** 区分；两套编号含义不同，文档中不得省略前缀。

---

## 5. 延伸触发条件（B / C 何时才动）

- **B（团队门禁）**：出现 ≥1 个愿意连续使用 3 个 sprint 的真实团队，且 M1 已达标（误报率 >5% 的门禁会被团队直接关掉）。届时新开 spec，本批不预留。
- **C（理解交付件）**：仅在「私有仓 / 不能上云 / 中文 / Java 深度」场景；公开仓库方向正面撞 DeepWiki，不做。

---

## 6. 风险与逆风条件

1. **宿主平台下沉**（Cursor / Anthropic 原生索引）：若半年内把「跨语言调用链 + 逐字锚点」做进原生能力，A 线天花板立即塌 → 票 04 的时间敏感性最高。
2. **精度到不了 <5%**：Go 跨文件类型引用（`declaredTypes` 按文件）是已登记主因，但可能不是全部。**降级策略**：给出「可达下限 + 剩余噪声的可解释性」，把「可解释」而非「绝对干净」作为对 agent 的承诺。
3. **发布凭证在用户侧**：npm 发布与 npm org（`@codecompass` scope）需用户本机执行，agent 只能做发布前验证与发布后核验。
4. **不可测指标**：Local-First 无遥测 ⇒ TTFP / Adoption 永远拿不到数。**接受**用「dogfooding + 公开仓库评测」替代，并且**不再把这两个指标写在任何对外文案里**（票 06）。
5. **重蹈「擦亮代替方向」**：本批的退出条件写死在 §3 的 M1–M5；任何不服务于 M1–M5 的改动一律不做。

---

## 7. 明确不做

- 不做 Web 视觉/文案/响应式新战役；不加 Tab；不加 MCP 工具（除非直接降误报）。
- 不做方法体级 AST 提取器 → 仅当 M1 复测证明 oversized 桶是残余误报主因时才升级为本批内票（当前判定：不是）。
- 不做多租户 / 服务器托管形态（V27-19 裁决持续有效）。
- 不做 LLM 编排（ADR-0005/0006/0012：补丁与意图解析在宿主侧）。

---

## 8. 协作与收口

- **版本预占**：`v0.31.0` 由本线占用（`git fetch` + CHANGELOG 顶部核实无冲突，2026-09-16）；`v1.0.0` 由票 04 收口时占用。共享区（`packages/contracts`、SSE 载荷、gate 断言、CHANGELOG/CONTEXT/HANDOFF/README、版本五处）改动**先落本 spec 对应 issue 的文件面声明**再动手。
- **收口人制**：一版一人；收口含双轴 `code-review`（不可省）+ 全量门禁（cp 650 / web 363 / bridge 26 / e2e 63 对照组）。
- **判据**：本批完成的定义 = M1 达 <5%（或诚实下限）+ M4=1 + M5≥3，缺一不算收口。

---

## 附：证据索引（规划期核实）

| 结论 | 证据位置 |
|---|---|
| 六个 dogfooding issue 已实现 | `.scratch/scan-dogfooding-v021/spec.md`（v0.22 立项定稿段）、`.scratch/scan-purify-v023/spec.md`（04+06）、`CHANGELOG.md:211-227` |
| lazygit 修复后仍 31.3% | `.scratch/scan-dogfooding-v021/issues/02-go-call-edges-marked-dynamic.md`（v0.22 实现备注） |
| Go 跨文件类型引用为残余主因 | `CHANGELOG.md:209`、`CHANGELOG.md:227` |
| 度量缺失（无真实仓库 harness） | `scripts/` 仅有 `e2e/closeout_gate.py`、`smoke/ui_smoke.mjs`；精度测量仅 `services/control-plane/package.json` 的 `eval`（合成 fixture） |
| npm 未发布 | `npm view @codecompass/cli` → 404（2026-09-16 实查） |
| README 工具数 15 vs 实际 17 | `README.md`（安装段）vs `services/control-plane/src/mcp/repoqa-mcp.ts` `MCP_TOOLS`（17） |
| benchmark 停在 75 题 | `docs/benchmark.md:1-6` vs e2e 输出「97 questions」 |
| 版本单一源与 MCP 棘轮 | `services/control-plane/src/version.ts`、`scripts/e2e/closeout_gate.py::check_versions`（V30-11 新增 `mcp-handshake-version`） |
| Web 六页签 | `apps/repoqa-web/src/components/TopBar.tsx:51-60`（`TABS`） |
