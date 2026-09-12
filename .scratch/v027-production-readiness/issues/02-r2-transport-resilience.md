# 02：R2 — 传输层韧性（fetch 超时 + WS 指数退避重连）

> *Parent spec 同上（Q5/Q6）。评估差距 1-缺①②。*

Status: open
标签：bugfix / P1 / 来源：生产就绪度评估 差距1-缺①②

## Agent Brief

**用户场景：** 后端挂起/重启时，工作台永转圈、索引进度流静默死亡，用户只能 F5（「页面死状态」报障根源之一）。修复后：请求超时得到可读错误态；后端重启后 WS 自动重连并静默刷新，UI 自己活过来。

**Summary:** ①`RepoQAClient.fetcher` 统一超时：常规 15s、preview/clone/reindex 60s、流式（evolve/chat）只卡到响应头；超时抛 `code:'network_timeout'` 的归一错误。②`RepoContext` WS `onclose` 重连：1s→30s 指数退避无限试，重连成功 refresh symbols+dashboard；断连期 offline-hint 呈现。

**Acceptance:** vitest（fake timers）——超时 abort、退避序列、重连触发刷新、组件卸载停重试；App/RepoContext 既测零红。
