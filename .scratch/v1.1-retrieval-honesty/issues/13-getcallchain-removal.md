# Issue 13 — 移除 `getCallChain`（票 01 派生：零调用点 + LIKE 假边）

> 依据：2026-09-28 票 01 实现期派生（票 01 Comments）+ 同日复核（穷举 grep 全仓 tracked 文件）
> 判据：**零调用点的真阳性死码**——按 v1.0 清理批「真阳性死 API 移除」同规；票 09 的「保留登记」例外不适用（无跨仓预定消费者，仅归档设计稿提及）
> 波次：波 3（搭车，F）｜ 状态：**✅ 已落地（2026-09-28）** ｜ 依赖：无 ｜ 裁决：2026-09-28 用户拍板「移除」（spec §7.1 追加裁决）

Status: done

## 1. 现状（实测）

- 定义：`services/control-plane/src/ingest/repoqa-repos.ts` 的 `RepoQARepos.getCallChain`（递归 CTE，从方法名逐跳找**调用者**）。
- **零调用点**：全仓 tracked 文件穷举 grep（排除 `dist/`、`.mimosa/`）只有三处命中——定义本身、`docs/archive/repoqa-plan.md`、`docs/archive/repoqa-prd.md`（早期设计稿）。活的调用链面是 `engine/repoqa-callchain.ts` 的内存引擎（MCP `trace_call_chain` 与工作台都走它）。
- **发布面不可达**：npm 包的 `bin`/`main` 都指向 `bin/codecompass.js`，`files` 只带 dist —— 外部消费者 import 不到 `RepoQARepos`。
- 预期寿命终结的原因是它**既是死码、又带一族潜在假边**（票 01 同族的 SQL 侧模式）：递归步 `json_extract(s.calls, '$') LIKE '%"' || c.method || '"%'` 里 `c.method` 的 `_` 被当单字通配——实测 `[{"method":"getXuserXid"}]` 对 `get_user_id` 判命中（假边 1 条），而 `EXISTS (SELECT 1 FROM json_each(calls) WHERE json_each.value.method = ?)` 判不命中。修它等于为无人调用的代码付维护费，故**移除**而非修复（形态二选一由 spec §7.1 追加裁决拍死）。

## 2. 落地

1. 删除 `RepoQARepos.getCallChain` 整个方法（含其递归 CTE）；**不动** `engine/repoqa-callchain.ts`（活路径）。
2. 票 01 Comments 的派生记录补「已由票 13 结清（移除）」——不留悬空指针。
3. **不改** `docs/archive/`（归档不改写，ADR 纪律）；`getCallChain` 在归档稿中的历史提及保持不变。

## 验收（机器可验证）

1. 删除后全仓 grep `getCallChain`：`src/` 零命中，剩余仅归档稿与本票面。
2. 控制面 **739 全绿、用例数不变**（本票不新增测试——死码移除的反向判据就是"没有任何用例依赖它"，739 全绿即为证明）；typecheck 干净。
3. e2e **71/0**，其中精度棘轮 ok（census 随删除 −1 符号 −1 孤儿，比值仍在 ceiling 之下）。
4. `git status` 可核：`docs/archive/` 未改动。

## 验收实测（2026-09-28）

- [x] 验收 1（零引用）：删除后全仓 tracked 文件 grep `getCallChain` —— `src/` **零命中**；剩余命中仅 4 处，全部为记录面：归档稿 `docs/archive/repoqa-plan.md:148` / `repoqa-prd.md:202`（**不改写**）、票 01 Comments 的结清注记、spec §5/§7.1 的票面条目。
- [x] 验收 2（无依赖 + 全绿）：控制面 **739 全绿、用例数不变**（删除前后同为 739 —— 无任何用例依赖该方法）；typecheck 干净。
- [x] 验收 3（门禁）：e2e **71/0**；精度棘轮 `| self | 163/2060 | 7.9% | ok (ceiling 17.1%) |` —— **孤儿桶 164 → 163**（被删方法原就在孤儿桶里，删除即离桶），比值 8.0% → 7.9%，仍在 ceiling 之下。
- [x] 验收 4（归档不动）：`git status` 中 `docs/` 无改动。

## Comments

- 2026-09-28 立项 + 裁决：本票源自票 01 的双轴 review 派生候选（原表述为"假调用边，建议单开票"）。复核发现该方法是**零调用点的死码**（非"现有路径上的错误结果"），故形态从「修转义」改为「移除」——避免用一张票维护无人调用的代码，也避免为它编造保留理由（spec 禁止投机泛化）。用户同日拍板 A（移除）。
- 2026-09-28 文件面：`services/control-plane/src/ingest/repoqa-repos.ts`（净删一个方法）+ spec §1.1/§5/§6.1/§7.1/§7.2 + 票 01 Comments 结清 + 票 07 拆半注记。
