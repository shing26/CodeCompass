# 票 06 — ADR-0023 + 收口（v1.7.0）

Status: done

## 背景

本批引入一个新的验收面（工件浏览器门），需要一条 ADR 钉住它的边界，否则以后会被误当成
「工件质量门」或「语义正确性门」。收口同时清掉评审已登记的工件元数据假事实。

## 做法

1. 产出 `docs/adr/0023-artifact-browser-gate-boundary.md`（accepted），裁决：
   - 门只回答「工件在真实浏览器里可渲染/可交互/无运行时错误/无外部依赖」，**不回答正文语义是否正确**；
   - 退出码三态（0/1/2），UNCHECKED 永不算绿；
   - 门只在 release 跑，CI 不跑（成本裁决）；
   - 门与工件同源演进：工件模板/内联方式变化时，检查项同步更新，禁止门落后于模板；
   - 与 v1.5 verification 回执的事实面分工（返回体 vs DOM）。
2. 清 `services/control-plane/src/export-artifact.ts:291` 的 `CodeCompass v0.9` 硬编码：
   改 import `../version` 的 `VERSION`（注意与 `version.ts` 的单一源规则一致），补一条断言。
3. 共享区一次性收口：版本五处 → 1.7.0、CHANGELOG `[1.7.0]`、README Known Limitations 增一条
   （「浏览器门不验语义」）、HANDOFF 门禁实数；CONTEXT 如有必要只改 Status 一行。
4. 双轴 code-review（fixed point = v1.6.0 收口 commit `2f9207a`），review 报告落 `docs/reports/`。
5. 全量门禁复跑并记录实数（控制面 / web / bridge 单测、e2e ≥73、release 门 smoke）。

## 验收

- ADR-0023 合入且被 spec/README 引用；
- 工件 `CodeCompass v…` 版本串随 `VERSION` 变化（构造版本变更的测试断言）；
- 版本五处一致、CHANGELOG 顶部与 `version.ts` 相等、e2e `check_versions` 绿；
- 双轴评审无 P0/P1（有则本票内修完再收）；
- tag `v1.7.0` 与 release 资产含工件 + 回执。

## Comments

- 2026-10-26 完成。
- ADR-0023 `docs/adr/0023-artifact-browser-gate-boundary.md`：门只回答可渲染/可交互/无运行时错误/
  无外部依赖，不冒充语义正确；三态退出码；release-only；旁车回执；门与工件同源演进
  （`data-check` 钩子）；与 v1.5 verification 回执的事实面分工。
- 清 `export-artifact.ts` 硬编码 `CodeCompass v0.9` → `VERSION`（评审 2026-10-26 已登记）。
- 共享区收口：版本五处 1.7.0、CHANGELOG `[1.7.0]`、README（版本串 / ADR 表 / 质量门禁 /
  路线图 / Known Limitations）、HANDOFF、CONTEXT。
- 门禁实数（2026-10-27 本机实跑）：typecheck 0；控制面 **903 tests / 72 files**；web **433 / 41**；
  bridge **26 / 1**；e2e **73 passed / 0 failed**；工件门自检 4/4；release 流模拟
  （CLI export → 工件门）verdict=PASS、回执 `engineVersion=1.7.0`、工件元数据 `CodeCompass v1.7.0`。
- **评审状态（done，2026-10-27）**：双轴 code-review 完成（fixed point `150b4ec`，报告
  `docs/reports/code-review-2026-10-27.md`）。Standards 8 条（3 硬违规）/ Spec 8 条；
  硬违规与可修 judgement 已修（`--require-full`、`DIAGRAM_TARGET_MISSING`、label 判定、
  懒渲染 waitForFunction、回执负例、selector 回填、HANDOFF 903/72 统一）；
  3 项重复实现类 judgement deferred（UNCHECKED 回执字面量 / loadChromium 与 ui_smoke 重复 /
  release.yml demo 仓重复），理由见报告「处置」。
  复核：真实 release 工件 `--require-full` PASS 9/9；钩子+类名同时漂移的工件 FAIL 退出 1。

