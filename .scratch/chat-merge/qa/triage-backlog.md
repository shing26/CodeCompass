# chat-merge 基线 Backlog（triage 前置整理）

- 整理人：Persona-QA-Simulator（QA 架构师）
- 日期：2026-09-08
- 基线：CodeCompass v0.24.0，代码终点 `88f1985`，QA 终判 GO 8.5/10
- 用途：真实使用攒反馈期的**增量 triage 基线**。此后新反馈在本表之上追加编号（CM-07 起），先对照本表防重复立项。
- 验证方式：全部 open/closed 判定均对照 `88f1985` 当前代码逐条核实（非照搬旧报告结论）。验证证据以 `文件:行` 形式内嵌于各 issue 文件。

## 编号消歧（重要）

终验报告存在编号撞号：首轮缺陷清单的 **QA-F-07 = 会话标题**；复验章节新增的 **QA-F-07 = StreamLeakFilter DSML 瞬态**、**QA-F-08 = dist 门禁**。本 backlog 统一改用 **CM-xx** 编号，来源列保留原编号并注明。

## 总表

### Open（立项，6 项，issue 文件在本目录 `issues/`）

| 编号 | 来源 | 标签 | P级 | 状态 | 一句话描述 | 建议批次归属 | issue 文件 |
|---|---|---|---|---|---|---|---|
| CM-01 | 复验新增 QA-F-07（DSML 瞬态，注意撞号） | ready-for-agent | P3 | open | StreamLeakFilter 的 dsml 态丢弃缓冲后重置直通，DSML 闭合标签族仍以 2-3 个 delta 瞬态到达裸 SSE 流（GUI 三重兜底不可见） | 下迭代小改批次 | `issues/01-streamleak-dsml-closing-tokens.md` |
| CM-02 | 复验新增 QA-F-08（流程） | ready-for-agent | P3 | open | dist 为 gitignored 构建产物不随提交重建，无任何 src↔dist 新鲜度防护；本机部署/长驻实例复用陈旧 dist 时已修复代码静默失效 | 下次发布流程顺手做 | `issues/02-dist-freshness-gate.md` |
| CM-03 | 首轮缺陷清单 QA-F-07（会话标题，注意撞号） | ready-for-agent | P3 | open | 会话标题为「会话 MM-DD HH:MM」纯时间戳（`routes.ts:62` 现状核实未修），多会话用户无法辨识话题，无重命名入口 | 真实使用反馈期第一批 | `issues/03-session-title-readability.md` |
| CM-04 | copilot m4-polish issue 01（chat-merge spec 明文转本线 backlog） | needs-triage | P2 | open | 拆除计划卡片化：代码核实 ChatView 连 v1（🧹 计划卡自动包裹）也未随迁（全仓 `🧹` 零命中），仅 remark-gfm 裸渲染；v2 需分组卡片 + 勾选持久化 + 载荷直供 | v0.25 增量 | `issues/04-teardown-plan-cards-v2.md` |
| CM-05 | copilot m4-polish issue 02（批次 D，spec 转 post-v0.24） | needs-info | P2 | open | 默认模型选型对比：当前默认模型文本假调用倾向仅有防线兜底，根治需第二 profile 对比数据；阻塞于用户提供第二模型 base/key | 等用户输入后启动 | `issues/05-model-selection-comparison.md` |
| CM-06 | 终验「明确不验收」声明（GUI 走查未覆盖） | ready-for-agent | P3 | open | 浏览器 GUI 层从未走查（骨架屏/Disabled 态/分辨率/Console 未捕获错误/regenerate 按钮/深链与 cite 深链实跳），终验为纯 HTTP 黑盒 | 真实使用反馈期第一批 | `issues/06-gui-walkthrough-catchup.md` |

### Closed（验证后关闭，15 项——不立项，此处仅存证）

