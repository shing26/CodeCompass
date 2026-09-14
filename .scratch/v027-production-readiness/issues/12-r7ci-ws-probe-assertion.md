# 12：R7-CI — 「R2 锁」CI 红引出优雅关闭真 bug（立 V27-31）

> *Parent spec：`.scratch/v027-production-readiness/spec.md`。R7 门的 CI 首跑实战。*

Status: closed
标签：test / P1 / 来源：v0.27.0 Release 首跑（ubuntu headless-shell）——「页面未刷新而 WS 重连收到索引进度」两轮 retry（20s+20s）皆红，而同期「reindex 服务端落定 ready」绿：后端与广播面工作正常，断言却无任何诊断可分辨「未重连」与「重连了但帧丢/未渲染」。本地 Windows 三+两轮全绿=幸存者。

## 根因分析（证据式，非猜测）

旧判定=「MutationObserver 捕 `status-progress` DOM 出现」，依赖三件事同窗对齐：页面重连时机（指数退避 1s 起步）、索引帧广播时机（小 fixture 毫秒级）、React 提交+观察器回调。旧脚本重连靠固定 2500ms 睡眠赌时机；帧若发于重连完成之前即永久丢失（服务端无补发队列，onopen 补偿只刷 symbols/dashboard 不含进度）。CI runner 调度与本机差异足以翻转该赛跑，且红后无线索。

## Comments（2026-09-14 实施收口）

- 落地：`page.addInitScript` 装 `__wsLog` 探针（/ws socket 的 create/open/close/message-type 全记录）+ `__pageId`（reload 即换，「页面未刷新」反证）；第 4 段改证据链——①mark 后出现新 `open`＝重连确证，②**确认重连后**才 POST reindex（消灭「202 早于重连即丢帧」），③`repoqa.index.progress` 帧到达＝进度送达确证（≤5 轮 reindex 防极端调度），④DOM 进度条降级为附加信息（渲染时机仍受 V27-23 面影响，不再作门）；失败 dump `__wsLog` 时间线尾 40 条。
- 语义守住：断言题面不变（未刷新+重连+收到索引进度），判定从「赌 DOM 时机」变「socket 层可判」；若 R2 真坏（无 open 或无帧）依旧红，且这次带证据。
- 验收：本地连跑 2 轮 PASS（detail=`reconnect=true progressFrame=true noReload=true domBar=亦见`）；CI Release 重跑为最终裁决（见 v0.27.0 tag 重打）。

## Comments（2026-09-14 第二轮——CI 再红，诊断网升级为双源）

- tag 首跑（34789966823）仍红，但探针带回关键事实：`__wsLog[mark:+40]=[]`——kill 后连 `close` 都没有。本地 chrome/headless-shell 双双复跑全绿（同 v1243 build），证明非浏览器形态；且全仓 grep 无任何 reload 路径。三种世界（页 reload 使 slice 下标越界 / kill 未真正断链的半开 socket / 效应未挂载）必须机械区分，下轮不许再猜。
- 重建：①判据从数组下标 `slice(mark)` 改 **t>=killTs 时间戳窗口**（reload 清零不再致越界假阴性）；②新增 **CDP 级 `page.on('websocket')`** 事件收集为第二证据源（不经页面 JS），页内探针与 CDP 任一证 open、任一证 index.progress 帧即成立；③`noReload`（`__pageId` 相等）独立裁决不参与短路；④失败 dump `__wsLog` len+tail 与 `wsEvents` tail 双时间线；⑤crash/framenavigated 监听器留痕。
- 本地复验全绿（四旗 true + nav 留痕正常：同文档 replaceState 不清 window，与页不刷新的语义相容）。CI 若再红，双源 dump 直接指认真凶：len=0→app 从未连（环境/产品深挖）；len 冻结在 pre-kill 值且 CDP 无 connect→半开 socket（kill 检测面）；CDP 有 connect 而探针无→页面被换（reload 世界）。

## Comments（2026-09-14 第三轮——真凶落网：产品级优雅关闭挂死）

- 第二轮 CI（34790801138）仍红，但双源 dump 给出决定性事实：`__wsLog` len=3 冻结在 kill 前（create/open/welcome 齐全——页活着、首连正常、noReload=true），kill 后**连 close 都没有**、CDP 亦零新 connect。唯一相容世界=旧进程 SIGTERM 后**没死**：监听的 socket 半开 → 浏览器永不重连（R2 机制无机会表演）。
- **根因（探针实证，ws@8+Node24）**：`wss.close()` 与 `server.closeAllConnections()` 都不销毁已升级的 WebSocket 连接 → `server.close()` 回调永不触发 → `RunningServer.close()` 卡死于 await → cli.ts 的 SIGTERM `shutdown()` 永不到达 `process.exit(0)`。Windows 本机 `child.kill()`=TerminateProcess 强杀完全掩盖此路径；Linux CI/`docker stop`（10s 后 SIGKILL）才是真实世界。旧脚本 DOM 赌时代表象、socket 证据亦红——**门是对的，产品是坏的**；R2 前端机制经此检验无恙。
- 修复（server.ts close()）：`server.close()` 前显式 `for (const client of wss.clients) client.terminate()`——修复前后各跑 30s 探针对照（closeCbFired false→true、clientSawClose false→true）。
- 回归钉：新 `server-shutdown.test.ts` 三例（活 WS 下 close() 限时完成/客户端可观察 close/关闭后拒新连）。**变异检验**：临时拆 terminate → 2/3 红且消息点名「close() hung」→ 复原 634/634 全绿。
- 冒烟断言重建（双源+时间戳+诊断 dump）保留——它现在既不再赌 DOM 时机，也是这次破案的仪器；V27-23 面（DOM 进度条残留）与本票解耦。
