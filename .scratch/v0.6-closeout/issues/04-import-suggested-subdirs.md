# 04: 导入超限时展示 suggestedSubdirs 建议

Status: done

## 问题

大仓超限（`MAX_FILES`/`MAX_LINES`）时后端已降级为建议：`repoqa-worker.ts:544-553` 捕获后调 `detectSuggestedSubdirs`（`repoqa-scan.ts:225-232`）并把 `suggestedSubdirs` 附加到 repo 记录。但前端 `ImportRepoModal` 只把原始错误串拼进红色文本（`importRepo failed: ...`），建议数据被丢弃，用户没有可操作的下一步（原 P1-4 / E10 的最小可用版）。

## 任务

1. `RepoQAClient.importRepo` 解析失败响应中的 `suggestedSubdirs`（对齐后端契约字段名）。
2. `ImportRepoModal` 超限错误时渲染"建议导入的子目录"按钮组，点击一键填入路径输入框并触发重新导入。
3. 无建议时维持现有错误展示。

## 验收

- 用超大 fixture 导入 → 出现建议按钮 → 点击后路径回填并重新发起导入。
- 组件测试覆盖：有建议渲染按钮组、点击回填、无建议不渲染。
