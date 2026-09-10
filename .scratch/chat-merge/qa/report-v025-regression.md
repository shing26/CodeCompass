# CodeCompass Workbench v0.25.0 收口定点回归报告（工程结构批）

- 日期：2026-09-10 · 实例：http://127.0.0.1:43110（静态 UI 服务端托管，LLM remote 模式）
- 画像：第一次拿到工具的架构师（Naive）+ 手滑不断的小白/破坏者（Chaos），核心动线各走一遍
- 执行方式：真实 Chromium 无头浏览器（本机 chromium-1243，playwright-core 1.63 驱动；ZCode 托管浏览器在子代理中被平台禁用，已如实替换为同内核无头实例，CDP 控制台/网络全量监听）。**按任务约束，未点击「浏览文件夹」按钮、未向远程 LLM 发出任何一条消息（`**/messages` 路由级拦截，拦截计数=0 即证据）。**
- 证据：截图与 DOM 快照存于 `C:/Users/Shing/.cc-qa-harness/shots/`（本次评审模型不支持图片输入，文中"截图描述"均基于可复核的 DOM/几何/网络事实，截图文件供人眼复核）。

## 1. 结论

> **【复核 2026-09-10 13:16】QA-01 修复已交付并实测通过（Win32 渲染/非 Win 隐藏/零误点零出网），唯一 P0 阻断解除——本结论修订为 GO · 8/10。明细见 §6。以下原文为复核前记录，保留存档。**

**NO-GO · 6/10**

- 两批纯重构（批次 2 路由拆分、批次 3 Context 分片）的"行为零变化"主张：**成立**（静态集合比对 + 25+ 端点活流量零异常 + 六视图动线全通）。
- 此前轮次行为抽查（首屏自动 trace、tab 新名、chat 四导览卡、consent 门、移动端抽屉/遮罩）：**基本零回归**，仅 1 项存量缺陷被抽查命中（非本轮引入，见 QA-02）。
- **本轮唯一功能增量（批次 1 原生目录选择器）在交付构建中完全不可用**：「📁 浏览文件夹…」按钮在 Windows 运行实例中不渲染，属 P0 验收阻断。根因是一行 prop 透传缺失，修复成本极低——修复+一条集成测试即可转 GO。

评分依据：核心体验质量高（主路径 0 崩溃、0 控制台报错、状态机大体自洽），但"重构零变化 + 一个功能增量"的交付中增量本体为死代码，验收第 3 条不成立，另携 1 个 P1 存量交互断裂与 2 个 P2。

## 2. 走查全轨迹（Transcript）

### S0 首屏（1440×900，Naive）
打开 `/`。顶栏出现 `repo-select`（"Select a repo"）、**「Import repo」**（非「+」）、Watcher: Standby、`远程模型 · api.***.com`、Cyber 主题、六个 tab：`代码拓扑/架构仪表盘/架构问答/变更审计/Diff 影响面/规范演进`——**tab 新名零回归达成**。中央为"三步开始代码架构分析"引导。API：GET /api/runtime、/api/repos 均 200；console 零输出。截图 `s0-landing.png`。
⚠ 引导文案自述"顶部「+」按钮""「架构指标」""「智能体对话」"——与真实控件（"Import repo"）与新 tab 名（架构仪表盘/架构问答）不一致（QA-06）。

### S1 导入弹窗（验收点 3）
点「Import repo」→ `[data-testid="import-dialog"]`（role=dialog, aria-modal=true）出现。DOM 探针结果：
- `[data-testid="import-browse"]`：**不存在（null）**。同页 `navigator.platform="Win32"`、`/Win/i.test(...)=true` → 门控 `onPickFolder && isWindowsHost` 中 `onPickFolder=undefined`（QA-01，P0）。
- 弹窗其余正常：名称/路径输入、"本地路径/GitHub 仓库" tablist、路径防抖 350ms 触发 POST /api/repos/preview 200（"将索引 888 个文件，跳过 12 个目录"）、Cancel/✕/Esc/遮罩点击均正确关闭。**按任务约束未点击浏览按钮**（其渲染缺失使其天然不可点）。
- 15s 降级逻辑仅存于源码（ImportRepoModal.tsx:312-318 `Promise.race` + "目录选择超时（对话框可能被遮挡），请手动填写完整路径。"），**运行实例中不可达**，按任务要求记录；非 Windows 隐藏逻辑同样只在源码层（isWindowsHost 门），无真机 macOS/Linux 环境未实测。
- 375px 重开弹窗（S7）：宽 375=视口宽、无横向溢出、提交键可见——移动端弹窗适配 OK（截图 `s7-mobile-dialog.png`）。

