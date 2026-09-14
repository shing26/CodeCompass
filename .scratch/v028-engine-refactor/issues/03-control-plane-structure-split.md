# 03：B3 — control-plane 结构轴手术（worker 拆分 / analysis 拆注册 / 目录归组）（销 V27-30）

> *Parent spec：`.scratch/v028-engine-refactor/spec.md`（grill D6/D8：结构轴）。*

Status: open
标签：结构 / P2 / 来源：2026-09-14 全模块验证 + scan oversizedFiles 桶（repoqa-worker.ts 2556 行、registerAnalysisRoutes 515 行、repoqa-* 家族 40+ 平铺）。

## 拆分计划（按耦合从低到高，逐增独立 commit 可回滚）

- 增量 1（低风险，纯函数）：worker 头部 6 模块级函数 + 5 类型外迁。
- 增量 2（低风险，无状态路由）：registerAnalysisRoutes 按域拆注册。
- 增量 3（中风险，需设计）：diagram 渲染簇（traceToMermaid/renderCallChainDiagram/renderConfigTopoDiagram/renderTourDiagram/renderLayerInstruction/collectSessionEdges/harvestDiagramSession/mermaidNodeIds，worker L1722-1960 区）抽 `worker-diagram.ts` 协作者类，worker 持实例委托。此簇方法互调且读 `this` 符号图缓存，须先定协作者接口再动，不做未验证拆分。
- 增量 4（机械，纯 git mv）：repoqa-* 40+ 文件按职能归 `engine/ mcp/ ingest/ eval/` 子目录（沿用 chat/languages/routes 先例）。

## Comments（2026-09-14 增量 1 收口）

- 落地：L85-363 纯函数（annotateTraceHttpMethods/splitIdentifier/fuzzyMatchScore/findFuzzyStartSymbol/deterministicIntentParse + 词表 + lineNumberAt）+ 5 共享类型（SessionGraphEdge/DiagramSession/IndexProgressPayload/StartSymbolResolution/FileRefreshResult）迁 `worker-helpers.ts`。worker 2556→2270。
- 兼容：repoqa-worker.ts 留 `export {…} from './worker-helpers'` re-export 桥，domain-radar-engine/repoqa-eval/repoqa-worker.test 全部既有 import 路径零改动。
- 验收：tsc 净、634/634、esbuild 成功。commit 95a2860。

## Comments（2026-09-14 增量 2 收口）

- 落地：registerAnalysisRoutes 515 行巨注册按域物理拆三件——`analysis-graph.ts`（221：symbols/reverse-deps/tours/dashboard/radar+TTL/subgraph/onboarding/chunks）、`analysis-gate.ts`（175：architecture-delta/gate-run/gate-runs，ADR-0017+票14契约注释随迁）、`analysis-stream.ts`（186：query GET/POST + evolve SSE，卡片落库语义逐字留）；`analysis.ts` 缩 23 行组成根，http.ts 导入面不变。三域路径互不重叠，Express 匹配语义不变。
- 验收：tsc 净、634/634、esbuild 成功、**e2e 62/62**（逐端点实战护航 SSE/门禁/radar 缓存）。commit 720e85f。
- **Mimosa 误报留痕**：对 `analysis-graph.ts:12` 报「SSRF 服务端请求伪造」高危——第 12 行系拆分说明注释，本文件无任何出网代码（radar/subgraph 只读内存符号图与本地缓存），经人工确认按原写法保留（逐字搬家，按建议强加 URL 白名单会凭空造出本不存在的出网逻辑、污染零行为变更约束）。

## 未完成（留后续会话，已给侦察结论）

- 增量 3：diagram 簇抽 `worker-diagram.ts`——耦合度已侦察确认（L1722 `private traceToMermaid` 起 8 方法区，互调 + 读 `this` 符号图），需先设计协作者接口（构造入参 getSymbolGraph 引用 or 整体迁出 + worker 委托），不做未验证拆分。
- 增量 4：repoqa-* 目录归组（纯 git mv + import 路径批量重写，建议独立 commit 且最后做，避免与增量 3 churn 叠加）。

## Comments（2026-09-14 增量 3 收口）

- 接口设计（动手前定稿）：`WorkerDiagram` 协作者类 + `DiagramContext` 双缝注入——`symbolIndexFor(repoId)`（委托 getSymbolGraph().index）与 `findStartSymbol(...)`（与 query 管线共享的起点解析）。除这两缝外，簇内 8 方法对 worker 状态零触碰，全部迁移后即为「纯函数 + 注入上下文」。
- 落地：diagram 簇 232 行（traceToMermaid/collectSessionEdges/harvestDiagramSession/renderLayerInstruction/renderCallChainDiagram/renderConfigTopoDiagram/renderTourDiagram/mermaidNodeIds + ADR-0013 注释群）**逐字**迁 `worker-diagram.ts`（264 行）；worker 构造处插 `private readonly diagram = new WorkerDiagram({...})`，7 个调用点（traceToMermaid×3/harvestDiagramSession×2/renderLayerInstruction×2）改 `this.diagram.*` 委托；摘净 worker 侧死 import（buildTours/classifyConfigKey/isSensitiveConfigKey/LayerInstruction/SessionGraphEdge-local）。**worker 2556→2087**。
- 新增契约钉 `worker-diagram.test.ts` 4 例：traceToMermaid 决定链+click 绑定+annotation 存在性过滤；ADR-0013 failed-tool 废链、config_topo focus 未中不画全量；collectSessionEdges 行计数/verifiedChain 递归/畸形行过滤。
- 调用面核查：8 方法全仓零外部消费者（仅 worker 内部 7 点+测试路径经由 worker），collectSessionEdges/renderLayerInstruction 历史上 public 但无人经 worker 实例直调——协作者侧保持 public 同名，行为不变。
- 验收：tsc 净、**638/638**（+4）、esbuild 成功、**e2e 62/62**（query/evolve SSE 与门禁实战护航）。
