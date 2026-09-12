# 02：R2 — 传输层韧性（fetch 超时 + WS 指数退避重连）

> *Parent spec 同上（Q5/Q6）。评估差距 1-缺①②。*

Status: closed
标签：bugfix / P1 / 来源：生产就绪度评估 差距1-缺①②

## Agent Brief

**用户场景：** 后端挂起/重启时，工作台永转圈、索引进度流静默死亡，用户只能 F5（「页面死状态」报障根源之一）。修复后：请求超时得到可读错误态；后端重启后 WS 自动重连并静默刷新，UI 自己活过来。

**Summary:** ①`RepoQAClient.fetcher` 统一超时：常规 15s、preview/clone/reindex 60s、流式（evolve/chat）只卡到响应头；超时抛 `code:'network_timeout'` 的归一错误。②`RepoContext` WS `onclose` 重连：1s→30s 指数退避无限试，重连成功 refresh symbols+dashboard；断连期 offline-hint 呈现。

**Acceptance:** vitest（fake timers）——超时 abort、退避序列、重连触发刷新、组件卸载停重试；App/RepoContext 既测零红。

## Comments（2026-09-12 实施收口）

- 落地：`client/timeout.ts`（首字节预算+NetworkTimeoutError code='network_timeout'+URL 上字段不上 message）；RepoQAClient 全 JSON 面默认 15s；WS onclose 退避重连（1s×2ⁿ 封顶 30s）+重开补刷+卸载清表。
- Reviewer-Security P1×2 修：pickFolder 15s 误杀人速对话框→120s（DIALOG）；gate/run+architecture-delta+subgraph-context 同步重计算 15s 假失败脑裂→300s（SYNC_ANALYZE）。P2 修：调用方 signal 合并（AbortSignal.any 降级保调用方）、Infinity/0=显式不限时、fetch 同步 throw 清表、NetworkTimeoutError.url 字段化；P2-7 测试质量：端点→预算映射锁 4 例、unstub 入 afterEach。
- 遗留移交：**P2-1** importRepo 超时文案「索引仍在进行勿重复提交」→ R3 人类化面；根治=import 迁 202+WS 进度（新登 V27-20）。**P2-5** EvolveStream 走全局 fetch 绕预算——注释已诚实标注；evolve 流挂起场景由 R7 冒烟兜（新登 V27-20）。
- 插曲记录：Edit 工具对 `JSON.stringify({base,head,...})` 做过一次错误模糊匹配把 body 弄成 `payload`（当场发现当场修）——route 级 body 表达式改动后必看 diff。
