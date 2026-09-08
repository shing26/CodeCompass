# Ticket 25.3 — 工件流服务端持久化（Artifact Stream Persistence）

## 目标
Ticket 24.5 的前端内存 Artifact Stream 升级为 SQLite 持久化：推演历史按 (repoId, commit) 落地服务端，重进仓库 / re-index 后回放；承载 spec 三支柱之"Persistence Layer"。

## 现状锚点（已核实）
- `useEvolutionSession.ts`（182 行）：bucketsRef 内存 Map 按 `${repo.id}::${repo.commit ?? 'unknown'}` 分桶；L47 注释明说 "server-side persistence is Issue 25"；**L10 `nextCardId` 模块级自增**——hydrate 回放后与自增 id 撞号，必须服务端化或换生成策略。
- 服务端已有落库种子：evolve done 时 `recordEvent({eventType:'query.done', intent:'evolve', feedback: JSON.stringify({intentType, target})})`（repoqa-worker.ts L989 一带）——只有意图回声，无 echo/result/mermaid/conflict。
- `repoqa_events`（db.ts L123-139）是 dogfooding 埋点表（Issue 08 /api/events 只读面、分页过滤都建立在 event_type/intent 语义上）——往埋点表塞大 JSON 工件不可取，**新建内容表**。
- evolve SSE 载荷（contracts L436-463）：stage{stage,label,status,intentEcho?} / done{intentEcho,result,mermaid?,commit?} / error{error,conventionConflict?}。
- 脱敏：http.ts evolve 分支（L584-644）未过 maskEventPayload（query 分支有）；工件 result 只含 path/symbol/引擎模板（Issue 12：值永不索引），落库前仍需一条显式复核/断言。

## 改动点
- **新表 `workbench_cards`（裁决④：同表 + kind 列，不再叫 evolution_cards）**（db.ts + 迁移）：
  - 列：`id INTEGER PK AUTOINCREMENT, repo_id TEXT NOT NULL, commit TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL('evolve'|'incident'), intent TEXT, target TEXT, status TEXT NOT NULL('done'|'error'), echo_json TEXT, result_json TEXT, mermaid TEXT, conflict_json TEXT, error TEXT, created_at TEXT NOT NULL`；
  - `UNIQUE(repo_id, commit, seq)` 幂等键；索引 `(repo_id, commit)`。
- **服务端落库点**：evolve 流 done/error 终态事件处理处（与现有 recordEvent 相邻）写终态卡；seq 按该 (repoId, commit) 现有 max(seq)+1；incident 卡落库归 Ticket 25.1 完成后接线（kind='incident' 预留）。
- **回放端点**：`GET /api/repos/:id/workbench-cards?commit=<hash|hash+dirty>` → 该流全量卡（seq 升序，shape 对齐前端 EvolutionCard/IncidentCard；**裁决④**：kind 列天然支持 evolve+incident 双流混合回溯，同 seq 序统一回放，前端按 kind 分发渲染）；无 commit 参数返回该 repo 最新流（调试用）。
- **前端 hydrate**：useEvolutionSession 切桶时先 GET 回放（服务端卡 id 作前端卡 id），再叠加本会话新投递；submit 不再依赖 `nextCardId`——临时卡用 `crypto.randomUUID()`，done 后以服务端 seq 卡为准替换。
- **中断语义不变**：切桶仍关 in-flight 并把本地 streaming 卡标 error（服务端无该卡，不回写——纯客户端状态）；重新进入该桶时中断卡自然消失（服务端只存终态），视为未完成推演，与现有文案一致。
- **写入路径幂等**：同一 done 事件重复到达（重连）不双写（UNIQUE 冲突即覆盖/忽略，取其一并测试）。

## 验收
- 集成测试：投递→done→重启服务（或新 client）→GET 回放同序同内容（echo/result/mermaid/conflict 全量）；conflict 卡回放为 error 态+conflict detail；不同 commit 流互不可见；kind='incident' 卡与 evolve 卡混合落库后按 seq 统一回放（双流混合回溯）。
- 幂等：同一 (repoId, commit, seq) 重复写入不重复行。
- 前端：重进仓库历史卡折叠回放、新投递正常追加、id 无撞号；useEvolutionSession 组件测试全绿（含原 9 个场景迁移）。
- 脱敏断言：落库 JSON 不含 config value 类字符串（复用 Issue 07 fixture）。
- control-plane/web 全量回归绿；gate 回放断言（扩项归 Ticket 25.4）。

## 实施记录（2026-09-01，Ticket 03 交付）