### S2 repo-878b3614 核心动线（架构师画像）
`selectOption [data-testid=repo-select] → repo-878b3614`。6 秒内网络：workbench-cards→symbols→tours→dashboard→**GET query?mode=call-chain&startName=GET /api/repos/:id/query&startFile=routes/analysis.ts → 200**。**首屏自动出图零回归达成**：画布出现"焦点 GET /api/repos/:id/query · 2 波及 · API 48/SQL 0"、2 张 flow-card（CALLER→CALLEE=handleQuery）、trace-strip Step 1/3、`selected-node` 与检查器同时就绪（`s2-topo-auto.png`）。
点 flow-card → 检查器打开：面包屑 `CodeCompass › services/control-plane/src/routes/analysis.ts › GET /api/repos/:id/query`、monaco 代码滚动至 L372、token 预算 86/6000、slices+reverse-deps 面板在场（`s2-inspector.png`）；GET file/raw、reverse-deps、subgraph-context 全 200。
切 tab：
- **架构问答**：初始屏**恰 4 张导览卡**（全库架构透视/高危大文件与孤岛/核心业务调用链路/变更风险评估，副标题齐全，`chat-starter-card`×4）✓（`s2-chat-cards.png`）。
- **Diff 影响面**：三步引导 + Base/Head/运行差异分析在场 ✓（`s2-diff.png`）。
- **规范演进**：空态引导（"工件流未开始"、意图输入示例针对当前仓库 `给App/record加 Excel 导出`）✓（`s2-evolution.png`）。
- **架构仪表盘**：dashboard 200、渲染正常（`s2-dash.png`）。
首轮我以 `**/api/chat/**` 全量拦截验证 consent，误伤了 `POST /api/chat/sessions`（建会话发生在网关之前）→ 出现 chat-error "Failed to fetch"。这顺带证明了**乐观失败面**：占位消息被撤回、草稿保留、无脏状态。

### S2b consent 重验（仅拦 `**/messages**`）
点导览卡 1 → `consent-modal` 出现：**"远程模型隐私确认——本次分析将向 api.***.com 发送脱敏后的关联代码切片。该选择只在当前页面会话内生效，不会写入本地存储。[取消][允许本次会话]"** ✓。点「取消」→ 弹窗关闭、`chat-question` 草稿精确恢复为卡片 prompt、消息区回到导览初始屏、**`/messages` 拦截计数 = 0**（授权前零内容出网）。consent 门验收达成（`s2b-consent.png`）。
同轮捕获 **pageerror ×3：`TypeError: Cannot read properties of undefined (reading 'toUrl')`**，堆栈指向 `assets/editor.worker-*.js → lt.toUri → lt.asBrowserUri`，步骤标记精确落在 **open-inspector**（QA-03，P2）。

### S3 移动端 375×812（小白画像）
选库→等待自动 trace：sidebar 位于 left:-280、inspector 位于 left:375（**均在屏外、不遮挡画布**）、canvas 满宽、**body 横向溢出=0**。
- 抽屉 1：aria-label="Open sidebar"（☰）点击 → sidebar 滑到 left:0 + `sidebar-mask`（fixed inset-0 z-30）出现；点遮罩 → 精确回缩 -280。**打开/遮罩关闭 ✓**。
- 抽屉 2：点 flow-card → inspector 滑入（w=319=85vw）+ `inspector-mask`；点遮罩 → 回缩 375。**打开/遮罩关闭 ✓**（截图 `s3-sidebar-open.png`/`s3-inspector-open.png`）。
- **手滑陷阱（QA-02，P1 存量）**：遮罩关闭检查器后，再点**同一条链路的两张卡（均为 analysis.ts）均无法再次打开抽屉**（A-click=false、B-click=false）。复现 2 次。桌面端同一状态机无此症状（drawer class 惰性）。
- 本轮 inspector 每次挂载仍触发 toUrl pageerror（计数 4，同 QA-03）。

