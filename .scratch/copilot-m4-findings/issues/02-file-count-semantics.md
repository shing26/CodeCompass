# Issue 02（P3）：文件数口径差异需工具描述文档化

- 状态：open（建议低改动随下版本带出）
- 来源：compass-copilot QA 首轮（P3 第 7 条）
- 级别：P3——不影响功能，但 LLM/用户会混用两个数字

## 现象

lazygit：`list_repos.fileCount`=1228（索引文件总数）vs dashboard/scan 可解析语言文件 1094。copilot 的 LLM 在回答里曾把两者混用错归因。

## 建议

1. 最低成本：`codecompass_list_repos` 与 `codecompass_get_dashboard` 的工具 description 各加一句口径说明（"fileCount 为索引文件总数；dashboard/scan 统计仅覆盖有符号产出的可解析文件"）
2. 可选：dashboard payload 增加 `indexedFiles` 字段对齐 list_repos 口径

copilot 侧无需改动。

## evidence

QA 首轮报告 P3-7 条目 + copilot REPL /status 与 /call 输出对比（2026-09-07）。

## 处理状态

（待线 A 排期时回写）
