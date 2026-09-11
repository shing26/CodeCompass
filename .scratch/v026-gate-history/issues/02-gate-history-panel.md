# 02：B02 — 变更审计三段化：「运行并记录」+ 门禁运行史表

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch/v026-gate-history/spec.md`（裁决 Q9/Q11/Q12）。*

Status: closed
标签：feature / P1 / 来源：v0.26 预留 B（CI 历史报表）

## Agent Brief

**Category:** feature（client 方法 + UI，消费 B01 数据面）

**用户场景：** 用户在「变更审计」tab 配好基线、复制命令去 CI 跑，回到工作台一切如初——没有任何地方告诉他这台机器上跑过的门禁结果。修复后：该视图纵向三段（现状区不动 → 「**运行并记录**」按钮 → 「**门禁运行史**」表），点一下就在工作台内完成"配置→执行→回看"闭环：每行显示 PASS 绿/FAIL 红、base→head、受影响路数、时间与 dirty 徽章，行尾一条迷你趋势 div 条（**不引图表库**）。

**Summary:** CiGateView 从纯展示组件升级为执行入口；RepoQAClient 增 `runGate(repoId, base, head, options)` / `listGateRuns(repoId, {limit,offset,commit})`。

**Key interfaces:**
- RepoQAClient 新方法（fetcher 注入式，契约对齐 B01 端点形状）
- CiGateView props 扩展（现有 `repo, dashboard` 不动，加 `client` 或回调——实施时按高内聚选，测试 mock 同步）
- 策略旋钮（maxRoutes/failOnBreak/failOnAuthImpact/base/head 本地 state）从"只进复制命令串"升级为同时作为 `runGate` 入参
- 趋势条：行内 div 先例 = Inspector token-budget 进度条；**dirty 行默认从趋势条过滤**（Q12 裁定）
- error 行：首行人话常显 + `detail` 用 `<details>` 折叠（票 14 的 delta-error-detail 同款交互）

**Acceptance criteria:**
- [ ] 点「运行并记录」→ 加载态 → 新行出现在历史表顶部；400/网络失败 → 表内 error 行（折叠原始输出）且按钮可重试
- [ ] PASS/FAIL/dirty 三徽章渲染断言；趋势条不引新依赖（diff 审查判据：package.json 零变化）
- [ ] 分页滚动/加载更多（limit/offset 消费）；切换仓库后列表换源不串数据
- [ ] 既有 CiGateView 断言（基线预填等）零修改通过；web 全量绿（基线 = 284 + A 系列增量）

**Out of scope:** 行内树展开（B03）、报表独立 tab、CLI 上报。

**Blocked by:** 01-gate-runs-store-endpoints（数据面必须先存在且 e2e 绿）。

**触碰面声明：** apps/repoqa-web（RepoQAClient/CiGateView/App.tsx 接线 + 测试）。App.tsx 触碰与 A02 串行合并（ticket 粒度合 master，注意 rebase 顺序）。

## Comments

### 实施记录（2026-09-11，ZCode）

- **client**：`runGate`（POST /gate/run，票 14 错误面与 `getArchitectureDelta` 逐字同构：Error.message=人话行、`err.detail`=原始输出）/ `listGateRuns`（GET /gate-runs?limit&offset&commit → `{runs,total}`）。web 侧 `GateRunRow`/`GateRunPolicyOptions` 镜像进 types.ts。
- **CiGateView 三段化**：①现状区逐字未动；②「运行并记录」——策略旋钮同时作为 runGate 入参、票 14/QA-05 同源非 ready 守卫（gate-not-ready-hint）；③「门禁运行史」——newest-first 表、PASS/FAIL/dirty 徽章、行尾趋势 div 条（INSPECTOR token-budget 先例样式，**package.json 零变化**已核；dirty 行不进标尺不画条，Q12）、limit/offset=20 加载更多、error 行首行常显 + `<details>` 折叠 detail。`client` 为可选 props——不传时②③段整体隐藏，Issue 31 既有 3 例逐字零修改通过。
- **成功走 echo 置顶不重拉、失败走重拉**：400 的失败行服务端已落库，UI 以历史表为唯一错误显形面（无 banner 双写）；纯网络失败由同一次重拉以 historyError 显形。
- 测试：CiGateView +11 例、RepoQAClient +5 例、App.test makeClient 补两桩。web **300/300**（基线 284+16）、控制面 **587/587**、e2e **60/60**、typecheck 干净。

### Reviewer-Security 独立审查（FIX-THEN-SHIP → 已全修）

- **[P1·a] 切库竞态守卫只做了一半**：historySeq 只包住 loadHistory，handleRun 成功出口无守卫直接 prepend（A 库 verdict 进 B 库历史），失败出口更糟——用点击时闭包的旧 repo.id 重拉会**签发新代次把切库后的正确响应作废**（确定性击穿，非瞬态竞态）。修：seqAtRun/runRepoId 快照进 handleRun 两条出口，代次变→整包作废；running 为动作局部标志无条件复位（防按钮永挂）。回归 +2 例（runGate 悬挂→切库→resolve/reject 两出口）。
- **[P2·b] prepend 去重与 total+1 非原子**：去重命中时幽灵「加载更多」（offset 空窗口永挂）。修：runs/total 合并单一状态对象原子写；append 也按 id 去重（翻页间隙服务端落新行会窗口平移出重复 key）。
- **[P2·c] 转圈永挂**：陈旧 replace 迟到于当前 append 完成时无人复位 historyLoading；「加载更多」未 gate historyLoading。修：finally 无条件复位自己的标志 + more 按钮 disabled={loadingMore || historyLoading}。
- **[P2·d 尾巴] 错误静默蒸发**：catch 先落 historyError 再重拉（重拉成功即清）——防「落库也没成」时 UI 零反馈。泄漏面核实：表内行渲染的是落库 masked 文本，400 原始 detail 在 UI 侧整个丢弃，无放大。
- **[P2·g] 断言鉴别力两处**：prepend 用例改断言 echo 独有的「路 5」；dirty 行 routesCount 改 12>8，令「dirty 不进标尺」在错误实现下必翻转（33%/67%）。
- **[P2·h] App.test runGate 桩 `{}`** 是地雷（一旦有用例点按钮即 TypeError）。修：补合法 GateRunRow 形状。
- **[服务端附带·P2]** gate-runs `asNumber` 放行小数交给 SQLite 隐式截断——改 `Number.isInteger` 拒非整数（回退默认分页，容错契约不变）。已复跑控制面 587/587 + e2e 60/60。
- 判不成立项：e) unversioned 画条不越权（Q12 只豁免 dirty）；f) XSS 无注入面（全 React 文本节点，无 dangerouslySetInnerHTML）。

### 验收 checkbox

- [x] 点「运行并记录」→ 加载态 → 新行出现在历史表顶部；400/网络失败 → 表内 error 行（折叠原始输出）且按钮可重试
- [x] PASS/FAIL/dirty 三徽章渲染断言；趋势条不引新依赖（package.json 零变化已核）
- [x] 分页滚动/加载更多（limit/offset 消费，offset=20 实参断言）；切换仓库后列表换源不串数据（含 runGate 两出口的 P1 回归）
- [x] 既有 CiGateView 断言零修改通过；web 全量绿（284 → 300）

**遗留移交 B03**：行内 payload 树展开（payload_json 已随行回传）；App.tsx 触碰本票只加了 client prop，与 A02 串行合并时注意 rebase。
