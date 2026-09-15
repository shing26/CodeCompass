# 02：T2 — clone 瞬断指数退避重试（销 V27-18）

> *Parent spec：`.scratch/v029-resilience-hardening/spec.md`。*

Status: closed
标签：容错 / P2 / 来源：生产就绪度评估缺口3（clone/reindex 网络瞬断一次成败，用户手动重按）。

## Agent Brief

**Summary:** `git-importer.ts` 增 `isTransientGitFailure` 分类器（TRANSIENT：could not read/connection reset·aborted·refused/failed to connect/unable to access/DNS 解析/early eof·rpc failed/HTTP 5xx·429/transaction aborted；PERMANENT 优先：authentication failed/permission denied/403/repository not found/**timed out**）；`cloneGitRepo` 内聚 1s/2s 两次退避重试（input 可注入 `retryBackoffMs`/`onRetry`），每次失败清场后重试。**timeout 刻意不重试**——60s 预算已烧完，盲重试把同步端点拉到 3×60s 比用户手动再点更糟；auth/404 确定性失败同理。
**Acceptance:** 瞬断→重试成功、永久→单次即止、预算耗尽→报最后一次错且 onRetry 记录 attempt 2/3；既有 failure/timeout 测试语义不回归（分类器对照跑过：repository not found/timed out 均永久位）。

## Comments（2026-09-15 实施收口）

- 进度可感知半边**明示让位**：clone 端点是 202-前的同步 await，重试只落 server 日志（routes/repos.ts onRetry→logger.info('clone', …)，带 attempt/退避/原因截 200）；「clone 进度流经流」与 import-202 化同一主题，挂账票 06 拆出的新行一并设计。
- 测试 +5（644/644）：transient→成功、permanent 快断言 onRetry 抛错防误重试、耗尽报 last error、timeout 单发回归钉、分类器正负例。
- tsc 净、e2e 62/62。前端零改动（600s 客户端预算覆盖最坏 2×60s+3s+60s）。
