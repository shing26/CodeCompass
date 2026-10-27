# 票 04 — 前端：进度行与慢提示

Status: done

## 背景

有了服务端信号，前端要做的是「让用户一眼知道在干嘛，并给出口」——不新增控件，复用现有停止键与档位切换。

## 做法

1. `ChatMergeClient.chatSend`：解析 `progress` / `hint` / `heartbeat`，handlers 增
   `onProgress?` / `onHint?`；未知事件继续忽略（兼容律）；`done` 仍是终态权威。
2. `ChatView.tsx`：
   - busy 时在「已用时 / 首字延迟」旁渲染进度行：按 phase/tool/step 映射中文文案
     （copy 表集中，copy-guard 合规）；
   - 收到 `hint` 渲染提示条（颜色与现有告警一致），文案：「模型响应较慢，可继续等待、停止或切换档位」；
     `profilesAvailable > 1` 时才给「切换档位」入口（复用现有 model switcher）；
   - `heartbeat` 只用于「最近一次服务端信号」时间显示（可选），无 UI 阻断。
3. 单测：进度文案映射、hint 出现/消失、切档建议仅多档时出现、未知事件不崩、done 后清空进度行。

## 验收

- 慢模型场景：20s 等待期间进度行持续更新、15s 出现提示条、停止键可用；
- 多步工具：进度行显示「正在执行 <tool>（第 N 步）」；
- 无障碍：进度行 `role="status"` `aria-live="polite"`，不抢焦点；
- 既有 ChatView 测试（R5-05 已用时/首字/停止）全绿。

## Comments

- 2026-10-27 完成。`RepoQAClient.ts`：`ChatSendHandlers` 增 `onProgress` / `onHint`，
  `chatSend` 解析 `progress` / `hint`（`heartbeat` 显式忽略，未知事件不落 error）；
  `ChatRuntimeContext.chatGuardSend` 直通（本层不消费，不影响 consent 门）。
- `ChatView.tsx`：导出 `progressLabel` / `hintLabel` 两个纯函数（文案集中、copy-guard 绿），
  busy 时 `chat-timing` 行内渲染进度（`role=status` `aria-live=polite`）与慢提示（`text-warning`）；
  多档位才提示「切换档位」；首个 delta 到达或轮次结束即清空，不留假状态；停止键/切档复用既有实现。
- 测试：新增 ChatView 4 条（进度文案 / 多档提示 / 单档不提示切档 / 结束后清空）+ ChatMergeClient
  帧解析 1 条；定向 web 测试 **66 passed**（含 copy-guard）。
