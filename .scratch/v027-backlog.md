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
| V27-13 | ~~UI 冒烟进 CI~~ **已随 v0.27-B R7 关闭（2026-09-13）**：`scripts/smoke/ui_smoke.mjs`+`stub-llm.mjs` 挂 `release.yml`（真 chromium 三链路+两段式流式钉+WS 重连韧性断言；stub LLM 零外网零 token）；发现项登 V27-23；见 issues/07（CHANGELOG 留收口批） | computer-use 走查 D3 | 质量 |
| V27-14 | 未选库 Sidebar 空态噪音（`0 files — expand to browse`/`ROUTES (0)`/中英混排提示），随 V27-11 一并收 | computer-use 走查 D4 | UX |
| V27-15 | 长 LLM 回答 ~300+ DOM 节点淹没可访问性树（读屏/键盘导航成本高；computer-use 走查亲踩流式后 index 漂移）：消息区 aria landmark 分区 + aria-live=polite + 超长回答折叠「展开全文」 | computer-use 走查 D5 | a11y |
| V27-16 | 拓扑首屏自动 trace 选题偏技术侧（CodeCompass 仓选中内部 query 路由而非核心业务）：候选改用 dashboard topApis/inDegree hub 优先，纯内部路由降级 | computer-use 走查 D6 | 产品 |
| V27-11 | **视觉去极客化战役**（需独立 spec/grill）：①字号降密——104 处任意值 px（9/10/11px 元数据）收进 sm/base 档；②中英混排收口（Import repo/Select a repo/Watcher/Routes/Symbols/Loading… 等常驻英文）；③黑话残留清扫（AST 提取/2-Hop/锚定/孤岛/波及/工件卡/惯例嗅探/落位表/BROKEN/[cite: N] 印在引导语——引 v0.27-UI 探查报告 §3/§5 清单，注意票 15 实名哨与 copy-guard 双闸会拦，需同步改哨）；④徽章族瘦身（16+ 种胶囊/徽标/丸）；⑤styles.css 存量段（plan/scenario/starter）迁 Tailwind token | 2026-09-12 用户反馈「太工程化/极客」→ v0.27-UI spec U5 裁决 | 视觉 |
| V27-17 | buildTours 启发式对 TS 前端仓零锚点：CodeCompass 本仓 `GET /tours` 返回 `[]`（Java 仓 nexus-campus / ResuAlign 有 auth-chain），侧栏 Quick Tours 只剩「No tours available」空转——锚点族按 Java 注解写死，需补 TS 侧（Express router 注册/React Context 枢纽/main.tsx 入口链）。内容缺位非界面 bug | 2026-09-12 全功能回归走查 R2（sweep2 段 5 实证） | 内容 |
| V27-18 | ~~clone 网络瞬断无策略重试~~ **已关闭（2026-09-15 v0.29 T2，reindex 不在范围：localPath 克隆重试无网络面，once-per-click 语义保留）**：isTransientGitFailure 分类器（永久优先：auth/404/timeout 不重试）+ cloneGitRepo 内聚 1s/2s 双退避 + onRetry 落日志（reindex 重试/进度流可感知半边随 import-202 化挂账，见 v029 票 06）；测试 +5（644）；见 v029 issues/02 | 生产就绪度评估 1-缺口3 | 容错 |
| V27-19 | 企业级套件裁决票：/metrics 指标暴露、外置告警、配置 fail-fast+.env.example——按 Local-First 产品身份多数建议不做，留 grill 显式销项 | 生产就绪度评估 低优先 | 边界 |
| V27-20 | import/evolve 韧性补全：POST /api/repos 迁 202+WS 进度（消灭 600s 假失败面与超时后重复导入诱因）；EvolveStream 改走注入的 TimedFetch（现在全局 fetch 绕 R2 预算，也测不了） | R2 review P2-1/P2-5 | 容错 |
| V27-21 | ~~掩码尺子不统一~~ **已关闭（2026-09-15 v0.29 T1）**：强尺 maskSensitiveText（14-pattern）成唯一出库权威——chat summarizeIfLarge 换尺、scan 分支改 parse masked（raw 旁路关死）、native tool loop 裸面补齐（台账未记的第四把「零尺」）、弱尺 maskSecrets 整函数废除；CONTEXT 新增「出库掩码不变式」词条；639 测+golden eval 零翻车+UI 冒烟绿；见 v029 issues/01 | R3 review P1-2（tool error 侧门已修，成功路径残余） | 安全 |
| V27-22 | ~~MCP 深链仍硬编码 localhost×5~~ **已关闭（2026-09-15 v0.29 T4）**：`config.ts::cockpitBaseUrl` 单一权威（displayHost+port，R4 规则同源），mcp.ts 五处统一改引；gate 深链断言同 commit 成对改（默认回环下宿主已变 127.0.0.1）；CONTEXT Deep-Link 词条更新；645/645+e2e 62/62；跨进程 host 真传递（CLI 深链端口感知 serve 实际口）留注记不阻塞；见 v029 issues/03 | R4 review P2-2 | 一致性 |
| V27-23 | ~~StatusStepper 常驻不清~~ **已关闭（2026-09-15 v0.29 T5）**：RepoContext 补目录轮询复位 effect——当前仓离开 active 三态即清 indexingProgress（10 行）；UI 冒烟第 4 段全链路验收（domBar 观测窗仍见、R2 锁 socket 判据不依赖残留）；web 354/354；见 v029 issues/04 | R7 实施（2026-09-12） | UX |

