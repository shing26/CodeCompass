# 票 05 — 稳定检查钩子（条件票）

Status: done

## 背景

票 02 依赖的选择器（`.mermaid`、`[data-view="sequence"]`、`.beat-bar`、`.deeplink`）目前都是
CSS 类名，随机重构（v1.4 就删过禁用占位 tab）可能让门静默变成 SKIPPED。若票 02 实测发现
选择器脆弱，本票给工件加**最小的检查钩子**。

## 做法

1. 在 `services/control-plane/src/export-artifact.ts` 给被检节点加 `data-check="…"` 属性
   （tab、mermaid 容器、beat-bar、deeplink、replay 块）；不改样式、不改文本、不改语义。
2. 门脚本优先用 `[data-check="…"]`，CSS 类名只作回退；回执的 `selector` 记录实际命中的形态。
3. `export-artifact.test.ts` 只增断言：每个 `data-check` 存在；不删既有断言。
4. 若票 02 实测选择器稳定，本票标 `wontfix` 并在 spec Comments 说明，不强行加属性。

## 验收

- 加钩子前后工件字节差异仅限新增属性；单测既有断言全绿；
- 门脚本对 good/bad 的判定不变；
- 若 wontfix：留下「选择器稳定性」实测记录（连续 10 次运行命中同一 selector）。

## Comments

- 2026-10-26 完成（实测后从条件票转正）。工件被检节点加 `data-check` 钩子：
  `view-arch` / `view-sequence` / `diagram`（两个 mermaid 容器）/ `story-beats` / `beat-bar` /
  `deeplink` / `replay` / `offline-warning`。门优先用钩子，CSS 类名与 id 只作回退
  （旧工件/旧快照仍可检）。
- `export-artifact.test.ts` 新增断言（钩子全在 + 版本串来自 `VERSION`、不再是 `v0.9`），
  共 11 tests 绿；既有断言未删。

