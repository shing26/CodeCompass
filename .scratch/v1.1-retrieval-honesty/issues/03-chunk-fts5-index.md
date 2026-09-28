# Issue 03 — `LIKE` → FTS5(trigram) 检索索引

> 依据：ADR-0002 撤的是 **embedding 与"语义检索"表述**，不含关键词/chunk 检索本身——本票在其承诺范围内（原文补偿手段即"精确检索、别名与配置 key 提取"）
> 波次：波 2 ｜ 状态：**已落地（2026-09-28）** ｜ 依赖：票 02 ｜ 半批：A 主命题

## 1. 实测（为什么可行）

- better-sqlite3 **12.11.1** 自带 FTS5（**建表实测成功**，零新依赖、零新中间件）。
- `trigram` 分词器行为（实测）：3 字 `MATCH '点赞功'` **命中**；**2 字 `MATCH '点赞'` 静默返回空且不报错**。
- 而 `LIKE '%点赞%'` 在 trigram 虚表上**语义完整**（2 字也命中）→ 短查询必须保留 LIKE 路径。

## 2. 三条硬约束（**前两条必须在 spec 拍死，不是实现自由**）

### ① 排序键：`file_path, line_start, id` —— 两路径共用

现状 SQL（`repoqa-repos.ts:1029-1032`）**没有 `ORDER BY`** → 行序**未定义**。因此"两条路径返回顺序一致"这个验收要求**当前不可判定**（两条都未定义，谈不上"一致"）。
→ 必须钉死排序键，两路径共用。**这不是实现细节，是验收判据的可判定性前提。**

### ② 所有 chunk 写入/删除必须经**单一函数**

现状 `repo_chunks` 写路径 **5 处**：`repoqa-repos.ts:533`、`:546`、`:994`、`:1013`（DELETE）+ `:1020`（INSERT）。
→ FTS 同步只在**这一个函数**里做。没有这条，两种表形态**都会静默漂移**，验收③（"故意不同步能抓到"）会变成"实现完才发现抓不到"。

### ③ 短查询保留 LIKE 语义

查询长度 < 3 走 LIKE，≥ 3 走 `MATCH`；两条路径**同一排序键**、同一 `LIMIT` 语义。

## 3. 脱敏（**更正一处外部推理**）

外部评估曾据"`maskSensitiveText` 只在出库侧"推断两种表形态都不引入脱敏旁路——**该前提不成立**：实测非测试命中 **50 处**，其中 `ingest/repoqa-worker.ts` **8 处**（chunker 内即调用）。

**正确的理由**：脱敏发生在**入库前**（`maskSensitiveText(content)` / `maskSensitiveText(block)`），因此 `repo_chunks.content` 存的已是掩码后的文本，**外部内容表与独立表存的是同一份文本**，都不构成旁路。

→ 实现者只需保证：**新分支（票 04）与既有分支一样，先掩码再入库**；表形态（`content='repo_chunks'` 外部内容表 vs 独立表）**可自由选**，但须在票内写明理由。

## 4. 取舍依据（换一个，原来的不重要）

- ~~"外部内容表省空间 vs 独立表双份存储"~~：chunk 量级 73 → 几百，**空间差可忽略**。
- **真正的取舍是同步失效的可检测性**（验收③）：这取决于约束②（单一写入函数），不取决于表形态。

## 验收（机器可验证）

1. 9 桶 `recallAtK` 不降（现全 100%）；票 02 的桶在票 04 之后达标。
2. **2 字中文查询仍命中**（走 LIKE）；**3 字以上命中 FTS 虚表**（`EXPLAIN QUERY PLAN` 输出留档）。
3. **会红证明**：故意让 FTS 表不随写同步 → 出现"刚入库的 chunk 查不到" → 有一条用例能抓到 → 复原 → 绿。
4. **顺序可判定**：新增用例断言两条路径在**同一数据集上返回同一序列**（`file_path, line_start, id`）。
5. 老库升级：用 v1.0.0 生成的索引库跑升级路径，`repo_chunks` 行数不变、检索结果与升级前一致。
6. 写路径收口后：`grep -c "repo_chunks" repoqa-repos.ts` 的写点集中在单一函数内（票内给出前后计数）。

## Comments

- 2026-09-27 立项；2026-09-28 按外部评估的三条意见重写（排序键 / 单一写入函数 / 取舍依据），并**更正**其脱敏推理（§3）。
- 2026-09-28 **落地**（表形态：独立 FTS5 表，非 external-content——普通 `DELETE` 直接可用、同步代码平凡正确；文本双份在百级 chunk 量下可忽略，§4 取舍兑现）。
  - **写路径收口（验收⑥）**：`DELETE/INSERT FROM repo_chunks` 散点 **5 处 → 2 个私有帮手**（`insertChunkRows`：INSERT repo_chunks + INSERT fts 同 rowid；`deleteChunkRows`：rowid 子查询先删镜像再删正表，`filePath` 缺省=整仓清除）。`clearRepoData`/`deleteRepo`/`upsertChunks`/`replaceFileChunks`/`deleteChunksForFile` 全部改走帮手；`db.ts` 开库重建（行数不一致即全量重建）定位为**崩溃自愈网，不是写路径**。
  - **排序键（验收④）**：两条路径共用 `ORDER BY file_path, line_start, id`，SQL 常量导出（`SEARCH_CHUNKS_LIKE_SQL` / `SEARCH_CHUNKS_FTS_SQL`，test-only 消费）供 EXPLAIN 断言防漂移；同数据集两路径同序列有用例钉死。
  - **短语语义**：FTS 走 phrase 查询（`ftsPhrase`：包引号 + 内嵌 `"` 双写），非相邻 trigram 不命中（AND 语义假阳被用例钉死："alpha delta" 不命中 "alpha beta gamma delta"）。
  - **验收逐条**：① eval 101 题 9 桶 recallAtK 全 100% 零回退、`ratchet=ok`、intent-anchor 4 道豁免题保持 0/4 先红不变；② 2 字中文走 LIKE 仍命中 / 4 字走 FTS 命中（EXPLAIN 留档：`SCAN repo_chunks_fts VIRTUAL TABLE INDEX 0:M1` + `SEARCH rc USING INTEGER PRIMARY KEY (rowid=?)`；LIKE 路径 `SEARCH repo_chunks USING INDEX idx_repo_chunks_repo`，零镜像引用）；③ 会红证明用例在档（裸 INSERT 绕过帮手 → ≥3 字检索不可见 → 开库重建同款语句复原 → 可见）；④ 同数据集两路径同序列；⑤ v1.0.0 库（有 chunk 无镜像）reopen 即重建，行数不变、检索一致；⑥ 计数如上。
  - 门禁：控制面 **751/751**（基线 739 + 新增 12 测）、eval exit 0、e2e **71/0**（golden eval 检查含 `ratchet=ok`）；dist 已重建。
  - probe 留档：`.scratch/v1.1-retrieval-honesty/probe-fts-plan.ts`（本地产物，可复跑打印两路径计划）。