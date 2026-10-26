# 票 03 — v1.5.1 收口

Status: done

## 范围

票 01（断链标记计数）与票 02（锚点行号 + 截断可见）的发布件：版本五处、CHANGELOG、
README 版本面、门禁复跑。共享区只在本票动（约定见 v1.5 spec §38）。

## 版本五处

root `package.json` / `apps/repoqa-web/package.json` / `packages/contracts/package.json` /
`services/control-plane/package.json` + 单一源 `services/control-plane/src/version.ts`
= **1.5.1**。bridge-adapters 的 0.6.0 独立版本线不动。

## 文档面

- `CHANGELOG.md`：新增 `[1.5.1] - 2026-10-26`，三修复 + 测试计数。
- `README.md`：徽章 `v1.5.1`；路线图新增 v1.5.1 条目并摘掉 v1.5.0 的「当前版本」；
  「版本实情」保留 npm registry 最新 = 1.5.0 的事实，另注工作树 1.5.1 **未上架**。
  门禁 `readme-version` 的判据是「当前版本」行，已对齐。
- `HANDOFF.md` 不动（v1.5.0 收口时已划销 R5-13，本批无新增开放项）。

## 门禁

- `npm run build`（四前缀）后跑 `npm run typecheck` / `npm test` / `npm run test:web` /
  `npm run test:bridge` / `python scripts/e2e/closeout_gate.py`。
- 结果记在 Comments。

## Comments

- 2026-10-26 收口，门禁 **870 / 433 / 26 / 73-0**（控制面单测 / web 单测 / bridge 单测 / e2e
  断言数-失败数）：
  - `npm run build` 四前缀 EXIT=0（web dist 一并重建，含新的无链路兜底文案）；
  - `npm run typecheck` 四前缀零错；
  - 控制面 69 文件 870 测试、web 41 文件 433 测试、bridge 1 文件 26 测试全绿；
  - `python scripts/e2e/closeout_gate.py`：**73 passed, 0 failed**，其中版本三门全过——
    `version-consistency`（root=1.5.1 / version.ts=1.5.1 / CHANGELOG=1.5.1）、
    `readme-version`（readme 1.5.1 == package.json 1.5.1）、`/health`（1.5.1 == version.ts）。
- `package-lock.json` 仍是 0.6.0 的老值（本轮未跑 `npm install`，门禁也不校验它）——
  登记为已知漂移，下次真正装包时会自动跟上。
