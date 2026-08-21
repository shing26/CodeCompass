# 08 - Local evidence plane

**What to build:** Record minimal local read-only query events so adoption, failure, and anchor behavior can be measured later without uploads.

**Blocked by:** 04 - SSE query skeleton; 05 - Deterministic call-chain query; 06 - Chunks and config evidence

**Status:** ready-for-human

- [x] Query start/done, tool miss, anchor click, feedback, and failure class events persist locally
- [x] Event data stays read-only and never leaves the machine
- [x] Events are associated with session/repo metadata as optional fields only
- [x] Evidence events are covered by HTTP-level tests

## Comments

### 2026-08-20 implementation

- `RepoQARepos.recordEvent` 写入 `repoqa_events`，支持 query start/done、tool miss、anchor click、feedback、failure class 与可选 sessionId。
- `queryRepo` 记录 `query.start`/`query.done`，call-chain start 找不到时记录 `tool.miss`；SSE query 失败路径记录 `query.failure`。
- HTTP 新增 `POST /api/repos/:id/anchor-click`、`POST /api/repos/:id/feedback`，事件仅本地持久化，不向外部上传。
- 测试新增 2 条 evidence 场景（本地事件持久化、failure class）；控制平面 15 条测试全通过，typecheck 通过。
