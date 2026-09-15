# 04：G4 — statusLabel 映射 + Badge/CountPill 双件（销 V27-11④，D4/D6）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（表 C + D6 组件化双件）。*

Status: open
标签：组件 / 文案 / 来源：v027 台账 V27-11④。

## 现状

机器枚举直出徽章：VERIFIED/BREAK/SUSPECT（EvidenceCard STATUS_BADGE:9-22）、PASS/FAIL（CiGateView:462-468）、LOW/MEDIUM/HIGH（:534）、EXTEND/DEPRECATE（PlanCardView:55）、CONTROLLER/ENTITY（CommandPalette:249-256）、BROKEN（Canvas:241）、dirty/sensitive。9 个徽章家族 ~55 实例无共享组件。

## Agent Brief

**Summary:** ①新建 `client/statusLabel.ts`（枚举→中文，表 C 全集）——**契约值/类型联合不动**，仅展示出口过映射；②新建 `components/ui/Badge.tsx`（variant: status/risk/lang/verb/stage + tone: ok/warn/danger/neutral，内含表 C 映射调用）与 `components/ui/CountPill.tsx`；③EvidenceCard/CiGateView/CommandPalette/PlanCardView/Canvas 计数丸/SubgraphPanel/DashboardView chip 系迁入双件；mermaid 伪元素与品牌角标不动（G6 处理中文 content）。**testid 全保是铁律**（gate-risk-badge/masked-badge/slice-chip/tech-chip/highlight-badge/privacy-pill 等），组件 props 透传 data-testid。
**Acceptance:** ①枚举直出位点 grep 零残留；②closeout_gate:622/:1001 marker 契约零改动（前端映射不触 payload——若发现 payload 内含英文人话串需先上票面裁决再动）；③web 全量绿（徽章文本断言 ~40 处同票改，计数入 Comments）；④两视口实拍；⑤ui_smoke 绿。

## Comments
