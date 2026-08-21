这份 **CodeCompass** 的全套端到端落地完整方案，涵盖了**产品定位、系统总体架构、AST 静态解析引擎、Agent 工具调用与 Prompt 协议、前端图码联动机制、数据模型及落地路线图**，可直接作为项目的架构白皮书与研发执行标准。

---

# CodeCompass：代码仓库架构透视与导读工作台 · 完整方案

---

## 1. 项目定位与核心价值

* **项目定位**：基于 AST 静态图谱与 LLM 协同的代码仓库全景透视与交互式导读工作台。
* **一句话价值**：输入任意业务接口或架构概念，秒级生成“确定性调用时序图 + 文字解构 + 源码逐行联动”的交互沙盘。
* **核心指标 (North Star Metric)**：
* **TTFP (Time-to-First-PR)**：新人从克隆项目到首个 PR 合并耗时缩短 $\ge 50\%$。
* **代码锚点有效准确率 (Valid Anchor Rate)**：生成的类名、方法名及代码行区间准确率 $\ge 98\%$。
* **首 Token 响应时延 (TTFT)**：图检索与首字输出时延 $\le 1.5\text{s}$。



---

## 2. 系统总体架构设计

系统由 **静态索引层**、**知识存储层**、**Agent 编排与检索层** 和 **前端交互工作台** 四层构成：

```
                    ┌──────────────────────────────────────────────────────────┐
                    │               Web 前端三栏工作台 (React + Tailwind)       │
                    │   [ 目录/路由树 ]  │  [ 问答 & Mermaid 画布 ]  │  [ Monaco ]   │
                    └─────────────────────────────▲────────────────────────────┘
                                                  │ (SSE 流式推送 / REST API)
                    ┌─────────────────────────────┴────────────────────────────┐
                    │            Agent 编排调度层 (FastAPI / Spring Boot)      │
                    │   - Intent Classifier (意图识别: 链路追踪/架构概览/配置)   │
                    │   - Context Pruner (三级 Token 剪枝器)                     │
                    │   - ReAct Tool Calling Loop (确定性工具链调用)             │
                    └──────────────┬────────────────────────────┬──────────────┘
                                   │                            │
                     ┌─────────────▼────────────┐  ┌────────────▼─────────────┐
                     │ 确定性图谱检索 (Deterministic)│  │ 语义向量检索 (Semantic)     │
                     │ - 符号表精确查准 (Class/Method)│  │ - README/注释向量匹配 (BM25) │
                     │ - Call Graph BFS/DFS 深度拓扑 │  │ - 业务名词/隐式配置匹配      │
                     └─────────────┬────────────┘  └────────────┬─────────────┘
                                   │                            │
    ┌──────────────────────────────┴────────────────────────────┴──────────────┐
    │                      静态解析与索引引擎 (Tree-sitter / JavaParser)        │
    │  - AST 语法树提取: @RestController / @Service / @FeignClient / Mapper     │
    │  - 依赖注入解析: @Autowired / @Resource / 构造器注入推断                  │
    │  - 持久化: SQLite (符号与拓扑图谱) + Chroma/Qdrant (代码注释向量)         │
    └──────────────────────────────────────────────────────────────────────────┘

```

---

## 3. 核心技术方案与数据链路

### 3.1 静态 AST 符号与依赖图谱构建引擎

传统 RAG 采用分块（Chunking）切分代码会导致语法断裂。CodeCompass 采用 **AST 结构化提取 + 拓扑关联** 方案（首期针对 Java/Spring Boot）：

1. **AST 提取规则（基于 Tree-sitter / JavaParser）**：
* **Route Node**：扫描提取 `@RequestMapping`, `@GetMapping`, `@PostMapping` 上的 URL Path 与 HTTP Method。
* **Class Node**：提取类名、包路径、类级别注解（`@Service`, `@Component`, `@FeignClient`）。
* **Method Node**：提取方法签名、形参/返回类型、注解（`@Transactional`）及物理起止行号 `[start_line, end_line]`。
* **Dependency Edge**：通过字段注解（`@Autowired`, `@Resource`）建立 `ClassA -> ClassB` 的依赖引用边。
* **Call Edge**：在方法体内部分析 `MethodInvocation`，建立 `MethodA -> MethodB` 的直接调用边。


2. **数据持久化 Schema（SQLite 轻量存储）**：

