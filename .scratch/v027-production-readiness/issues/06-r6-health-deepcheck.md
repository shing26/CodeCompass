# 06：R6 — /health 深检 + runtime 附进程指标

> *Parent spec 同上。*

Status: closed
标签：enhancement / P2 / 来源：生产就绪度评估 差距4

## Comments（2026-09-13 实施收口）

- 落地：/health 深检（SELECT 1 + dataDir 固定名 .health-probe 写探针，rm 失败不降级、结果 TTL 1.5s 缓存、db 句柄缺席报 'skipped' 不报口头 ok，任一 down → 503 degraded）；/api/runtime 加 process{uptimeSec,rssKb,indexingJobs}，**仅回环 peer 可见**（LAN 逃生侧信道治理，review P2-4）。
- Reviewer-Security P1×3：探针 rm 假降级+残留无回收→固定名+写成功即判可写；deps.db 缺省口头 ok→'skipped' 三态；activeOpCount 语义谎→running map 实只登记 indexRepo，字段实名 indexingJobs+注释钉死（query/evolve 流不占该 map，若将来要全任务集需先扩 running 生命周期）。P2 采纳：TTL 缓存（热轮询不打爆同步 syscall）、探针命名向 doctor 惯例靠。
- 测试：http-health 6 例（healthy/skip/dataDir-down 503/db-down 503/runtime 形状/无残留）+ repoqa-http 两例形状更新；e2e wait_health 的 503=未就绪语义核实成立（backupDb 在 listen 前，无启动期合法 503 窗口）。
- 门禁：cp 630/630、tsc 净、build 0、e2e 60/60、UI smoke PASS。

## Agent Brief

**Summary:** `/health`：DB `SELECT 1` + dataDir 临时文件可写，降级返 503+`checks` map（ok/degraded/down）；`/api/runtime` 追加 `uptimeSec/rssKb/activeTasks`（worker 在途计数）。`/health` 保持零依赖 fast path 不变（version/port/dataDir）。

**Acceptance:** 三态测（注入坏 db/坏目录）+ runtime 字段断言。
