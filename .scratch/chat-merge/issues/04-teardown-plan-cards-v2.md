# CM-04：拆除计划卡片化（v1 未随迁 + v2 结构化分组与持久化）

Status: needs-triage
标签：CM-04 / P2 / 来源：copilot `.scratch/m4-polish/issues/01-structured-plan-cards-v2.md`（chat-merge spec 明文"卡片化 v2（issue 01）→ 归入本线 backlog"）
类别：AI摩擦 / 体验优化（DEPRECATE 拆除决策链）

## 现状（88f1985 代码核实——比 copilot 原件描述更差一档）

- copilot 原 issue 称"v1 已交付（回答含 ≥3 个任务项时自动包 🧹 计划卡 + remark-gfm 勾选）"。
- 但毕业移植时 **v1 未随迁**：全仓（services/ + apps/）`🧹` 零命中；`ChatView.tsx`（347 行）无计划卡/teardown/分组逻辑，仅 ReactMarkdown + remark-gfm 裸渲染（task-list 语法可勾选但纯 Markdown、无卡片容器、无持久化）。
- 后果：DEPRECATE 拆除清单（本产品"防误删"核心卖点的决策链末端）当前以整块散文 Markdown 呈现，勾选不落库，刷新即丢。

## 修法建议（分两期）

**一期（补齐 v1 + v2 渲染，前端 + store）：**
1. ChatView 增加计划卡组件：assistant 回答含 ≥3 个任务项（GFM task list / teardown checklist 结构）时包裹卡片容器，按符号分组渲染（符号、文件:行、风险、验证步骤、checkbox）。
2. 勾选状态持久化到 control-plane（chat_messages 元数据列或新表），刷新/重启保留。

**二期（载荷直供，涉及契约，需先落 spec）：**
3. 数据源从"模型散文解析"升级为 `codecompass_plan_evolution` 载荷直供——模型引用卡片数据而非自由生成，卡片为准、散文只做解读。此项涉及 payload 契约扩展，按并行协作约定先落 spec。

## 验收标准

1. 对抗性删除提问的回答中，拆除清单以分组卡片呈现（一期）。
2. 勾选状态刷新/重启后保留（一期）。
3. （二期）模型散文与卡片数据不冲突——卡片为准。
4. chat 单测全绿；web 单测覆盖卡片渲染与勾选持久化。

## 为什么 needs-triage（不直接 ready）

一期存储方案（元数据列 vs 新表）与二期 payload 契约均为设计判断；maintainer 定案后一期即可升级 ready-for-agent。

## Comments
