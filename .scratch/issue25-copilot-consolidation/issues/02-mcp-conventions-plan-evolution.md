# Ticket 25.2 — MCP 感知面外溢：get_conventions + plan_evolution（14→16）

## 目标
把 Issue 24 的两个纯引擎能力挂上 MCP：`codecompass_get_conventions`（惯例清单）与 `codecompass_plan_evolution`（EXTEND/DEPRECATE 落位推演）；宿主（Cursor/Claude Desktop）与 Web 消费同一份引擎输出（Dual-Surface 对等）。意图解析在宿主侧——MCP 工具入参显式 `intentType`/`target`，零 LLM、零自然语言猜测。

## 现状锚点（已核实）
- `services/control-plane/src/repoqa-mcp.ts`：14 个 `codecompass_*` 工具（grep 计数 14；CONTEXT.md L4 同口径）；`mcpModuleEvolution`（L570-591）已直调 `runModuleEvolution` 且**未捕获 `ConventionConflictError`**——冲突时宿主只拿裸异常字符串；Web 面 worker（repoqa-worker.ts L946-954）捕获后输出结构化 `conventionConflict`（contracts `RepoQaEvolveError` L457-461）——**现存 Dual-Surface 缺口，本 ticket 修复**。
- `repoqa-mcp.ts` 未 import `runConventionScan`；`RepoQAWorker.runConventionScan(repoId, targetSymbol?, nearPackages?)`（repoqa-worker.ts L394-415）已含 anchors 物理存在性校验，直接复用。
- `runModuleEvolution` 已内嵌惯例消费（module-evolution-engine.ts L899 scan、L913/L922 throw `ConventionConflictError`、类定义 L64）——`plan_evolution` 不新增引擎逻辑。
- contracts 现成导出：`ConventionProfile`(L224)、`ModuleEvolutionResult`(L263)、`ConventionConflictDetail`(L354)；`ConventionScanInput` 仅 control-plane 内部（repoqa-conventions.ts L385），MCP 契约无需它。
- ADR-0016：新增 MCP 长操作（预期 >5s）必须"立即返回+轮询"，同步契约必须实测时长预算。**裁决⑤（2026-09-04）细化**：本 ticket 两个新工具坚决 Sync、严守 5s 红线——纯 AST 检索/图拓扑（零 LLM、零外网 I/O）理应 200ms~1500ms；超 5s 属引擎贪婪回溯 Bug，应引擎侧优化剪枝，不得用异步轮询掩盖。
- gate：`scripts/e2e/closeout_gate.py` `check_mcp_composite_tools`（L781-870，NDJSON roundtrip，L856 断言 `==14` → 改 16、消息 "14 total since v0.18" → "16 total since v0.20"）；CI 矩阵三 OS 跑同一 gate。

## 改动点
- **`codecompass_get_conventions`**：入参 `{repoId, targetSymbol?, nearPackages?}`；实现转发 `worker.runConventionScan`，返回 `ConventionProfile`（axes/verdict/coverage/anchors/dissidents/globalVerdict）。description 写明： neighbour-first 仲裁、纯引擎零 LLM、感知面与 Web /evolve 共享同一扫描。
- **`codecompass_plan_evolution`**：入参 `{repoId, intentType: 'DEPRECATE'|'EXTEND', targetSymbolOrModule, extensionGoal?, nearPackages?}`；宿主负责把自由文本解析成这些显式参数（工具 description 给出解析指引与示例）。返回 `ModuleEvolutionResult`（含 conventions/blastRadius/checklists/scaffoldTemplates/transactionBoundaries）。
- **冲突结构化**：两处（新 handler 与既有 `mcpModuleEvolution`）catch `ConventionConflictError` → 返回 `{conventionConflict: ConventionConflictDetail, error}` 结构（对齐 Web 面 `RepoQaEvolveError`）；JSON-RPC 层错误码选择由实现定（工具结果内嵌 vs tool error），以宿主可读为准。
- **ADR-0016 预算（裁决⑤口径）**：实测样例仓库 DEPRECATE/EXTEND 同步耗时——两工具坚决同步返回；≤5s 达标；超 5s 不得改 async 轮询，视为引擎贪婪回溯 Bug，先在引擎侧剪枝优化到 5s 内再落 MCP（结论与实测值写进工具 description 与本文件实施记录）。
- **`codecompass_module_evolution` 处置（裁决③）**：原样保留、不打断既有脚本；description 追加显式标注 `[Deprecated: Superseded by codecompass_plan_evolution]`；v1.0 大版本再物理下线。`plan_evolution` 的差异（冲突结构化 + 惯例清单显式暴露）写进自身 description。
- **脱敏复核**：ConventionProfile/ModuleEvolutionResult 出口值经 `maskSensitiveText` 口径复核（Issue 07；config 值不索引，引擎产物天然无值，但补一条静态断言/测试防回归）。

