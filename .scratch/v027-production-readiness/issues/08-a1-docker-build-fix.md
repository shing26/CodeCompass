# 08：A1 — Docker 镜像构建修复 + CI docker 回归门（立 V27-24）

> *Parent spec：`.scratch/v027-production-readiness/spec.md`。宽口径批（2026-09-14 grill D1/D2）。*

Status: closed
标签：build / P0 / 来源：2026-09-14 全模块验证——`docker build` 在 `services/control-plane && npm run build` 报 esbuild `Could not resolve "../../../packages/bridge-adapters/src/index"`；根因=Dockerfile 只 COPY apps/services 两目录，而 `server.ts→harness-manager.ts` 相对引用 `packages/{contracts,bridge-adapters}/src`，容器内 `/app/packages` 不存在；CI/Release 从未跑过 docker build（.github 全目录 grep docker 零命中），故破损存活数个版本。

## Agent Brief

**Summary:** Dockerfile 两处 `FROM node:20-bookworm-slim`→`node:24-bookworm-slim`（对齐 engines>=24 契约，D2 定案）；backend 构建段补 `COPY packages/ packages/`；`ci.yml` 新增独立 `docker-build` job（ubuntu，仅 build，PR/push 即跑）——镜像自此有门。

**Acceptance:** 本地 `docker build` 绿；容器起后 `GET /health` 200；`docker compose config -q` 绿；ci.yml 新 job YAML 合法。better-sqlite3@12 在 linux Node 24 若无 prebuilt 则回退源码编译（build 段已有 python3/make/g++ 工具链兜底）。

## Comments（2026-09-14 实施收口）

- 落地：Dockerfile 两处基座 node:20→24 + `COPY packages/ packages/`（附根因注释）；`ci.yml` 新增 `docker-build` job（构建 + `docker run` 后 /health 轮询冒烟）。
- 验收全绿：本地 `docker build` 成功（405MB）；容器默认 CMD 起服后 `/health` 200 且 `version:0.27.0`、`boundHost:0.0.0.0`（镜像逃生位）、checks db/dataDir ok、SPA 200；`docker compose config -q` 绿；better-sqlite3@12 在 linux Node 24 prebuilt 命中、无回退编译。
- **实施中新抓 P1 缺陷（销前扩面）**：容器 CMD 无 `--no-browser` 时 `openBrowser` spawn ENOENT（slim 镜像无 xdg-open）以未监听 'error' 事件崩掉进程——旧代码 try/catch 接不到异步失败，「best-effort never crash」注释为假。修 `cli.ts:openBrowser`（监听器+unref）+ 新测试 `open-browser.test.ts` 钉住；CI docker 冒烟步骤本身即该缺陷的永久回归门（修复前该步骤必红）。
- 全量护航：62 项 e2e、UI 冒烟、cp 631、web 351 全绿。
