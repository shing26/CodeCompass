# v1.7.0 发布清单（Release checklist）

Status: ready-to-run（2026-10-27）
关联：spec `.scratch/v1.7-artifact-browser-gate/spec.md`、评审 `docs/reports/code-review-2026-10-27.md`、ADR-0023

## 0. 前置条件（必须全绿才进第 1 步）

- [ ] `npm run typecheck` 零错误
- [ ] 单测：控制面 **903 / 72 files**、web **433 / 41**、bridge **26 / 1**
- [ ] `python scripts/e2e/closeout_gate.py` → **73 passed / 0 failed**
- [ ] 工件门自检：`node scripts/smoke/artifact_browser_check.mjs --self-test` → 4/4 + 3 个回执负例 caught
- [ ] 真工件：`node scripts/smoke/artifact_browser_check.mjs <release 工件> --require-full --json` → verdict=PASS、9/9
- [ ] 双轴 code-review 已出报告（本批：2026-10-27，硬违规已修）
- [ ] `git status --short` 只含本批文件（12 改 + 4 新；无临时脚本/产物）

## 1. 提交（**用户本机 shell**；Mimosa 会拦 agent 的 git commit）

```powershell
git add scripts/smoke/artifact_browser_check.mjs scripts/smoke/make-artifact-fixtures.mjs `
        services/control-plane/src/export-artifact.ts services/control-plane/src/export-artifact.test.ts `
        .github/workflows/release.yml
git commit -m "feat(v1.7): 工件浏览器验收——真 Chromium 门 + 旁车回执 + release 接线"

git add -A
git commit -m "docs(v1.7): 收口 v1.7.0——ADR-0023、双轴评审修复、版本五处、CHANGELOG/README/HANDOFF/CONTEXT"
```

- [ ] 两个 commit 完成；`git status --short` 干净

## 2. Tag 与 Release workflow（tag 驱动）

```powershell
git tag v1.7.0
git push origin master --tags
```

在 GitHub Actions → **Release**（`push tag v*` 触发）逐项确认：

- [ ] Typecheck + 单测 + e2e 绿
- [ ] UI smoke 绿（同一步安装 chromium，工件门复用它）
- [ ] **Artifact browser gate 绿**——若 `UNCHECKED`（退出码 2）**不得当绿**：下载旁车回执看 `diagnostics[].code`（常见 `BROWSER_UNAVAILABLE` = CI 没装到 chromium）
- [ ] Release 资产含 `architecture-artifact.html` 与 `architecture-artifact.html.browser-check.json`
- [ ] 回执内容：`verdict=PASS`、`engineVersion=1.7.0`、`checks=9`

失败排查：release 页下载回执 → 按 `automatic` 诊断码定位（`CHECK_SKIPPED` = 模板/钩子漂移；`DIAGRAM_SYNTAX_ERROR`/`VIEW_NOT_RENDERED` = 工件真坏）→ 修工件或门 → 新 commit → 重指 tag（见第 5 节）。

## 3. npm 发布（手动；release workflow 不含 publish）

- [ ] 双击 `D:\zcode-tmp\publish-1.7.0.cmd`（6 步：版本自检 → git 状态 → registry → 登录 → publish → 校验）
- [ ] 等价的单步命令：`npm whoami` → `npm publish --access public`（2FA 6 位）→ `npm view @codecompass/cli version dist-tags`
- [ ] 期望 `latest: 1.7.0`；`npx -y @codecompass/cli@1.7.0 --version` 打印 1.7.0
- [ ] 可选深检：pack + 安装 + `node scripts/smoke/packed-mcp-handshake.mjs . D:\CodeCompass`（17 tools）

> registry 现状：只有 `0.31.0 / 1.4.0 / 1.5.0`；1.5.1 / 1.6.0 未上架，1.7.0 直接覆盖 latest 即可，不必补发历史版本。

## 4. 发布后文档回写（同一天内）

- [ ] README「**版本实情（重要）**」：latest `1.5.0` → `1.7.0`；「工作树 1.7.0（未上架）」→「已上架」；删掉「未上架」括注
- [ ] README「路线图」的 npm 行：加 `@codecompass/cli@1.7.0` 已上架（日期写实际发布日）
- [ ] CHANGELOG `[1.7.0]` 标题日期与实际发布日一致（若跨天，改日期）
- [ ] （可选）GitHub Release notes：引用回执结论（`verdict=PASS, checks=9/9`）+ 评审报告链接
- [ ] （可选）CONTEXT `## Status` 不动（版本号已一致）

## 5. 回退与失败处理

- **Release 门红**：先修根因（工件或门），再 `git tag -f v1.7.0 <new-commit> && git push -f origin v1.7.0`（本仓库有重指 tag 先例）。
- **npm 发布后发现问题**：不要 unpublish；发 `1.7.1` 修正，并在 CHANGELOG 记一行。
- **工件门 UNCHECKED**：环境问题（无 chromium/超时）而非工件坏；本地复跑同一命令确认，别把它当绿。

## 6. 收尾核对

- [ ] `npm view @codecompass/cli dist-tags` → `latest: 1.7.0`
- [ ] Release 资产可下载，回执 `verdict=PASS`
- [ ] `git status` 干净；tag 指向收口 commit；CI 最新 run 绿
- [x] 勾完本清单，归档到 `.scratch/v1.7-artifact-browser-gate/`

## 7. 执行记录（2026-10-27，实测）

| 项 | 结果 |
|---|---|
| commit / tag | `fe89599` / `v1.7.0`，master 与 origin 同步 |
| Release workflow | [#40393242362](https://github.com/shing26/CodeCompass/actions/runs/40393242362) **success**（11 步全绿，含 `Artifact browser gate`） |
| Release 资产 | `architecture-artifact.html` 3,581,846 B；`architecture-artifact.html.browser-check.json` 2,636 B |
| npm | `@codecompass/cli@1.7.0`，2026-10-26T22:34:25Z 上架；registry latest=**1.7.0**，versions=0.31.0/1.4.0/1.5.0/1.7.0 |
| 包内容 | `npm pack` 160 files / 5.1 MB / shasum `8616d0e2…` |
| 安装验证 | 临时 prefix 全局安装后 `codecompass --version` → `1.7.0`（本机 `npx` 取件异常，属本地 npm cache/链接问题，非包问题；见下） |
| 文档回写 | README 版本实情 / 路线图 npm 行 / v1.7 行、HANDOFF v1.7 段、CHANGELOG 门禁段、spec + 票 06 已更新 |
| 评审 | 双轴报告 `docs/reports/code-review-2026-10-27.md`（硬违规已修） |

备注：本机 `npx -y @codecompass/cli@1.7.0 --version` 报 `'codecompass' is not recognized`，而
`npm i -g --prefix <tmp> @codecompass/cli@1.7.0` 后运行正常，说明是本地 npx 临时目录/链接问题，
不是发布包问题；README 的 `npx -y @codecompass/cli mcp ...` 用法在干净环境仍成立。

## 附：本机复跑命令（发布前一次性确认）

```powershell
npm run typecheck
npm test
npm run test:web
npm run test:bridge
npm run e2e
node scripts/smoke/artifact_browser_check.mjs --self-test
```
