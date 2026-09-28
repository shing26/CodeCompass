# Issue 03 — 导入 202+WS 进度流化 + 导入 UX 重设计（V29-1 解冻）

> 波次：波 2 ｜ 状态：ready-for-agent ｜ 优先级：P0 ｜ 依赖：—（**跨端契约手术：SSE/WS 载荷先落本票面再动手**，parallel-collaboration「契约改动先落 spec」适用）｜ 依据：spec D4

## 1. 实测与来源

- V29-1（`.scratch/v027-backlog.md`，v0.29 T3 拆账）：`POST /api/repos` **同步 await 全量索引**，大仓最长 600s 长挂、无进度；clone 重试（v0.29 T2 双退避已落）**对用户不可感知**；`onRetry` 半边当时挂账「随导入 UX 重设计」——即本票。
- 原注「建议与 Web 体验战（V27-11）并批 grill 一次定传输+UX」——本次产品化线即该批。
- 语义对齐先例：MCP `index_repo` 已全异步化（ADR-0016「立即返回 + 轮询」）；REST 面是最后一块同步长挂。
- 幽灵防线不变式（不动摇）：worker 长任务每处数据表写入前 repo 行存在性断言；`invalidate()` 不 abort。

## 2. 契约（本节即先落票面的契约，实现不得静默偏离）

1. `POST /api/repos` → **202** `{ taskId }` 秒回；索引进度走既有 WS 通道（`indexingProgress` 事件源复用，v0.29 T5 的目录轮询复位机制不动）；完成事件携带 repoId。
2. 失败事件带错误码（对齐 v0.27-B R3 的 28 稳定码族，新增码入 CONTEXT 权威表）。
3. **破坏性 REST 变更登记**：旧「同步返回完整 repo」语义废弃 → CHANGELOG 破坏性段 + README/安装文档同步；web 客户端同 commit 切换（monorepo 单提交原子）。
4. contracts 载荷类型镜像三处（contracts src / v1 / web types）+ `contract-mirror` 哨同步。

## 3. UX（ImportRepoModal 重设计）

- 阶段化进度：clone → parse → index → done（阶段标签过 copy-guard 双哨，词族对齐 worker 既有 label）。
- **可关闭后台继续**：Modal 关闭不取消索引；完成后 Sidebar 列表自动出现 + 选中引导。
- 失败可重试（消费 `onRetry`：v0.29 T2 的 isTransientGitFailure 分类与 1s/2s 退避首次可感知）。
- 本地路径 / clone URL 两种来源同一进度语义。

## 4. 验收（机器可验证）

1. e2e：POST 大样例仓 **< 2s 返回 202 + taskId**；WS 进度事件序列断言（阶段单调、终态 done/error 恰一）。
2. Modal 关闭后索引继续：关闭→完成→列表出现该仓（e2e 断言）；幽灵防线既有测试零回归。
3. clone 失败路径：重试事件可见（UI 断言 + 服务端 onRetry 日志断言双证据）。
4. 错误码：失败事件 `code` ∈ 稳定码表（新增码登记 CONTEXT）。
5. `contract-mirror` 哨绿；`npm run test:web` / 控制面全量绿；UI 冒烟扩「导入流化」链路。
6. 旧语义消费者排查留档：全仓 grep 确认无第三方依赖旧同步返回形态（本仓内仅 web 客户端，同 commit 迁移）。

## Comments

- 2026-09-28 立项（grill D4 解冻 V29-1；契约四条按「先落票面」纪律写死，202 语义破坏性变更须 CHANGELOG 破坏性段）。
