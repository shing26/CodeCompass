# 02 — Physical Anchor commit 钉定

Status: done

> 2026-09-01: 列名 `repo_commit`（`commit` 是 SQLite 保留字）；`resolveRepoCommitSync`（hash/+dirty/unversioned）；create/upsert/refreshRepoCommit 三处写入；anchor 契约加 `commit`+`lineEnd`；两条校验循环盖章；done payload 透传；8/8 测试（含真 git 仓库 SSE 端到端）。

## 目标（ADR-0010）
- `repoqa-repos.ts`：`repos` 表新增 `commit` 列（幂等 ALTER TABLE 迁移）；注册/更新 repo 时解析：
  - `git -C <local_path> rev-parse HEAD` → commit hash；`git status --porcelain` 非空 → `commit+dirty`；
  - 非 git 目录 → `unversioned`。解析失败不阻塞注册（列可空）。
- `RepoQaAnchor` 扩展 `commit?: string`；`isValidAnchor` 校验通过后把 repo 当前 commit 附加到锚点。
- SSE `repoqa.query.anchors` 与 `repoqa.query.done.payload` 透传 commit；anchor-click 入参兼容（不强制）。
- 导出工件（export-artifact / onboarding markdown）锚点行带 commit 短哈希。

## 验收
- repos 迁移幂等（旧库升级不丢数据）；git / 非 git / dirty 三态测试（临时目录 fixture）。
- anchors payload 含 commit；现有 252+ 测试全绿。
