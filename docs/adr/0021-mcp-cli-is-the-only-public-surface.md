---
status: accepted
---

# 定位定稿：MCP/CLI 是唯一对外产品面，Web 是 dogfooding 驾驶舱与演示面

## 背景

2026-09-03 曾裁决「不做 agent、不做低配 Cursor，收敛为 MCP 变更分析引擎（Web 仅演示厅）」；2026-09-16/24 裁决「A 主轴（MCP-first 事实层）+ D 交付，Web 只减不增」；2026-09-28（ADR-0020）又为工作台产品化反转了「只减不增」。三套方向句同时留在 README/CONTEXT/HANDOFF 里，任何一次新想法都能各取所需地引用一条，导致方向摇摆。

2026-10-19 用户明确要求「该是什么就是什么」，并对四选一给出定论：**MCP 唯一对外产品面**。

## 决定

1. **唯一对外产品面 = MCP 工具面（17 个 `codecompass_*` 工具）+ CLI（`@codecompass/cli`）**。这是承诺面：签名/数量冻结（ADR-0020），新增须回答「降低哪类误报、提升哪类精度」；README、发布说明、对外宣传只描述这一面。
2. **Web 工作台 = 维护者自己的 dogfooding 驾驶舱与演示面**。它的用途是：肉眼验证引擎结论、走查体验、出截图与演示。它是内部工具与证据面，**不是并列的第二产品**，不作为对外承诺对象。
3. **ADR-0020 的 Web 新增门禁保留但降格为内部纪律**：Web 改动仍须回答「维护者日常怎么用它」；答不上来即不做。
4. **冻结面与非产品面写进代码注释**（`routes/workbench.ts`、`packages/bridge-adapters`）：`/api/tasks|harnesses|workspaces`、`anchor-click`、`feedback` 是零消费方的遗留面，不构成承诺。

## 摇摆终止规则（唯一裁决口径）

新想法只走两条合法通道，取代此前互相打架的三条方向句：

- **通道 A（事实面）**：增强 MCP/CLI 或引擎精度，且能说清**降低哪类误报 / 提升哪类精度**（v0.31 纪律）；或
- **通道 B（驾驶舱）**：改 Web，且能说清**维护者日常怎么用它**（ADR-0020 dogfooding 纪律）。

两条都答不上来 = 不做，并优先清理（删除或标注为非产品面）。裁决时不再引用 v0.31 的「Web 只减不增」（该句由 ADR-0020 覆盖，又被本 ADR 明确降格为内部纪律）。

## 后果

- README / CONTEXT / HANDOFF 收敛到本 ADR 的表述，成为唯一权威；历史方向句保留出处但标注被取代。
- 本 ADR 生效日的配套清理（同批落地）：移除 HTML 工件的 Lifecycle/Dataflow 禁用占位（ADR-0008 的 v1.0 承诺作废）；移除 Web 侧 incident 死链（`askIncident`/`submitIncident`/状态机/`?mode=incident` 别名——服务端 incident 能力保留但无 UI 入口，属「非承诺能力」）；MHW harness 面冻结并加注。
- 代价：Web 面的产品化投入被正式判为内部成本，任何「把 Web 做成产品」的提议必须先改本 ADR。
