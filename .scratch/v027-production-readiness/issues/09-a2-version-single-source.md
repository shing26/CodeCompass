# 09：A2 — 版本单一源 version.ts + /health 扩门（立 V27-25）

> *Parent spec：`.scratch/v027-production-readiness/spec.md`。宽口径批（2026-09-14 grill D3）。*

Status: closed
标签：consistency / P1 / 来源：2026-09-14 全模块验证——`server.ts:140` 硬编码 `version: '0.6.0'`（0.6 时代残留），/health 对外报错误版本；e2e `check_versions`（closeout_gate.py:415-434）只比 root package.json == cli.ts VERSION == CHANGELOG 三处，health payload 与 Dockerfile 基座均在射程外。

## Agent Brief

**Summary:** 新建 `services/control-plane/src/version.ts` 导出 `VERSION`；`cli.ts:27` 与 `server.ts:140` 改引该常量（只能引 version.ts，不得 server→cli——循环 import）；e2e `check_versions` 三扩：①正则源 cli.ts→version.ts；②Dockerfile `FROM node:(\d+)` 两处主版本==`engines.node` 下限；③服务起来后断言 `/health`.version==常量。

**Acceptance:** e2e 全绿；故意改坏 server 版本时门红（自测后还原）；`--version` 输出不变（0.26.0）。

## Comments（2026-09-14 实施收口）

- 落地：`src/version.ts`（VERSION=0.27.0）；`cli.ts` 改 import+re-export（既有 `from './cli'` 消费者零破坏）；`server.ts` createHttpApp 引常量；e2e `check_versions` 三扩（源挪 version.ts / Dockerfile `FROM node:N`==engines 下限 / 新增 `check_health_payload_version` 挂 `wait_health` 后）。
- **负测天然留证**：首轮 bump 遗漏 version.ts 时门当场红（detail=`root=0.27.0 version.ts=0.26.0`），补齐后复跑 62/62——「漂移即红」由实施过程自身验证。
- `--version` 现回显 0.27.0（随本版 bump，非 0.26.0）；容器内 `/health` 与本机 dist 均 0.27.0。门数 60→62 已记 CHANGELOG 质量门面。
