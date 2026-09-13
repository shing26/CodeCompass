# 12：R7-CI — UI 冒烟「R2 锁」断言升级 socket 级证据链（立 V27-31）

> *Parent spec：`.scratch/v027-production-readiness/spec.md`。R7 门的 CI 首跑实战。*

Status: closed
标签：test / P1 / 来源：v0.27.0 Release 首跑（ubuntu headless-shell）——「页面未刷新而 WS 重连收到索引进度」两轮 retry（20s+20s）皆红，而同期「reindex 服务端落定 ready」绿：后端与广播面工作正常，断言却无任何诊断可分辨「未重连」与「重连了但帧丢/未渲染」。本地 Windows 三+两轮全绿=幸存者。

## 根因分析（证据式，非猜测）

旧判定=「MutationObserver 捕 `status-progress` DOM 出现」，依赖三件事同窗对齐：页面重连时机（指数退避 1s 起步）、索引帧广播时机（小 fixture 毫秒级）、React 提交+观察器回调。旧脚本重连靠固定 2500ms 睡眠赌时机；帧若发于重连完成之前即永久丢失（服务端无补发队列，onopen 补偿只刷 symbols/dashboard 不含进度）。CI runner 调度与本机差异足以翻转该赛跑，且红后无线索。

## Comments（2026-09-14 实施收口）

- 落地：`page.addInitScript` 装 `__wsLog` 探针（/ws socket 的 create/open/close/message-type 全记录）+ `__pageId`（reload 即换，「页面未刷新」反证）；第 4 段改证据链——①mark 后出现新 `open`＝重连确证，②**确认重连后**才 POST reindex（消灭「202 早于重连即丢帧」），③`repoqa.index.progress` 帧到达＝进度送达确证（≤5 轮 reindex 防极端调度），④DOM 进度条降级为附加信息（渲染时机仍受 V27-23 面影响，不再作门）；失败 dump `__wsLog` 时间线尾 40 条。
- 语义守住：断言题面不变（未刷新+重连+收到索引进度），判定从「赌 DOM 时机」变「socket 层可判」；若 R2 真坏（无 open 或无帧）依旧红，且这次带证据。
- 验收：本地连跑 2 轮 PASS（detail=`reconnect=true progressFrame=true noReload=true domBar=亦见`）；CI Release 重跑为最终裁决（见 v0.27.0 tag 重打）。
