# 02：G2 — 字号两档语义化（销 V27-11①，D5）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（D5：11px→text-xs，9/10px→text-micro）。*

Status: open
标签：视觉 / 零文案 / 来源：v027 台账 V27-11①。

## 现状

`text-[Npx]` 任意值 111 处（11px×48 / 10px×43 / 9px×20），top 文件 EvolutionView 17、Inspector 15、CiGateView 10、Sidebar 9；唯一 inline 字号 Inspector.tsx:375 Monaco `fontSize:13`。

## Agent Brief

**Summary:** tailwind.config.js `theme.extend.fontSize` 新增 `micro: '10px'`（行高定 1.4，实施定稿）；全量替换 `text-[11px]`→`text-xs`、`text-[10px]`/`text-[9px]`→`text-micro`；Monaco fontSize:13 与 brand-marks.ts SVG font-size 属性豁免（登记票面，非 Tailwind 域）。grep 验收 `text-\[\d+px\]` 全 src 零残留（test 文件同清）。
**Acceptance:** ①任意值字号归零（grep 证据）；②web 全量绿（纯 className 断言零文案，理论零红；若测试有 class 断言同票改）；③票 03/04/06 动布局文件时不得重新引入 `text-[Npx]`（G8 收口 grep 复查）。

## Comments
