# CM-05：默认模型选型对比（批次 D）

Status: needs-info
标签：CM-05 / P2 / 来源：copilot `.scratch/m4-polish/issues/02-model-selection-comparison.md`（chat-merge spec 明文"批次 D → 归入本线 post-v0.24"）
类别：AI摩擦（根治向）/ 决策

## 现状

- llm-profiles.json 仅 `default` 单 profile；当前默认模型存在文本假调用倾向（`<tool_call>`/DSML 文本形态）与 cite 纪律不稳（M3 对抗轮发现），现由编排层防线（stripTextToolCalls / StreamLeakFilter / 重试）全部兜底，但根治需更强模型或模型对比数据支撑决策。
- **阻塞项：等用户提供第二模型的 base/key**（写入 llm-profiles.json + .env）。

## 修法建议（用户输入到位后执行）

同一组对抗性提问（批量删除 / 注入 / 错别字 / 多轮指代，取自 QA 报告 Persona 清单）在两个 profile 下各跑一轮，按原 issue 五维记录：

| 维度 | 记录 |
|---|---|
| 文本假调用频率 | StreamLeakFilter 拦截次数 / JSONL answer_retry 次数 |
| cite 纪律 | 正文 [cite: N] 与 citations 数组的对齐率 |
| 语言一致性 | 中英漂移次数 |
| 工具编排质量 | 是否自发 scan→diagnose 链路、target 合法性 |
| 延迟 | done 总耗时对比 |

## 验收标准

1. 产出对比表 + 默认模型决策记录（回写本 issue 处理状态）。
2. 决策数据同步至 QA 报告（`.scratch/chat-merge/qa/`）。

## Comments
