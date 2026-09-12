# 06：R6 — /health 深检 + runtime 附进程指标

> *Parent spec 同上。*

Status: open
标签：enhancement / P2 / 来源：生产就绪度评估 差距4

## Agent Brief

**Summary:** `/health`：DB `SELECT 1` + dataDir 临时文件可写，降级返 503+`checks` map（ok/degraded/down）；`/api/runtime` 追加 `uptimeSec/rssKb/activeTasks`（worker 在途计数）。`/health` 保持零依赖 fast path 不变（version/port/dataDir）。

**Acceptance:** 三态测（注入坏 db/坏目录）+ runtime 字段断言。
