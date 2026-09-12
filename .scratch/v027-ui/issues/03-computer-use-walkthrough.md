# 03：UI-3 — computer-use 真实走查批：chat 发送链路 P0 修复 + 缺陷登记

> *2026-09-12 用户指令「模拟用户使用找缺陷」→ Edge 真实浏览器（用户 dev server 5173 + 真实数据 + 真实 LLM）走查。*

Status: closed
标签：fix / P0 / 来源：computer-use 用户模拟走查

## 走查范围与结论

首屏（未选库）→ 选库 → 自动 trace → **AskDock 提交链路** → chat 真实发送 → 变更审计 tab。全程可访问性树取证。

## 【P0 已修】chatGuardSend 把 repoId 当 sessionId——真实前端 chat 全坏（v0.25.0 批3 引入）

- **现象**：AskDock/chat 发送后无回答，消息区裸显英文 `unknown session`，无任何引导。curl 复现：`POST /api/chat/sessions/<repoId>/messages` → 404 `{error:'unknown session'}`。
- **根因**：`ChatRuntimeContext.chatGuardSend` 在 v0.25.0 批次 3 Context 分片时写成 `client.chat.chatSend(currentRepo.id, ...)`，而该参数语义是 **sessionId**（`RepoQAClient.chatSend:916` → `/sessions/:id/messages`）。**自 3380890 起真实用户 chat 发送 100% 失败**，持续 ~2 天。
- **为什么全绿测试没拦住**：330 条 web 测试用 mock chatSend（不校验首参）；e2e 打 API 层自己管会话，绕开前端 context。**mock 盲区的教科书案例**——单测通过≠链路正确。
- **修复**：sessionId 从 ChatView（`send()` 持 `session.id`）经 `onSend` 第三参传入 chatGuardSend 直达 client；`App.test` 加回归断言（首参 must match `^chat-s` 且 `not repo-`）。
- **复验**：Edge 真实浏览器重发提问 → 完整流式回答到达（含 cite 角标、markdown 列表/代码）✓。

## 走查发现的其他缺陷/待完善（登记 v0.27 台账，见 v027-backlog.md V27-12..16）

- **D2 错误文案裸传**：后端 404 JSON 原文直出 UI（`unknown session`），无中文化无引导无重试。修法：ChatView catch 里对 client 错误做人类化映射。
- **D3 UI 冒烟缺位**：P0 存活两天说明 CI 无真实浏览器 UI 冒烟。a04-shots/ui1/ui2 rig 已具雏形，建议移植为 Playwright smoke 进 Release 管线。
- **D4 未选库 Sidebar 噪音**：`0 files — expand to browse`、`ROUTES (0)`、`SYMBOLS`、`Choose a repo to see recommended tours.` 中英混排空态（并入 V27-11 视觉战役）。
- **D5 长回答淹没可访问性树**：一条 LLM 回答 ~300+ DOM 节点铺满消息流，TopBar/Sidebar 被挤出前 200（键盘/读屏导航成本高，且计算机操作侧 index 极易漂移——走查中亲踩：流式完成后旧快照 index 全部错位）。
- **D6 首屏自动 trace 选题偏技术侧**：CodeCompass 仓自动选中 `GET /api/repos/:id/query`（一个内部 API 路由），非"核心业务"。建议取 dashboard topApis 同源的 hub/inDegree 高者优先。
- **产品侧正面观察**：LLM 回答诚实（对 App.tsx 入口标 SUSPECT、明说 tours 形态不覆盖、拒绝因零调用者判可删）——Zero-Hallucination 契约在真实会话中兑现，这条是「问答有用」的正证，值得写进 README 场景示例。
