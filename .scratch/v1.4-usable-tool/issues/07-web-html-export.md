# 票 07 — Web 导出单文件 HTML 报告

Status: closed（已落地，2026-10-19，tag v1.4.0）

## 背景
用户第三步后半：一键导出单文件 HTML 报告，发给同事双击就能看。现状：能力已存在（`codecompass export` → 内联 mermaid、断网可渲染），但只有 CLI 入口；Web 顶栏只有 Markdown 导出。用户面「一键」缺位。

## 目标
Inspector 打开某个符号时，一键下载「该符号的诊断报告 HTML」——与 CLI `export` 完全同源同产物。

## 实现要点
1. **HTTP**：`GET /api/repos/:id/export/html?symbol=<name>`（`routes/analysis-graph.ts`，与 onboarding 导出同域）
   - 复用 `runDiagnose` + `renderArtifactHtml`（与 `cli.ts` export 命令同路径；抽出共享 helper 消除双份逻辑）
   - 符号找不到 → 404 `symbol_not_found`；产物 `text/html` + `Content-Disposition: attachment`
   - 内联 mermaid 运行时不可得时的 CDN 回退警告写入响应头（`X-Artifact-Warning`）供前端提示
2. **Web**：Inspector 头部导出按钮（图标 + 「导出 HTML 报告」，与既有 Markdown 导出并列）；`RepoQAClient.exportHtmlReport(symbol)` → Blob 下载（`utils/download.ts` 扩 html 类型）
3. 文件名：`codecompass-<symbol>-<traceId>.html`

## 验收
1. 控制面测试：端点返回自包含 HTML（含内联 mermaid script 标签、无外部 http(s) 资源引用——正则断言）；404 分支。
2. Web 测试：按钮触发下载调用（mock client）。
3. 真机：下载产物断网打开可渲染（人工记录入 Comments）。
4. 与 CLI 产物同源：断言两条路径共用同一 helper（测试或代码结构说明）。

## Comments
**2026-10-19 落地。** 证据：
- 共享装配器 `artifact-report.ts`：CLI `export` 与 HTTP 端点同源；`chainMermaid` / `chainSequence` 自 cli.ts 迁入，零行为变化。
- 端点 `GET /api/repos/:id/export/html?symbol=`（inline mermaid；缺运行时以 `x-artifact-warning` 如实告知）；400/404 分支。
- Web：Inspector「导出 HTML 报告」按钮 → `downloadBlob`（text/html）。
- 测试：`repoqa-http.test.ts` 新 describe 1 项（400/404/200 + attachment + 自包含）；`Inspector.test.tsx` 2 项（导出调用、缺 handler/符号时隐藏）。
