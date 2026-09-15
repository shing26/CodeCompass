# 08：G8 — 战役收口 + 发 v0.30.0

> *Parent spec：`.scratch/v030-degeekify/spec.md`（D2：收口另切 v0.30.0）。*

Status: open
标签：收口 / 发布 / 全战役。

## Agent Brief

**Summary:** ①黑名单终表复核（表 D 全量入 copyBlacklist + 双层哨 + 服务端哨全绿）；②注释扫尾：全仓 grep 退役词零残留（代码标识符与 ADR/CHANGELOG/票面豁免清单落档）；③**两视口实拍全套**（TopBar/Sidebar/Dashboard/Inspector/CiGateView/演进视图/chat/空态/Modal，before/after 对照）交 judge 视觉验收；④全门禁终跑：tsc 四包 / cp 644+ / web 356+ / bridge 26 / **golden eval 97** / e2e 62 / UI 冒烟 / docker 构建+容器冒烟（e2e 与 docker 串行）；⑤发布程序：五处 bump 0.30.0 + CHANGELOG 0.30.0 段（战役纪要+四表摘要+D4 授权假设记录）+ e2e 版本门 + commit + tag v0.30.0 + push + CI/Release 双绿 + Release 对象核验；⑥总账划销：V27-11 五件套、V27-14、V27-2、V27-3、V27-4、V27-10；暂缓项注记（V27-5/6/15/16/17、V29-1）；⑦CONTEXT 词条终核（用户文案规范词条与本战役实态一致）。
**Acceptance:** ①「极客感」判据人工复核：chrome 全中文（通用语除外）、徽章全人话、无 [cite]/BROKEN/推演/落位字样直出、字号无任意值——逐项附 grep/实拍证据；②双流水线绿 + Release published；③本票 Comments 含全门禁数字与实拍结论。

## Comments
