# v0.27 待办台账（v0.26 收口双轴 review + A04 移交登记）

> *2026-09-11/12 v0.26.0 收口时立。来源标注保证每条可溯源，届时拆票。*

| # | 项 | 来源 | 类型 |
|---|---|---|---|
| V27-1 | **安全**：控制面 `server.ts` 默认绑 `127.0.0.1` 评估 + LAN 暴露面审计（现绑全网卡零鉴权；`^-` ref 注入已由 v0.26 收口 P1-2 双层守卫挡掉，本票做绑定收敛） | 收口 review P1-2 | 安全 |
| V27-2 | chat agent 系统提示词含「拆除计划」（`chat/agent.ts:19,23`），模型可能把退场词复述进答案、前端 copy-guard 对运行期文本盲——与 MCP description 残留（`codecompass_module_evolution` 描述「模块演进推演」、README:179、ADR-0014/0015「模式嗅探」）合并做**文档/措辞统一票** | 收口 review P2-5 + A03 移交 | 命名族 |
| V27-3 | `repoqa-export.ts:78` ONBOARDING 模板标题「架构指标」+ README:37 沿用——命名族半残（非失实，导出确实产该标题），随 V27-2 统一 | 收口 review P2-6 | 命名族 |
| V27-4 | CiGateView ScenarioGuide 三步滞后三段化（:288-291 仍纯复制命令旧动线）——票 15「引导滞后」病灶萌芽 | 收口 review P2-7 | 文案 |
| V27-5 | 「查调用链」按钮名实升级：导航措辞或跳 topo 后自动聚焦上次 trace（含 `open-chat`/`onOpenChat` 标识符重命名） | A01/A04 移交裁决① | UX |
| V27-6 | risk 色族跨视图统一：gate 树红/橙/灰 vs ArchitectureDeltaView 黄/蓝/绿，同概念两档配色 | B03/A04 移交裁决② | UX |
| V27-7 | gate 运行史 payload 渲染上限：超大 run impactedApis 全量进 DOM（analysis 端不受 maxAffectedRoutes 截断）——slice+尾行 | B03/A04 移交裁决③ | 性能 |
| V27-8 | 仓库卫生：`.scratch/test-store-*.db` 40 个测试遗留已入库（含本机绝对路径）——gitignore + 清理 | 收口 review P2-11 | 卫生 |
| V27-9 | LLM 节点池归智能体线（既有在册，随 v0.27 grill 合并裁决） | [[v023-scan-purify]] | 边界 |

**明确不做的不在此列**（v0.26 spec「明确不做」持续有效）。
