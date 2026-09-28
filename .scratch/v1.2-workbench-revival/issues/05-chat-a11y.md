# Issue 05 — 长回答 a11y（V27-15 解冻）

> 波次：波 1 ｜ 状态：ready-for-agent ｜ 优先级：P2 ｜ 依赖：— ｜ 依据：spec D4；台账源 V27-15（computer-use 走查 D5 实证）

## 1. 实测（走查在档）

- 长 LLM 回答 ~300+ DOM 节点淹没可访问性树：读屏/键盘导航成本高；computer-use 走查亲踩「流式后元素 index 漂移」（V27-15 原文）。
- v0.31 冻结时标注「界面增强类」——本线 D5 双轨制下按「dogfooding 论证」过闸：键盘/读屏可用性是产品面质量底线。

## 2. 任务

1. 消息区 aria landmark 分区（`role="log"` 或等价 landmark，容器级一处）。
2. 流式输出容器 `aria-live="polite"`（避免 per-token 朗读风暴，节流策略实现者定）。
3. 超长回答折叠：「展开全文」（阈值实现者定，参考 ~200 行/300 节点档）；折叠态不丢内容（展开回放完整）。
4. 环境坑预登记：jsdom 无 `scrollIntoView`（HANDOFF §2.3-9），滚动联动用例需 polyfill 或绕行。

## 3. 验收（机器可验证）

1. ChatView.test：landmark 断言 + `aria-live` 断言。
2. 折叠断言：超长夹具折叠后消息区可见 DOM 节点数 ≤ 阈值；「展开全文」后内容完整回放（文本等价断言）。
3. 既有 12 测 incident-stream / chat 流式用例零回归；copy-guard 双哨绿（「展开全文」文案不在退役表）。

## Comments

- 2026-09-28 立项（grill D4 解冻；范围按 V27-15 原文三条，不扩）。
