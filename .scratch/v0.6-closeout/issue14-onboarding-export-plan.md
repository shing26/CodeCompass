# Issue 14 — ONBOARDING.md 架构交接手册一键导出

## 目标
- 后端：`repoqa-export.ts` 聚合 `buildDashboard` + `buildTours`，生成标准 Markdown；
  `http.ts` 暴露 `GET /api/repos/:id/export/onboarding`。
- 前端：TopBar 导出按钮，点击下载 `{repoName}-ONBOARDING.md`。
- 测试：后端 `repoqa-export.test.ts` + http 用例；前端 RepoQAClient / App / download 测试；全量回归。

## 步骤
1. 后端 `repoqa-export.ts`：`onboardingExportFileName` + `buildOnboardingMarkdown`（标题/技术栈/规模表/脱敏配置表/Top API 时序图/3 条路线）。
2. `http.ts` 路由（404 + `maskSensitiveText` 防御）。
3. 后端单测 `repoqa-export.test.ts`（复用 dashboard 测试的 parseTree fixture 风格）。
4. `repoqa-http.test.ts` 追加 export 用例（200/404/header/无敏感值）。
5. 前端 `RepoQAClient.exportOnboarding` + `utils/download.ts` + TopBar 按钮 + App 接线。
6. 前端测试：RepoQAClient、download、App 导出交互。
7. 全量测试（后端 vitest + 前端 vitest + typecheck + build）+ curl 冒烟。