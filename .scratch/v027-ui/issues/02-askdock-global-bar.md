# 02：UI-2 — AskDock 全局常驻对话条

> *2026-09-12 v0.27-UI 立项。Parent spec: `.scratch/v027-ui/spec.md`（裁决 U3/U4）。方向=推荐默认（用户未答方向题，先例 v0.6 收口默认决策）。*

Status: ready-for-agent
标签：feature / P1 / 来源：v0.27-UI（用户直接反馈）

## Agent Brief

**Category:** feature（新组件 + App 装配）

**用户场景：** 用户在拓扑/仪表盘/审计/演进任一视图里被工程细节卡住想问一句，得先切 tab、找入口、进 chat——路径断在「对话是另一个房间」。修复后：主区下沿常驻一条「问点什么…（架构问答）」输入条，任何视图敲问题回车即展开全屏对话且问题已预填在 composer（发送权留给用户，consent 门链路不变）；对话视图自身与 Inspector 抽屉打开时 dock 隐藏不抢位。

**Summary:** 新组件 AskDock.tsx；App.tsx 装配（仅 currentRepo 存在时渲染）；不新增 Provider，复用 RepoContext/ChatRuntimeContext 既有面。

**Key interfaces:**
- 提交动作：`setView('chat')` + 草稿预填（ChatView 需暴露受控草稿通道：App 层 state 或 context 字段 `pendingDraft`，实施时选低侵入方案，UI-1 合入后 ChatView 结构已稳定）
- 隐藏条件：`view === 'chat'` 或 Inspector 抽屉打开（窄屏）时不渲染
- 375px：不遮挡 footer 与主区底部控件（z-index 与 padding-bottom 处理，测试断言类名/DOM 结构）
- 文案：placeholder「问点什么…（架构问答）」——与 ChatView composer 既有 placeholder 同族词，零黑名单

**Acceptance criteria:**
- [ ] 组合测试：任一视图（topo）→ AskDock 输入+Enter → view=chat 且 composer 预填该问题、未自动发送
- [ ] 隐藏断言：chat 视图下 dock 不在 DOM；无库时 dock 不在 DOM
- [ ] 既有 App.test 全部零修改通过（UI-1 合入后基线）
- [ ] Playwright 两视口实拍：dock 成型且不遮挡（截图并入 UI-1 的核对包）
- [ ] web 全量绿；控制面/e2e 零触碰
- [ ] 票 Comments 登记：V27-5「查调用链」入口缺失前提随 AskDock 消除（文案本轮不动，U4）

**Out of scope:** 六 tab IA 变化、首屏改 chat、AskDock 内联回答（不展开全屏）的 lite 模式。

**Blocked by:** 01-chatview-completion（App.tsx/ChatView 草稿通道串行）。

**触碰面声明：** apps/repoqa-web（AskDock.tsx 新建 / App.tsx / ChatView.tsx 草稿通道最小开孔 / 测试）。零后端。
