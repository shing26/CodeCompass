# Issue 03 — 导入 202+WS 进度流化 + 导入 UX 重设计（V29-1 解冻）

> 波次：波 2 ｜ 状态：**已落地（2026-09-29）** ｜ 优先级：P0 ｜ 依赖：— ｜ 依据：spec D4

## 1. 实测与来源

- V29-1（`.scratch/v027-backlog.md`，v0.29 T3 拆账）：`POST /api/repos` **同步 await 全量索引**，大仓最长 600s 长挂、无进度；clone 重试（v0.29 T2 双退避已落）**对用户不可感知**；`onRetry` 半边当时挂账「随导入 UX 重设计」——即本票。
- 原注「建议与 Web 体验战（V27-11）并批 grill 一次定传输+UX」——本次产品化线即该批。
- 语义对齐先例：MCP `index_repo` 已全异步化（ADR-0016「立即返回 + 轮询」）；REST 面是最后一块同步长挂。
- 幽灵防线不变式（不动摇）：worker 长任务每处数据表写入前 repo 行存在性断言；`invalidate()` 不 abort。

## 2. 契约（本节即先落票面的契约，实现不得静默偏离）

1. `POST /api/repos` → **202** `{ taskId }` 秒回；索引进度走既有 WS 通道（`indexingProgress` 事件源复用，v0.29 T5 的目录轮询复位机制不动）；完成事件携带 repoId。
2. 失败事件带错误码（对齐 v0.27-B R3 的 28 稳定码族，新增码入 CONTEXT 权威表）。
3. **破坏性 REST 变更登记**：旧「同步返回完整 repo」语义废弃 → CHANGELOG 破坏性段 + README/安装文档同步；web 客户端同 commit 切换（monorepo 单提交原子）。
4. contracts 载荷类型镜像三处（contracts src / v1 / web types）+ `contract-mirror` 哨同步。

## 3. UX（ImportRepoModal 重设计）

- 阶段化进度：clone → parse → index → done（阶段标签过 copy-guard 双哨，词族对齐 worker 既有 label）。
- **可关闭后台继续**：Modal 关闭不取消索引；完成后 Sidebar 列表自动出现 + 选中引导。
- 失败可重试（消费 `onRetry`：v0.29 T2 的 isTransientGitFailure 分类与 1s/2s 退避首次可感知）。
- 本地路径 / clone URL 两种来源同一进度语义。

## 4. 验收（机器可验证）

1. e2e：POST 大样例仓 **< 2s 返回 202 + taskId**；WS 进度事件序列断言（阶段单调、终态 done/error 恰一）。
2. Modal 关闭后索引继续：关闭→完成→列表出现该仓（e2e 断言）；幽灵防线既有测试零回归。
3. clone 失败路径：重试事件可见（UI 断言 + 服务端 onRetry 日志断言双证据）。
4. 错误码：失败事件 `code` ∈ 稳定码表（新增码登记 CONTEXT）。
5. `contract-mirror` 哨绿；`npm run test:web` / 控制面全量绿；UI 冒烟扩「导入流化」链路。
6. 旧语义消费者排查留档：全仓 grep 确认无第三方依赖旧同步返回形态（本仓内仅 web 客户端，同 commit 迁移）。

## Comments

