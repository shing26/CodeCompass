# Ticket 25.4 — gate 扩项 + 文档 + 版本 0.20.0

## 目标
Issue 25 收官：closeout gate 纳管三支柱新能力，CONTEXT/CHANGELOG 落袋，版本一致性 gate 通过。

## 改动点
- **gate 扩项**（scripts/e2e/closeout_gate.py）：
  - MCP 面：tools/list 16 断言（L856 消息 "14 total since v0.18" → "16 total since v0.20"）+ `get_conventions`/`plan_evolution` roundtrip（含 conflict 结构化样例）；时长预算断言（ADR-0016 5s 线，Ticket 25.2 结论）。
  - 持久化面：evolve done → 重启进程（或新 client 打开同 data-dir）→ `GET /api/repos/:id/workbench-cards` 回放断言（顺序/内容/conflict 卡；端点名随裁决④表名）。
  - Incident 面：`check_incident_sse_query`（L539）语义不变；新增"incident 卡入流"的前端级断言仅在 web vitest（gate 只管 HTTP/SSE 面，沿用现状边界）。
- **CONTEXT.md**：MCP 工具面 14→16、IncidentView 收编终局（ADR-0012 Web 面完成）、Artifact Stream 持久化、ADR 引用补 Issue 25 落地注记。
- **CHANGELOG.md**：新增 `## [0.20.0] - 2026-09-0X`（日期沿用仓库既有风格，注意 check_versions 取**第一个** `## [x]` 标题——顶部不得加 Unreleased）。
- **版本 bump**：各 package.json 0.19.0 → 0.20.0（与 CHANGELOG 一致性由 gate check_versions 把关）。
- **全量回归**：typecheck（三包）+ control-plane vitest + web vitest + 四包 build + gate 全绿。

## 验收
- gate 新项全绿、总数在 README/gate 输出同步更新；check_versions 通过。
- CONTEXT.md 与实现逐条对得上（无超前宣称）；CHANGELOG 0.20.0 条目含三支柱。
- `npm run build` 四包 + `npm test --prefix services/control-plane` + web vitest + gate：全绿。
- 具备打 v0.20.0 tag 条件（Release 工作流 green 为前置——v0.19.0 的 npm publish ENEEDAUTH 已裁决切 B 解决（release.yml 无 publish，run 33846466406 ✅），无遗留阻塞）。
---

## 实施记录（2026-09-05 回填）

> 上文目标段成稿于版本裁决前；执行中用户定调 **0.21.0**（0.20.0 已被 336a26f scan 引擎发布占用，Issue 25 为完整能力跃迁必须 bump），下文按实际交付记录。

### 并行会话合流
- 执行期间主树被并行会话 checkout 在 `feat/v0.21.0-file-bucket`（=9e40495，与 incident-stream 同指），其未提交工作 = scan 第五桶 `oversizedFiles`（索引符号覆盖跨度 ≥600 行文件聚合）+ codex 反馈定位显性化 + 其自行完成的 0.21.0 六处 bump 与 [0.21.0] 章节（日期 2026-09-05）。
- 处置：diff 快照备份（scratchpad `parallel-session-snapshot.patch`）→ 全量验证其工作（control-plane 546/546、web 284/284、四包 build、gate 52/52 全绿）→ 替其提交 **59033f1**（14 文件 +122/−17，顺带修复其 CONTEXT.md 重复词条行：加五桶新行时漏删旧四桶行）→ 叠加本 ticket 收口 **b4fae3b**（3 文件 +37/−17）。

### 版本 0.21.0 六落点（实测核实）
root `package.json`、`apps/repoqa-web/package.json`、`services/control-plane/package.json`、`packages/contracts/package.json`、`services/control-plane/src/cli.ts:24` `VERSION`、`services/control-plane/src/repoqa-mcp.ts:51` `MCP_SERVER_VERSION`。用户原列 packages/cli 实际不存在，以 repoqa-mcp.ts 替代；`packages/bridge-adapters` 0.6.0 为独立版本线，不随主版本 bump。

### CHANGELOG 重排裁决
- [0.20.0] 保持纯 Scan 引擎记录（Highlights + 四条引擎 Added + CONTEXT 词条 + 立项 Note，日期 2026-09-04）；Issue 25 Ticket 01~03 条目全部收拢至 [0.21.0]（日期沿用并行会话先建的 2026-09-05；顶部无 Unreleased，check_versions 取第一个 `## [x]`）。
- [0.21.0]：Highlights 增 Issue 25 整合收官总述；Added 按 Ticket 01→02→03 时间线（Ticket 01 条目从 92ac703 commit msg 与 memory 新写）+ file-bucket 条目；Changed 移入 5 条 + 版本推进条（注明 packages/cli 不存在、bridge-adapters 独立版本线）；Notes 增 Ticket 03 分歧裁决 + CHANGELOG 收口裁决。

### CONTEXT.md 与 gate
- 状态行改 0.21.0 Issue 25 整合收官口径（Incident 卡流 + 第 16/17 工具 + workbench_cards 持久化 hydrate），scan 词条含 oversizedFiles（v0.21.0 新增）；删除被收拢的 Ticket 03 独立段，0.20.0 零残留。
- gate 断言名 L1035 "v0.20 codecompass_scan returns four candidate buckets" → "v0.21 … five candidate buckets"；check_versions 断言 0.21.0 三方一致；守住 MCP tools==17、hydrate 三断言、eval 97 题三幻觉桶 0%。

### 合并与验证
- worktree `.scratch/wt-merge`（master checkout）+ junction 3 个 node_modules（bridge-adapters / control-plane / web；root 无 node_modules、contracts 无 node_modules，故为 3 非 4）→ `git merge --ff-only` 两连跳：d0bda62→9e40495→59033f1→b4fae3b，master=b4fae3b（feat/v0.21.0-file-bucket 同指）。
- worktree 内 build 四包 + 全量 gate 52/52 EXIT=0（合并后核验）；拆 junction（先 rmdir 链接再 `git worktree remove --force`）清理完毕，主树 node_modules 完好。
- 具备打 v0.21.0 tag 条件；tag 未打，由用户决定。
