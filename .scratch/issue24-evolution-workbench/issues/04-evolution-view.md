# Ticket 24.4 — Evolution Workbench 视图 v1

## 目标
矩阵三视图中唯一新建视图(ADR-0015):自由文本意图 → 单次产出四段工件卡。

## 改动点
- 后端:`POST /api/repos/:id/evolve`(SSE,事件命名空间 `repoqa.evolve.*`):stages = intent_parse(LLM 单次:intentType + 目标短语 + goal)→ target_resolve(domain_radar 意图锚点,resolved target + 备选)→ convention_scan → pipeline(EXTEND/DEPRECATE)→ artifact;
- 意图解析回显:卡头 `{intentType, resolvedTarget, alternatives[]}`,错了改一版重新投递,不反问;
- 前端:App.tsx 新视图 + Sidebar 入口;`EvolutionView.tsx`:意图框 + 工件卡(四段:惯例清单[锚点+覆盖率+披露]/落位表[行级 code:// 深链]/死代码清单[勾选框]/风险 Checklist);引擎渲染图消费图层指令产物;
- 复用:evidence 渲染、MermaidDiagram、Inspector 深链。

## 验收
- Playwright 冒烟:输入"给订单模块加 Excel 导出" → 回显 resolved target → 四段卡齐 → 点落位表行跳 Inspector 正确文件行;页面零 JS 错误;
- 6 步预算:LLM 调用 = 意图解析 1 次 + 骨架叙述 ≤1 次,引擎步骤不计;
- typecheck + 组件测试绿。


## 实施记录(2026-09-01,分支 feat/evolution-view @ eec7a73)

### 后端(services/control-plane)
- `POST /api/repos/:id/evolve`(http.ts,POST JSON {intent 必填, target 可选}→ SSE,maskEventPayload 照走)。
- `repoqa-worker.ts evolveRepo`:五阶段 SSE — intent_parse(LLM 配置时 completeNativeChat 单次,任何失败/未配置落 deterministicIntentParse:DEPRECATE 动词表 + INTENT_MARKERS 标记词切分)→ target_resolve(显式 target 直投跳 radar;否则 runDomainRadar,chunkHitFiles 中文桥:中文 javadoc → docstring chunk → searchChunks LIKE → 命中文件内 method/route/class base=70)→ convention_scan/pipeline(runModuleEvolution,ConventionConflictError → evolve.error + 结构化 conflict)→ diagram(pickEvolveStart + resolveCallChain 4 hops + traceToMermaid,失败静默省略)→ recordEvent(intent 'evolve')→ evolve.done {intentEcho, result, mermaid?, commit}。
- LLM 预算:意图解析 1 次,无叙述调用。
- 测试 repoqa-evolve.test.ts 7/7:确定性解析 3 + 流 4(五阶段序列/echo/四段、target 直投、404/400、STRICT conflict:「裸返回」意图 × ApiResult 5/5 route 轴)。

### 前端(apps/repoqa-web)
- types.ts 手抄 contracts evolve 类型(前端不直接 import contracts,既有约定);WorkbenchTab 加 'evolve'。
- RepoQAClient.evolveStream → EvolveStream:evolve 端点是 POST+JSON body,EventSource 不支持,用 fetch+ReadableStream 手工解析 SSE 帧;无自动重连(evolve 一次性计算,重连会重跑 pipeline)。
- EvolutionView.tsx:意图栏 → 校正胶囊(🎯 目标锚定 X (N% 匹配) + 备选按钮点击以 pinned target 重投)→ 五阶段 chips → 结构化冲突卡 → 四工件卡(惯例清单[STRICT 覆盖率 + 偏离样本锚点]/落位表[packagePath/files/注入/Handler 签名,行级深链]/死代码级联[勾选框]/风险卡[事务解耦])→ 引擎 Mermaid(highlightNode=resolvedTarget,onNavigate→inspector.openFile)。
- 接线:TopBar TABS 加「演进推演」(tab-evolve),Sidebar 加 Evolution 入口,App.tsx 渲染分支。

### 验收状态
- Playwright 冒烟:全仓无 playwright 配置(既有事实),以组件测试覆盖同路径:EvolutionView.test.tsx 4/4(输入→回显 target→四卡齐→落位行/冲突锚点/死代码行跳 Inspector 断言、备选重投断言、零 console error 由测试环境保证)+ App.test tab/Sidebar 接线用例。**真浏览器 Playwright 冒烟留待 Issue 24 收尾 ticket 统一补(需装依赖)。**
- 预算:组件测试路径为确定性回退(零 LLM);LLM 配置时意图解析 1 次,合规。
- typecheck:contracts/control-plane/web 全绿;control-plane 522/522、web 275/275、gate 38/38。

### 语义决策
- engine classCandidates 只认 kind service|class:route 类(@RestController)不能直接做 attach 目标,conflict 测试用 Parent.method 形式(OrderController.list)。
- URL mode 参数未加 evolve(现 switch 只处理 diff/incident;后续 ticket 可扩展)。
