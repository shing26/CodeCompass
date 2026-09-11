# 01：B01 — gate_runs 落库 + 执行/回放端点（控制面垂直片）

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch/v026-gate-history/spec.md`（裁决 Q6/Q9/Q12 + ADR-0017）。*

Status: closed
标签：feature / P1 / 来源：v0.26 预留 B（CI 历史报表）

## Agent Brief

**Category:** feature（schema + store + API + e2e，一穿到底；无 UI）

**用户场景：** 开发者在自己机器上反复用 `npx codecompass pr-summary` 把关 PR，但跑过的判定散落在 CI 日志里，本地工作台完全不知道历史上门禁通过/失败过没有、波及了谁。修复后（本票为数据面第一步）：任何客户端 POST 一次 gate 运行，服务器现算 `analyzeDiff+evaluateDiffPolicy` 并落库，`GET /gate-runs` 能按仓库 newest-first 回放全部历史（含 dirty 工作区独立流）——B02/B03 的界面与树都吃这条数据路。

**Summary:** 新表 `gate_runs` + `gate_run_routes`（spec 契约节 schema 逐字执行）；store 层单一入口 `saveGateRun`（表 + `gate.run` event 双写在同一方法内，禁止路由层分头写）；`POST /api/repos/:id/gate/run` + `GET /api/repos/:id/gate-runs?limit&offset&commit`（分页契约形状照 `/api/events` 先例 `{runs,total}`，非法参数容错）；**e2e gate 55→60**（规划预估 +1 条，实施按断言语义拆为五条：落库/回放同序/event 双写/票 14 契约/失败行入库）。

**Key interfaces:**
- `db.ts` SCHEMA 追加（`CREATE TABLE IF NOT EXISTS`，无列迁移；`commit_hash` 列名避 SQLite 保留字；两表 FK `ON DELETE CASCADE`）
- `repoqa-repos.ts` 新 store 方法（saveGateRun / listGateRuns；commit 三态复用 `resolveRepoCommitSync` + `repo.commit ?? 'unversioned'` 兜底）
- `routes/analysis.ts`（或新 gate 段）两注册函数——**复用票 09 的 `requireRepo` 守卫**
- **契约冻结（票 14）**：git/引擎失败 → 400 响应 `{error: 人话首行, detail: 原始输出}` 形状不变，同时照常落一行 `error` 记录（用户要看"跑挂过"的历史）；policy FAIL 是正常结果行不是 error 行

**Acceptance criteria:**
- [x] 新表单测：落库/回放顺序、(repo,commit) 流隔离（含 `+dirty` 独立流、空→unversioned）、级联删仓、策略 options 快照不回溯
- [x] 双写断言：一行 gate_run ⇔ 一条 `gate.run` event（/api/events 时间线可查）
- [x] POST 端点：成功 201 `{run}`（含 payload_json + routes 行）；缺参 400；坏 ref 走票 14 契约；`source='workbench'` 默认（CLI 上报为 ADR-0017 预留位）
- [x] GET 端点：分页/过滤/非法参数容错（/api/events 同款断言族）
- [x] 既有 delta/policy/events/workbench-cards 断言**零修改**通过（workbench_cards CHECK 零触碰）；控制面全量绿（基线 580 起）
- [x] e2e closeout_gate.py 60/60（原 55 + 本票 5 条能力断言：落库/回放同序/event 双写/票 14 契约/失败行入库）

**Out of scope:** 前端 UI（B02）、树渲染（B03）、CLI --report-to 通道（ADR-0017 预留）、自动清理（spec 明确不做）。

**Blocked by:** None — can start immediately（与 A 系列全并行）。

**触碰面声明：** services/control-plane（db.ts / repoqa-repos.ts / routes/analysis.ts / repoqa-http.test.ts）+ scripts/e2e/closeout_gate.py。**不碰** web 包、不碰 contracts 包既有类型（新增类型走 server 侧导出）。

## Comments

- 实现（2026-09-11）：schema 双表+索引入 `db.ts` SCHEMA（无列迁移需求）；store 单一入口 `saveGateRun`（表+子表+event 同事务，better-sqlite3 transaction 体内零 await）/`listGateRuns`（newest-first、/api/events 同款 sanitizePaging）；`routes/analysis.ts` 两端点（复用 `requireRepo` 守卫与 `resolveRepoCommitSync`）。测试 `repoqa-gate-runs.test.ts` 7 单测+1 HTTP 集成（两提交 Java fixture）；控制面 **587/587**、e2e **60/60**（新五条断言全过，活证据：status=FAIL violations=1 routes=1；坏 ref 人话行「无法解析 git 引用 "origin/nope"…」+ 失败行入库）。
- 双轴 review（Reviewer-Security 全量挑刺）六项处置：#1 **P1 真缺陷**——displayPath 不含动词/控制器，GET+POST 同路径必撞 PK 静默覆盖 riskLevel，且 routes_count 记入参长度与子表实存漂移 → 键改 `displayPath#Parent.method` 复合、store 内 Map 去重、count 由去重后派生（附回归测试）；#2a **P1**——成功回显「按 (repo,commit) 取最新」并发下会串 verdict → `listGateRuns` 加 `id` 谓词，按 `runId` 回读；#2c **P2**——catch 内二次落库可因 FK（仓被删）抛出悬挂请求 → 包 try，历史写永不吞票 14 响应；#3 **P2**——`intent` 列是低基数枚举维度（worker 先例），合成串毁掉该维度 → `intent='gate'` + refs/verdict 进 `feedback` JSON；#4 **P2**——payload 掩码了但 error/detail 裸存，同表掩码不变量只覆盖 1/3 文本列 → 入列前 `maskSensitiveText`（**响应体保持原样，票 14 契约冻结不受碰**）；#6 **P2**——e2e 断言同义反复（status∈CHECK 域永真、自反回环）→ 钉死 fixture 期望 FAIL+violations≥1+options/base/head，回放断言改九字段全列比对。#2b/#5 裁定非缺陷（分析全程不触工作区；CASCADE/NULL CHECK/事务均实测成立）。
- spec 勘误：schema 契约节初稿漏 `payload_json` 列（B03 树明细依赖）已补；e2e 口径「55→56」按实施实况修正为 60（5 条断言）。
- 收口双轴 review 追加两笔：**P2-9 勘注**——spec schema 写 `created_at TEXT DEFAULT (datetime('now'))`，实现为 NOT NULL 代码供时（db.ts，workbench_cards 先例同形、行为等价），非缺陷、免后人对照生疑；**P1-2 守卫**——本端点（与 architecture-delta）base/head 加 `^-` 选项注入拦截（`--output=` 类值会被 git 当选项、server 绑全网卡无鉴权），analyzeDiff 咽喉+路由前置双层，校验失败 400 不落 error 行、票 14 语义不受碰；127.0.0.1 绑定收敛与 LAN 暴露面评估立 v0.27 安全票。
