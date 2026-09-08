# 06: 调用链/子图 caller/callee 视图切换

Status: done

## 问题

后端子图是双向提取（1 跳 caller + 3 跳 callee 同图返回），每个节点带 `direction: 'start' | 'caller' | 'callee'` 属性。前端 `types.ts:271` 已定义 `SubgraphDirection` 类型，但 Mermaid 图一次性全画，无视图切换；E2E 报告的 caller/callee 双向切换诉求（E4 前半）可用纯前端过滤满足。

## 任务

1. 调用链/子图画布上方加视图切换：全部 / 仅 Caller / 仅 Callee（过滤节点与其关联边，start 节点始终保留）。
2. 加方向图例（caller/callee/start 的视觉区分）。
3. 纯前端过滤，不新增后端查询参数。

## 验收

- 同一符号三种视图切换，节点数变化符合 direction 属性；节点点击跳转在过滤视图下仍可用。
- 组件测试覆盖三种过滤态。

## Comments

- 2026-08-28（code-review 批注）：切换落点为 Inspector 的 SubgraphPanel 而非聊天画布——
  事实核查后确认聊天 call-chain 的 mermaid 是**线性链**（起点 → 后继 callees，
  `traceToMermaid`），链里没有 caller 侧节点，在画布上做方向切换没有意义；双向数据
  （direction 属性）只存在于 subgraph-context 的节点里，子图面板才是它的视图。
  原「画布切换」诉求按此记录为不适用，而非缺失。
- 图例已补 Start 项（code-review 指出缺 start 视觉区分）。