### 落地
- **表**（db.ts SCHEMA）：`workbench_cards`——id INTEGER PK AUTOINCREMENT, repo_id, commit_hash, seq, kind CHECK('evolve','incident'), intent, target, status CHECK('done','error'), echo_json, result_json, mermaid, conflict_json, error, created_at + `UNIQUE(repo_id, commit_hash, seq) ON CONFLICT REPLACE` + `idx_workbench_cards_query(repo_id, commit_hash, seq ASC)`。列名用 `commit_hash`（`commit` 是 SQLite 保留字；沿 db.ts `repos.repo_commit` 先例）。commit 口径统一 `repo.commit ?? 'unversioned'`（+dirty 后缀原样存储，查询天然隔离）。
- **写入**（repoqa-repos.ts）：`saveWorkbenchCard` 显式 `INSERT OR REPLACE`（坑位：表级 UNIQUE…ON CONFLICT REPLACE 对不显式指定算法的 plain INSERT 不生效），seq 取 `COALESCE(MAX(seq),0)+1`（Math.max 防空流），返回 `{cardId, seq}`；五处终态落库点：worker evolve done / evolve ConventionConflictError catch（echo+conflict）/ incident LLM done / incident fallback done，http.ts handleEvolve catch + handleQuery catch（mode==='incident'）补 error 卡；落库对象一律过 maskEventPayload；终态 SSE 载荷注入 `cardId`/`cardSeq`。
- **回放**（http.ts）：`GET /api/repos/:id/workbench-cards?commit=`——404 / 缺省 commit = 当前物理流、seq 升序、响应过 maskEventPayload；行 shape `{id:String, seq, kind, intent, target?, status, echo?, result?, mermaid, conflict?, error, createdAt}`（echo = evolve 意图回声对象 / incident 原始堆栈文本；result = evolve 工件 / incident `{answer, anchors, usage, provenance, lowConfidence, suggestedAction?}`）。
- **级联**：deleteRepo 事务追加 `DELETE FROM workbench_cards WHERE repo_id=?`——一处覆盖 MCP remove_repo 与 HTTP DELETE 双入口。
- **前端**：useEvolutionSession 删模块级 `nextCardId` 计数器→`crypto.randomUUID()`（非安全上下文回退随机后缀）临时 id；evolve/incident 的 done/error 处理器采纳载荷 cardId/cardSeq 替换临时 id；切桶 effect 调 `getWorkbenchCards(repoId, commit)` hydrate——服务端行→卡映射（evolve stages:{} 重放为空、incident evidence = parseEvidenceFromAnswer(answer, anchors) 确定性重算、break = anchors 空且无 mermaid），按 id 去重合并（服务端行权威、in-flight 流卡保持），失败静默保持内存桶；client.getWorkbenchCards 仿 getDashboard（404→null→空回放）；QueryStream error 事件透传 payload.cardId/cardSeq。

### 验证
- control-plane 545/545（新增 repoqa-workbench-cards.test.ts 6 测：Evolve/Incident 混合顺序、显式 seq REPLACE 幂等、deleteRepo 级联、+dirty commit 隔离 + 2 条 HTTP 集成含「落库 JSON 与 GET 响应均不含 supersecret」脱敏断言）；web 284/284（hydrate 组件测试 3 条）；四包 build 过。
- gate 52/52：新增 check_workbench_cards_hydrate 三断言（done 载荷披露服务端 cardId/seq；hydrate 回放同 id 同 seq 同内容；conflict 流 error 卡回放含结构化 conflict detail）。

### 三处分歧裁决（以 repo spec 为准）
1. **工件卡分列存储（spec「改动点」列清单）而非单 payload blob+title（用户草案）** → 采用分列：echo/result/conflict 结构化可查询、mermaid 独立列。spec 未覆盖的 incident 字段映射：answer/anchors/usage/suggestedAction/provenance/lowConfidence → result_json、stack → echo_json、diagram → mermaid、evidence 前端 hydrate 时由 parseEvidenceFromAnswer 确定性重算。
2. **端点名 `workbench-cards`（spec 回放端点条目）而非 `workbench/cards`（用户草案）** → 采用 workbench-cards。
3. **gate Hydrate 冒烟提前至本 Ticket（用户明确要求）** → check_workbench_cards_hydrate 随 Ticket 03 交付，下文「扩项归 Ticket 25.4」由本记录取代。

### 中断语义（与 spec 一致）
切桶仍关 in-flight 并把本地 streaming 卡标 error（纯客户端状态，服务端无该卡、不回写）；重进该桶时中断卡自然消失（服务端只存终态卡），与现有文案一致。
