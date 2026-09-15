# 05：G5 — 黑话清扫（前端+服务端双端，销 V27-11③）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（表 B 全量；D4/D8 双端同改）。*

Status: open
标签：文案 / 跨端 / 来源：v027 台账 V27-11③。

## 现状

前端可见黑话 ~40 处 + 服务端 worker 中文 stage label（SSE 渲染进 UI）+ agent.ts 系统提示词。侦察实证闸门冲突活例：「演进推演」被 Canvas.test:82/Sidebar.test:273 禁出现，EvolutionView.tsx:30,479 与 worker.ts:707,780 却在用——本票了结。

## Agent Brief

**Summary:** 按表 B 全量替换（AST 提取/2-Hop/锚定/孤岛/波及/工件/惯例嗅探/演进推演/落位/拓扑收敛/图谱投射/意图解析/跨语言桥接/[cite 引导语字样），前端 STAGE_LABEL 与服务端 worker label **双侧同步**；stage **id** 与 payload 字段一律不动（closeout_gate:1544 钉 id 序列）；`架构指标` 导出模板标题**先核 golden eval 是否锁题面**（`src/eval/repoqa-eval.ts` 面），锁则停步上账裁决，不锁则随票改（repoqa-export.test.ts:175 + repoqa-http.test.ts:1654 同票）；`[cite: N]` 机器格式、agent.ts:224 rewrite、模型指令契约值保留，仅引导语文案人话化。退役中文词随本票入表 D 第一层，改红注释顺手清。
**Acceptance:** ①表 B 退役词 web+cp 两侧 grep 零残留（标识符豁免名单入票面）；②cp 全量绿（worker label 断言测试同票改）+ web 全量绿；③**golden eval 97 题重跑**（label 改动预期零翻车，翻车即停票上账）；④e2e 62 绿；⑤docker 重建冒烟（动 server 面）；⑥UI 冒烟绿 + 演进视图实拍（STAGE 胶囊序列肉眼可读）；⑦票 01 服务端哨全绿（哨与本票文案互证）。

## Comments
