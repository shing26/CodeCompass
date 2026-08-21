# 02 - Repo import and safe file access

**What to build:** Let a developer import a local Java repo, watch status progress, re-index safely, recover after restart, and read source files through a protected endpoint.

**Blocked by:** 01 - Contract and schema freeze

**Status:** ready-for-human

- [x] POST import of a local Java repo returns 201 and the created repo
- [x] Status transitions through idle/indexing/ready/error with progress events
- [x] Re-import and re-index are idempotent; no stale symbols survive
- [x] Repo data and status recover after Control Plane restart
- [x] Over-limit repos (>3000 files / 500K LOC) guide submodule selection or fail with a clear reason
- [x] Raw file endpoint serves indexed files and returns 403 for path traversal
- [x] HTTP integration tests cover the above at the API boundary

## Comments

### 2026-08-20 implementation

- 数据层：`repos` 表增加 `error` 列，并提供存量表迁移；新增 `findByLocalPath`、`upsertByLocalPath`、`clearRepoData`、`resetInterrupted`。
- 扫描器：`repoqa-scan.ts` 递归扫描并计数，忽略 `.git`、`node_modules`、`dist`、`build`、`target`、`out`、IDE/coverage 目录与符号链接；硬限制 3000 文件、500K 行。
- Worker：`indexRepo` 完成 `idle -> indexing -> ready | error` 状态机，通过 EventBus 发送 `repoqa.index.progress/done/error`；重新导入会清理旧 `repo_symbols` / `repo_chunks`。
- HTTP：新增 `GET /api/repos`、`GET /api/repos/:id`、`POST /api/repos` 与 `GET /api/repos/:id/file/raw`；raw file 路由校验 resolve 路径不越出 repo root，并在 `realpath` 后再次校验。
- Runtime：`src/index.ts` 已改为使用 `createHttpApp` 与 WebSocket 共用同一 HTTP server，RepoQA、Harness、Repo `/api` 路由在运行时也应可用。
- 测试：新增 `src/repoqa-http.test.ts`，在真实 HTTP port 上覆盖 5 个场景（导入/进度、幂等重导且清理符号、重启恢复、超限错误、raw 文件与路径穿越）。`npm test --prefix services/control-plane` 通过，`npm run typecheck --prefix services/control-plane` 通过。

### 2026-08-20 code review fix

- 新增 `repo_files` 持久化已扫描文件清单；raw file 端点现在只服务已索引文件，`.git`、`node_modules` 等忽略目录返回 403。
- 配置文件（`application*.yml/properties`、`pom.xml`）通过 raw 端点返回时会先做 secret masking。
- `src/index.ts` 现在把 `repoqa.*` EventBus 事件转发给 WebSocket 客户端，导入进度可被外部订阅。
