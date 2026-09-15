# 03：T4 — MCP 深链展示面对齐（cockpitBaseUrl 单一权威，销 V27-22）

> *Parent spec：`.scratch/v029-resilience-hardening/spec.md`。*

Status: closed
标签：一致性 / P2 / 来源：V27-22（R4 review P2-2）——R4 确立「打印的 URL 与可达地址永不脱节」后，MCP 深链仍硬编码 `http://localhost:${port}`×5：`MHW_CP_HOST=192.168.x` LAN 逃生时深链连空。

## Agent Brief

**Summary:** `config.ts` 新增 `cockpitBaseUrl(env)` = `http://<displayHost(host)>:<port>`（复用 R4 displayHost 规则，不可连地址退 localhost）；mcp.ts 五处 baseUrl 统一改引；gate:1345 深链断言成对改 `^http://(localhost|127\.0\.0\.1):\d+`（默认绑 127.0.0.1 后深链宿主已非 localhost，不改必红——台账点名的成对纪律）。
**Acceptance:** 三断言（默认回环→127.0.0.1:43110、0.0.0.0 逃生→localhost、具体网卡 192.168.1.7:5555 原样）+ 既有单测面零 localhost 断言（grep 证实）+ e2e 深链检查项绿。

## Comments（2026-09-15 实施收口）

- 落地即验收：`server-bind.test.ts` +1（三断言）、mcp.ts 5 处一行替换（同文 replace_all）、gate 判据同 commit 成对改；tsc 净、645/645、esbuild 成功。
- e2e 两跑记录：首跑 61/62（evolve conflict 一项 timed out——与本票无关的负载 flaky，票 12 同款偶发），复跑 **62/62**，深链判据两跑皆绿。
- 语义注记：MCP stdio 进程与 HTTP 服务进程各读各 env（同机部署 loadConfig 同源）；跨进程 host 真传递（env 注入通道）仍未做——台账原文承认「需专票设计」，本票对齐的是**展示规则同源**这把现成的尺；深链端口仍取 env 默认（CLI 面不感知 serve 实际随机口，系前 v0.27 既有行为，非本票回归）。
