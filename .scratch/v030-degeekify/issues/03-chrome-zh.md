# 03：G3 — chrome 中文化（销 V27-11② + V27-14）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（表 A 全量；D3 工程通用语保留）。*

Status: open
标签：文案 / 大票 / 来源：v027 台账 V27-11②、V27-14。

## 现状

~55 唯一英文短语散落内联（无 i18n 层，侦察表 A 逐位点列账）；V27-14 Sidebar 空态噪音（`0 files — expand to browse`/`ROUTES (0)`/中英混排）同性质同文件并入。

## Agent Brief

**Summary:** 按表 A 全量替换；KIND_FILTER_OPTIONS 只译 label 不动 value；HTTP 动词/语言名/品牌/API/Git/URL/Token 按 D3 保留。**同 commit 联动**：App.test:285,296,1094,1104、TopBar.test:221,222,287-295、Canvas.test:55 票15 实名哨（`Import repo`→`导入仓库`）、TourPlayer 钉句、ImportRepoModal.test（18 断言）、ArchitectureDeltaView/CiGateView 英文钉——预估 ~120 处断言；表 D 第二层英文退役词（Watcher/Import repo/No file open/Quick Tours/Tech Stack/Base ref/[cite:）随本票入黑（哨基建票 01 已就位）。V27-14 空态降噪：未选库时 Routes/Symbols 节头与计数在空数据下整体隐藏或收进 tooltip（实施时实拍裁决，勿留「(0)」噪音）。
**Acceptance:** ①表 A 位点 grep 零残留（保留名单除外）；②web 全量绿、testid 全保（diff 审查无 data-testid 改动行）；③两视口实拍（1366px + 375px）交票面；④ui_smoke 全链路绿（testid 驱动，应零改动——改动即违例上账）。

## Comments
