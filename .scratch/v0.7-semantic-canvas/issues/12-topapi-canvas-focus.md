# 12: Top API → 画布焦点高亮

Status: ready-for-agent

## 问题

DashboardView Top API 点击后 `handleTrace` 已切换到工作台并以精确起点（name+file）发起 call-chain（App.tsx:236-245），但完成后无节点级焦点——画布焦点标签被动显示，无高亮居中（报告"上下文割裂"主张的部分属实部分）。

## 任务

1. 追踪完成（done 事件携带 anchors）后，对起始锚点（anchors[0]）做高亮：FlowCards 目标卡与 mermaid 起始节点复用 glow 视觉语言（一次性 1.5s 闪烁 class）。
2. 高亮状态经 useChat 消息元数据或 Canvas 内部 effect 派生（保持单向数据流，不新增全局状态）；移动端自动展开 Inspector 的现有行为不变。
3. 组件测试：带 anchors 的消息完成起始节点获得高亮 class 并按时移除。

## 验收

- 组件测试绿；手工路径"看板点 API → 工作台起始节点闪亮"可用。
