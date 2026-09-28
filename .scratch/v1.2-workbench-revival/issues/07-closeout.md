# Issue 07 — 收口：ADR-0020 + 定位文档 + Round4 走查 + v1.2.0

> 波次：波 3 ｜ 状态：ready-for-agent（收口时执行）｜ 优先级：收口票 ｜ 依赖：票 01–05 全落 + 票 06 落地或显式 deferred ｜ 依据：spec D5/D6/D8；收口人制（parallel-collaboration）

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