| 编号 | 来源 | P级 | 关闭证据（88f1985 代码核实） |
|---|---|---|---|
| — | QA-F-01（P1）DSML 覆盖正文并持久化 | P1 | `88f1985` stripTextToolCalls + StreamLeakFilter（`src/chat/agent.ts:319/342`）；复验 3/3，done/落库 0 DSML |
| — | QA-F-02（P1）chat 只认 COPILOT_LLM_* | P1 | resolveActive 按 REPOQA_LLM_* → COPILOT_LLM_* 顺序解析；部署口径实测开箱即用 |
| — | QA-F-04（P2）流式/最终答案双段不一致 | P2 | regenerate 事件 + 前端清缓冲；done.answer === 落库逐字节相等（复验实测） |
| — | QA-F-05（P2）fallback 文案指向无效变量 | P2 | 文案已列实际生效路径（REPOQA_LLM_* / llm-profiles.json），复验一致 |
| — | QA-F-06（P2）`?mode=incident` 深链 | P2 | `App.tsx:177/254` 运行时映射 + `App.test.tsx` deep link 3 passed；首轮"存疑"已撤销 |
| — | m4-polish P3-1 畸形 JSON 返回 HTML 堆栈页 | P3 | 终验场景 5 实测 400 JSON `{"error":"invalid JSON body"}` |
| — | m4-polish P3-2 SPA 回退吞 /api 404 | P3 | `http.ts:1002` `app.use('/api', 404 JSON)`（Bug-R2-05） |
| — | m4-polish P3-3 messages 对不存在会话返回 200 | P3 | `chat/routes.ts:68/77` 404 unknown session |
| — | m4-polish P3-4 content-type 错误误报 unknown session | P3 | `chat/routes.ts:43/58/73` 415 `{error:'content-type must be application/json'}` |
| — | m4-polish P3-5 断流后悬空用户消息 | P3 | `chat/routes.ts:159` 落库占位 `（回答未完成：${reason}）` |
| — | m4-polish P3-6 重试废弃片段闪现 | P3 | 服务端先发 `regenerate` 事件再发重试 delta；`ChatView.tsx:233` 清空缓冲（复验确认） |
| — | m4-polish P3-7 PageRank 数值未进 scan 载荷 | P3 | `scan-engine.ts:216` hubs 候选 note 含 `PageRank 0.xxxx; in n / out m` |
| — | v021 issue 04 孤儿桶 DI/入口点假阳性 + nextAction 危险引导 | P2(enh) | `4df2613`（v0.23.0）：`scan-engine.ts:40-41` wiredExcluded 文案、`:75-88` wiredKindOf（@Bean/@FeignClient/@Configuration 成员归 di）；未做 petclinic 动态复跑，机制在位 |
| — | v021 issue 06 hubs getter/setter 占榜 | P2(enh) | `4df2613`：`scan-engine.ts:88-93` isAccessorLike + `:208` hubs 过滤 + `:192-195` 注释引用 issue 06 |
| — | chat-merge spec「JSONL 取证并入 events」 | — | spec 授权"不设验收、实施按最小改动定"；已按最小改动定案：`chat/log.ts` 独立保留随迁 |

### Deduped（已单独建档，不重复立项，只引用，2 项——归线 A）

| 建档文件 | 状态核对（2026-09-08） | 说明 |
|---|---|---|
| `.scratch/copilot-m4-findings/issues/01-orphan-total-instability.md` | open（待线 A 排期） | 孤儿桶 total 跨全新索引漂移（184→154），确定性宣称问题。与 v023 wired 过滤（有意的构成变化）是两回事，勿混淆 |
| `.scratch/copilot-m4-findings/issues/02-file-count-semantics.md` | open；本轮代码核实仍未修：`repoqa-mcp.ts:121/146` list_repos 与 dashboard 的 description 均无口径说明、无 `indexedFiles` 字段 | 文件数口径 1228 vs 1094；m4-polish P3-8 与此同源，统一引用本件，勿重复立项 |

### Wontfix / 排除（3 项——已有定案，防重复提出）

| 项 | 定案依据 |
|---|---|
| 错别字回显（「扫揫」） | m4-polish 定案 by design：用户输入原样回显是聊天产品惯例 |
| Git Bash curl 中文 GBK 乱码 | 终验已排除：测试装置问题，非产品缺陷 |
| emoji 持久化为 `??????` | 同上，UTF-8 复测持久化正常 |

## 统计

| 状态 | 数量 |
|---|---|
| open（立项，issue 文件在 `issues/`） | 6 |
| closed（验证后关闭） | 15 |
| deduped（引用既有建档） | 2 |
| wontfix / 排除 | 3 |

## 建议执行顺序（top 3）

1. **CM-04 卡片化 v2（P2）**——DEPRECATE 拆除场景是本产品"防误删"核心卖点的决策链末端，且核实发现连 v1 都未随迁，是 open 项中唯一的功能缺口级体验欠账。
2. **CM-01 裸 SSE 瞬态 DSML（P3）**——最后一个 AI 摩擦类遗留，改动小（drain 丢弃逻辑一处），在真实使用期产生第三方/脚本 SSE 消费者之前收掉，防污染面扩大。
3. **CM-03 会话标题（P3）**——真实使用攒反馈期用户最先撞上的感知项（多会话全叫「会话 09-08 xx:xx」），0.5h 级成本、无 LLM 开销的方案已给全。

CM-02（dist 门禁）建议不占独立批次，绑在下次发布流程顺手落地；CM-06（GUI 走查）适合在首批真实用户进来之前补课，其产出直接喂给增量 triage。
