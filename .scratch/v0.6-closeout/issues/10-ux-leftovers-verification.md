# 10: 体验遗留 4 项复验与修复（原 B4）

Status: done

## 问题

产品体验报告 Round 2（v0.2.0 时代）遗留 4 项未入 D1-D8/E1-E12 清单的小缺陷，后续多次重构（v0.5 web 重构、主题系统）可能已改变其形态。**先复验存在性，存在才修**。

## 清单

1. **R2-02** 浏览器 back 退出到 about:blank（`App.tsx` replaceState 历史）。
2. **R2-03** 冷启动首次点击无 glow（Inspector 轮询竞态）。
3. **R2-07** `IGNORED_DIRS` 缺 `.scratch`，dogfood 时演示代码污染 Top API。
4. **R2-08** mermaid `code://` 点击后请求 ERR_ABORTED 残留。

## 任务

1. 逐项在当前构建复验；已在重构中消失的标注「已不存在」并关闭。
2. 仍存在的按原报告的根因线索修复；R2-07 是一行改动（IGNORED_DIRS 补 `.scratch`），可直接修。

## 验收

- 四项各有「已不存在 / 已修复」结论记录；修复项不引入新回归（e2e 基线仍绿）。

## Comments

- 2026-08-28 复验结论（四项全部已在后续版本修复，无需再修）：
  1. **R2-02 浏览器 back 退出 — 已修复**：`App.tsx` `handleSelectRepo` 用
     `pushState`（Bug-R2-02 注释）+ popstate 恢复选中仓（Bug-08），back 不再逃逸到 about:blank。
  2. **R2-03 冷启动 glow 竞态 — 已修复**：`Inspector.tsx` glow effect 改为等待
     Monaco model path 匹配（onDidChangeModel + 2s 有界兜底），
     `Inspector.test.tsx` 有 4 个 Bug-R2-03 回归用例。
  3. **R2-07 IGNORED_DIRS 缺 `.scratch` — 已修复**：`repoqa-scan.ts` IGNORED_DIRS
     现含 `.scratch`/`.workbuddy`/`.penguin` 等。
  4. **R2-08 mermaid `code://` ERR_ABORTED — 已修复**：`MermaidDiagram.tsx` 点击
     委托在导航前 `ev.preventDefault()`，不再触发对 `code://` 的真实请求。
