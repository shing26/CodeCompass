# CodeCompass — Context

## Status
11 ADRs（0001–0003、0005–0009、0010–0011 accepted，0004 accepted 详见 0.13 CHANGELOG）+ 0012–0015 accepted（2026-09-01 grilling 收官：Copilot 定位升级——只读架构雷达与演进顾问、Intent→Artifact、引擎垄断几何、Pattern Ingestion、演进工作台；MCP 工具面现为 17 个，演进类工具已随 Issue 24/25 落地：get_conventions（五轴画像 + 物理锚点校验）与 plan_evolution（NLU 留宿主端、结构化冲突载荷）经 MCP 直达引擎，module_evolution 降级为向后兼容别名）。当前版本 0.20.0（第 15 个 MCP 工具 codecompass_scan 自荐发现引擎 + Issue 25 Ticket 02 演进感知工具；Issue 24 演进工作台收官：`POST /api/repos/:id/evolve` 单遍流式 Intent→四工件卡、STRICT 惯例冲突结构化拦截、Intent Eval Bucket 入 eval 冻结集；Issue 25 Ticket 03 工件卡服务端持久化与 hydrate 回放（workbench_cards 按 (repoId,commit) 流落库、`GET workbench-cards` 回放端点、SSE 终态载荷披露 cardId/seq、前端切桶自动 hydrate 去重合并）；Issue 23 排障副驾驶 `mode=incident` 零幻觉合约延续，物理锚点四元组见 ADR-0010，静态边界见 ADR-0011）。

## Naming

- **CodeCompass**：产品 canonical 名（仓库、bin、CHANGELOG、MCP 工具前缀 `codecompass_`）。
- **RepoPulse**：曾用名，仅存于历史文档与 ADR 标题，等价于 CodeCompass。
- **RepoQA**：代码命名空间（`apps/repoqa-web`、`RepoQAClient`、`repoqa-*` 模块），非独立产品名。
- **MHW_***（Multi-Harness Workbench）：宿主工作台层的命名残留（环境变量 `MHW_CP_PORT`/`MHW_DATA_DIR` 与 `/tasks`、`/harnesses` 端点），指 Control Plane 承载的 harness 编排面。

## Glossary

| Term | Definition |
|------|------------|
| Harness | Autonomous coding / execution agent runtime. |
| Control Plane | Local Node/TypeScript service for routing, lifecycle, audit, and token accounting. |
| Orchestrator | Control Plane component decomposing intent into Tasks and assigning Workers. |
| Worker | Harness executing coding, shell/script, or browser tasks. |
| Task | Unit of work with resumable states and per-Task token accounting. |
| Session | User-scoped collaboration linking Harnesses to shared artifacts. |
| Workspace | Exportable/importable local organizational container. |
| Bridge | Adapter layer translating Harness-native protocols into a unified JSON-RPC/SSE protocol. |
| Sidebar Queue | Persistent left panel listing Tasks; primary management surface in v1. |
| Command Palette | Fast creation/dispatch entry point layered on top of templates and free-form input. |
| Canvas | Visual task-flow surface for monitoring and selection, not primary creation in v1. |

## CodeCompass Glossary