```sql
-- 符号表 (Symbols)
CREATE TABLE symbols (
    id TEXT PRIMARY KEY,           -- e.g. "com.nexus.controller.OrderController.create"
    repo_id TEXT NOT NULL,
    file_path TEXT NOT NULL,       -- e.g. "src/main/java/com/nexus/controller/OrderController.java"
    symbol_type TEXT NOT NULL,     -- "CONTROLLER", "SERVICE", "MAPPER", "FEIGN_CLIENT", "METHOD"
    name TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    extra_meta JSON                -- 存 HTTP 路径、参数签名等
);

-- 调用与依赖关系表 (Call Graph Edges)
CREATE TABLE call_edges (
    source_id TEXT NOT NULL,       -- 调用方 Method/Class ID
    target_id TEXT NOT NULL,       -- 被调用方 Method/Class ID
    edge_type TEXT NOT NULL,       -- "CALLS", "INJECTS", "IMPLEMENTS"
    PRIMARY KEY (source_id, target_id)
);

```

---

### 3.2 Agent 编排与 Tool-Calling 规范

Agent 不直接盲猜代码，而是通过调用底层确定性工具构建上下文，并严格执行 **Token 剪枝**：

#### 1. 核心 Agent 工具集 (Tools)

* `find_route_entry(http_method, path)`: 根据 API 路径快速定位入口 Controller 及对应方法。
* `trace_call_chain(method_id, depth=3)`: 顺着 `call_edges` 拓扑图执行 BFS，返回下游调用的类、方法及起止行号。
* `get_symbol_outline(file_path)`: 仅获取目标文件的类结构与方法签名，折叠具体方法体。
* `get_method_code_snippet(method_id)`: 精准提取目标方法体的源码片段。

#### 2. 上下文三级剪枝（Context Pruning）策略

* **Level 1（全局骨架）**：仅提供项目核心模块结构与 Top 20 核心 Service 签名（$\le 1,500$ Tokens）。
* **Level 2（链路相关类）**：仅展开调用链命中的方法源码，同文件其余方法全部折叠为 `// ... other methods collapsed`。
* **Level 3（依赖接口）**：第三方 RPC 或 DB Mapper 仅保留接口方法声明与 SQL 映射注解。

#### 3. Agent Prompt 约束契约与输出结构

