# 票 04 — 接线：release 门 + 回执随工件发布

Status: done

## 背景

门不接线就只是本地脚本。release.yml 已经有 chromium（`release.yml:37-44`）与工件生成
（`:45-85`），天然是落点。

## 做法

1. `.github/workflows/release.yml`：在 `Generate sample artifact` 之后新增一步
   `Artifact browser gate`，对 `dist-release/architecture-artifact.html` 运行
   `node scripts/smoke/artifact_browser_check.mjs dist-release/architecture-artifact.html --json`；
   退出码非 0 即 release 红（不吞 UNCHECKED；chromium 已在 UI smoke 步骤装好，复用）。
2. `:89-94` 的 release 资产追加 `dist-release/architecture-artifact.html.browser-check.json`，
   让「可校验的回执」随工件一起发布（archify 的 portable proof 思路，只借这一条）。
3. `ci.yml` **不加**：CI 无 chromium 安装步骤（约 350MB），e2e 保持纯进程级。理由写进 ADR-0023。
4. 在 `scripts/e2e/closeout_gate.py` **不新增断言**（本批 e2e 数不变）；如需本地一键复跑，
   直接调脚本。

## 验收

- 在 release 语境下（chromium 已装）新步骤绿；人为换入 `bad-syntax.html` 时步骤红、release 断；
- 回执作为 release 资产可见且内容与本地跑一致（除时间戳/浏览器版本）；
- CI 工作流文件除 release.yml 外无改动；e2e 断言数仍 ≥ 73。

## Comments

- 2026-10-26 完成。`release.yml` 在 `Generate sample artifact` 之后新增
  `Artifact browser gate`（复用 UI smoke 已装的 chromium，timeout 5 min）；
  release 资产追加 `dist-release/architecture-artifact.html.browser-check.json`。
- 裁决（用户「全部默认」）：CI 不加（成本）；e2e 断言数不变；回执随工件发布。