| Term | Definition |
|------|------------|
| CodeCompass（曾用名 RepoPulse） | 只读代码智能工作台：导入仓库后生成 AST 符号、调用链、chunks，并围绕 SSE 问答提供可点击代码证据。 |
| Repo Index | 某仓库在指定 commit 下的只读解析快照，包含元数据、symbols、chunks 与索引状态，不写回源码。 |
| AST Symbol | 静态解析出的可定位代码单元，如 class、method、route、field，必须带 file/line range。 |
| Call Edge | 静态解析出的调用关系；不等同于运行时链路，也不能推断接口动态绑定。 |
| Call Chain | 从入口 symbol 沿 Call Edge 得到的受深度限制的静态链路。 |
| Route Chain | HTTP 请求从 Controller 到 Service/Mapper 的静态调用路径。 |
| Anchor | 指向真实 file:line 的代码证据；只有 raw file 校验通过才能展示。 |
| Static Analysis Break | 调用图无法继续解析的位置；必须明确标记，禁止自动补全猜测。 |
| Reverse Deps（反向依赖） | 以某符号为目标的静态 Call Edge 反向查询，返回调用它的 caller 列表；正向桥接边不进入反向索引。 |
| Subgraph（子图） | 以 start 符号为中心的双向静态邻接提取（1-Hop Caller + 1~3 Hop Callee），用于 Graph RAG 上下文与子图视图。 |
| Module Scope（模块作用域） | 多模块仓库（Maven 多模块 / monorepo 工作区）中符号的物理所属模块；仅在仓库跨越多个模块时标注，用于消解同名符号歧义。 |
| Aggregate Node（聚合节点） | 画布规模控制下代表被收拢的深层节点/边的单个占位节点；它不是静态符号，不携带锚点。 |
| Chunk | 由 README、doc comment 等切分出的可检索文本单元；不默认等于 embedding。 |
| Sensitive Context Masking | 代码或配置进入 LLM 前对 password、token、AK/SK、私钥等内容的确定性脱敏。 |
| Evidence Plane | 用户行为、结果、反馈、错误与质量事件组成的本地只读事件层。 |
| Golden Dataset | 冻结 repo commit、固定问题与人工标注 ground truth 的回归集，是发布 gate 而非示例。 |
| Recall@K | 真实调用链/符号出现在返回 top-K 证据中的比例，K 必须固定。 |
| Quick Tour | 基于真实 symbols 生成的单个预填问题流程，目标是让用户一次看懂一个调用链。 |
| Onboarding Dashboard | 索引后生成的一屏仓库简报；当前是待验证功能，不是 Ready 的同义词。 |
| Composite Tool（复合工具） | 由多个确定性图谱查询组合成的 MCP 工具（`codecompass_diagnose`、`codecompass_refactor_plan`）；零 LLM、可单测可重放，叙述与补丁由 LLM 编排层生成（ADR-0005/0006）。 |
| Diagnose Chain（穿透链路） | 从入口符号（方法名或 "METHOD /route/path"）出发的分层链：FRONTEND_COMPONENT → HTTP_ROUTER → SERVICE → DATA_MAPPER；每层标 VERIFIED / BROKEN / SUSPECT，层级按语言可降级，缺层不硬凑。 |
| Blast Radius（爆炸半径） | 以目标符号为根的反向递归调用方聚合，含直接/间接计数、受波及对外路由、桥接受波及的前端组件与 HIGH/MEDIUM/LOW 风险评级。 |
| Deep-Link（驾驶舱深链） | 带 `?repo=&focus=&traceId=&mode=diff` 的工作台 URL，用于现场还原一条链路或差异视图；深链落在卡片流上（ADR-0007）。 |
| HTML Artifact（诊断工件） | `codecompass export` 输出的单文件自包含 HTML：内联 mermaid 运行时、链路步骤与代码切片，断网可渲染、可随 PR 归档。 |
| Module Evolution（模块演进） | DEPRECATE（安全下线：模块聚类 + 固定点级联孤立死代码 + 清理 Checklist）与 EXTEND（功能扩展：挂载点 + 事务边界证据 + 解耦模式脚手架）两条确定性推演管线；脚手架是推荐写法而非补丁（ADR-0006）。 |
| Domain Radar（领域雷达） | 符号图的全景聚合：出入度 + 确定性 PageRank（阻尼 0.85、悬挂节点权重重分配、桥接边计入入度）+ 三栏输出；意图锚点 = 模糊匹配链 + doc-chunk 证据 + 图排名增益，零 embedding。 |
| Story Beats（分步演播） | 工件内把推演步骤转为 Prev/Next 步进卡片并与代码切片联动；仅落在自包含 HTML 工件端，Web 端需协议扩展，推 v1.0（ADR-0009）。 |
| Live Trace Strip（实时演播带） | v0.11 在 Web 驾驶舱 Canvas 底部新增的实时 trace 步进条（Prev / Step N/M / Next），步进时联动画布居中 + Inspector 切片高亮；区别于离线 Story Beats（ADR-0009 的工件端演播），它是 SSE 问答 `done.payload.trace` 的实时消费（见 Stage 4）。 |
| Brand Badge（品牌徽标） | 依依赖/配置关键词确定性贴标的技术栈 SVG 徽标（Spring/Redis/MySQL 等），是证据标注而非装饰。 |
| Async Tool Call（异步工具调用） | MCP 长操作的契约：同步部分只做校验与前置门禁（失败即抛、不落库），建行后立即返回 `indexing` 状态，实际工作后台执行，客户端经 `list_repos` 轮询至 `ready`/`error`（error 行带根因摘要）。见 ADR-0016。 |
| MatchedBy（锚点溯源） | Domain Radar 锚点的匹配来源标注：`identifier`（标识符模糊命中）、`doc-chunk`（文档证据桥接）——每个入选锚点必有其一，agent 可据此对措辞敏感的锚点降权。 |
| Candidate Scan（自荐扫描） | 第 15 个 MCP 工具：对已索引仓库输出四桶"该动哪里"候选清单——orphanedPublic（零静态调用者，声明反射误报边界）、hubs（PageRank 波及热点）、oversized（≥150 行方法，行距为方法体级 AST 落地前的代理信号）、deepChains（最深入口链）。每桶 top-N + 总量 + 确定性 nextAction 引导后续工具；纯查询同步契约。 |
| Architecture & Incident Copilot（排障副驾驶） | Web 端改造新增的排障对话模式：以文字描述 + 粘贴堆栈/日志为入口，独立 6 步 ReAct 预算（普通问答保持 3 步），产出穿透链 + 爆炸半径 + 配置证据的锚定式回答。v1 纯静态边界：不接 APM/日志流。 |
| Zero-Hallucination Contract（零幻觉合约） | 回答中每条调用链断言必须逐字来自本次会话工具返回的 Call Edge；每个 file:line 引用必须过 raw-file 物理校验；静态不可达边界强制标 BREAK/SUSPECT，禁止叙述性补全。叙述性总结与逻辑串联不要求逐句锚定。验收 = golden eval incident bucket 幻觉率 0%，进发布 gate。 |
| Physical Anchor（物理锚点） | `repoId + commit + file:line-range + symbolId` 四元组，raw-file 校验通过才可展示；工作区有未提交修改时记为 `commit+dirty`。钉 commit 换取时空可回放性，防止文件改动后行号切片错位成幽灵锚点。 |
| Stack Trace Parsing（堆栈解析） | 确定性正则解析器：从粘贴的堆栈/日志提取 `Class.method(File.java:123)`，反查符号表后串联 diagnose 穿透与波及面分析；零 LLM 参与。 |
| Intent→Artifact（意图工件模型） | ADR-0012 定义的交互模型：用户给一个意图，智能体单次产出高密度工件卡（定位节点 + 拓扑图谱 + 落位清单 + 风险 Checklist），不逐步反问；历史是工件流，按 (repoId, commit) 隔离；对工件卡的追问 = 新意图输入。 |
| Artifact Stream（工件流） | 会话历史的呈现形态：时间序高密度工件卡列表（ADR-0012），每张卡自带物理锚点与溯源元信息，非聊天气泡。 |
| Pattern Ingestion（模式嗅探） | 演进建议生成前对目标代码库既有惯例的确定性抽取（ADR-0014：惯例清单带物理锚点 + 覆盖率；近邻优先、全局多数兜底、披露强制；骨架由 LLM 消费惯例清单生成并标注 llm-generated）；契约按 ADR-0005 零 LLM（嗅探轴 v1 清单待 Issue 24）。 |
| Engine-rendered Diagram（引擎渲染图） | 图谱几何一律由确定性引擎从 Call Edge 边表渲染（ADR-0013 白名单：traceToMermaid、配置拓扑、Tour 路线）；LLM 仅产出结构化图层指令（图型、focus、折叠层级、节点注释），永不直接产出连线。迁移期缺口与 eval 波及见 ADR-0013。 |
| Evolution Workbench（演进推演台） | 矩阵三视图中唯一新建视图（ADR-0015）：自由文本意图入口，LLM 单次意图解析 + 引擎意图锚点落地目标，解析回显披露不反问；产出四段工件卡（惯例清单 / 落位表 / 死代码清单 / 风险 Checklist）。 |
| Workbench Cards（工件卡持久流） | workbench_cards 表按 (repoId, commit) 流落地演进/排查终态卡（seq 单调、UNIQUE 幂等、删仓级联清理）；SSE 终态载荷披露服务端 cardId/seq，`GET /api/repos/:id/workbench-cards` 全量回放，前端切桶 hydrate 按 id 去重合并。 |
| Dual-Surface（双面体） | 产品形态解耦（0012–0015 grilling 收官）：无头感知底座（MCP Server，纯引擎工具、永不内置 LLM 编排，意图解析在宿主侧）与可视化决策大屏（Workbench）；两端消费同一份引擎输出（同锚点同结构），禁止任何一端另起叙述管线。v1 MCP 感知面冻结为现有 8 工具，演进类工具随 Issue 25 补齐。 |

## Open Decisions
- Post-v1: remote sync backend, advanced approval/guardrail automation, and
  the external Harness adapter ecosystem.
