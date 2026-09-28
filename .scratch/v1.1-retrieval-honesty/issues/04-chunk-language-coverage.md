# Issue 04 — chunk 覆盖扩到 TS/TSX/JS/PY 的注释与 docstring

> 依据：审计 v2 判定 D4 为最弱维度；本仓实测缺口比审计描述更大
> 波次：波 2 ｜ 状态：**已落地（2026-09-28，与票 05 同 commit——同文件串行 + 一次冻结）** ｜ 依赖：票 02 ｜ 半批：A 主命题

## 1. 现状（实测）

- `extractChunks`（`ingest/repoqa-worker.ts:2055-2085`）只有两个分支：
  - `readme*` / `*.md` → **整文件 `slice(0, 4000)`**（不切分，见票 05）
  - `*.java` → Javadoc 块
- self 仓实测：**1587 文件 → 73 chunks 全为 markdown**；**TS/TSX/PY/JS 共 252 个文件产出 0 chunk**（本仓无 Java）。
- 即：**本仓自己的注释几乎完全不在自己的检索面里**——`searchChunks` 的候选池只有文档。

## 2. 扩什么（有边界的扩）

**只扩声明式注释 / docstring，不扩函数体**：

| 语言 | 取什么 |
|---|---|
| TS/TSX/JS | `/** … */` 块注释、文件头注释 |
| Python | 模块 / 类 / 函数 docstring |

理由：函数体会让 chunk 数与噪声**同时**爆炸；且 ADR-0002 指定的补偿手段是"精确检索、别名与配置 key 提取"——注释/docstring 正是**意图声明**所在处。

### 2.1 语言范围写死：**Go 不做**

- 夹具实测 **0 个 Go 文件**（`repoqa-eval.ts:172` 内联夹具的文件键里无 `.go`）→ 扩了**无任何判据能问它**，属"不可测的覆盖扩张"，与 spec §6.1 相悖。
- 这是**显式登记的边界**，不是遗漏：Go 的缺口承认存在（Go 仓库在**检索面**会只剩 markdown chunk），其边界表述与触发线由**票 07** 承担。
- 触发线：出现 Go 仓库进入检索面的真实使用，或 lazygit 的 chunk 进入任何验收判据 → 立项补 Go。

### 2.2 脱敏（**入库前**，与既有分支一致）

实测：`maskSensitiveText` 在 `ingest/repoqa-worker.ts` 有 **8 处**调用（md/readme 走 `maskSensitiveText(content)`、Javadoc 走 `maskSensitiveText(block)`）——**掩码发生在入库前**。
→ 新分支必须**同样先掩码再入库**（不是"出库时再掩"）。

## 3. 与票 02 / 03 的关系

- 票 02 先红 → 本票扩覆盖 → 该桶转绿（**xfail 转正**，同一 commit 内完成"去豁免 + 复跑绿"）。
- 票 03 的索引**必须覆盖新 chunk**（同轮验证，别出现"新 chunk 查不到"）。
- 票 05 与本单位同文件（`extractChunks`），**必须串行**。

## 验收（机器可验证）

1. 票 02 的桶 `recallAtK ≥ 85`（豁免数转 0）；**其余 8 桶不降**（棘轮）。
2. chunk 总数从 **73** 变为**冻结新值**（与票 05 **合并一次冻结**，避免两轮基线抖动）。
3. **脱敏不变式**：新增一条"TS 注释里含假凭据"的用例（凭据运行时拼接，勿写静态字面量，见 HANDOFF §2.3-2），且断言其**入库前**已被掩码。
4. **增量与全量一致**：同一文件经增量刷新与全量索引产出的 chunk **逐字节相同**。
5. **Go 未被纳入**（`git grep` 断言新分支无 `.go` 扩展名处理），且票 07 的边界文本已含 Go 缺口。

## Comments

- 2026-09-27 立项；2026-09-28 补登 Go 边界（外部评估 1a 建议）与脱敏落点更正（其 E1 推理不成立，见 spec §2.1）。
- 2026-09-28 **落地**（新模块 `ingest/repoqa-chunker.ts`，纯函数 `extractCommentBlocks(path, content)`——全量索引与热重载两入口共用同一纯函数，「增量=全量逐字节一致」由构造保证；worker `extractChunks` 只剩分发+掩码+落盘）：
  - **验收逐条**：① intent-anchor **9/9 全正式计分 100%**（4 道豁免题经 LikeButton/CommentBox 的 TSX docstring 命中→radar chunkHitFiles 锚定，先红证据链闭合），其余 8 桶 100% 不降、`ratchet=ok`；② chunk 总数 **73 → 3389**（probe 实测 `.scratch/v1.1-retrieval-honesty/probe-chunk-count.ts`：markdown 2049 + docstring 1340 = TS 1170 / TSX 135 / JS 7 / PY 28；基线本无 chunk 计数字段，本次冻结项=exempt 4→0 + recallAtK 100 重证，随票 05 一次完成）；③ 脱敏：TS 注释假凭据用例（`'AKIA'+'A'.repeat(16)` 运行时拼接）断言 chunker 产出→`maskSensitiveText`→入库的路径上已替换为 `[REDACTED AWS KEY]`；④ 两入口共用纯函数 + determinism 用例；⑤ Go 未纳入（chunker 源码无 `.go` 分支的用例断言）+ 票 07 语言清单随本 commit 写入 domain_radar 工具描述。
  - **转正三件同 commit**：`repoqa-eval.ts` intent-6..9 去豁免旗、`retrieval-baseline.json` `intentAnchor.exempt` 4→0（note 更新为完成时态）、冻结断言测试改写为「名单必须恒空 + exempt 载荷缺席」。
  - 门禁：控制面 **766/766**（751 + 新增 15 chunker 测）、eval 101 题 exit 0、e2e **71/0**（golden eval 检查 `intent-anchor=9q/0exempt`）。
  - **Mimosa 误报入档**：新建 chunker.ts 被标「命令注入」（165 行）——实为 `RegExp.prototype.exec(line)` 词面误报，全文件零进程/命令执行面（grep 在案）；按 v0.27 B 批同型误报先例（用户裁决「保持原写法」）保持原样。