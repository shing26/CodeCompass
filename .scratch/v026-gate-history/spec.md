# v0.26-B Spec：门禁运行史（gate runs）+ 受波及树

> grill session 2026-09-10 产出。上游承诺：`.scratch/chat-merge/issues/07` 排期预留 B。
> 语义裁决见 **ADR-0017**（历史=服务器执行史，非 CI 遥测）。决策编号 Q6/Q9–Q12 对应访谈轮次。

## 问题

变更审计（CiGateView）现状是纯静态展示：基线指标来自 dashboard、策略旋钮是本地 state、唯一动作是复制 `npx codecompass pr-summary` 命令。用户没有任何地方回看「过去的门禁跑过什么、结果如何、波及了谁」。门禁判定引擎（`analyzeDiff`+`evaluateDiffPolicy`）本就是服务器包内的纯函数，但历史上只在 CI 进程的 CLI 里被调用，结果从未落库。

## 裁决（设计决策表）

| # | 决策 | 内容 |
|---|------|------|
| Q9 | 数据语义 | 报表主体=**服务器端执行史**，界面正名「**门禁运行史**」；CLI `--report-to` 上报降为预留 additive 扩展（ADR-0017）。 |
| Q6 | 存储 | 新表 `gate_runs` + 子表 `gate_run_routes`；**零触碰 workbench_cards**（其 CHECK kind 锁死 evolve|incident，扩列/改约束会击穿 workbench-cards.test 与 worker 落卡路径）。`repoqa_events` 双写 `eventType='gate.run'` 轻量行，`/api/events` 时间线天然含门禁事件（先例：eval.run 双写）。 |
| Q10 | 受波及树 | 载体=`gate_runs.payload_json`（impactedApis 三层结构原样存），渲染=CiGateView 报表**行内展开**两层树（div 列表 + 风险徽章 + 节点点击走既有 anchor→Inspector 导航）。零新图形技术、零新协议。 |
| Q11 | 界面位置 | 挂「变更审计」tab 内纵向三段：①现状区（基线+命令复制，不动）→ ②「运行并记录」按钮 → ③「门禁运行史」区（表格+行内树+趋势 div 条）。不新增第七 tab；趋势用行内 div 条（PASS 绿/FAIL 红、routes 计数），不引图表库。 |
| Q12 | 细则 | 受影响路数**物化**进 `gate_run_routes`（聚合查询靠 SQL，blob 只管回放明细）；**不做**自动清理（个人本地，过早设计）；`hash+dirty` **独立流**（与 workbench_cards 语义一致）+ 报表行 dirty 徽章；两表 FK `ON DELETE CASCADE`（照搬 workbench_cards 先例）。 |

## 契约

**表（`db.ts` SCHEMA 追加，`CREATE TABLE IF NOT EXISTS`；无列迁移需求）**

```
gate_runs(
  id INTEGER PK, repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  commit_hash TEXT NOT NULL,          -- resolveRepoCommitSync 三态：hash / hash+dirty / unversioned
  base TEXT NOT NULL, head TEXT NOT NULL,
  policy_options TEXT NOT NULL,       -- JSON 快照（maxAffectedRoutes/failOnBreak/failOnAuthImpact）——规则可变的量必须快照，回放不追改
  status TEXT CHECK(status IN ('PASS','FAIL')) NOT NULL,
  violations_count INTEGER NOT NULL DEFAULT 0,
  routes_count INTEGER NOT NULL DEFAULT 0,   -- gate_run_routes 行数冗余，列表页免 JOIN
  error TEXT,                          -- 人话首行（票 14 语义）；非空=执行失败行
  detail TEXT,                         -- 原始 git 输出，行内折叠
  duration_ms INTEGER,
  payload_json TEXT,              -- 掩码后的完整结果快照（violations + impactedApis 三层结构）；表管查询、blob 管回放（Q12）
  source TEXT NOT NULL DEFAULT 'workbench',  -- 'workbench' | 未来 'cli'（ADR-0017 additive 口）
  created_at TEXT DEFAULT (datetime('now'))
)
INDEX idx_gate_runs(repo_id, commit_hash, id)

gate_run_routes(
  run_id INTEGER NOT NULL REFERENCES gate_runs(id) ON DELETE CASCADE,
  route TEXT NOT NULL, display_path TEXT, risk_level TEXT CHECK(risk_level IN ('HIGH','MEDIUM','LOW')),
  PRIMARY KEY(run_id, route)
)
```

**API（routes/deps.ts 复用 `requireRepo` 守卫——票 09 的资产）**

- `POST /api/repos/:id/gate/run` `{base, head, options?}` → 服务器跑 `analyzeDiff`+`evaluateDiffPolicy` → 落库（含双写 event）→ 201 `{run}`（payload_json 全量 + routes 行）。失败落 `status='FAIL'` 还是 `error` 行：**git/引擎失败 → 400 响应 `error/detail`（票 14 契约），同时落一行 error 记录**（用户要看到"跑挂过"的历史）；policy FAIL 是正常结果行。
- `GET /api/repos/:id/gate-runs?limit&offset&commit` → newest-first 分页（契约形状照抄 /api/events 先例：`{runs, total}`，非法分页参数容错）。

**前端**：RepoQAClient 加 `runGate` / `listGateRuns`；CiGateView 三段化；行展开树消费 payload.architectureDelta.impactedApis（与 ArchitectureDeltaView 已验证的字段族同源）；节点点击 `onNavigate(file,line)` → Inspector（复用 openFile 契约，票 11 的 navSeq 已保证窄屏可开）。

## 验收门

- [ ] 控制面：新表/守卫/双写/分页/级联删除/dirty 独立流/策略快照不回溯 单测全绿（基线 580 起）；既有 delta/policy/events/workbench-cards 断言**零修改**通过。
- [x] web：CiGateView 三段新断言（运行并记录→行入表；展开树节点点击→Inspector 打开；error 行折叠 detail）；基线 284 起（B02 收 300，B03 收 307）。
- [x] e2e gate：55 → **60**，新增五条「gate 落库→回放同序 / event 双写 / 票 14 错误契约 / 失败行入库」能力断言（scripts/e2e/closeout_gate.py；规划时预估 +1 条，实施按断言语义拆细为 5 条）。
- [ ] ADR-0017 已入库；`CONTEXT.md` 增补 Gate Run（门禁运行）词条。
- [ ] 版本六处推进归收口（v0.26.0 本线预占）。

## 明确不做

- CLI `--report-to` 上报通道（预留，schema 的 source 列已给位）；报表行自动清理/保留策略；独立报表 tab 或路由；图表库引入；策略规则的 CI 端回写（gate_runs 只记结果不回改任何配置）。

## 风险与暗礁

| 风险 | 对策 |
|------|------|
| 复用/扩 workbench_cards 的诱惑（"都是 (repo,commit) 流"） | 明令禁止——Q6 裁决 + workbench-cards.test:113,153 是雷区；gate_runs 独立 |
| `commit` 是 SQLite 保留字 | 列名 `commit_hash`（db.ts:144 注释先例） |
| 服务器端执行 analyzeDiff 的耗时（大仓 diff 两 ref） | 请求级现算与 delta 端点同量级（票 14 已验证 UX 可接受）；`GIT_TIMEOUT_MS` 既有兜底；行内 loading 态 |
| dirty 工作区两次运行不可比 | 独立流 + 徽章，趋势条默认过滤 dirty（spec 即此裁定） |
| 双写 events 忘一处导致时间线缺腿 | 落库与 event 写入收敛为 store 层单方法 `saveGateRun`，路由只调一处 |
