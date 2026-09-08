# Spec: v0.7 — 语义深度与画布工程化

Status: ready-for-agent

> 处置对象：《四角色全链路实测报告》（Java/TS/Python/Go 四画像，2026-08-28 评审会上内联提供，未落盘为仓库文件）。
> 基线：v0.6.0 + closeout（commit cd4443f）。事实核对方式：三路并行代码走查。

## 事实核对结论

**属实并立项（8 项）**：
1. 多模块同名符号无命名空间——`ExtractedSymbol`/`RepoSymbol` 无 moduleName/qualifiedName，`detectMavenModules` 结果未入符号，前端裸名展示。
2. MyBatis 动态标签压平——`summarizeSql` 把 `<choose>/<foreach>` 等替换为空格并截断 240 字符（报告称"仅提取 id"不准确，存在 sqlSummary）。
3. FastAPI `Depends`——参数默认值被完全忽略，且 `Depends(get_db)` 产生指向不存在 "Depends" 符号的死调用边。
4. Go 隐式接口——仅 `var x Storage = &Impl{}` 显式赋值模式建 `impl.interfaces`，纯 duck typing 无映射。
5. 画布无搜索/缩放/折叠——mermaid 一次性静态 SVG。
6. 非标 venv 漏扫——IGNORED_DIRS 为 26 项精确名单，`env_py310`/`.conda`/`poetry_env` 全漏。
7. 复制 Agent 上下文无脱敏提示——前端无 Toast 体系。
8. 权重文件占预算——`.bin/.pt` 等不被读取、不计行数，但计入 MAX_FILES=3000 与文件清单。
（另：Java `@Async`/`@EventListener` 零识别属实，按决策推迟 v0.8；Top API 点击已有精确起点追踪，缺节点级焦点，作为小件并入画布轨。）

**误报 rebuttal（不立项）**：
- "缺实时阶段推送"：v0.6.0 已有 WS 四阶段广播 + TopBar StatusStepper（App.tsx:114-151、TopBar.tsx:325）；仅导入弹窗内保留轮询 parsed/total 文案。
- "模板 URL 归一化丢失"：TypeScriptAdapter `dynamicPathPattern` 把 `${id}` 参数化为 `{id}`，与后端路由归一为 `/{}` 匹配；多候选歧义显式 Static Analysis Break 是设计行为。
- "Goroutine 断链"：`go worker.process()` 调用边正常进入调用图，链不断，缺的只是 async 语义标记。
- "权重文件 I/O 开销"：SOURCE_EXTENSIONS 白名单在 readFile 之前跳过，不产生读取 I/O。

## 已确认决策（2026-08-28 评审）

1. **三轨全做**：①扫描韧性与命名空间 ②框架语义增强 ③画布交互。
2. 画布选型：**mermaid + 增强层**（svg-pan-zoom / 节点搜索 / 分层裁剪 / 简化 MiniMap），不换交互式图库。
3. 语义增强做 **Depends + go[async] 标记 + Go 隐式接口 + MyBatis 摘要**；**@Async/@EventListener 推迟 v0.8**（Spring 代理调用消歧复杂，且 Java 已是最高评级）。

## Issues

| # | 文件 | 轨道 |
|---|---|---|
| 01 | [issues/01-module-scope-contract.md](issues/01-module-scope-contract.md) | ① |
| 02 | [issues/02-ignored-dirs-patterns.md](issues/02-ignored-dirs-patterns.md) | ① |
| 03 | [issues/03-binary-extensions-budget.md](issues/03-binary-extensions-budget.md) | ① |
| 04 | [issues/04-copy-context-masking-toast.md](issues/04-copy-context-masking-toast.md) | ① |
| 05 | [issues/05-mybatis-dynamic-sql-summary.md](issues/05-mybatis-dynamic-sql-summary.md) | ① |
| 06 | [issues/06-fastapi-depends-edges.md](issues/06-fastapi-depends-edges.md) | ② |
| 07 | [issues/07-go-async-marker.md](issues/07-go-async-marker.md) | ② |
| 08 | [issues/08-go-implicit-interfaces.md](issues/08-go-implicit-interfaces.md) | ② |
| 09 | [issues/09-canvas-pan-zoom-minimap.md](issues/09-canvas-pan-zoom-minimap.md) | ③ |
| 10 | [issues/10-canvas-node-search.md](issues/10-canvas-node-search.md) | ③ |
| 11 | [issues/11-canvas-scale-control.md](issues/11-canvas-scale-control.md) | ③ |
| 12 | [issues/12-topapi-canvas-focus.md](issues/12-topapi-canvas-focus.md) | ③ |

## 验收标准

- 每件配单测/组件测试；门禁新增断言：venv/二进制过滤、moduleName/qualifiedName、Depends 边、隐式接口边、async 标记。
- 三套全绿：后端 vitest、前端 vitest + typecheck、`scripts/e2e/closeout_gate.py`。
- 报告误报项在本 spec 与 issue 中留有 rebuttal 记录。

## Roadmap（推迟）

- Java `@Async`/`@EventListener` 语义边（v0.8，Spring 代理调用消歧）
- 真·交互图库（reactflow/cytoscape）迁移评估
- 导入弹窗内轮询文案与 StatusStepper 的展示统一（小 UX 债）
- **ADR-0004 备注**：本期改变了 call-chain 语义面（Python 裸调用按名解析、Depends 边、
  Go 隐式接口）——ADR-0004 仍为 proposed；未来建 golden dataset 时必须以 v0.7+ 语义冻结真值
