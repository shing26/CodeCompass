# 票 04 — R5-13 无链路兜底文案（Web）

Status: done

现状：链路解析完成但零锚点时，canvasAnchors 回退旧链或空数组，画布永远显示
FlowSkeleton（像在加载）。useChat onDone 已把该消息标 break=true——只需消费它。

- ChatRuntimeContext 新增 canvasTraceEmpty：最近一条已完成 assistant 消息
  break 且无 anchors 且无 diagram；
- Canvas 新 prop traceEmpty：该态下渲染确定性兜底文案（风格同 TopApiBlock 空榜），
  不再渲染骨架；「当前链路」标注同屏显示；
- 组件测试覆盖两态。
