# 04：R4 — 控制面默认绑 127.0.0.1 + MHW_CP_HOST 逃生（销 V27-1）

> *Parent spec 同上（Q2）。*

Status: open
标签：bugfix-security / P1 / 来源：V27-1

## Agent Brief

**Summary:** server.ts listen 显式 host：默认 `127.0.0.1`；`MHW_CP_HOST` env 逃生（`0.0.0.0` 旧行为）；`/health` 回显 boundHost；启动日志打实际绑定面，绑 0.0.0.0 时 warn「局域网暴露零鉴权」；doctor 检查同步；README/CHANGELOG 标破坏性。

**Acceptance:** 默认绑定断言（connect 非回环失败或 netstat）；env 逃生测试；既有 60+ 控制面测零红；e2e gate 若绑 127.0.0.1 起服务则自然通过。
