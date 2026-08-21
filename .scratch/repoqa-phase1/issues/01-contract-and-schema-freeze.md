# 01 - Contract and schema freeze

**What to build:** Freeze the Phase 1 public contract so the Repo Index lifecycle never advertises embedding or semantic retrieval, the SSE query contract is fixed, and a local read-only Event Plane schema exists.

**Blocked by:** None - can start immediately

**Status:** ready-for-human

- [x] Index status/progress unions remove `embedding`; no contract or event exposes semantic retrieval claims
- [x] Query completed event may carry optional `suggestedAction` derived from static symbols
- [x] `repoqa_events` schema exists for local read-only evidence events (query start/done, tool miss, anchor click, feedback, failure class)
- [x] Typecheck passes for contracts and Control Plane

## Comments

### 2026-08-20 implementation

- `packages/contracts/src/repoqa.ts`: `IndexJobOutput.status` 移除 `embedding`，进度 phase 收敛为 `cloning | parsing | ready | error`；`QueryJobOutput` 增加可选 `suggestedAction`。
- `packages/contracts/v1.ts`: 从 MHW 原始工作台恢复缺失文件，并补齐 `repoqa.index.*` / `repoqa.query.*` ServerEvent 变体与 payload 导出；服务端 SSE 事件与此契约对齐。
- `services/control-plane/src/repoqa-worker.ts`: 进度 phase 同步移除 `embedding`，chunking 阶段使用 `parsing`。
- `services/control-plane/src/db.ts`: 新增 `repoqa_events` 表及 `idx_repoqa_events_repo` / `idx_repoqa_events_type` 索引，字段覆盖 query start/done、tool miss、anchor click、feedback、failure class。
- 补齐控制平面编译前置：恢复 `packages/bridge-adapters`（来自原始 MHW），安装 `services/control-plane` 依赖；两个包 tsconfig 使用 `NodeNext`，control-plane typecheck 关闭 emit。
- 修复既有 HTTP/Orchestrator 契约错位（`TaskAction`、`createTask` 签名、`requiresApproval` 字段），未改变对外 SSE/DB 行为。
- 验证：`npm run typecheck --prefix packages/contracts` 与 `npm run typecheck --prefix services/control-plane` 均通过；`rg -i embedding packages services`（排除 node_modules/dist）无命中。
- 测试：`npm test --prefix services/control-plane` 因仓库当前无 `*.test.ts` 文件而退出码 1；本 ticket 无 HTTP 行为，未新增测试，符合 spec 的 HTTP API 测试 seam 约定。
- 仓库说明：`D:/CodeCompass` 不是 git 仓库（`git status` 报 fatal），无法执行 git 变更验证或提交。
