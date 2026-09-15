# 04：T5 — 索引完成后步进条复位（销 V27-23）

> *Parent spec：`.scratch/v029-resilience-hardening/spec.md`。*

Status: closed
标签：UX / P2 / 来源：R7 冒烟实施中发现（韧性段落定信号被迫改走服务端状态的根因）。

## Agent Brief

**Summary:** `RepoContext.tsx` WS 处理器只 set `indexingProgress`（FINALIZING/100 只触发静默刷新、无清空帧），唯一复位在切库 effect——索引完成后步进条常驻直到刷新。补一个目录轮询复位 effect：当前仓离开 active 三态（cloning/parsing/indexing→ready/error）即清空（active 清单与 useRepoCatalog 对齐）。
**Acceptance:** 冒烟第 4 段 domBar 观测窗内仍见（observer latch 只置真不受复位影响）+ web 全测绿 + 复位语义全链路实跑。

## Comments（2026-09-15 实施收口）

- 落地：单 effect 10 行（currentRepo 驱动）。R2 锁判据（socket 级，票 12）不受影响——它从不依赖残留。
- 取舍记录：不补单元例（需全套 WS+轮询 harness，App.test 无既有缝）；UI 冒烟第 4 段即全链路验收（reindex→ready→stepper 清空路径实跑，domBar=亦见）。
- 联动核：票 12 注记「进度条残留系 V27-23 在册缺陷」——本票即其修复，落库后该缺陷面消亡；smoke 落定信号维持服务端状态（既有设计不变）。
- 验收：web 354/354、tsc 净、vite build 成功、**UI 冒烟 PASS（四旗+domBar）**。
