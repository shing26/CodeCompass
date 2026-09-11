# 02：A02 — 方案摘要卡重塑（Plan Digest + CTA 跳演进）

> *2026-09-10 v0.26 grill 拆票生成。Parent spec: `.scratch/v026-mind-split/spec.md`（裁决 Q3）；glossary 已钉 Plan Digest 词条。*

Status: closed
标签：enhancement / P2 / 来源：v0.26 预留 A

## Agent Brief

**Category:** enhancement（前端组件重塑 + 1 条接线）

**用户场景：** 用户在「架构问答」问"这个仓库哪里最值得改"，答案流里冒出一张带勾选框的「🧹 拆除计划」卡——只读免责声明只有 12 字藏在卡片角落，用户以为系统要开始拆代码，慌了；另一面老用户想顺着方案去演进工作台，也没有路。修复后：该卡以「**方案摘要**」名义出现、头部常驻「引擎只读，改动由你执行」、右下角「在规范演进中展开 →」一键跳进 evolve——问答里的方案输出从尴尬点变成两视图的桥。

**Summary:** PlanCardView 更名 + 底线声明常驻头部 + 新增可选 prop `onOpenEvolution`（CTA），App 组合层接 `goEvolution`；勾选行为语义不变（本地追踪）。

**Key interfaces:**
- PlanCardView：卡名「拆除计划」→「方案摘要」；底线句从内部小字升为头部常驻行；CTA 按钮（无回调时不渲染，保 3 处既有渲染点测试零改动）
- ChatView → PlanCardView 传递链：`planCards` 载荷协议零变化（CM-01 卡片化 v2 资产冻结）
- App.tsx 接线：`onOpenEvolution={goEvolution}`（RepoContext 已有）

**Acceptance criteria:**
- [x] 「拆除计划」在用户可见文案 grep 零命中；「方案摘要」出现
- [x] 底线句常驻头部（非折叠/非角落）断言
- [x] 组合测试：问答答案含 plan 卡 → 点 CTA → view 切到 evolve
- [x] 勾选框本地追踪行为回归通过；done.payload.planCards 契约零变化（无控制面 diff）
- [x] web 全量绿

**Out of scope:** 摘卡/协议裁剪（Q3 已裁）、evolve 侧文案（A03）。

**Blocked by:** None — can start immediately（与 A01/A03 并行；App.tsx 触碰面此票独占）。

**触碰面声明：** apps/repoqa-web（PlanCardView/ChatView/App.tsx + 测试）。零后端。

## Comments

### 实施记录（2026-09-11，ZCode）

- PlanCardView 重塑：卡名「🧹 拆除计划」→「📋 方案摘要」（emoji 随卡名正名同步替换——🧹 扫帚配摘要卡是新的名实不符，全仓 grep 零依赖）；底线句「引擎只读，改动由你执行」升为头部常驻行（`plan-bottomline`，非 `<details>` 断言钉死）；CTA「在规范演进中展开 →」经 ChatView 透传、App 接 `goEvolution`（与 Sidebar 同源引用，零新逻辑）。
- **协议冻结面守住**：`ChatPlanCard`/`planCards`/`onPlan`/`chatSend` 全在 `RepoQAClient.ts`，本票 diff 零 services/、零 client 文件；`entry.planCards?.length` 渲染条件未动。
- 测试：新建 `PlanCardView.test.tsx` 3 例（**此前该组件零覆盖**——含无回调不渲染 CTA、勾选 localStorage key 硬编码观测值防自反、进度徽标）+ App.test 组合 1 例（chat→plan-cards→CTA→evolution-view，走 chatGuardSend 全链）。web **316/316**、typecheck 净、vite build 通过。

### Reviewer-Security 独立审查（放行·有条件 → 条件全清）

- **[P2·b] 底线句/note 冗余**：「改动由你执行」与「执行由人工完成」同命题两式、双分隔线——note 精简为「勾选仅作本地追踪。」，bottomline 去 border-bottom。
- **[P2·额外发现→本票必修] `--accent` 等 8 个 CSS 变量全仓未定义**：styles.css 用 `var(--accent/--border/--panel-2/...)`，但 index.css 只定义 `--color-*` 系——CTA 按钮 `border: 1px solid var(--accent)` 因 IACVT 简写整体失效、真实浏览器渲染成无边框纯文本。已在 index.css 两主题块补 8 个语义别名（`--accent: rgb(var(--color-accent))` 等），一处定义顺带治存量 4 处误用。
- **[实拍发现·超票面] `styles.css` 自 446473d 起从未挂进加载链**（main.tsx 只 import index.css；`git log -S` 证实创建即漏挂）——chat 视图/方案摘要/场景导览样式是死文件，monaco #12 同型隐性退化（jsdom 不评估 CSS 故测试全绿）。本票 CTA 依赖其中 `.plan-card-cta`，接线 `import './styles.css'` 归 A02 交付必要部分；dist CSS 已验证含 plan-card-cta。**chat 视觉首秀由 A04 两视口截图核对验收**（销 A01 移交的「重建 dist」提醒）。
- **判不成立项**：a) 协议冻结面证据级成立；c) CTA 后 URL mode 删除与 TopBar/Sidebar 进 evolve 同构（evolve 本不可深链，F5 落 topo 是既有裁决）；会话数据服务端持久化无丢失，视图态落差对一切 tab 切换早已存在；e) 测试无自反回环、组合例真走全链。
- **勘注**：spec 风险表「3 处渲染点」与地面真相有出入（PlanCardView 挂载 1 处 + ChatView 挂载 2 处），保护机制（可选 prop）与计数无关，不构成缺陷。
