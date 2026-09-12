# v0.27 待办台账（v0.26 收口双轴 review + A04 移交登记）

> *2026-09-11/12 v0.26.0 收口时立。来源标注保证每条可溯源，届时拆票。*

| # | 项 | 来源 | 类型 |
|---|---|---|---|
| V27-1 | ~~安全：控制面绑全网卡零鉴权~~ **已随 v0.27-B R4 关闭（2026-09-12）**：默认绑 127.0.0.1 + MHW_CP_HOST 逃生（Docker 镜像预设 0.0.0.0），LAN 告警+health 回显+README；见 `.scratch/v027-production-readiness/issues/04`（CHANGELOG 破坏性条目留收口批） | 收口 review P1-2 | 安全 |
| V27-2 | chat agent 系统提示词含「拆除计划」（`chat/agent.ts:19,23`），模型可能把退场词复述进答案、前端 copy-guard 对运行期文本盲——与 MCP description 残留（`codecompass_module_evolution` 描述「模块演进推演」、README:179、ADR-0014/0015「模式嗅探」）合并做**文档/措辞统一票** | 收口 review P2-5 + A03 移交 | 命名族 |
| V27-3 | `repoqa-export.ts:78` ONBOARDING 模板标题「架构指标」+ README:37 沿用——命名族半残（非失实，导出确实产该标题），随 V27-2 统一 | 收口 review P2-6 | 命名族 |
| V27-4 | CiGateView ScenarioGuide 三步滞后三段化（:288-291 仍纯复制命令旧动线）——票 15「引导滞后」病灶萌芽 | 收口 review P2-7 | 文案 |
| V27-5 | 「查调用链」按钮名实升级：导航措辞或跳 topo 后自动聚焦（含 `open-chat`/`onOpenChat` 标识符重命名）。**v0.27-UI AskDock 已落地：「对话唯一入口=tab」的入口孤岛前提消除，本项仅剩名实升级半件** | A01/A04 移交裁决① + v027-ui 票 02 U4 登记 | UX |
| V27-6 | risk 色族跨视图统一：gate 树红/橙/灰 vs ArchitectureDeltaView 黄/蓝/绿，同概念两档配色 | B03/A04 移交裁决② | UX |
| V27-7 | gate 运行史 payload 渲染上限：超大 run impactedApis 全量进 DOM（analysis 端不受 maxAffectedRoutes 截断）——slice+尾行 | B03/A04 移交裁决③ | 性能 |
| V27-8 | 仓库卫生：`.scratch/test-store-*.db` 40 个测试遗留已入库（含本机绝对路径）——gitignore + 清理 | 收口 review P2-11 | 卫生 |
| V27-9 | LLM 节点池归智能体线（既有在册，随 v0.27 grill 合并裁决） | [[v023-scan-purify]] | 边界 |
| V27-10 | copy-guard 英文 Evolution 封条仅锚两个 testid 位点（节标题+按钮），位点外的未来英文「Evolution」用户文案会漏网——可升级为「JSX 文本节点级」扫描或补全局正则位点（现值独立 grep 零命中，属前瞻防护） | 发布前 code-review skill（Spec 轴） | 文案哨 |
| V27-12 | ~~chat 错误裸传~~ **已随 v0.27-B R3 关闭（2026-09-12）**：五面 code 契约+前端 ERROR_COPY 人类化，见 `.scratch/v027-production-readiness/issues/03` | computer-use 走查 D2（v027-ui 票 03） | UX |
| V27-13 | **UI 冒烟进 CI**：chatGuardSend P0 存活两天、330 测试全绿零拦（mock 不校验参数、e2e 绕前端层）——把 a04-shots/ui1/ui2 Playwright rig 移植成 Release 管线 smoke job（真实浏览器走 选库→dock 提问→门禁运行 三链路） | computer-use 走查 D3 | 质量 |
| V27-14 | 未选库 Sidebar 空态噪音（`0 files — expand to browse`/`ROUTES (0)`/中英混排提示），随 V27-11 一并收 | computer-use 走查 D4 | UX |
| V27-15 | 长 LLM 回答 ~300+ DOM 节点淹没可访问性树（读屏/键盘导航成本高；computer-use 走查亲踩流式后 index 漂移）：消息区 aria landmark 分区 + aria-live=polite + 超长回答折叠「展开全文」 | computer-use 走查 D5 | a11y |
| V27-16 | 拓扑首屏自动 trace 选题偏技术侧（CodeCompass 仓选中内部 query 路由而非核心业务）：候选改用 dashboard topApis/inDegree hub 优先，纯内部路由降级 | computer-use 走查 D6 | 产品 |
| V27-11 | **视觉去极客化战役**（需独立 spec/grill）：①字号降密——104 处任意值 px（9/10/11px 元数据）收进 sm/base 档；②中英混排收口（Import repo/Select a repo/Watcher/Routes/Symbols/Loading… 等常驻英文）；③黑话残留清扫（AST 提取/2-Hop/锚定/孤岛/波及/工件卡/惯例嗅探/落位表/BROKEN/[cite: N] 印在引导语——引 v0.27-UI 探查报告 §3/§5 清单，注意票 15 实名哨与 copy-guard 双闸会拦，需同步改哨）；④徽章族瘦身（16+ 种胶囊/徽标/丸）；⑤styles.css 存量段（plan/scenario/starter）迁 Tailwind token | 2026-09-12 用户反馈「太工程化/极客」→ v0.27-UI spec U5 裁决 | 视觉 |
| V27-17 | buildTours 启发式对 TS 前端仓零锚点：CodeCompass 本仓 `GET /tours` 返回 `[]`（Java 仓 nexus-campus / ResuAlign 有 auth-chain），侧栏 Quick Tours 只剩「No tours available」空转——锚点族按 Java 注解写死，需补 TS 侧（Express router 注册/React Context 枢纽/main.tsx 入口链）。内容缺位非界面 bug | 2026-09-12 全功能回归走查 R2（sweep2 段 5 实证） | 内容 |
| V27-18 | clone/reindex 网络瞬断无策略重试（一次成败，用户手动重按）——2 次指数退避 + 进度流可感知 | 生产就绪度评估 1-缺口3 | 容错 |
| V27-19 | 企业级套件裁决票：/metrics 指标暴露、外置告警、配置 fail-fast+.env.example——按 Local-First 产品身份多数建议不做，留 grill 显式销项 | 生产就绪度评估 低优先 | 边界 |
| V27-20 | import/evolve 韧性补全：POST /api/repos 迁 202+WS 进度（消灭 600s 假失败面与超时后重复导入诱因）；EvolveStream 改走注入的 TimedFetch（现在全局 fetch 绕 R2 预算，也测不了） | R2 review P2-1/P2-5 | 容错 |
| V27-21 | 掩码尺子不统一：chat 成功路径工具结果过 `maskSecrets`（llm.ts 弱三件套 AKIA/sk-/Bearer），与 routes/入库面新用的 `maskSensitiveText`（13-pattern 全套）不同尺——JWT/ghp_/DSN 可随成功结果进模型上下文再回声；scan 分支 summary 从 raw 构造更绕开一切。需专票统一+评测冻结集回归（golden eval 65/97 题按旧行为钉，静默换尺可能翻车） | R3 review P1-2（tool error 侧门已修，成功路径残余） | 安全 |
| V27-22 | MCP 深链仍硬编码 `http://localhost:${port}`×5（repoqa-mcp.ts:672/702/720/779/923）：R4 确立「展示面跟实际绑定面」后，`MHW_CP_HOST=192.168.x` 具体网卡逃生时深链连空——MCP stdio 进程与 HTTP 服务进程 env 可能分叉，host 传递通道需专票设计（e2e closeout_gate.py:1319 的 `startswith("http://localhost:")` 断言必须成对改） | R4 review P2-2 | 一致性 |

**明确不做的不在此列**（v0.26 spec「明确不做」持续有效）。