| V27-24 | ~~Docker 镜像构建破损~~ **已随 v0.27.0 A1 关闭（2026-09-14）**：Dockerfile 补 `COPY packages/` + 基座 node:24 + CI 新 `docker-build` job（构建+容器 /health 冒烟）；实施中另抓 openBrowser 异步 ENOENT 崩服 P1（监听器修复+测试钉住）；见 `.scratch/v027-production-readiness/issues/08` | 2026-09-14 全模块验证 | 构建 |
| V27-25 | ~~/health 版本漂移~~ **已随 v0.27.0 A2 关闭（2026-09-14）**：`version.ts` 单一源（cli/server 共引）+ e2e `check_versions` 三扩（源挪 version.ts/Dockerfile 基座==engines/health payload 断言，门 60→62）；负测留证（bump 遗漏即红）；见 issues/09 | 2026-09-14 全模块验证 | 一致性 |
| V27-26 | ~~web↔contracts 镜像零检查~~ **已随 v0.27.0 A3 关闭（2026-09-14）**：`contract-mirror.test.ts` 类型名集合哨（16 型关注清单，交集==清单双向钉）；字段级等值随 V27-29 单一源手术；见 issues/10 | 2026-09-14 全模块验证 | 契约 |
| V27-27 | ~~web flaky~~ **已随 v0.27.0 A4 关闭（2026-09-14）**：BROKEN 用例断言包 waitFor，实施后全量两跑零红；见 issues/11 | 2026-09-14 全模块验证首轮 | 质量 |
| V27-28 | ~~bridge-adapters 零测试面~~ **已关闭（2026-09-14 B1/v0.28）**：包内 vitest + 26 例单测进 CI matrix（4 适配器生命周期/事件序列/取消短路/shell 真实子进程，零 token 零外网）；StubAdapter.type='shell' 按现状钉死注明；见 v028 issues/01 | 2026-09-14 全模块验证 | 质量 |
| V27-29 | ~~web→contracts 单一源手术~~ **已关闭（2026-09-14 B2/v0.28）**：types.ts 16 型改 re-export（TokenUsage 别名桥=RepoQaTokenUsage、delta 族异名、ImpactedApi 派生）；考古 8 项裁决入票面（死分支 signature 删、transactionBoundaries 补、axis 收窄零改动）；V27-26 哨升级为「禁手工重镜像」棘轮；Dockerfile COPY packages 前置 web 段。tsc 一次过、354/354、UI 冒烟/docker 重建绿；见 v028 issues/02 | 2026-09-14 grill D4/D7 | 契约 |
| V27-30 | ~~control-plane 结构轴手术（B 批主线）~~ **已关闭（2026-09-14，四段全收）**：✅增量 1 worker-helpers.ts 外迁（95a2860）；✅增量 2 analysis 515 行巨注册拆 graph/gate/stream（720e85f）；✅增量 3 diagram 簇 232 行抽 worker-diagram 协作者（DiagramContext 双缝，b23ba54）；✅增量 4 目录归组（票 04，327a35b）——42 git mv 分 ingest/engine/mcp/eval + 78 文件 import 重写（vi.mock 暗路径亦清），全门禁实跑 638/e2e 62/docker 全新构建/UI 冒烟/web 354。worker.ts 2556→2087、巨注册 515→三域，零行为变更铁律全程守住 | 2026-09-14 grill D6/D8 + scan oversizedFiles 桶 | 结构 |
| V27-31 | ~~UI 冒烟「R2 锁」断言在 CI headless-shell 上两轮 retry 皆红~~ **已关闭（2026-09-14，三轮递进破案）**：升级 socket 级双证据（页内 __wsLog 探针 + CDP websocket 跟踪，killTs 时间戳判据）后 dump 坐实**产品级真 bug**——SIGTERM 优雅关闭中 `wss.close()`/`closeAllConnections()` 不销毁已升级 WS 连接（ws@8+Node24 探针实测），`server.close()` 永挂→半死进程攥着 socket→浏览器永不重连（Windows 强杀掩盖，Linux CI/docker stop 才是真实路径）。修复：`server.close()` 前 `wss.clients.terminate()`；回归钉 server-shutdown.test.ts 三例+变异检验（634/634）；见 issues/12 | v0.27.0 Release CI 首跑 | 质量+产品 |

**明确不做的不在此列**（v0.26 spec「明确不做」持续有效）。
