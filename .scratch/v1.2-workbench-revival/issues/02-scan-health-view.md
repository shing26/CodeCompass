# Issue 02 — 体检面数据面：scan REST 通道 + 五桶呈现 + 精度态势

> 波次：波 2 ｜ 状态：ready-for-agent ｜ 优先级：P0 ｜ 依赖：票 01（骨架）｜ 依据：spec D3/D5；双轨制自查：零 MCP 改动

## 1. 实测（2026-09-28）

- `runScan(input): ScanResult`（`scan-engine.ts:184`）——确定性同步纯函数，秒级出结果，无 ADR-0016 长操作问题；现仅 `mcp/repoqa-mcp.ts` 与 `chat/agent.ts` 消费，**REST 零路由**（`routes/` 全扫确认，`ingest/repoqa-scan` 系 preview 同名误命中）。
- 五桶：`orphanedPublic` / `hubs` / `oversized` / `deepChains` / `oversizedFiles`，各 top-10（`SCAN_TOP_LIMIT=10`，`scan-engine.ts:23`）。**访谈时「四桶」系口误，以五桶为准。**
- 精度资产：`scripts/precision/ratchet-baseline.json`（self：orphanTotal 236 / ratio 0.1204，字段 `metric_direction=inverse`、`sampling=top-n` 已入档）+ `verdicts/{lazygit,petclinic,self}.json` + `docs/reports/scan-precision-baseline-*.md` 复测报告族。
- 雷达先例：`routes/analysis-graph.ts` 有 per-(repoId, query) TTL Map 缓存先例可抄。

## 2. 设计（先例对齐 + 两处拍死）

1. **通道**：`GET /api/repos/:id/scan`（幂等只读，对齐 v0.20 scan 只读自荐语义）；服务器端跑 `runScan`，结果按 (repoId, commit) TTL 缓存（照 radar 先例）。**不落库**——gate-run 落库源于「执行史」诉求（ADR-0017），体检面首版无此诉求，YAGNI；要趋势再立票。
2. **MCP 面零改动**（双轨制）：REST 属 Web 通道，先例 = gate 两面（`POST /api/repos/:id/gate/run` REST-only，v0.26 additive）。
3. **文案红线（拍死）**：孤儿桶只写「零静态调用者」（确定性事实）；**禁写「可安全删除」「死代码」**（v0.21 scan 定位红线 + ADR-0018：桶只声称可调用符号、testOnly 标记展示为「仅测试调用」）。语义判断引导到 chat（「问 agent 该不该动」）。
4. **精度态势区**：读 `ratchet-baseline.json` 摘要（ratio / ceiling / metric_direction / sampling / self commit）+ 指向 `docs/reports/` 复测报告链接；标注诚实边界「CI 无 clone，真仓数字以报告为准」（v1.1 票 06 D2 同款措辞）。反向指标提示语复用票 12 语义（「孤儿比上升可能是改进被看见，以假边条数读进度」）。

## 3. UI

- 五桶卡列表：每桶 top-10 行（符号 / `filePath:line` / 关键判据字段），hubs 带 PageRank 分值；行点击跳 Inspector（navSeq 契约复用，先例 = gate 受波及树，v0.26-B03）。
- 空态 / 索引中 / 索引过期（commit 变化）三态与票 01 骨架对齐。
- 桶语义来自 ADR-0018 后引擎实况：`candidatesBeforeRules` 普查守恒等字段如已导出可一并展示（增强项可裁）。

## 4. 验收（机器可验证）

1. 集成/e2e：GET scan 返回五桶，且与 MCP `codecompass_scan` 同 (repoId, commit) 输出一致（一致性断言）。
2. 缓存行为有断言（同 commit 二次请求命中缓存；commit 变化后失效）。
3. 文案哨：组件测试断言体检面 DOM 不出现「安全删除」；copy-guard 双哨绿。
4. 精度态势区字段与 `ratchet-baseline.json` 逐字段一致（测试夹具固定断言）。
5. UI 冒烟扩链路：体检面三态走查进 `ui_smoke.mjs`；e2e 计数同步 HANDOFF §2.1。
6. 搭车（P3 可裁，若动 workbench 路由顺手）：`saveWorkbenchCard` 为 error 卡持久化 intentEcho（Round3 `:41` 处方），刷新回放后失败卡仍见「当初解析到了什么」。

## Comments

- 2026-09-28 立项（grill D3；scan REST 通道与不落库设计按 gate-run/radar 先例拍定，落库留触发线：出现「体检历史/趋势」日常诉求再立票）。
