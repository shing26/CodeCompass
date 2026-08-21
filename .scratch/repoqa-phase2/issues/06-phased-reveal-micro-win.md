# 06 — Staged reveal, micro-win and Static Analysis Break presentation

**What to build:** 开发者的一次查询按"业务概览 → 图 → 源码卡片 → 下一步"四阶段揭晓完成（spec 决策：分阶段揭晓，不一次性展开）。一次 trace 完成后展示可量化 micro-win（如"已确认 N 个源码锚点"）与显式 off-ramp（继续提问 / 回到顶部）；若上下文有 Static Analysis Break 或后端 error 事件，展示显式断点标记，不使用成功 toast 掩盖。

**Blocked by:** 03 — Mermaid render with graceful fallback; 04 — Source trace drawer with anchored code cards

**Status:** done

- [x] 渲染顺序为 token（概览）→ mermaid → anchors（抽屉），各阶段到达即揭晓
- [x] `done` 后展示 micro-win（基于真实 anchors 数量）与 off-ramp 出口
- [x] 出现 Static Analysis Break（error 事件或无 anchors 且 trace 不完整）时显示断点标记，无成功 toast
- [x] 组件测试覆盖：揭晓顺序断言、micro-win 文案、break 场景渲染

## Comments

### 2026-08-21 spec
- Break 检测来自后端 error 事件 / 结构化输出中缺失锚点的信号；前端只做忠实呈现，不猜测补全。

### 2026-08-21 implementation
- `useChat.ts`：`ChatMessage` 增加 `suggestedAction` / `status: 'streaming'|'done'` / `break`；`done` 事件读取 `event.payload?.suggestedAction`；error 事件对保留的消息标 `break:true, status:'done'`（空消息删除）；onDone 标 done 且 `break = m.break || (!anchors?.length && !diagram)`（无锚点且无图一律按 Break 呈现，不用成功态掩盖）。
- `RepoQAClient.ts` QueryStream：`done` 事件现在解析 `JSON.stringify(payload)` → 发射 `{type:'done', payload}` 后再 `finish()`（此前直接 finish 导致 suggestedAction 丢失）。顺带修复同文件既有 bug：token/mermaid 帧也是 JSON 包装（`{"token":"..."}`/`{"mermaid":"..."}`），此前按原始字符串透传，真实后端下会渲染 JSON 原文；现 `payloadString()` 解析字段、非 JSON 帧回退原文。
- `Canvas.tsx`：加 `inputRef`/`scrollRef`；`TraceOutcome` 组件——`message.break` 时渲染 `break-marker`（红底 "Static Analysis Break"），否则渲染 `micro-win`（绿底 `✓ 已确认 N 个源码锚点` 或 anchors=0 时 `✓ 分析完成`），off-ramp 三出口：`off-ramp-suggested`（提交后端建议问题）、`off-ramp-continue`（聚焦输入框）、`off-ramp-top`（滚动回顶部）。
- 测试：`chat.test.tsx` 新增 5 条（揭晓顺序、micro-win+三出口、diagram-only 无建议时 `✓ 分析完成`、error 带内容 → break-marker 无 micro-win、done 无锚点无图 → break-marker）；新增 `src/client/RepoQAClient.test.ts` 5 条（done payload 解析、坏 payload 容错、token/mermaid/anchors 逐事件转发、非 JSON 帧回退、URL 构造）。
- 全套 49 测试通过 + typecheck ✓ + build ✓（4.4MB chunk 警告为已知非 gate 项）。