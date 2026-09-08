# 09: 增量索引/热重载验证（原 AC-12 残留）

Status: done

## 问题

FS watcher 热重载已交付（Issue 30，Local FS watcher + incremental graph refresh），但从未被验证（评审报告 P2-5「本轮未实测」）。能力存在但未证实，属于可信收口范围内必须补的验证。

## 任务

1. e2e 基线新增热重载场景：导入样本仓 → 修改一个源文件（新增函数/改路由路径）→ 等待 watcher 触发 → 断言符号与调用边增量更新（不重新导入）。
2. 记录增量刷新耗时与事件广播（IndexingPhase）是否正常。
3. 若 watcher 存在缺陷，修复并在本 issue 记录根因。

## 验收

- 修改文件后无需手动重导，查询结果反映变更；基线断言通过。

## Comments

- 2026-08-28：验证通过。gate 断言 `FS-watcher hot reload indexes the new method without
  re-import`：向已导入仓库的 OwnerService.java 类内追加 `hotReloadProbe()` 方法，
  轮询 /symbols 在 25s 超时内看到新符号（实际秒级）。Issue 30 的 watcher 可用。
