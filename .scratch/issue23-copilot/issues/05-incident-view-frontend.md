# 05 — IncidentView 前端（Web 端改造）

Status: done

<!-- 完成（2026-09-01）：
- types.ts：QueryMode+'incident'、WorkbenchTab+'incident'、Anchor+commit?/lineEnd?、EvidenceStatus/EvidenceItem。
- components/evidence.ts：parseEvidenceFromAnswer(answer, anchors) — 4 正则（CHAIN/FRAME/BREAK/PLAIN_LOCATION），
  BROKEN→BREAK 归一，Map 按 status|label|file|line 去重（首现保留），anchor 合并 pass 继承 commit、
  未出现 anchor 追加为 VERIFIED；纯叙事不产生行（零幻觉约束：不编造）。
- EvidenceCard.tsx：VERIFIED 绿/BREAK 红/SUSPECT warning 徽标 + commit chip（前 7 位）；
  VERIFIED 行可点击 → onNavigate(file,line,undefined,symbol)，BREAK 不可点。
- StackTraceInput.tsx：症状输入 + 可折叠堆栈 textarea；IME 安全 isComposing/keyCode===229 双守卫；
  Enter 提交（shift+enter 换行）。
- IncidentView.tsx：消息流 + 空/streaming/reconnecting/recovered/error 态 + EvidenceCard 渲染。
- useChat.ts：ChatMessage+mode?/stack?/evidence?；askIncident(question, stack?)；done 事件在
  lastModeRef==='incident' 时 parseEvidenceFromAnswer；retry 传 lastStackRef；queryRepo 第 5 参仅 incident 传 stack。
- RepoQAClient.ts：QueryStream 构造器第 6 参 stack（reconnectBaseMs 前），open() 有值才 set('stack')。
- TopBar.tsx：TABS 加 '排障'（tab-incident）。App.tsx：MainView 'incident' 分支、深链 ?mode=incident、
  popstate/URL 同步、handleIncidentSubmit 共享 LLM consent 门禁（confirmConsent 按 mode 分流）。
- 测试：EvidenceCard 8 + StackTraceInput 7 + RepoQAClient stack 2 + App incident 5（tab 切换+URL 同步/
  深链/纯问题提交/带堆栈提交/consent 门禁）；既有 Top API 测试补第 5 参 undefined。
- 回归：repoqa-web 全量 32 文件 266/266 通过。
-->

## 目标
- `RepoQAClient`：`QueryMode` 加 `'incident'`；`queryRepo` 增可选 `stack` 参数（URLSearchParams 透传）。
- `useChat`：暴露 `askIncident(question, stack)`（内部 mode='incident'），状态机与普通 ask 共用。
- 新组件：
  - `StackTraceInput.tsx` — textarea 粘贴堆栈 + 问题输入；Enter 发送（IME 安全：`isComposing`/`keyCode===229` 守卫）。
  - `EvidenceCard.tsx` — 回答内证据卡：每条断言显示 VERIFIED（raw-file 校验过）/ BREAK / SUSPECT 徽标 + `file:line` + commit 短哈希 chip；点击走既有 anchor-click → Inspector 切片。
- `App.tsx`：`MainView` 增加 `'incident'` 分支 + TopBar/Sidebar 入口；深链 `?mode=incident`。
- 视觉沿用 repoqa-web 既有语言与设计令牌；空态/加载/错误态齐全。

## 验收
- 组件测试：EvidenceCard 三徽标渲染、StackTraceInput IME 守卫与提交、App 分支切换与深链。
- vitest mock 沿用既有 mermaid/monaco 模式；前端全量绿。
