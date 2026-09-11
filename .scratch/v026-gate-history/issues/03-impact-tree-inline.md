# 03：B03 — 行内受波及树 + 锚点跳 Inspector（B 系列体验闭环）

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch\v026-gate-history\spec.md`（裁决 Q10；ADR-0013 白名单核对见下）。*

Status: closed
标签：feature / P2 / 来源：v0.26 预留 B（受波及树）

> *B02 已 closed（表格宿主就位：CiGateView 三段化 + GateRunRow 类型 + runGate/listGateRuns，web 基线 300）。B03 可开工。*

## Agent Brief

**Category:** feature（树渲染 + 既有导航契约复用）

**用户场景：** 门禁历史表已经能告诉用户"这次 FAIL 波及了 7 条路"，但想知道**哪条路由被谁拖下水**就得自己翻 JSON 或重跑 delta。修复后：展开任意历史行 →「受波及树」两层铺开（路由 → 受影响符号，HIGH 红/MEDIUM 橙/LOW 灰徽章）→ 点任意符号节点，Inspector 直接开对应文件切片（375px 窄屏抽屉同样能弹开）——从"哪条线越界"到"越界代码现场"三次点击内完成。

**Summary:** 消费 `gate_runs.payload_json` 的 `impactedApis`（routeSymbol + affectedBySymbols + riskLevel，与 ArchitectureDeltaView 同源字段族），div 列表两层渲染；零新图形技术（ADR-0013 无涉——不产图，树是结构呈现）。

**Key interfaces:**
- 树数据 = B01 payload_json 直出（表管查询、blob 管回放，Q12 裁决——**不得**要求后端加结构化列）
- 节点点击 → `onNavigate(file, line)` → Inspector `openFile`（票 11 navSeq 契约已保证窄屏复点同文件可开——直接受益，勿重新发明）
- 行展开态本地 state（与 B02 表格行合并渲染）；空 impactedApis / 无 commit 历史行的降级态

**Acceptance criteria:**
- [x] 展开行 → 树渲染 route→symbols 两层 + 风险徽章着色断言
- [x] 点击节点 → Inspector 面包屑显示目标 file、glow 行到位；error 行不可展开（无 payload）
- [x] 375px：从历史行节点跳 Inspector 抽屉弹出（复用票 11 测试模式）
- [x] 深链回放一致性：同一 run 展开的树与其 commit 流匹配（实现补记见 Comments——payload 随行直出，无跨流取数可言）
- [x] web 全量绿；既有 B02 断言零修改

**Out of scope:** mermaid/图谱化呈现、跨 run 对比视图、导出工件。

**Blocked by:** 02-gate-history-panel（表格宿主先存在）。

**触碰面声明：** apps/repoqa-web（CiGateView + 测试）。零后端。

## Comments

### 实施记录（2026-09-11，ZCode）

- **树渲染**：行内「展开受波及树」toggle（仅 impactedApis 非空行有）→ 两层：第一层 route 节点（风险徽章 + symbolLabel，点击 `onNavigate(routeSymbol.file, lineStart)`）、第二层 `affectedBySymbols` 叶子（border-l 缩进、纯文本）。expandedIds 为 `Set<string>` 多行可同开，切库清空。
- **实施补记①（票面假设纠偏，「点任意符号节点」）**：引擎落库的 `affectedBySymbols` 是 `impact.modifiedMethod` **裸名字符串**（repoqa-diff.ts:845-847），无 file/line；票面「零后端」约束下只有第一层 routeSymbol 可导航，第二层只作呈现——数据面物理限制，非偷懒（review 复核认可以此收敛）。
- **实施补记②（票面「GET ?commit= 过滤取数」）**：B01 的 GET /gate-runs 每行随行回传 payload（SELECT * 含 payload_json），展开树**零取数请求**，「与其 commit 流匹配、不猜」天然成立；一致性以「两行各带不同 payload → 各自展开各自树」用例锚定。
- **防御解析**：`isImpactedApi` 逐条把关（含叶子逐元素 typeof string、lineStart Number.isFinite），坏条目丢弃不崩行；error 行/空 impactedApis 行/全坏 payload 行不给展开控件（降级态=不可展开）。
- 接线：App.tsx `onNavigate={inspector.openFile}`（票 11 navSeq 契约复用，零新机制）。types.ts 未加 blob 镜像类型（review P2-4：死类型与落库事实相悖，删）。
- 测试：CiGateView +6 例（两层+色族、导航实参、降级三态、混合坏、对象叶子不崩、多行独立展开）、App.test +1 例（票 11 状态级抽屉 + getFileRaw 实参 + 面包屑）。web **307/307**（300+7）、既有 B02 断言零修改、typecheck 净。

### Reviewer-Security 独立审查（有条件合并 → 全修）

- **[P1] 叶子元素类型不设防**：`Array.isArray` 只查容器，对象元素直进 React children =「Objects are not valid as a React child」整树卸载（全仓无 ErrorBoundary），违反本票自述「不信任 blob」威胁模型。修：`every(typeof s === 'string')` + lineStart 收紧 Number.isFinite + 回归用例（对象叶 → 整条丢弃、console.error 零调用）。
- **[P2] branch key 缺 parentType**（三元组在 `line ?? 1` 兜底路径可撞）：key 复合化为 `file:lineStart:parentType.name`，对齐引擎合并键。
- **[P2] 「部分坏」路径无测试**：补混合好坏分支用例（filter 语义而非整行拒的唯一理由被锚定）。
- **[P2] 死类型**：GateRunPayload 镜像（violations 形状与 PolicyViolation[] 相悖、零引用）删除。
- **[P2] 错误注释+缩进**：App.test「jsdom 默认窄视口」不实（1024px，断言实为状态级，与票 11 先例同层级）→ 注释改写、describe 反缩进回顶层。
- **[P2] 空叶子残根**：`affectedBySymbols.length > 0` 才渲染 border-l ul。
- **判不成立项**：c) 掩码不毁路径/符号名（maskEventPayload 只重写凭据赋值；即便 file 被掩，useInspector error 态优雅兜底）；d) expandedIds 生命周期与 seq 守卫无交互残留；e) no-op 按钮与 Canvas/MermaidDiagram 先例一致；f) badge 色 class 断言非假绿；g) 抽屉断言实质成立。
- **移交收口/跟进**：① risk 色族跨视图统一（本票票面色 HIGH红/MEDIUM橙/LOW灰 vs ArchitectureDeltaView 黄/蓝/绿——同产品同概念两档配色是设计坏味道，动 delta 既有断言，归收口裁决）；② payload 不受 maxAffectedRoutes 截断（analysis.ts:223），超大 run 全量进 DOM 可卡顿——渲染上限 slice+尾行留作 v0.27 小票。
