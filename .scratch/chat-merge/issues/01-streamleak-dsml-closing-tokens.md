# CM-01：StreamLeakFilter DSML 闭合标签瞬态漏入裸 SSE 流

Status: ready-for-agent
标签：CM-01 / P3 / 来源：chat-merge 终验复验新增 QA-F-07（注意与首轮"会话标题"QA-F-07 撞号）
类别：AI摩擦 / 流式控制状态机

## 现状（88f1985 代码核实）

- `services/control-plane/src/chat/agent.ts:342-404` StreamLeakFilter：drain() 中 dsml holding 态一旦确认泄漏标记，即 `this.buffer=''; this.holding=''`（L390-394）重置为直通。
- 开启正则 `/<tool_call|<function=|<｜｜DSML｜｜/i`（L364）不匹配闭合形态——`</｜｜DSML｜｜invoke>` 以 `</` 开头，不命中 `<｜｜DSML｜｜`。
- 后果：DSML 闭合片段以 2-3 个 delta 事件瞬态到达裸 SSE 流（复验证据 `qa/evidence/verify/f01-stream.txt` L146/149/158）。
- GUI 用户不可见（三重兜底）：仅触发 regenerate 的轮次出现 + `ChatView.tsx:233` 收到 regenerate 即清空缓冲 + done.answer 回写覆盖。**但裸 SSE 消费者（脚本/第三方集成）可见。**

## 修法建议

drain() 的 dsml 分支在丢弃缓冲后不立即回直通，二选一：

- 方案 A（推荐）：dsml 态重置后追加一个 swallow-until-line-end 子态——继续吞掉直到下一个换行/非 `｜｜` 起始内容。
- 方案 B：将 DSML 闭合标签族（`</｜｜DSML｜｜invoke>`、`</｜｜DSML｜｜tool_calls>` 等）纳入 drain 的丢弃匹配集合。

## 验收标准

1. 裸 SSE（curl 直连、无前端）消费 10 次 steps>=3 的会话，delta 拼接文本中 DSML token（`｜｜DSML｜｜` 族）出现 0 次。
2. done.answer 与落库 assistant.content 保持现状 0 DSML，不回退（chat 现有 19 条单测全绿）。
3. 新增闭合族回归用例：模拟"开启标记丢弃后紧跟闭合片段"的 chunk 序列，断言 sink 输出不含闭合族。

## Comments