```markdown
你是一个代码仓库架构分析专家。你必须基于提供的精准代码上下文回答，严禁臆测不存在的类和行号。

输出必须严格遵循以下三段式结构：
## 1. 业务流程拆解
简要说明执行逻辑，核心步骤必须带物理行号胶囊（格式：`[FileName.java (L起始-L结束)](code://相对路径#起始-结束)`）。

## 2. 调用时序图
输出标准 Mermaid sequenceDiagram，并在末尾为每一个参与者/关键方法绑定跳转伪协议：
```mermaid
sequenceDiagram
  autonumber
  Client->>OrderController: POST /api/v1/orders
  OrderController->>OrderServiceImpl: createOrder()
  OrderServiceImpl->>InventoryClient: deductStock()
  %% 绑定点击协议
  click OrderController "code://src/main/java/.../OrderController.java#20-35"
  click OrderServiceImpl "code://src/main/java/.../OrderServiceImpl.java#40-58"

```

## 3. 核心证据链

列出 2~4 个最核心的代码锚点与核心职责说明。

```

---

### 3.3 图码联动机制（Graph-to-Code Linkage）

实现“点击图表节点/文字链接 $\to$ 右侧代码无缝切换定位”的核心协议与生命周期：


```

[ 用户点击 Mermaid 节点 / Markdown 引用 ]
│
▼
解析协议：code://relative/path/File.java#35-50
│
▼
CodeViewerStore 状态调度
│
┌─────────────┴─────────────┐
▼                           ▼
[ 检查文件是否已加载？ ]       [ 压入导航历史栈 ]
├── 命中缓存: 直接复用           └── historyStack.push({ path, line: 35 })
└── 未命中: 请求 /api/file/raw
│
▼
Monaco Editor 驱动
├── editor.revealLinesInCenter(35, 50)
├── deltaDecorations: 注入黄色发光动画 (.monaco-line-glow)
└── 1.5s 后转换为常驻微光边框 (.monaco-line-persist)

```

---

## 4. 前端工作台组件设计

前端基于 **React + Tailwind CSS + Zustand + Monaco Editor + Mermaid.js**：


```

WorkbenchLayout
├── TopBar (仓库切换 / 分支选择 / 索引状态 Badge / 导出 Markdown)
├── LeftSidebar (可折叠 18%~25%)
│   ├── QuickToursPanel (预设上手播放列表: 鉴权链/下单流/异常拦截)
│   ├── RouteCatalogList (自动提取的 API 列表，带 GET/POST 徽章)
│   └── FileSymbolTree (文件树 + 类/方法两级展开)
├── MainCanvas (可伸缩 40%~50%)
│   ├── ChatStreamView (虚拟列表)
│   │   ├── MarkdownRenderer (自动转换 code:// 为可点击超链接)
│   │   ├── MermaidSandbox (带语法校验、错误边界保护与点击拦截代理)
│   │   └── EvidenceCardDrawer (折叠代码快照)
│   └── PromptInputBox (带 /trace /explain 快捷指令及业务预设 Prompt 气泡)
└── RightInspector (可伸缩 30%~40%)
├── CodeBreadcrumbs (文件路径 + 符号定位大纲下拉)
├── MonacoEditorInstance (只读模式、MiniMap、行号锚定、高亮装饰器)
└── NavigationHistoryBar (Back / Forward 按钮)

```

---

## 5. 后端核心 API 契约设计

| 接口 | 方法 | 请求参数 | 说明 |
| :--- | :--- | :--- | :--- |
| `/api/repo/index` | `POST` | `{ repo_url, branch, local_path }` | 触发后台异步 AST 扫描与图谱构建任务 |
| `/api/repo/status` | `GET` | `?repo_id=xxx` | 轮询索引进度（`CLONING` $\to$ `PARSING` $\to$ `READY`） |
| `/api/repo/routes` | `GET` | `?repo_id=xxx` | 获取全仓扫描出的 API 路由清单与入口映射 |
| `/api/chat/completions` | `POST` | `{ repo_id, query, session_id }` | **SSE 流式传输**，返回结构化问答与 Mermaid 规范 |
| `/api/file/raw` | `GET` | `?repo_id=xxx&file_path=xxx` | 获取指定源码文件文本（前端 LRU 缓存） |

---

## 6. 质量评估体系 (Eval Benchmark)

在系统上线与持续迭代中，使用一套**黄金测试集（Golden Dataset）**评估系统稳定性：

*   **基准测试库**：
    1. `spring-petclinic`（经典简单单体）
    2. `RuoYi-Vue` / `mall-swarm`（典型中大型微服务架构）
*   **评测维度与合格阈值**：
    *   **调用链完整度 (Recall@5)**：$\ge 85\%$（对比人工标注的标准调用路径）。
    *   **行号精准度 (Anchor Accuracy)**：$\ge 98\%$（定位的目标方法必须完全包含该行区间）。
    *   **Mermaid 语法合法率**：$100\%$（不可出现客户端 SyntaxError 导致白屏）。

---

## 7. 分阶段落地路线图 (Roadmap)


```

[Phase 1: 最小链路验证 (Week 1-2)]
• 后端：构建 Tree-sitter Java 扫描脚本，提取 Controller/Service 符号与调用边存入 SQLite。
• 前端：三栏基础骨架，跑通 mock 数据的图码联动与 Monaco 行号滚动高亮。
• Agent：固化 Prompt 输出规范，实现单接口的时序图与代码引用输出。

[Phase 2: 完整交互闭环 (Week 3-4)]
• 后端：支持 SSE 流式返回，接入 Agent Tool-Calling，实现确定性图搜索。
• 前端：完善 Mermaid 点击代理、代码 LRU 缓存、预设 Onboarding 路线卡片。
• 交付：在标准 Spring Boot 项目上完整跑通“点击 API -> 输出时序图 -> 跳转 Monaco”。

[Phase 3: 体验打磨与扩展 (Week 5-6)]
• 增加 React Flow 大画布自由拖拽支持。
• 支持导出《项目架构全景新人手册》(Markdown/PDF)。
• 拓展 TypeScript / Go 语言生态解析。

```

---

这套方案打通了从底层 AST 图谱解析、中间 Agent 剪枝调度，到前端图码联动交互的完整通路。后续开发可严格遵照此架构规范，分步推进各模块实现。

```