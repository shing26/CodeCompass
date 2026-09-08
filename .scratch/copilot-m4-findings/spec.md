# copilot M4 dogfooding 取证回流（给线 A）

> 来源：compass-copilot（对话式智能体，M3/M4 阶段）以真实 LLM 会话驱动 CodeCompass MCP 时的引擎侧发现。
> 关联：copilot 侧报告 `D:/compass-copilot/.scratch/qa-report/persona-experience-report.md`；本仓库既有 dogfooding 记录 `.scratch/scan-dogfooding-v021/`（v0.22.0 轮）。
> 性质：均为确定性引擎（非 LLM 路径）问题，evidence 可复现。

## Issue 01（P2）：孤儿桶 total 跨索引不稳定

**现象**：同一 petclinic clone（206 files / 595 symbols 两次完全一致），两次独立索引（各自全新 `mcp <path> --data-dir` 进程）的 `codecompass_scan` orphanedPublic total 不同：

| 索引轮 | 时间 | total | 孤儿率 |
|---|---|---|---|
| A | 2026-09-06 ~20:19 | **184** | 30.9% |
| B | 2026-09-07 ~06:00 | **154** | 25.9% |

lazygit 同样复测：184→154 同期 hub totals 也有小幅漂移（5282→5217）。

**为什么重要**：0.22.0 门禁宣称 golden eval 完全确定性；scan 五桶的 total 字段是 copilot 编排层引用的核心数字——数字漂移会让「孤儿项 154 个」这类引用无法追溯，也让「比上个月少了 30 个孤儿」这类跨期对比失效。

**疑似方向（未验证）**：符号去重/排序的时序依赖；FS-watcher 残留状态；db 复用 vs 全新 data-dir 的差异。建议用确定性问题排查法：同一仓库连续 N 次全新索引 diff scan 载荷，定位首个发散的字段。

**evidence**：`D:/compass-copilot/.scratch/m3-dogfood/lazygit-scan.json`（B 轮全量载荷）、`report.md` §六；A 轮数字见 report 早期版本（JSON 已被 B 轮覆盖，数字记录在报告正文与 copilot memory）。

## Issue 02（P3）：文件数口径差异需文档化

**现象**：`list_repos.fileCount`=1228（lazygit 全部索引文件），dashboard/scan 可解析语言文件统计=1094。用户/LLM 会把两者混用（copilot 的 LLM 在回答中就把 1094 的归因搞错过）。

**建议**：低改动方案 = 在 `list_repos` 与 `get_dashboard` 的工具 description 中各加一句口径说明（"fileCount 为索引文件总数；dashboard/scan 统计仅覆盖有符号产出的可解析文件"）。可选增强 = dashboard payload 增加 `indexedFiles` 总数字段对齐。copilot 侧无需改动。

**evidence**：QA 首轮报告 P3 第 7 条 + copilot 取证（2026-09-07，REPL /status 与 /call 输出对比）。

## 回流流程约定

copilot 后续 dogfooding 的引擎侧发现统一在 `.scratch/copilot-m4-findings/issues/` 追加（编号顺延）；线 A 排期采纳后把结论回写"处理状态"行，copilot 侧 QA 回访验证闭环。