- 2026-09-28 立项（grill D4 解冻 V29-1；契约四条按「先落票面」纪律写死，202 语义破坏性变更须 CHANGELOG 破坏性段）。
- 2026-09-29 **落地**。**契约定案（实现前的侦察结论，与票面草稿的两处修正）**：
  1. **响应形状 `202 { repo, taskId }`**（票面草稿写「{ taskId }」）：worker 的 `upsertByLocalPath` 在建索引前毫秒级落行，路由把该行快照一并返回——repoId 即时可用，taskId=`index-${repoId}` 与 worker.broadcast 同源供日志/帧关联；MCP `index_repo` 的 ADR-0016 先例（:937-959）即此形状，REST 对齐。
  2. **同步失败语义保留**：坏路径在路由内先行 `fs.stat` → 400 `import_failed` **不建行**；fire-and-forget 的 pre-try 拒绝由 catch 翻 `error` 携带根因（僵尸防线，照 MCP:941-951）。
  3. **`suggestedSubdirs` 必须落行**（票面未预见）：旧同步契约靠返回值携带它，异步后 Modal 只能读 catalog 行——新增 `repos.suggested_subdirs` 列（SCHEMA+ALTER 守卫、行映射防御解析、`setSuggestedSubdirs` 写入口、worker 错误路径落建议、索引开始清陈旧）。`repos` 表另有个 `RepoQARepos` 映射已接。
  4. **克隆瞬断重试可感知（V27-18 欠账清偿）**：新 WS 事件 `repoqa.import.clone-retry {name,attempt,backoffMs,reason(掩码)}`——契约落点在 **`packages/contracts/v1.ts` 的 ServerEvent 联合**（权威；cp `src/types.ts` 是同名子集遗留，本票踩过一次后回滚）；clone 路由 onRetry 广播，前端 Modal 克隆阶段显示「网络瞬断，正在自动重试（第 N 次，约 X 秒后）」。
  5. **前端 WS 门控放宽为常连**：克隆/导入常发生在未选库时（旧门控 `if (!repoId) return` 收不到帧）；effect 依赖收敛为 `[client.baseUrl]`，repoId 与 silent refresh 走 ref 读最新值——选库/切库不再重建 socket（常驻通道语义；既有 WS 三测原样通过）。
- **服务端**：`POST /api/repos` → 202（`routes/repos-import-202.test.ts` 3 测：202 秒回以挂起 promise 证明「不等」/ 坏路径 400 零建行 / 僵尸防线 reject→error 带根因）。
- **Web**：`RepoClient.importRepo` 返回 `{repo,taskId}`；`useRepoCatalog` Bug-12 手轮询退役（202 后常驻状态轮询即拍）；`RepoContext.handleImportLocal` 照 clone 同款收尾（refresh+select+topo）；Modal 新增 localPhase 后台阶段（「取消」→「后台继续」+ `import-background-hint`）、catalog 收口 effect（ready 自动关 / error 原地报错+行上建议）、「重试」按钮（复用同路径 re-POST，upsert 复用行）。
- **波及面（验收 6 旧消费者排查留档）**：web 客户端与 Modal（本票改）；`closeout_gate.py::import_repo` 轮询化（202 断言 taskId + 目录轮询 ready/error，180s 上限——破坏性变更的活断言）；`ui_smoke` section 0 改 202+轮询；cp 集成测试 6 文件 × 本地 import 帮手经新 `test-import-poll.ts` 快照轮询（56 处断言面零语义漂移，只把「响应即 ready」改成「轮询至 ready」）；**MCP 面零改动**（独立异步路径，ADR-0016 早于本票）。
- **验收逐条**：① smoke「导入 202 快返(status=indexing+taskId)」+「后台阶段 <15s」+ gate 202 活断言；WS 序列断言落地在 smoke 1c（Node 24 原生 WebSocket 独立收帧：**phases=[DISCOVERY,AST_EXTRACTION,CROSS_LANG_BRIDGE,FINALIZING]、终态 completes=1、7 帧单调**）；② smoke 1c「弹窗关闭（后台继续出口可用）」+「关闭后索引继续并落目录 ready」；③ clone 重试 UI：Modal `import-clone-retry` 行（WS 驱动）+ 服务端 `logger.info('clone', transient...)` 双证据在代码路径就位（真实瞬断无法在 CI 复现，登记为发布前人工/真实网络场景观察项）；④ 失败事件码族沿用既有稳定码（`import_failed`/`clone_git_failed` 等，无新增）；⑤ contract-mirror 哨绿 + cp/web 全量绿 + 冒烟扩链路（1c 三段）；⑥ 上列排查表。
- **门禁**：typecheck 净、cp **778/778**、web **364/364**、e2e **73/73**、UI 冒烟 **PASS**（含 1c）。
- **挂账**：CHANGELOG 破坏性段（202 取代 200/201、重复导入不再有 200 语义）随 v1.2.0 收口由票 07 落笔；README 导入说明同步随收口。
