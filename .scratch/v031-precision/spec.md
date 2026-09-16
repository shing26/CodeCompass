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
| M4 | 发布可用性 | 干净机器照 README 抄一行命令完成 MCP 握手并返回 `list_repos` | 0（npm 404） | 1 |
| M5 | 工程资产 | 公开可验证物：npm 发布物 / 技术文 / 可复现 benchmark / 公开精度报告 | 0 | ≥3 |

**度量纪律**：M1 的采样与判定脚本必须可复跑（票 01），数字入 `docs/reports/` 留档；**不允许按目标倒推口径**——若 <5% 不可达，诚实写出可达下限与代价。

---

## 4. 票池

| 票 | 标题 | 依赖 | 关键验收 |
|---|---|---|---|
| [01](issues/01-precision-baseline.md) | 精度复测基线（度量先行） | — | 一条命令产出三仓五桶 + 抽样清单；人工核验后出 before/after 对照表 |
| [02](issues/02-residual-precision.md) | 残余精度攻坚 | 01 | M1 三仓 <5%；不可达则给可达下限与根因清单 |
| [03](issues/03-release-readiness.md) | 发布就绪（npm 首发 + 文档一致性） | 01 | M4=1；README 工具数/安装段、benchmark、协作文档三处与实现一致 |
| [04](issues/04-impact-delivery.md) | 影响力兑付（v1.0.0 + 技术文 + 公开评测） | 02、03 | M5 ≥3；tag 双绿；benchmark 数字可由命令复现 |
| [05](issues/05-web-convergence.md) | Web 收敛 6→3（**条件票**，D 目标可裁剪） | — | 一级导航 3 项；深链全可达；web 单测全绿且净减 |
| [06](issues/06-freeze-guardrails.md) | 冻结护栏与 V27 余账归位 | — | 三文档口径一致；六项 V27 余账处置留痕 |

**波次**：Wave 1 = 01 + 06（可并行，零冲突）；Wave 2 = 02 + 03（02 动引擎、03 动发布与文档，文件面不撞）；Wave 3 = 04（收口人制，含 v1.0.0 版本五处推进）；05 视 §1.3 裁决择机。

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
