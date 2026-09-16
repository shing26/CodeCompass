# 08：G8 — 战役收口 + 发 v0.30.0

> *Parent spec：`.scratch/v030-degeekify/spec.md`（D2：收口另切 v0.30.0）。*

Status: closed
标签：收口 / 发布 / 全战役。

## Agent Brief

**Summary:** 黑名单终表复核、注释扫尾、两视口实拍全套、全门禁终跑（含 golden eval/docker）、CHANGELOG+tag+双绿、总账划销 V27-2/3/4/10/11/14、CONTEXT 终核。
**Acceptance:** 极客感判据逐项附证据；双流水线绿+Release published；Comments 含全门禁数字与视觉结论。

## Comments（2026-09-16 实施收口）

- **黑名单终表**：中文 23 词+英文 38 词，双哨共读零残居（web 7/7、cp 5/5 绿）；注释扫尾由「扩表自报」机制完成（G5 60 处、G7 1 处全清），豁免清单=机器值比较字面量与 CHANGELOG/ADR/票面历史（扫描根外，设计如此）。
- **视觉验收三轨**：
  1. 运行时文本门（6 视图 body.innerText）：退役词/英文 chrome 零命中 + 中文 chrome 必备词 10 项全在场——**PASS**。
  2. 布局几何门（1366×900 + 375×812）：非 truncate 语义裁切与文档级横滚零检出——**PASS**（G2/G3/G4/G6 四票累积的版式风险机械清算）。
  3. 实拍 gallery 11 张（`D:/zcode-tmp/v030-shots/`：六视图+导入弹窗+检视器+演进运行+移动双帧）——**视觉眼检移交 maintainer**：本会话模型与 judge 子代理通道均剥离图像输入（judge 报告 9/9 Unverified 有凭据），机制性缺眼不谎称看过，PNG 与验收要点清单留作人审工单。
- **极客感判据终核**：chrome 全中文（保留名单=D3 工程通用语）✓；徽章全人话（已验证/断链/通过/低风险/扩展挂载/控制器…）✓；[cite]/推演/落位/锚定/波及/工件/2-Hop/AST 提取字样 UI 零直出✓；字号任意值零✓；styles.css 零✓；testid 全保✓；契约值/stage id/SSE/MCP 零动✓（e2e 62 + golden eval 97 + 冒烟四链为证）。
- **全门禁终跑**：tsc 四包 0 | web 363 | cp 650 | bridge 26 | e2e 62/62（LLM 清空对照组，版本门 0.30.0 五源齐） | UI 冒烟 PASS | docker v030g7+/health（G5/G6 另有 CI docker-build 绿）。
- **挂账与移交**：V30-9（gate hermetic 化）已入 spec；实拍眼检移交；V27-17（tours TS 锚点）内容票、V27-15（a11y）、V27-16（选题）、V27-5/6、V29-1 继续在册——下一仗候选池不变。
- 发布：五处 bump 0.30.0 + 本段 CHANGELOG + dist 重建 + e2e 版本门绿 → commit + tag v0.30.0 + push；CI/Release 双绿与 Release 对象凭据见发布记录。
