# 01：G1 — 哨基建先行（销 V27-10，立 D8 双哨机制）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（grill D8：双哨同表+全局扫描升级）。*

Status: open
标签：文案哨 / 先行票 / 来源：v027 台账 V27-10 + D8。

## 现状

copy-guard 英文封条只锚 2 个 testid 位点（copy-guard.test.ts:49-60），位点外英文「Evolution」用户文案会漏网（台账 V27-10 前瞻项）；服务端文案（worker stage label、agent 提示词、export 模板标题）历史上无哨。侦察已逮到漂移活例：「演进推演」被前端哨禁、却被 EvolutionView STAGE_LABEL 与 worker label 使用。

## Agent Brief

**Summary:** ①`copy-guard.test.ts` 把 Evolution 封条从 testid 位点升为**全组件 JSX 文本节点扫描**（遍历 `components/**/*.tsx` 源文本，剥标识符语境后断言 `\bEvolution\b` 仅存于代码标识符——具体判据实施时定稿，防 EvolutionView/EvolutionRisk 误伤是硬约束）；②新增服务端哨 `services/control-plane/src/copy-guard.server.test.ts`：worker.ts 中文 stage label 集合、agent.ts SYSTEM_PROMPT、export 模板标题三面断言「零退役词」——本票黑名单暂只入现词（拆除计划等 7 词表 B 已定退役项），给 03/05/07 各票留同票扩词空间；③英文词 JSX 级扫描层机制建立但词表暂空（表 D 第二层随 03 票入词）。
**Acceptance:** ①新哨在当前文案下有**已知红例**（临时植词→红→回滚）证明灵敏度，非空转；②web/cp 全量绿（新哨自身除外零改测试）；③零业务文案改动（本票只立闸不改案）。

## Comments