### S4 深链与历史（破坏者画像）
- `/?mode=diff`（无 repo）直达 + F5：tab 高亮"Diff 影响面"正确，但主区渲染的是"三步开始"引导画布（`architecture-delta` 不存在）——**tab 高亮与内容错位**（可接受兜底、有困惑成本，QA-07a；`s4-t1-diff-norepo.png`）。
- `/?mode=chat`：契约别名冷加载生效 → 高亮"架构问答"、无 repo 时同样落引导兜底；随后 `history.replaceState` 把 URL 静默改写为 `?mode=incident`（QA-07b）。
- `/?repo=<R878>&mode=chat`：repo 与视图双恢复 ✓，导览卡可点、consent 正常弹出（再次确认）。
- 历史流：`/` → 选库（pushState `?repo=`）→ 点 Diff → **goBack()**：URL 变回 `/`，但 UI 仍保持 CodeCompass+Diff 高亮（popstate 处理器要求 `id && id !== currentRepo?.id`，空 id 分支 no-op）——**URL 与状态失同步**，此时复制/刷新 URL 会丢失选库（QA-04，P2）。goForward 回到带参条目则一致（因状态从未离开）。
- `?repo=repo-doesnotexist` / `?mode=bogus`：温和回退到无库拓扑引导，无崩溃、console 零报错。全程 console 零输出。

### S5 空仓库 fixture（repo-83797372, idle）
选库后：watcher 徽标 "Standby"；拓扑画布优雅降级（"焦点 fixture · 0 波及 · API 0/SQL 0"，无虚假出图、无报错）；架构仪表盘显示全零规模（0 Routes/0 Services…2 Files）；变更审计给出预置命令（含基线 0 Routes）；规范演进/Diff 显示三步引导——**六视图零崩溃、API 全 200、console 零输出**。
- 破坏性补充（S6）：idle 库 Diff 的 Base/Head 下拉**为空但「运行差异分析」不禁用**，点击 → POST 400 → UI 弹 `[data-testid="delta-error-detail"]`，展示"原始 git 输出"级技术细节（对小白晦涩，QA-05）。
- 注意：idle 库 chat 导览卡照常可点、可建会话（消息流最终会吃 SSE `repoqa.query.error: Repo is not ready (idle)`——本次未实测发送，避免出网+超范围）。

## 3. 缺陷与体验问题清单

### QA-01 [P0-阻断][功能缺陷] 批次 1 原生目录选择器在全部平台不可达（「📁 浏览文件夹…」不渲染）——**复核 2026-09-10 13:16 已 CLOSED，见 §6**
- 环境：Windows 10 ×64，服务端托管构建 `index-D6Ay8Xtg.js`（与 `apps/repoqa-web/dist` sha1 一致：`5ae62682…`，构建时间 12:24 晚于全部源码修改）。
- 复现：① 打开 `/`；② 点 `[aria-label="Import repo"]`；③ 探针 `document.querySelector('[data-testid="import-browse"]')` → `null`（同页 `navigator.platform="Win32"`）。
- Actual vs Expected：验收要求 Windows 下按钮存在且绑定 GET /api/dialog/folder；Actual=按钮为死代码（bundle 内含 `a&&h&&button(import-browse)` 与 `onPickFolder:()=>n.chat.pickFolder()` 调用点，但 TopBar 未把 prop 传给 ImportRepoModal → `a===undefined` 恒 false）；连带 15s 超时降级/非 Windows 降级文案全部不可达。
- 根因：`apps/repoqa-web/src/components/TopBar.tsx` L362-371 `<ImportRepoModal …>` 未透传 `onPickFolder`（props 类型 L39 已声明，`App.tsx` L145 已传入 TopBar）；commit cff344d 即存在（**批次 1 自带缺陷**，非批次 3 回归）。测试盲区：`ImportRepoModal.test.tsx` 直接挂 Modal 且不传 `onPickFolder`，TopBar 组合层零覆盖。
- 修复 Prompt（Fullstack-Dev）：在 `TopBar.tsx` 的组件形参解构中加入 `onPickFolder` 并在 `<ImportRepoModal>` 处透传 `onPickFolder={onPickFolder}`。验收标准：(a) 新增 TopBar 集成测试（mock `navigator.platform='Win32'`，渲染 TopBar→点 import→断言 `[data-testid="import-browse"]` 可见且 click 触发 `client.chat.pickFolder()`/GET `/api/dialog/folder`）；(b) 非 Win mock 断言按钮不存在；(c) 真实实例复跑本探针：`!!document.querySelector('[data-testid="import-browse"]') === true`。

