# 06：T3 — EvolveStream 走注入 TimedFetch（V27-20 前半；后半 import-202 化拆 V29-1）

> *Parent spec：`.scratch/v029-resilience-hardening/spec.md`（grill 假设 A：拆）。*

Status: closed
标签：容错 / P2 / 来源：R2 review P2-1/P2-5（EvolveStream 用全局 fetch 绕 R2 预算、且不可测）。

## 实施

- `EvolveStream` 构造器首位收注入 `TimedFetch`，私有 fetcher() 从裸 `fetch(...)` 改 `this.timedFetch(...)`——evolve SSE 自此吃 R2 首字节预算（默认 15s）；`fetchWithTimeout` 的 AbortSignal 合并（P2-2）保住 connect 自有 controller 的 abort 语义。工厂 `evolveStream()` 传 `this.fetcher`（已包预算的注入尺）。
- 钉 +2（`RepoQAClient.test.ts` R2 预算 describe）：①hang 注入 → 15s 后 **onError 收到 NetworkTimeoutError**（旧裸 fetch 永挂无预算，此例即回归面）；②POST intent 经注入 spy 透传（URL 编码、method、body 面）。
- 验收：tsc 净、web **356/356**、build 成功。UI 冒烟不遍历 evolve 流（四段面无交集），真类构造仅工厂一点、client 测试双例已覆盖传导——冒烟免跑，理由在此。

## V27-20 后半拆账

**V29-1**：POST /api/repos 202+WS 进度流化（同步 await 全量索引 → 秒回 + indexing 进度经 WS；连带 clone 重试进度可感知、evolve/intent 同型端点对齐）。跨端契约手术 + 前端导入流程重设计，建议与 Web 体验战（V27-11 战役）并批 grill——UX 方案与传输方案一次定。不排期。
