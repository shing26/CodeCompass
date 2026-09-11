# v0.27-UI Spec：对话补课 + 全局对话条

> 2026-09-12 用户反馈立项（「web 很工程化/极客，copilot 融入没用处，连个完整对话框都没有」）→ plan mode 探查实证后批准。归属 v0.27 线（feature 非 patch，不单独发 0.26.1）。方向决策按推荐默认执行（用户未答 AskUserQuestion，先例 [[v06-closeout-defaults]]）：全局常驻对话条 + ①②同轮，③去极客化进台账。

## 诊断（探查实证）

1. **ChatView 骨架 CSS 历史上从未存在**：`chat-view/chat-side/chat-main/chat-msgs/chat-composer/chat-send/chat-cite/chat-empty/chat-head/chat-back/chat-error/msg-body` 等类名自 chat-merge（aa048f5）起只写在 TSX；全仓 CSS、git 历史（`git log -S`）、已构建 dist 均零定义。v0.26-A 接线的 styles.css 只含 plan 卡/starter 卡/scenario 段。当前渲染=裸 HTML 纵向堆叠 + 浏览器默认小 textarea——用户「连个完整对话框都没有」是事实。
2. **对话入口孤岛**：进 chat 唯一可见路径=TopBar 第 3 枚 tab；默认首屏（topo+自动 trace）与全部浏览动线零对话入口；Dashboard「查调用链」（testid open-chat）跳 topo（V27-5 在册）。
3. **视觉语言分裂**：styles.css 硬编码 `rgba(79,156,249)` 蓝与 clean accent `37 99 235` / cyber accent `34 211 238` 均不吻合（index.css:20,54 vs styles.css:5,16,19）。

## 裁决

| # | 决策 |
|---|------|
| U1 | ChatView 用 **Tailwind 语义类**补全（与主应用同一 token 语言、主题自动跟随），不往 styles.css 加 chat 段；styles.css 存量段（plan/starter/scenario）本轮只把硬编码蓝对齐 token，不迁移。 |
| U2 | **data-testid 与用户可见文案零变化**——ChatView.test 12 例、App.test chat-merge 例、copy-guard、票 15 实名哨全部不动。 |
| U3 | 对话入口=**全局常驻 AskDock**（主区下沿输入条），不推翻六 tab IA、不改首屏为 chat。prefill 草稿不自动发送（发送权留给用户，consent 门链路不变）。 |
| U4 | 「查调用链」文案本轮**不再改**（A01 刚正名，防第三次改名翻车）；AskDock 落地后 V27-5 的入口缺失前提消除，登记票 Comments。 |
| U5 | 视觉去极客化（字号降密 104 处任意值、中英混排、黑话残留、徽章族）=独立战役，登记 v0.27 台账，需单独 spec/grill。 |

## 布局规格（UI-1）

- `chat-side` 280px：品牌行 + 「+ 新会话」+ 会话列表（active 高亮 `bg-accent/10 text-accent`）+ 模型设置 details；375px 收 off-canvas（☰ 切换，模式对齐 App 全局 Sidebar 抽屉）。
- `chat-msgs`：滚动区，消息列 `mx-auto max-w-3xl`；assistant 左气泡 `bg-surface border border-line rounded-lg`、user 右气泡 `bg-accent/10 rounded-lg`；cite 角标=圆形 `text-[10px]` accent 徽标，展开 detail 卡（tool/args/ms + 「在拓扑中查看 →」）。
- `chat-composer`：`sticky bottom-0` + 背景遮罩（`bg-canvas/95 backdrop-blur`）；textarea 自适应 1~4 行；发送钮 accent 实心；Enter/Shift+Enter/placeholder/「思考中…」行为不变。
- `chat-error` danger 色条；`chat-empty` 引导句 + starter 卡列（卡样式已在 styles.css，仅对齐色）。

## 验收门

- [ ] ChatView/App 既有测试**零修改**通过（testid/文案不动的机械证明）。
- [ ] 新结构断言：composer sticky 类、user/assistant 气泡角色类、375 侧栏折叠态（UI-1）；AskDock 提交→view=chat+草稿预填、chat 视图/Inspector 打开时隐藏（UI-2）。
- [ ] 生产构建 Playwright 实拍两视口（复用 a04-shots rig 模式）：chat 界面成型、AskDock 不遮挡关键控件——截图交 maintainer。
- [ ] web 全量绿（基线 320 起）；控制面/e2e 零触碰；copy-guard 绿（新文案零黑名单词）。
- [ ] 每票 Reviewer-Security；ticket 粒度提交推送。

## 明确不做

首屏改 chat、六 tab 增删、主题重设计、黑话/字号/徽章清扫（U5 台账）、「查调用链」再改名（U4）、styles.css 全量迁移。