## 验收
- tools/list 16 个工具；`codecompass_get_conventions` 样例仓库返回含 return_wrapping 等 axis 的 verdict+coverage+anchors；`plan_evolution` EXTEND 返回落位表+事务边界+scaffold，DEPRECATE 返回孤立符号级联清单。
- 冲突路径：构造 STRICT axis 正面冲撞（对齐 gate `check_evolve_convention_conflict` 的样例），返回体含 `conventionConflict.axis/coverage/anchors/suggestion`，与 Web 面载荷同构。
- gate 扩项：`check_mcp_composite_tools` 断言 16 工具 + 两个新工具 roundtrip（`==14`→16、消息更新为 "16 total since v0.20"）；三 OS CI 绿。
- Sync 时长红线：两新工具样例仓库实测 ≤5s（gate 增加时长断言，红线 5s）；既有 `codecompass_module_evolution` description 含 `[Deprecated: Superseded by codecompass_plan_evolution]`。
- contracts 导出类型单测（`get_conventions` 返回 shape 断言）入 control-plane vitest。

## 实施记录（2026-09-04，commit 9b0b34a）

- **基线修正**：spec 写「14→16」基于旧 master（afd3a69）；落盘时分支已含 336a26f（`codecompass_scan` 第 15 个工具，v0.20.0），故实际为 15→**17**，gate 断言 `==17`、消息 "17 total since v0.20"。
- **引擎契约实测**（probe-t25-conflict）：
  - `ConventionAnchor` 字段是 `{file, line, symbol}`（contracts L185）——不是 filePath；axis 的 `verdict` 是人读句子，机器可读字段是 `primary`（'ApiResult'/'bare'/'field'…）。
  - 冲突触发词：中文「直接返回裸数据,不要包装」命中 `INTENT_BARE_RETURN` 正则；英文 'no wrapping' 不匹配（正则含 `no\s*wrapper` 而无 `no wrapping`）——宿主解析指引应写明该词表。
  - `targetSymbolOrModule` 必须是 class kind：'OrderController' 是 route kind，不在 `runExtend` 的 class attach 候选里，用 'FieldService0'。
- **测试夹具坑**：旧 `setupIndexedRepo` 无条件 `makeSpringRepo(repoDir)`——向冲突仓库目录写入 Spring 夹具会稀释 return_wrapping 采样（5/5→5/6，跌破 STRICT 阈值），冲突静默不触发、plan 成功返回。修复：拆出 `bootHarness(dir, repoDir)`（db+worker，不写夹具），冲突测试直接 boot 纯冲突仓库。
- **Sync 红线实测（裁决⑤）**：gate 活会话口径 `get_conventions` 全 roundtrip **0.20s**（含 stdio 往返）；单测内 `elapsed < 5000ms` 断言双保险。远低于红线，无需引擎剪枝。
- **gate 基建 `_McpSession`**：`codecompass_index_repo` 是 fire-and-forget（ADR-0016），stdio 进程被回收会让**全新**仓库冻在 `indexing`（v0.18 的 polyglot 之前已被 HTTP 侧索引、re-index 在窗口内完成，故从未暴露）。Issue 25 段改用单活会话：索引→in-session 轮询就绪→计时画像→冲突拦截，进程全程保活。`_mcp_roundtrip` 重构为其薄壳，原语义不变。
- **版本号**：0.20.0 已被 scan（336a26f）占用；Ticket 02 条目追加进 CHANGELOG `[0.20.0]` 块（Highlights/Added/Changed），package.json/cli.ts/CHANGELOG 顶三处一致，gate 版本一致性检查绿。发布号段 bump 裁决留给 Ticket 04。
- **测试**：control-plane 29/29（repoqa-mcp）+ 539/539 全量；web 281/281 + tsc/build 绿；gate **49/49**（原 44 + Issue 25 五项）。