### QA-02 [P1-严重][状态同步/交互反馈] 移动端检查器抽屉关闭后，点击同文件节点永久无法再开（存量，非 v0.25 引入）
- 复现：① 375px 选 repo-878b3614；② 点 flow-card → 抽屉开；③ 点 `inspector-mask` 关闭；④ 再点任意 flow-card（两条均属 analysis.ts）→ 抽屉不再打开（两次实测 false）。
- 根因：`context/InspectorContext.tsx` L49-51 `useEffect(() => { if (inspector.file) setInspectorOpen(true) }, [inspector.file])` 仅在文件字符串变化时揭示；HEAD 版 App.tsx L210-213 同码 → 批次 3"行为零变化"成立（连缺陷一起保持）。
- 修复 Prompt：节点点击处显式 `setInspectorOpen(true)`（Canvas flow-card onClick 经 props 注入），或将揭示键改为 `{file,line,symbol,seq}` 复合；验收：遮罩关闭→复点同卡→抽屉重现（e2e 断言 bounding.left<200），桌面端行为不变。

### QA-03 [P2-一般][性能与控制台] Monaco `editor.worker` 每次打开检查器抛 3 条未捕获 `TypeError: … 'toUrl'`
- 复现：桌面/移动任一途径开检查器（挂载 monaco）→ DevTools 出现 3× pageerror，栈：`assets/editor.worker-*.js → lt.toUri → lt.asBrowserUri`；页面表面不崩（代码视图正常渲染）——典型"静默失败"。
- 归因：`client/monacoSetup.ts`（`monaco-editor@0.52` + `?worker` 打包）worker 侧 URI 解析异常，与业务代码无关但随 Inspector 每次挂载复发。
- 修复 Prompt（AI-Architect 先投研再实施）：升级 `monaco-editor` 至 0.52.x 最新 patch 或 0.53+ 回归验证；或 `MonacoEnvironment.getWorker(_, label)` 按 label 工厂化。验收：连续开关检查器 ×3，console `pageerror` 计数 = 0。

### QA-04 [P2-一般][状态持久化] 浏览器后退：URL 回到 `/` 但 UI 保留已选 repo 与 tab（URL 不再可信）
- 复现：`/` → 选库（push `?repo=R878`）→ 点"Diff 影响面" → goBack → `location.search=""` 而 repo-select 仍=R878、tab 仍高亮 Diff；此状态 F5/复制 URL 即丢上下文（popstate 处理器 `id` 为空/no-op）。
- 修复 Prompt：`RepoContext.tsx` onPopState 补空分支——`!id → selectRepo(null)` 或反向 `replaceState` 把当前真实状态写回 URL（二选一并写进 ADR）；验收：上述四步后 URL 与 select/高亮三者一致。

### QA-05 [P2-一般][功能缺陷/交互反馈] 未就绪（idle）仓库仍允许点击「运行差异分析」，错误面为"原始 git 输出"
- 复现：选 repo-83797372 → Diff 影响面 → base/head 下拉均空 → `[data-testid="delta-run"] disabled=false` → 点击 → POST 400（console 1 条资源错误）→ `[data-testid="delta-error-detail"]` 显示"原始 git 输出"面向工程师而非用户。
- 修复 Prompt：`repo.status!=='ready' || (!baseRef && !headRef)` 时禁用 delta-run 并给 tooltip"该仓库尚未索引完成/无可用 ref，请先在更多操作里重建索引"；错误文案首行改为人话（"该仓库不是有效的 Git 仓库或 ref 不存在"），原始输出折叠。验收：idle 库下按钮 disabled 或错误首行不含 git 术语。

