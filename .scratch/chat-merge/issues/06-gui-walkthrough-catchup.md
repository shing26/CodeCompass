# CM-06：浏览器 GUI 层走查补课（chat 模块从未做过 GUI 维度验收）

Status: ready-for-agent
标签：CM-06 / P3 / 来源：chat-merge 终验「明确不验收」声明
类别：交互反馈 / 视觉适配 / 性能与控制台

## 现状

chat-merge 终验为纯 HTTP/SSE 黑盒 + 静态 bundle 断言，以下 GUI 维度**零覆盖**：

- 骨架屏 / Loading 态 / Disabled 态 / Hover 反馈
- 分辨率适配（1280 / 2560 / 移动宽）下 ChatView 容器遮挡与文字截断
- Console 未捕获 Promise / 类型报错 / 静默失败
- regenerate 按钮（F-04 复验仅源码层确认前端链路 `RepoQAClient.ts:876` → `ChatView.tsx:233`，未在浏览器实测点击）
- `?mode=incident` 深链实跳（F-06 由 vitest 3 passed 关闭，但未浏览器实测）
- cite 角标 → Canvas 深链定位（B2 收口 gate 过，无走查记录）
- SSE 中断/断连时前端 UI 态（是否假死、能否重发）

## 修法建议

用 web-gui-tester 按 6 个体验维度走查 ChatView 全交互面（含 Chaos 画像：流式中打断、并发狂点发送）；走查报告落 `.scratch/chat-merge/qa/`，新增发现按 triage-backlog 增量编号（CM-07 起）。

## 验收标准

1. 走查报告产出，覆盖上述 7 项清单，每项有 Actual/Expected 结论。
2. 新增缺陷 0 个未分级——全部入 backlog 或当场转 issue。
3. 无 P0/P1 遗留；若有，转立 ready issue 并给出修复 Prompt。

## Comments
