# Multi-Harness Workbench — Context

## Status
21 ADRs accepted. v1 implementation is complete with local verification gates
passing; see docs/execution-plan.md for the execution plan.

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

## RepoPulse Glossary

| Term | Definition |
|------|------------|
| RepoPulse | 只读代码智能工作台：导入仓库后生成 AST 符号、调用链、chunks，并围绕 SSE 问答提供可点击代码证据。 |
| Repo Index | 某仓库在指定 commit 下的只读解析快照，包含元数据、symbols、chunks 与索引状态，不写回源码。 |
| AST Symbol | 静态解析出的可定位代码单元，如 class、method、route、field，必须带 file/line range。 |
| Call Edge | 静态解析出的调用关系；不等同于运行时链路，也不能推断接口动态绑定。 |
| Call Chain | 从入口 symbol 沿 Call Edge 得到的受深度限制的静态链路。 |
| Route Chain | HTTP 请求从 Controller 到 Service/Mapper 的静态调用路径。 |
| Anchor | 指向真实 file:line 的代码证据；只有 raw file 校验通过才能展示。 |
| Static Analysis Break | 调用图无法继续解析的位置；必须明确标记，禁止自动补全猜测。 |
| Chunk | 由 README、doc comment 等切分出的可检索文本单元；不默认等于 embedding。 |
| Sensitive Context Masking | 代码或配置进入 LLM 前对 password、token、AK/SK、私钥等内容的确定性脱敏。 |
| Evidence Plane | 用户行为、结果、反馈、错误与质量事件组成的本地只读事件层。 |
| Golden Dataset | 冻结 repo commit、固定问题与人工标注 ground truth 的回归集，是发布 gate 而非示例。 |
| Recall@K | 真实调用链/符号出现在返回 top-K 证据中的比例，K 必须固定。 |
| Quick Tour | 基于真实 symbols 生成的单个预填问题流程，目标是让用户一次看懂一个调用链。 |
| Onboarding Dashboard | 索引后生成的一屏仓库简报；当前是待验证功能，不是 Ready 的同义词。 |

## Open Decisions
- Post-v1: remote sync backend, advanced approval/guardrail automation, and
  the external Harness adapter ecosystem.
