# 04：R4 — 控制面默认绑 127.0.0.1 + MHW_CP_HOST 逃生（销 V27-1）

> *Parent spec 同上（Q2）。*

Status: closed
标签：bugfix-security / P1 / 来源：V27-1

## Agent Brief

**Summary:** server.ts listen 显式 host：默认 `127.0.0.1`；`MHW_CP_HOST` env 逃生（`0.0.0.0` 旧行为）；`/health` 回显 boundHost；启动日志打实际绑定面，绑 0.0.0.0 时 warn「局域网暴露零鉴权」；doctor 检查同步；README/CHANGELOG 标破坏性。

**Acceptance:** 默认绑定断言（connect 非回环失败或 netstat）；env 逃生测试；既有 60+ 控制面测零红；e2e gate 若绑 127.0.0.1 起服务则自然通过。

## Comments（2026-09-12 实施收口）

- 落地：config.loadConfig 加 host（默认 127.0.0.1，MHW_CP_HOST 逃生）；server.listen(port,host)；/health 回显 boundHost；cli/index/`.env.development` 展示面对齐实际绑定（displayHost 共享自 config）。
- **破坏性变更 + CHANGELOG 留 v0.27 收口批**：默认绑 127.0.0.1（原全网卡）+ 深链/展示 URL 文案。README 已写；CHANGELOG.md 0.27.0 Breaking 段随收口批补（P2-5）。
- Reviewer-Security P0/P1 零；P2×7 处置：P2-1 我引入的 USAGE 吞行已修；P2-3a 告警判定改**解析后监听地址**（isLoopbackListenAddress，堵 hosts 拐 localhost 漏报+127.x 误报）；P2-3b displayHost 抽共享；P2-4 Dockerfile 补 --network host 直暴警告注释；P2-6 补 loadConfig trim/displayHost/isLoopback 单测+不可绑地址 reject+EADDRINUSE/URL 用例钉 env；P2-7 .env.development 改 127.0.0.1。
- 移交台账：**V27-22**（MCP 深链 repoqa-mcp.ts×5 仍硬编码 localhost，跨进程 host 传递需专票，e2e:1319 断言成对改）。Docker ENV 逃生保留镜像层（`docker run` 是一等公民，非下移 compose）。
- 门禁：cp 609、web 349、tsc×2、build 0、e2e 60/60（真进程验默认回环）。
