# 01：UI-1 — ChatView 补全（Tailwind 对话界面 + 375 折叠）

> *2026-09-12 v0.27-UI 立项（用户反馈「连个完整对话框都没有」——探查实证：骨架 CSS 从未存在）。Parent spec: `.scratch/v027-ui/spec.md`（裁决 U1/U2/U5）。*

Status: closed
标签：feature / P1 / 来源：v0.27-UI（用户直接反馈）

## Agent Brief

**Category:** feature（纯前端样式层重写 + 窄屏折叠态）

**用户场景：** 用户点开「架构问答」tab，看到的是一列裸 HTML——没有气泡、没有输入框形状、composer 是浏览器默认小框，完全不像聊天产品，坐实「copilot 融入没用处」。修复后：ChatView 是完整对话界面——左会话侧栏（375px 收 off-canvas）、居中消息流（assistant 左/user 右气泡）、cite 圆形角标可展开溯源、底部 sticky composer 自适应 1~4 行；主题（clean/cyber）自动跟随。

**Summary:** ChatView.tsx 的 className 层用 Tailwind 语义 token 重写；**data-testid 与用户可见文案零变化**（U2 铁律）；styles.css 把 plan/starter/scenario 段硬编码 `rgba(79,156,249)` 对齐 accent token。

**Key interfaces:**
- 布局规格逐条见 spec「布局规格（UI-1）」段
- 375px 侧栏折叠：☰ 按钮 + off-canvas + 遮罩，模式对齐 App 全局 Sidebar 抽屉（App.tsx:176-182 先例）
- 消息滚动：新消息到达滚到底（既有 listRef 行为保持）
- 不新增依赖、不新增 CSS 文件；styles.css 只改色值

**Acceptance criteria:**
- [x] ChatView.test 既有例 + App.test chat-merge 例**零修改**通过（票面「既有 12 例」系计数笔误，实为 5 例——review 勘正；App.test 36 例全绿）
- [x] 新结构断言 ≥3 例：composer `sticky` 类、user/assistant 气泡角色类、375 折叠态（☰ 切换 chat-side 显隐 + backdrop 开合）
- [x] copy-guard 绿（文案未动）；styles.css 无 `79,156,249` 残留（三处全改 `rgb(var(--color-accent)/α)`）
- [x] 生产构建 Playwright 两视口实拍 chat 界面成型（`.scratch/v027-ui/qa/` 3 图 + DOM 布局断言：1280 composer bottom=776=800−24footer、side 280px；375 side x=−280 全收起、toggle 可见、composer bottom=788）
- [x] web 全量绿（323 = 320+3）

**Out of scope:** AskDock（UI-2）、去极客化战役（U5）、styles.css plan/scenario 段迁移 Tailwind。

**Blocked by:** None。

**触碰面声明：** apps/repoqa-web（ChatView.tsx / styles.css / ChatView.test.tsx）。零后端、零 App.tsx（与 UI-2 串行）。

## Comments

### 实施记录（2026-09-12，ZCode）

- ChatView.tsx className 层 Tailwind 重写（骨架类名保留作钩子）：侧栏 280px 会话列表（active `bg-accent/10 text-accent`）、消息列 `mx-auto max-w-3xl` 居中（assistant 左 `bg-surface border-line` / user 右 `bg-accent/10` 气泡）、cite 圆形角标 + detail 卡、composer `sticky bottom-0 bg-canvas/95 backdrop-blur` + textarea rows=1 自适应 1~4 行（128px 封顶）、markdown 元素 arbitrary variants、ModelSelect/错误条/重生成横幅全上样式。375px 侧栏 off-canvas（☰ + backdrop，模式对齐全局 Sidebar 抽屉）。
- styles.css 三处硬编码蓝 `rgba(79,156,249,α)` → `rgb(var(--color-accent)/α)`（与 index.css 先例同语法，两主题自动跟随）。
- U2 铁律机械 diff 复核：既有 11 枚 testid 零删改（新增 2 枚属票面强制新节点）；文案 REMOVED 集为空，ADDED 仅 `☰`（票面授权）+ aria-label「切换会话列表」（a11y 义务非文案改动）。

### Reviewer-Security 独立审查（Request changes → 全修）

- **[P1-1] textarea 高度残留**：命令式 style 放 onChange，React 重渲染不重置——发送清空后留最高 128px 空框，「自适应 1~4 行」在最高频路径自毁。修：高度计算挪 `useEffect([input])` + taRef，统一覆盖清空/草稿恢复/程序化赋值三路径。
- **[P1-2] 消息列缺 spec 明文 `mx-auto max-w-3xl`**：宽屏三套宽度语言并存（气泡 ~850px vs composer/空态 768px），正是用户投诉「不像聊天产品」的残余形态。修：chat-msgs 内加居中列。
- **[P2 已修]** `[&_code]` 误伤 `pre>code`（大 chip 套小 chip）→ `[&_:not(pre)>code]`；chat-side 漏抄 `md:z-auto`（先例 Sidebar.tsx:200 有）；backdrop `bg-black/40` → 主题 token `bg-ink/30`；ModelSelect 提示行裸奔补 `chat-hint` 样式。
- **[P2 留账]** 收起态侧栏未 `inert`（键盘可 Tab 进不可见钮）——全局 Sidebar 先例同病，属继承债，随 U5 战役或 UI-2 处理。
- **判不成立项**：375 折叠盖 TopBar/开态 toggle 被遮罩压住=与全局 Sidebar 抽屉逐像素同构（票面「模式对齐」授权）；拖宽窗口不卡死（md: 覆盖 + backdrop md:hidden）；PlanCardView 撑爆不成立；测试类名断言=票面明文授权的有意 tripwire 非脆弱耦合；rgb() 空格+斜杠 alpha 语法 Chrome 65+ 无忧。
- **票面勘正**：「既有 12 例」实为 5 例（HEAD 计数）。

### 修后复验

web **323/323**、tsc 净、vite build 过；实拍脚本失败收集非零出口（A04 P1-1 教训沿用）。