### QA-06 [P3-体验优化][晦涩] 首屏引导与提交说明滞后于本轮改名/契约
- 引导（ScenarioGuide/onboarding 文案）仍说"顶部「+」按钮""「架构指标」""「智能体对话」"，真实 UI 为"Import repo"（桌面）与"架构仪表盘/架构问答"；小白照文案在桌面端找不到「+」（仅 <640px 才有）。
- 批次 1 commit cff344d 标题写"POST /api/dialog/folder"，实现与客户端为 **GET**；"41 路由/1030 行"实测 **37 路由/1043 行**（另 8 条 chat 路由在批次 2 范围外、原样保留）。
- 修复 Prompt：三处文案改 tab 新名 + "顶部「Import repo」按钮（窄屏为「+」）"；spec/HANDOFF 修正路由计数与动词。验收：引导内不出现「架构指标」「智能体对话」字样。

### QA-07 [P3-体验优化][晦涩] 深链别名静默改写与"无 repo 的 mode 深链"内容错位
- `?mode=chat` 被接受（冷加载+popstate 双端映射）但视图写入 URL 时归一为 `?mode=incident`（用户分享/收藏的 `mode=chat` 会被悄悄换名）；`?mode=diff`/`?mode=chat` 在无 repo 时高亮对应 tab 却渲染拓扑引导内容。
- 修复 Prompt：mode→view 为纯只读入口可保留，但 replaceState 归一化前在文档标注 `incident|chat` 双别名；无 repo 时 tab 高亮回退 topo 或渲染带"先选仓库"提示的占位（当前引导已含该信息，仅高亮错位）。

## 4. 零回归抽查表（验收主张 ↔ 实测）

| # | 主张/既有行为 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | 批次 2：1030 行 41 路由按域拆分，行为零变化 | ✅ 通过（口径 41→37 有小出入） | HEAD http.ts 37 条注册路径与 `routes/{workbench,repos,analysis}.ts` 集合 diff=0；chat/routes.ts 8 条原样；活流量 25+ 端点全部符合语义状态码；S2-S5 全程 console 干净 |
| 2 | 批次 3：App.tsx→{Repo,Inspector,ChatRuntime} 三 Provider，行为零变化 | ✅ 通过（含缺陷保真） | App 315+628 行结构就位；自动 trace、consent 门、抽屉、拷贝脱敏、深链恢复全通；QA-02 缺陷与 HEAD 逐行一致，反证"零变化"为真 |
| 3 | 批次 1：Windows 浏览按钮 + GET /api/dialog/folder + 15s 降级 + 非 Win 隐藏 | ❌ 不成立（原文）→ **✅ 复核 13:16 成立（§6）** | 复核前：运行实例 `import-browse=null`（Win32）；复核后：Win32 渲染+文案逐字匹配、Linux 伪装隐藏、零误点（QA-01→CLOSED）。15s 降级分支仍仅源码/单测层可达（按约不点按钮），OS 对话框真交互未测 |
| 4 | 拓扑首屏自动 trace 出图 | ✅ | 选库 6s 内 call-chain GET 自动发出并出图（桌面+375px 双验，Step 1/3 步进条在） |
| 5 | 移动端 ≤375px 侧栏/检查器遮罩抽屉 | ✅（打开/遮罩关/无横向溢出）；⚠ 复开断裂=存量 QA-02 | 几何 left:-280/375→0→-280/375 往返；overflowX=0 |
| 6 | chat 初始屏四张导览卡 | ✅ | `chat-starter-card`×4，标题副标题与 STARTER_CARDS 一致（idle 库同样渲染，见 QA-05 注） |
| 7 | consent 弹窗（remote） | ✅ | 文案含"脱敏""仅当前会话不写存储"；取消→草稿还原、`/messages` 零请求 |
| 8 | tab 新名六枚 | ✅ | aria-pressed 高亮与深链恢复（?mode=diff/incident）双验 |
| 9 | 空仓库（idle）各视图 | ✅ 无崩溃/无 console 错误 | 六视图 + S6 破坏点击均优雅；仅 delta 禁用/文案两级摩擦（QA-05） |
| 10 | 控制台与静默失败 | ⚠ 主路径 0；唯一复发项=Monaco worker | QA-03 归因 vendor 栈；非重构引入 |

