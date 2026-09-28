# Issue 01 — `searchChunks` 的 LIKE 转义是空操作且 `_` 未转义（真 bug）

> 依据：2026-09-27 外部审计复核（本仓实测），锚点 `services/control-plane/src/ingest/repoqa-repos.ts:1031`
> 判据：**现有路径上的错误结果**——不需要"降低误报"论证即应修（HANDOFF §2.2 的反面情形）
> 波次：波 1 ｜ 状态：**✅ 已落地（2026-09-28）** ｜ 依赖：无

Status: done

## 1. 缺陷（实测）

```ts
// services/control-plane/src/ingest/repoqa-repos.ts:1028-1032
.prepare(`SELECT * FROM repo_chunks WHERE repo_id = ? AND content LIKE ? LIMIT ?`)
.all(repoId, `%${query.replace(/%/g, '%%')}%`, limit)
```

三点，任意一点单独成立即为 bug：

1. **`%%` 是空操作**：SQLite 的 `LIKE` 只在带 `ESCAPE` 子句时才把 `%%` 认作"转义后的 `%`"。全仓 `ESCAPE` **0 命中**（实测 `grep -rn "ESCAPE" --include='*.ts' services/control-plane/src | wc -l` → `0`）。
2. **`_` 完全未处理**：`_` 是 LIKE 的单字符通配符。实测查 `get_user_id` 会同时命中 `getXuserXbyXid` 一类内容。
3. **`LIMIT 20`**：假阳直接挤占真阳位，是"检索看似命中、点开不对"的典型症状。

## 2. 影响面

调用点 **11 处**：`repoqa-worker.ts:686/1088/1442/1771/1792`、`repoqa-mcp.ts:701`、`cli.ts:898`、`analysis-graph.ts:122/219`、`repoqa-eval.ts:739/879`。

其中 `repoqa-worker.ts:1442` 把 20×200 字 chunk 文本**直接注入 diagnose 上下文**——假阳会进 LLM 上下文。

## 3. 落地

- 新增 `escapeLikePattern(s: string): string`：**先**转义 `\`，**再** `%` 与 `_`（顺序错了会双重转义）。
- SQL 改为 `... content LIKE ? ESCAPE '\' LIMIT ?`。
- **不要动 LIKE 的匹配语义**（大小写不敏感、`%`/`_` 仍是通配符），只堵注入面。
- 票 03 会把这条查询换成 FTS5；**本票先独立成立**（票 03 未开工也必须修）。

## 4. 为什么不是"票 03 一起做"

票 03 依赖票 02 先红（波 2），而本 bug 在波 1 就该消失。且票 03 的双路径设计里**短查询仍走 LIKE**——本票的转义在那条路径上同样必需。

## 验收（机器可验证）

1. 新增单测：同一 repo 两条 chunk，一条含 `get_user_id`、一条含 `getXuserXbyXid` → `searchChunks('get_user_id')` **只返回前者**。
2. 反向用例：`searchChunks('%')` 只匹配**真的含 `%` 字符**的 chunk（不是全表）。
3. 回归：9 桶 `recallAtK` 不降（现全 100%）；控制面用例数 711 → 711+N；e2e 71/0。

## 验收实测（2026-09-28）

- [x] 单测：新增 `services/control-plane/src/ingest/repoqa-repos.test.ts` 4 条（`escapeLikePattern` 直测 + `_` 字面量 + `%` 字面量 + 反斜杠转义顺序），修前 4/4 红 → 修后 4/4 绿。
  - ⚠️ **票面验收 1 的夹具串实测不可判别**：`'%get_user_id%'`（11 字符窗口）对 14 字符的 `getXuserXbyXid` **修前也不命中**（多出的 `by` 使两个 `_` 各配一位后对不齐，实测 `LIKE` → 0），拿它当判据会得到一条修前修后都绿的假用例。实现改用真能命中假阳的 `getXuserXid`（`_` 各配一位，`LIKE` → 1），判据原意不变。
- [x] 反向用例：`searchChunks('%')` 只返回真含 `%` 的 chunk（修前返回全表）。
- [x] 回归：9 桶 `recallAtK` 全 **100%** 不降、零幻觉桶 0.0%（e2e gate 的 eval smoke 明细）；e2e **71/0**；控制面单测 **733 → 737**（+4，`npm test` 全绿；typecheck 干净）。
  - ⚠️ 票面写的 711 是 2026-09-24 的记录；本日修前实测为 **733**（v0.31 后续票已加 22 条），故按实测记录，HANDOFF §2.1 的 711 一并留待收口同步。

## Comments

- 2026-09-27 立项：外部审计 v2 未发现本项（其 D4 段只提"chunk 覆盖窄"），属本次双专家线复核的**新发现**。`_` 未转义的实测形态：`LIKE '%get_user_id%'` 命中含 `getXuserXbyXid` 的内容（`_` 各匹配一个任意字符）。
  - 2026-09-28 更正：上句第二半的示例串不成立（见「验收实测」⚠️），`_` 未转义的实测形态应为命中 `getXuserXid` 一类内容。
- 2026-09-28 实现：`escapeLikePattern`（先 `\`，再 `%`/`_`）+ 语句 `content LIKE ? ESCAPE '\'`，`LIMIT 20` 与 LIKE 大小写不敏感语义不动，11 处调用点同时受益。文件面：`ingest/repoqa-repos.ts` + 新测试 `ingest/repoqa-repos.test.ts`（仅控制面，无共享区）。双轴 review 后采纳两条 standards 修正（helper 移出类型簇、用例头精简至 4 行）；spec 轴无缺项、无越界。
- 2026-09-28 派生候选（**已结清**）：同文件 `getCallChain` 的递归步 `json_extract(s.calls, '$') LIKE '%"' || c.method || '"%'` 是同类未转义 LIKE——实测 `'["getXuserXid"]' LIKE '%"get_user_id"%'` → 1，即含 `_` 的 symbol 名会多出**假调用边**（与 v0.31 票 21「假边」同族）。
  - **2026-09-28 结清**：复核发现 `getCallChain` **零调用点**（全仓 tracked 文件穷举 grep；活的调用链面是 `engine/repoqa-callchain.ts` 内存引擎），且 npm 发布面（`bin`-only）不可达 → 裁决从「修」改为「移除」，落**票 13**（`issues/13-getcallchain-removal.md`，spec §7.1 追加裁决）。本条不再悬空。