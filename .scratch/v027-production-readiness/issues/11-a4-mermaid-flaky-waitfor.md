# 11：A4 — web flaky：MermaidDiagram BROKEN 用例包 waitFor（立 V27-27）

> *Parent spec：`.scratch/v027-production-readiness/spec.md`。宽口径批（2026-09-14 grill D5）。*

Status: closed
标签：test / P2 / 来源：2026-09-14 全模块验证首轮——全量并跑时 `MermaidDiagram.test.tsx > injects broken edge class when the target hop is BROKEN`（L185-198）偶发红，单文件 20/20、复跑全量 349/349 均绿。根因：L195-197 为文件内唯一未包 waitFor 的正向注入断言，对「async render → 两段链式 useEffect（svgHtml→traceSteps）」的提交时机敏感；姊妹用例（L215-217）逐条 waitFor。

## Agent Brief

**Summary:** BROKEN 用例的边/节点 class 断言包进 `waitFor`，对齐姊妹模式；不动组件代码。

**Acceptance:** 本地全量 `npm run test:web` 连跑 3 轮零红。

## Comments（2026-09-14 实施收口）

- 落地：BROKEN 用例边/节点两条断言包 `waitFor`（对齐姊妹用例既有模式），注释写明「async render → [svgHtml, traceSteps] 两段链式 effect」的提交时机根因；组件代码零改动。
- 验收：实施前亲踩复现 1 failed（首轮全量）；实施后 A5 阶段全量再两跑（351 基数）零红 + 最终回归绿。
