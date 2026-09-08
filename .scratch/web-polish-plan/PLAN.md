# Web 端质感跃迁 · 执行计划

> 合并两份前端优化方案（"架构驾驶舱" / "桌面工件质感"），基于 `apps/repoqa-web` v0.9.0 **真实代码现状**重排。
> 制定日期：2026-08-30 · 范围：仅 Web 前端 + 必要的后端接线（domain-radar）

---

## 0. 现状快照（Code Audit）

两份方案把大量**已经落地**的能力又列成了待办。先锁定事实，避免重复造轮子。

### 已完成（不必重做）
| 能力 | 证据 |
|---|---|
| 设计 Token 体系（clean/cyber 双主题） | `src/index.css` 149 行 CSS 变量 + `tailwind.config.js` 语义色映射 |
| 点阵背景 Dot Grid | `.workbench-grid`（`index.css:67`） |
| Mermaid 画布工作台 | `MermaidDiagram.tsx` v0.7：wheel 缩放 / drag 平移 / 双击重置 / 节点搜索居中 / **MiniMap 点击跳转**（依赖自由的 CSS transform 方案） |
| Monaco 配置与诊断高亮 | `Inspector.tsx:316` 已关 minimap、只读、主题同步 `vs-dark`/`vs`；诊断行 `inspector-glow` + `-gutter` |
| 脱敏提示 / 骨架屏 | `CopyMaskingToast.tsx`、`FlowSkeleton`（`Canvas.tsx:452`） |
| Deep-Link 聚焦 | `?focus=&traceId=`（`Canvas.tsx`） |
| 4 层链路卡片 / Segmented 切换 | `StatusStepper.tsx`、`TopBar.tsx`（topo/metrics/gate） |
| Story Beats 演播（离线工件） | `TourPlayer.tsx` / `QuickTours.tsx` / `useTours.ts` |

### 真实缺口
1. **Mermaid 塑料感根源** — `client/mermaidRenderer.ts` 仅 20 行，`theme: 'default'`，**未注入 `themeVariables`**。改 20 行即可。
2. **domain-radar 无 HTTP 通道** — `services/control-plane/src/domain-radar-engine.ts`（283 行，fuzzyMatchScore + PageRank）完整，但仅被 `cli.ts` / `repoqa-mcp.ts` / `repoqa-worker.ts` 引用；`server.ts` / `http.ts` **无路由**，`apps/repoqa-web` **零引用**。Cmd+K 实为全栈任务。
3. **品牌徽标缺失** — 无 `brand-marks.ts`；Mermaid 节点标签转义（`()` `#` `<>`）有破坏现有测试的风险。
4. **Inspector 面包屑缺失** — grep 无结果。
5. **可拖拽分栏** — `react-resizable-panels` 未安装，`App.tsx` 为 `flex min-h-0 flex-1` 硬编码布局。

### 不在范围内
- 增加新功能（AST/图算法/MCP 引擎）—— 这些是后端，非本次目标。
- 拖拽分栏（见 Stage 5，延后评估）。

---

## 1. 总体原则

- **不二选一**：两方案重合度约 80%，取方案二的诊断精度（指出 `themeVariables` 注入点）+ 方案一的排期纪律。
- **已落地项不重做**：§0 清单内的能力直接进入验收项，不排开发工时。
- **测试先行**：涉及 Mermaid 标签转义（Stage 1/2）的项，先补/扩 `mermaidGraph.test.ts` 再改生成逻辑。
- **主题统一**：所有新增颜色走现有 CSS 变量与 `tailwind.config.js` 语义色，禁止硬编码 `#000`/`#fff`。

---

## 2. 阶段计划

> 优先级 P0（用户可感知的质感跃迁）→ P1（交互升维）→ P2（细节打磨）。工时估算含测试与联调。

### Stage 0 — Mermaid 主题对齐 · P0 · 约 0.5d
**目标**：消除"塑料感"根源，画布图元与全局深色/浅色同色系。
- 文件：`src/client/mermaidRenderer.ts`、`src/index.css`
- 任务：
  1. 按 `data-theme`（`clean`/`cyber`）注入 `themeVariables`：`background` / `primaryColor` / `primaryTextColor` / `primaryBorderColor` / `lineColor` / `fontFamily` 取自现有 token（画布 `#0f172a`、表面 `#1e293b`、边框 `#334155`、连线 `#64748b`、高亮 `#10b981`/`#f43f5e`）。
  2. 切换主题时触发 `mermaid.initialize` 重入（结合 `useTheme()` 已在 `Inspector.tsx` 处理 Monaco，Mermaid 侧补同等响应）。
  3. `index.css` 补 `.mermaid-node` 圆角 8px、`border-radius` 统一（可选）。
- 验收：暗色下**无白底**；连线柔和 slate；节点圆角 8px；亮/暗切换后画布同步。
- 风险：低。回滚：改回 `theme: 'default'`。

### Stage 1 — 语义边与状态胶囊 · P0 · 约 1d
**目标**：调用链状态一眼可辨。
- 文件：`src/components/MermaidDiagram.tsx`、`src/client/mermaidGraph.ts`、`src/index.css`
- 任务：
  1. **BROKEN 边**：红白脉冲虚线（keyframes 流动）+ 节点警告 Tag（复用 `mermaid-node-flash` 思路）。
  2. **HTTP 跨端桥接**：紫/青流光动画边。
  3. **节点状态胶囊**：GET 蓝 / POST 绿 / BROKEN 红虚框，内嵌于节点 label。
  4. 先扩 `mermaidGraph.test.ts`：覆盖 `()` `#` `<>` 转义与 label 注入用例。