**未覆盖及原因**：`/api/dialog/folder` 与系统对话框真点击（任务明令禁止）；非 Windows 真机隐藏行为（无环境）；LLM 真实回答/流式中断/Abort 压测（remote 出网成本与任务红线）；tasks/workspaces/harnesses/export/onboarding/feedback/anchor-click/evolve-run 端点与 WS 热更新、命令面板、主题切换、超长输入与 Prompt 注入（超出本次收口范围，建议下轮批扫）。

## 5. 证据索引
`s0-landing/s1-dialog-local/s2-topo-auto/s2-inspector/s2-chat-cards/s2b-consent/s2-diff/s2-evolution/s3-initial/s3-sidebar-open/s3-inspector-open/s4-t1-diff-norepo/s5-idle-topo/s6-idle-delta-run/s7-mobile-dialog` + 同名 `.json` 快照，均位于 `C:/Users/Shing/.cc-qa-harness/shots/`；驱动脚本 `C:/Users/Shing/.cc-qa-harness/s{0,1,2,2b,3,3b,4,5,6,7,8}*.mjs` 可一键复跑（复核证据：`s8_qa01_recheck.mjs`、`s8-win32-browse-button.png`、`s8-linux-no-browse.png`）。

## 6. QA-01 定点复核（复核 2026-09-10 13:16）——QA-01 CLOSED

**修复主张**：TopBar 解构 `onPickFolder`（`TopBar.tsx:101`）并透传 `<ImportRepoModal onPickFolder={onPickFolder}>`（`:371`）；门控 `onPickFolder && isWindowsHost`；新增 2 条 TopBar 集成测试；web 272/272、CP 580/580、e2e 55/55 全绿；服务实例 dist 已重建。

**静态确认**：
- 交付 bundle 已换代：`index-RPMZfMWD.js`（sha1 前缀 `1920c052`，≠ 复核前 `5ae62682` 的 `index-D6Ay8Xtg.js`）——排除"修了源码没重建"假阳性。
- `TopBar.test.tsx:65`『forwards onPickFolder to the modal so the browse button renders on Windows (QA-01)』与 `:87`『renders no browse button when onPickFolder is not provided』两条新测试在案。

**真实浏览器活测**（同一 Chromium 内核，两上下文）：
- **A｜Win32（原生）**：开导入弹窗 → `[data-testid="import-browse"]` present=true、visible=true、`type="button"`、disabled=false，文案逐字符匹配 **「📁 浏览文件夹…（调用系统对话框自动填入路径）」**；名称/路径输入与弹窗骨架无恙；Esc 正常关闭；console 零输出。截图 `s8-win32-browse-button.png`。
- **B｜伪装非 Win（navigator.platform='Linux x86_64' + X11 Linux UA，双路径皆不匹配 /Win/i）**：import-browse present=false，弹窗退为纯手输模式（name/path 输入完好）——「非 Windows 隐藏按钮」门控成立。截图 `s8-linux-no-browse.png`。
- **红线遵守**：全程未点击按钮；两上下文网络监听 `**/api/dialog/**` 命中数均为 **0**。

**残留口径（如实标注，不阻断）**：OS 系统对话框真交互与 15s 超时降级仍按约定不可线上触达，仅由源码逻辑+新增单测覆盖；建议发布说明将 15s 降级从"运行时行为"降格为"防御性代码路径（单测保证）"表述，或安排一次人工桌面手测销项。

**修订后结论**：本轮验收四主张——批次 2 零变化 ✅、批次 3 零变化 ✅、批次 1 功能增量 ✅（修复后）、既往行为抽查 ✅（除 QA-02 存量 P1，非本轮引入）。**GO · 8/10**（扣分项：QA-02 P1 存量交互断裂、QA-03/04/05 P2、QA-06/07 P3；QA-01 闭环后不再压分）。QA-02~07 状态不变，建议进下轮 triage。
