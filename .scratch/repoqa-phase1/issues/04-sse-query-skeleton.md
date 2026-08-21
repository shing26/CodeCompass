# 04 - SSE query skeleton

**What to build:** Let a developer ask a natural-language question and receive a progressive SSE answer even before real LLM wiring, with validated anchors and a suggested next action.

**Blocked by:** 02 - Repo import and safe file access; 03 - Symbol extraction and browse

**Status:** ready-for-human

- [x] Query endpoint streams token, mermaid, anchors, and done events in order
- [x] Anchors pass raw-file validation before being emitted; invalid anchors are omitted or rejected
- [x] Done event may include a static suggested action based on real symbols
- [x] Mock LLM adapter drives the contract; integration tests assert the event sequence

## Comments

### 2026-08-20 implementation

- Contract 增加 `RepoQaAnchor`、`RepoQaQueryToken/Mermaid/Anchors` 与对应 `ServerEvent` 变体（`repoqa.query.token`、`repoqa.query.mermaid`、`repoqa.query.anchors`）。
- `RepoQAWorker.queryRepo` 是 async generator：mock answer -> token 流 -> mermaid -> anchors -> done；mock 内容基于持久化 symbols，不做真实 LLM 调用。
- Anchor 在 emit 前经过 `realpath`/root 路径校验；无效 anchor 被丢弃。`repoqa.listSymbols` 的 DB row 改为稳定 camelCase，修复 anchor.filePath 丢失。
- HTTP 新增 `GET /api/repos/:id/query?question=&mode=` SSE 路由；missing repo/question 分别返回 404/400。
- 测试：新增 2 条 SSE 集成测试，断言事件顺序、content-type、anchor 校验；控制平面 9 条测试全通过，contracts/control-plane typecheck 通过。
