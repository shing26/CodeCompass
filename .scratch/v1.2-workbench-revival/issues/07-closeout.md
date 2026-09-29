# Issue 07 — 收口：ADR-0020 + 定位文档 + Round4 走查 + v1.2.0

> 波次：波 3 ｜ 状态：**收口中（2026-09-29）——文档/版本/ADR/评审已落；Round4 与 tag 随后** ｜ 优先级：收口票 ｜ 依赖：票 01–06 全落 ✅ ｜ 依据：spec D5/D6/D8；收口人制（parallel-collaboration）

## 1. 内容清单

1. **ADR-0020 落地**：`docs/adr/0020-web-workbench-revival.md`，底稿见 spec §6（状态 proposed → accepted 随本票）。
2. **定位文档改写**（共享区，收口一次做，spec §1.2 取代清单照单执行）：
   - README：首句保留「事实层 / MCP 主轴」，补 Web 产品面地位与消费面主次新表述；
   - CONTEXT：「CodeCompass 身份」词条 +「Dual-Surface」词条（Web 冻结语义 → dogfooding 产品面）；
   - HANDOFF：§1 停更口径改写 + §2.2 纪律替换为双轨制措辞（MCP 精度论证门槛不动 / Web 面 dogfooding 论证闸）；
   - 台账 `.scratch/v027-backlog.md`：V27-5/6/7/15/16、V29-1 关闭划销 + 冻结标注解除记录；V30-10 保持挂账。
3. **Round4 全功能走查**：computer-use 全功能回归（拓扑/chat/gate/delta/体检/导入六动线），报告进 `docs/reports/`（Round1–3 并排先例，含勘误与 P1–P3 分级）；截图 `docs/reports/ui-shots/`。
4. **版本五处** v1.2.0 + CHANGELOG `[1.2.0]` 段（含票 03 的 REST 破坏性条目）+ 双轴 review（fixed point = 上次审完 commit，不可省）+ 全量门禁（基线以当时 HANDOFF §2.1 为准）+ dist 重建 + Docker/冒烟。
5. **真用一周软验收启动**：发布后真实使用登记反馈，进增量 triage；不阻塞发版，P1 反馈优先插队。

## 2. 验收（机器可验证 / 可核查）

1. ADR-0020 在档且 CONTEXT「ADR 索引」行同步（19 → 20）。
2. 定位文档四处改写后，copy-guard 双哨绿（新表述不在黑话/退役表）；grep 无「不得再把它写成产品面」残留语义。
3. Round4 报告在 `docs/reports/` 且三级问题各有处置登记（修/挂/不修）。
4. e2e `check_versions` 绿（版本五处 + CHANGELOG 顶部 + /health + Dockerfile 基座一致）；mcp-handshake-version 棘轮绿。
5. tag v1.2.0 + Release 双绿；npm 随 v1.1.0 之后的下一次发布窗口一并发（沿 v1.1 spec §7.1「一次发」裁决——若 v1.1.0 已发则本版即窗口）。

## Comments

- 2026-09-28 立项（grill D5/D6/D8 收口形态定案）。
- 2026-09-29 **收口执行（第一段：文档/版本/评审）**：
  - **ADR-0020 落库** `docs/adr/0020-web-workbench-revival.md`（spec §6 底稿原文级落笔：双面体再平衡/双轨制/否决备选/后果含代价与撤下触发线）；CONTEXT ADR 索引 19→20。
  - **定位文档改写**（spec §1.2 取代清单逐条执行）：README 消费面主次改写（MCP 产品面 + Web 个人驾驶舱，保留主轴措辞）+ 版本行 1.2.0；CONTEXT Status 补 v1.1/v1.2 两段（**v1.1 收口时漏更新 Status——停在 1.0.0，本次补记**）+ Dual-Surface 词条 v1.2 再平衡；HANDOFF §1 v1.2 收口态 + §2.2 纪律改写双轨制 + §2.1 计数 778/368/73 + **§6 快速验证清单计数改正（711/364/71 → 778/368/73，评审点名）**；v027-backlog **划销六行**（V27-5/6/7/15/16 + V29-1，各带关闭出处）+ 补 **V12-1** 行（saveWorkbenchCard echo——评审点名的静默丢失风险，此前票面称留台账但无落点）。
  - **版本五处 1.2.0** + dist 重建（/health 版本门 73/73 绿）；CHANGELOG `[1.2.0]` 段含**破坏性变更块**（202 语义 / suggested_subdirs 新列 / clone-retry 新事件 + 迁移消费方清单）。
  - **双轴评审（v1.1 补审触发线兑现 + v1.2 独立两轴）**：两轴 **GO WITH NOTES**；14 条发现处置——**本批修复 9 条**（P1 reindex/clone 僵尸统一 guardIndexFailure；frozen 门 fail-open 封口（文件集合双向 + entry 白名单/畸形记账，三态会红验证）；MCP catch 对称自保；pollRepoReady 超时抛错 + 三文件 timeout 档；折叠切点安全回退；检索分区清态+error；detail 出正文；WS 常连测试；progressEmitAt 清理）+ **登记/顺手 5 条**。记录落 `docs/reports/code-review-2026-09-29-v11-v12.md`（CHANGELOG/spec 所引指针从此不悬空）。
  - **门禁**：typecheck 双包净、cp 778/778、web 368/368、e2e 73/73、UI 冒烟 PASS（六动线含 1b 体检/1c 导入流化）。
  - **第二段（随 tag 与发布执行）**：tag v1.2.0 + Release CI；**Round4 体验报告为发布后软验收首项**——口径调整如实记录：六动线真 chromium 冒烟已全过（功能面证据在档），Round4 补的是人眼质感走查（截图/溢出/文案），归 D8「真用一周」软验收期与截图证据（ui-shots 本地不入库）一并执行，不阻塞功能发布。
