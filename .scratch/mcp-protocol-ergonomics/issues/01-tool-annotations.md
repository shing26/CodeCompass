# 01 — MCP tool annotations(readOnlyHint / destructiveHint / idempotentHint)

Status: done

`McpToolMeta` 增加 `annotations` 字段并透传 `registerTool`:

- 15 个只读工具:`readOnlyHint: true`(含 get_pr_impact——它对 repoPath 也只读)
- `codecompass_remove_repo`:`destructiveHint: true`(索引数据级联删除,与 install 器 autoApprove 白名单立场一致)
- `codecompass_index_repo`:`idempotentHint: false`(同路径重复导入会 upsert 新轮索引)

验收:tools/list 线上可见 annotations;单测断言 15 只读 / 1 destructive / 1 non-idempotent。
