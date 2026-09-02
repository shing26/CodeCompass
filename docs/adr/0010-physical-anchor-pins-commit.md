---
status: accepted
---

# Physical Anchor 四元组钉死 commit

排障场景的代码处于持续变动中（发版后报错、feature 分支对比 main），不记录 commit 的锚点在文件一旦改动后行号切片会全部错位，成为"幽灵锚点"。决定：锚点升级为 `repoId + commit + file:line-range + symbolId` 四元组；工作区有未提交修改时记为 `commit+dirty`；锚点在 UI、SSE payload 与导出工件中一律透传 commit 字符串。备选方案"沿用 repoId-only 锚点"被否：省下的只是一个字段，换来的是无法回放与审计。代价：所有锚点消费方（anchor-click、Inspector、导出）需要携带并展示 commit；收益是绝对的时空可回放性。