- 验收：三类边在样例拓扑可见；动画 60fps；单测全绿。
- 风险：中（需 `querySelector` 注入 class 到 mermaid 生成 SVG）。回滚：状态样式开关 flag。

### Stage 2 — 技术栈品牌徽标 · P1 · 约 1.5d
**目标**：图元告别千篇一律的灰框，自动带技术栈 Logo。
- 文件：新建 `src/brand-marks.ts`、`src/client/mermaidGraph.ts`、`mermaidGraph.test.ts`
- 任务：
  1. 节点 label 注入内联 SVG 徽标（Spring / FastAPI / React / Vue / MySQL / Redis 等），按符号类型映射。
  2. 完善 Mermaid 标签安全转义（多边形 `<>`、`#`、`()` 与中文路径）。
  3. 徽标开关 `?badges=0` 可降级。
- 验收：徽标渲染正常；既有 60 节点截断与转义单测全过；降级开关生效。
- 风险：中-高（Mermaid 标签解析脆弱）。
- 回滚：徽标默认关，灰度开启。

### Stage 3 — Cmd+K 命令面板 · P1 · 约 3d（全栈）
**目标**：手不离键盘，体验对齐 Linear / Raycast。
- **前置依赖（RISK-1）**：domain-radar 无 HTTP 通道，需先补后端。
- 任务：
  1. **后端**：`control-plane` 暴露 `POST /api/radar`（复用 `runDomainRadar`），返回符号名 / 物理路径 / 出入度（In/Out）。
  2. **前端 client**：`RepoQAClient` 加 `radar(query)` 方法。
  3. **新建组件**：`src/components/CommandPalette.tsx`（居中磨砂玻璃、上下键选点、Enter 回车）。
  4. **接线**：`Cmd/Ctrl+K` 全局呼出，联动 `MermaidDiagram` 已有 `focusNode` / 居中能力，右侧 Inspector 同步就位。
  5. 先做后端 + 前端 mock 数据，解耦联调。
- 验收：输入 `login` 秒级出 Top 匹配（带路径与出入度徽标）；Enter 画布平移居中 + Inspector 就位。
- 风险：高（全栈 + 检索性能）。回滚：面板独立组件，失败时不影响主画布。

### Stage 4 — Inspector 面包屑 + 演播带下钻 · P2 · 约 1.5d
**目标**：Inspector 现代编辑器化，消除大图人肉找节点。
- 文件：`src/components/Inspector.tsx`、`StatusStepper.tsx`、`TourPlayer.tsx` / `useTours.ts`
- 任务：
  1. **面包屑**：`Repo > 文件 > 符号` 顶部栏，每节点可点击跳转。
  2. **演播带**：diagnose/evolve 后底部浮动控制条（◀ Prev / Step N / Next ▶），步进时复用 v0.7 Pan 居中 + Monaco 切到对应行。
- 验收：步进时画布自动平移到节点；Monaco 同步切片高亮。
- 风险：低（复用已有居中能力）。

### Stage 5（延后/可选）— 拖拽分栏 · 收益最低
- 文件：`App.tsx` + 新依赖 `react-resizable-panels`
- 风险：高成本低收益——新增第三方依赖 + 重构 `App.tsx` flex 布局 + 持久化比例。
- 决定：**v1.0 之后评估**，本期不做。

---

## 3. 风险与依赖

- **RISK-1（阻断 Stage 3）**：domain-radar 无 HTTP 路由。需在 Stage 3 前置一个后端工单。
- **RISK-2（影响 Stage 1/2）**：Mermaid 标签转义脆弱。务必先补测试再改生成逻辑。
- **RISK-3（影响 Stage 0）**：主题切换需重入 `mermaid.initialize`；与 `useTheme()` 机制对齐，避免亮暗切换画布失效。
- **RISK-4（全局）**：所有新颜色必须走 token，禁止硬编码，否则破坏 clean/cyber 双主题一致性。

---

## 4. 验收与验证

- 单测：`cd apps/repoqa-web && npm test`（vitest）——重点 `mermaidGraph.test` / `MermaidDiagram.test` / `Inspector.test` 全绿。
- 构建：`npm run build`（`tsc --noEmit` + `vite build`）通过。
- 手动验收：
  1. 亮/暗主题切换，画布与 Inspector 同步无白底。
  2. 样例仓库加载拓扑，BROKEN / HTTP 边与状态胶囊可见。
  3. 品牌徽标在 Controller/Service/Mapper 节点显示。
  4. `Cmd/Ctrl+K` 检索 `login`/`order` 并回车居中。
  5. Inspector 面包屑点击跳转；演播带步进联动画布。

---

## 5. 排期（相对顺序）

```
Stage 0 ─▶ Stage 1 ─▶ Stage 2 ─▶ Stage 3（含后端 /api/radar）─▶ Stage 4
                                                                  │
                                  Stage 5（延后，独立评估）◀──────┘
```

| Stage | 优先级 | 工时 | 依赖 |
|---|---|---|---|
| 0 Mermaid 主题 | P0 | 0.5d | — |
| 1 语义边/胶囊 | P0 | 1d | 0 |
| 2 品牌徽标 | P1 | 1.5d | 1（转义测试） |
| 3 Cmd+K | P1 | 3d | 后端 /api/radar（RISK-1） |
| 4 面包屑/演播带 | P2 | 1.5d | 0 的居中能力 |
| 5 拖拽分栏 | — | 延后 | 新依赖决策 |

**建议起点**：Stage 0（改 20 行 `mermaidRenderer.ts`），半小时内可见画布质感变化。
