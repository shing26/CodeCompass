# CodeCompass — Context

## Status
9 ADRs（0001–0003、0005–0007、0008–0009 accepted，0004 proposed）。当前版本 0.11.0。

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

## Open Decisions
- Post-v1: remote sync backend, advanced approval/guardrail automation, and
  the external Harness adapter ecosystem.
