# 🧪 产品体验与缺陷报告 - CodeCompass v0.2.0-beta（Round 2）

- **测试对象**：CodeCompass（Java 代码理解工作台，v0.2.0-beta）
- **测试实例**：隔离实例 `http://127.0.0.1:48732`（独立数据目录 `cc-data-r2`，未触碰用户 5173/43110 服务）
- **测试日期**：2026-08-25
- **测试仓库**：
  - `petclinic`（`repo-f2e62b0f-5598-4618-8a24-436151bbaa93`，130 文件 / 344 符号 / 6 routes / 47 files）
  - `cc-self`（导入 CodeCompass 自身，`repo-e9046f15-93bd-452d-ab73-94df3b498c8e`，routes 19 / services 9 / repositories 11 / methods 423 / files 173 / configKeys 116 / advices 2 / interfaces 4）
  - `我的演示仓库2`（本地导入的小仓库，自定义 Name 透传验证）
- **证据截图**：`ui-shots/`（r2-petclinic-dashboard.png / r2-chat-fixed-answer.png / r2-ccself-dashboard.png / r2-after-back.png）

---

## 1. 体验总览 (Executive Summary)

* **体验角色**：新用户（冷启动直觉）、核心玩家（反复使用、交叉验证）、破坏性测试者（狂点、并发、极端输入、快速返回）
* **健康指数**：🟡 **严重交互受阻** —— 主问答入口（自由提问）失效是核心痛点；其余功能整体可用、无崩溃
* **核心体感**：仪表盘、符号树、Top API 点击链路、Tour、导入/导出均已打磨到位，Round1 的 13 项缺陷 12 项确认修复；但「自由提问」作为产品主入口，**无论问什么内容都固定返回第一个路由+方法**（Round2 新发现 P1），且浏览器返回按钮会直接退出页面到 `about:blank`（P2）。

### 1.1 Round 1 缺陷回归验证（13 项）

| 编号 | 内容 | 结果 |
| :-- | :-- | :-- |
| Bug-01 | camelCase 字段统一（types.ts 无 snake_case 残留、符号树按 47 文件分组、TopBar 路径、route tooltip `路径:行号`） | ✅ 已修复 |
| Bug-02/03 | Top API 点击携带 call-chain + start 正确进入 PetController.java:101→addPet→isNew（无 "Static mock answer" 占位） | ✅ 已修复 |
| Bug-04 | 375px 视口 `scrollWidth=375` 无文档级溢出；open-chat 可点击；sidebar/inspector 为 off-canvas drawer（关闭态 translateX 属设计非 bug） | ✅ 已修复 |
| Bug-05 | 无效路径导入给出具体错误 `importRepo failed: 400: local path is not a directory: ...` | ✅ 已修复 |
| Bug-06 | 冷启动跨文件首次点击 route 无 glow 高亮 | ❌ **残留**（见 Bug-R2-03） |
| Bug-07 | 0 步 error-handling tour 前端已过滤（API 仍返回 3 条：auth-chain 1 步 / main-flow 3 步 / error-handling 0 步；UI 只显示 2 条） | ✅ 已修复（建议后端同步过滤，见 Vibe） |
| Bug-08 | F5 刷新后 repo 选择保持 | ⚠️ 部分修复（见 Bug-R2-02：刷新 OK，浏览器 back 却失效） |
| Bug-09 | Routes 显示真实 URL（/oups、/owners/new） | ✅ 已修复 |
| Bug-10 | 自定义 Name 透传 + 幂等重导更新名称（"我的演示仓库"→"我的演示仓库2"） | ✅ 已修复 |
| Bug-11 | ESC 关闭导入弹窗 | ✅ 已修复 |
| Bug-12 | 大仓库导入显示"正在启动导入…→正在扫描仓库…（索引中）" | ⚠️ 部分修复（"正在解析 AST…（N 个文件）"分支从未出现，见 Bug-R2-04） |
| Bug-13 | 畸形 JSON → `{"error":"invalid JSON body"}` HTTP 400（无 HTML 堆栈泄露） | ✅ 已修复 |

**其他已验证 ✓**：空/纯空格输入提交按钮禁用；导出 `petclinic-ONBOARDING.md`（10KB，技术栈/脱敏配置/Top API mermaid/tours 结构完整，password key 标 sensitive 且无值）；无效深链优雅降级；跨仓库切换清空 chat；Mermaid 节点点击→Inspector；main-flow 3 步 tour 播放；离线提问→"连接中断，自动重连失败，请手动重试"+重试成功；正常路径无 console error / 无 4xx。

---

## 2. 缺陷与体验问题清单 (Defect Items)

### 🔴 [Bug-R2-01] 自由提问（默认 architecture 模式）完全忽略问题内容，固定返回第一个 route+method —— 主问答入口失效

* **严重级别**：P1-严重
* **问题类别**：功能缺陷
* **复现环境**：Chrome (Playwright chromium) / 1440×900 / 隔离实例 48732 / petclinic 仓库

#### 🐾 严格复现步骤 (Step-by-Step Reproduction)
1. 打开 `http://127.0.0.1:48732/?repo=repo-f2e62b0f-5598-4618-8a24-436151bbaa93`，等待 dashboard 加载。
2. 点击 `[data-testid="open-chat"]` 打开聊天面板。
3. 在 `[data-testid="chat-input"]` 输入 `initCreationForm 是在哪个类实现的？`（默认 mode=architecture）。
4. 点击 `[data-testid="chat-submit"]`，等待回答。
5. 换其他问题（`owner`、中文长句、日语、500 字超长文本）重复步骤 3-4。

#### ⚖️ 现象比对 (Expected vs. Actual)
* **实际现象 (Actual)**：四种完全不同的问题均返回同一答案——"识别到入口 CrashController 与下游调用：1. CrashController @ .../CrashController.java:29  2. addInterceptors @ .../WebConfiguration.java:56"。即固定取该仓库 route[0]+method[0]，与问题文本无关（截图 `ui-shots/r2-chat-fixed-answer.png`；curl 实证：`GET /api/repos/:id/query?question=initCreationForm在哪&mode=architecture` 返回 CrashController 入口）。
* **预期行为 (Expected)**：问 `initCreationForm` 应识别入口 `PetController.java` / `OwnerController.java` 相关调用链（call-chain 模式实测可正确得到 OwnerController.java:73）；问无意义文本应提示"未找到相关符号"，而不是装作有答案。

#### 🔍 疑似根因与线索 (Suspected Cause & Code Context)
* **疑似文件/位置**：`services/control-plane/src/repoqa-worker.ts:407-447`（architecture 分支固定取 `route[0]`+`method[0]`，未解析 question 文本）；对照 `:533-589` `findStartSymbol`（call-chain 模式会做 words 匹配→fuzzy→typeKinds 解析）。
* **状态/网络线索**：curl 对比两个 mode 的响应即见差异：`mode=architecture` 恒为 CrashController；`mode=call-chain` 能按问题解析符号并自动排除 test 路径。
* **影响面**：Top API 卡片点击已修复（Bug-02/03），但**用户最常用的自由提问入口仍然全坏**，属于"修了入口 A、漏了入口 B"。

#### 🤖 编码 Agent 专用修复 Prompt (Coder Agent Instruction)
> 修复 `services/control-plane/src/repoqa-worker.ts` 中 architecture 模式的查询逻辑。
> 1. architecture 分支在生成回答前，先用与 call-chain 相同的 `findStartSymbol` 逻辑解析 question 文本中的符号（words 匹配→fuzzy→typeKinds），命中后以该符号为入口生成架构链路。
> 2. 仅当解析不到任何符号时才回退到 route[0]+method[0]，且回答必须带明确前缀提示"未找到相关符号，以下为仓库默认入口供参考"。
> 3. 验收标准：a) 提问 `initCreationForm 是在哪个类实现的？` 回答入口必须是 PetController/OwnerController 相关链路，不得再是 CrashController；b) 提问 `zzzz不存在符号` 时出现"未找到相关符号"提示而非固定 CrashController；c) 现有 Top API 点击链路（Bug-02/03 场景）回归不破坏。

---

### 🟠 [Bug-R2-02] 浏览器返回按钮直接退出到 about:blank（replaceState 不产生历史条目）

* **严重级别**：P2-一般
* **问题类别**：状态同步 / 交互反馈
* **复现环境**：Chrome (Playwright chromium) / 1440×900 / 隔离实例 48732

#### 🐾 严格复现步骤 (Step-by-Step Reproduction)
1. 打开 `http://127.0.0.1:48732/?repo=repo-...petclinic`，等待 dashboard。
2. 在 `[data-testid="repo-select"]` 切换仓库为 `cc-self`（URL 变为 `?repo=repo-e9046f15-...`）。
3. 点击浏览器返回按钮（`page.go_back()`）。
4. 观察地址栏与页面。

#### ⚖️ 现象比对 (Expected vs. Actual)
* **实际现象 (Actual)**：地址栏变成 `about:blank`，页面空白（截图 `ui-shots/r2-after-back.png`，URL 与 title 均为空）。用户从一个仓库切到另一个仓库再按"返回"，**直接退出了产品**。
* **预期行为 (Expected)**：返回上一个仓库视图（或至少回到应用内 dashboard 前一状态），不退出页面。

#### 🔍 疑似根因与线索 (Suspected Cause & Code Context)
* **疑似文件/位置**：`apps/repoqa-web/src/App.tsx:82-85` 使用 `history.replaceState` 更新 URL——replaceState **不产生新历史条目**，`popstate` 监听几乎永不触发，导致 go_back 越过本应用跳到上一个外部历史条目（本场景为 about:blank）。
* **状态/网络线索**：F5 刷新能保持 repo 选择（Bug-08 修复方向正确），但路由切换没有利用浏览器历史；建议从 replaceState 改为 pushState + popstate 映射回 dashboard 状态。

#### 🤖 编码 Agent 专用修复 Prompt (Coder Agent Instruction)
> 修复 `apps/repoqa-web/src/App.tsx` 的路由历史行为。
> 1. 仓库切换/视图切换改用 `history.pushState`（或接入轻量路由库），并为 `popstate` 注册监听：back 时恢复上一个 `repo`/视图状态；对不支持场景至少拦截回退到 dashboard。
> 2. 保留当前 F5 刷新恢复 repo 选择的能力（现 replaceState 行为），两者不冲突。
> 3. 验收标准：a) `/` → 选 petclinic → 切 cc-self → 浏览器 back → 回到 petclinic dashboard（URL 为 petclinic 的 `?repo=`），绝不出现 about:blank；b) F5 刷新仍保持当前 repo；c) 浏览器前进（forward）也能恢复 cc-self。

---

### 🟠 [Bug-R2-03] 冷启动跨文件首次点击 route 无 glow 高亮（Bug-06 残留）

* **严重级别**：P2-一般
* **问题类别**：交互反馈
* **复现环境**：Chrome (Playwright chromium) / 1440×900 / 隔离实例 48732 / 全新页面（无缓存）

#### 🐾 严格复现步骤 (Step-by-Step Reproduction)
1. 冷启动打开 `http://127.0.0.1:48732/?repo=petclinic`（无任何已加载文件缓存）。
2. 在侧边栏 `[data-testid="route-item"]` 中点击**首个尚未加载过的文件**的 route。
3. 观察 Inspector 中该符号是否有 glow 高亮。
4. 同文件再点一次（或切到已缓存文件后重击）。

#### ⚖️ 现象比对 (Expected vs. Actual)
* **实际现象 (Actual)**：首次点击（monaco model 异步加载中）glow=0，无高亮反馈；同文件/缓存后重击 glow=1。t3c 两轮独立复现稳定。
* **预期行为 (Expected)**：首次点击即应有 glow，或至少在有"正在加载"的视觉反馈。

#### 🔍 疑似根因与线索 (Suspected Cause & Code Context)
* **疑似文件/位置**：`apps/repoqa-web/src/components/Inspector.tsx:74-109`（useEffect 轮询 `maxAttempts=8 × 50ms`），`:206-242` `revealAndGlow`。monaco model 异步加载时间超过 400ms 轮询窗口时，轮询提前放弃。

#### 🤖 编码 Agent 专用修复 Prompt (Coder Agent Instruction)
> 修复 `Inspector.tsx` 中 glow 时机竞态。
> 1. 将轮询等待改为监听 monaco `editor.onDidChangeModel` / model 加载 Promise，model 就绪后再执行 `revealAndGlow`；或把 maxAttempts 提高到覆盖实际加载时间（如 40×100ms）并在失败后补一次监听。
> 2. 验收标准：冷启动（新开页面、无缓存）首次点击任意未加载文件的 route，Inspector 打开后 1s 内出现 glow 高亮；连续点击不同文件不丢高亮。

---

### 🟡 [Bug-R2-04] 导入大仓库时"正在解析 AST…（N 个文件）"进度分支从未出现

* **严重级别**：P3-体验优化
* **问题类别**：交互反馈
* **复现环境**：Chrome (Playwright chromium) / 隔离实例 48732 / 本地大仓库导入

#### 🐾 严格复现步骤 (Step-by-Step Reproduction)
1. 打开导入弹窗 `[data-testid="import-modal"]`，选择本地大仓库（如 CodeCompass 自身）。
2. 观察进度文案序列。

#### ⚖️ 现象比对 (Expected vs. Actual)
* **实际现象 (Actual)**：只出现"正在启动导入…"→"正在扫描仓库…（索引中）"，**"正在解析 AST…（N 个文件）"分支从未出现**；`importingRepo.fileCount` 在整个索引期恒为 0，用户无法感知解析进度。
* **预期行为 (Expected)**：扫描完成后进入解析阶段，显示已解析文件数 N（如"正在解析 AST…（213 个文件）"）并逐步增长。

#### 🔍 疑似根因与线索 (Suspected Cause & Code Context)
* **疑似文件/位置**：前端导入进度组件（ImportRepoModal）与 `services/control-plane/src/repoqa-worker.ts:215`（`updateRepoStatus(repoId,'ready', stats.fileCount, ...)` 只在 ready 时回写 fileCount）。索引中间态未推送 fileCount/进度事件。

#### 🤖 编码 Agent 专用修复 Prompt (Coder Agent Instruction)
> 为导入进度补充解析阶段计数。
> 1. repoqa-worker 在解析阶段按批推送 progress 事件（如每 50 个文件更新一次 `fileCount`/`parsed`），前端对应显示"正在解析 AST…（N 个文件）"。
> 2. 验收标准：导入 CodeCompass 自身大小的仓库时，UI 依次出现"扫描中→解析中（N 递增）→完成"；小仓库导入不受影响。

---

### 🟡 [Bug-R2-05] API 层未知路由返回 Express 默认 HTML 404，而非 JSON 错误

* **严重级别**：P3-体验优化
* **问题类别**：功能缺陷（API 一致性）
* **复现环境**：curl 对隔离实例 48732

#### 🐾 严格复现步骤 (Step-by-Step Reproduction)
1. `curl http://127.0.0.1:48732/api/nonexistent`。

#### ⚖️ 现象比对 (Expected vs. Actual)
* **实际现象 (Actual)**：返回 `HTTP 404`、`content-type: text/html`、正文 `<pre>Cannot GET /api/nonexistent</pre>`（Express 默认 404）。与项目其他 API 错误格式（如 `{"error":"invalid JSON body"}`）不一致，前端若按 JSON 解析会失败。
* **预期行为 (Expected)**：`/api/*` 未知路由返回 `404 application/json`，如 `{"error":"not found"}`。

#### 🔍 疑似根因与线索 (Suspected Cause & Code Context)
* **疑似文件/位置**：`services/control-plane/src/http.ts` 路由注册末尾缺 `/api` 前缀的 JSON 404 兜底（Express 默认兜底返回 HTML）。

#### 🤖 编码 Agent 专用修复 Prompt (Coder Agent Instruction)
> 在 http.ts 路由注册末尾、默认兜底之前加入 `app.use('/api', (req,res) => res.status(404).json({ error: 'not found' }))`。
> 验收标准：`curl /api/nonexistent` 返回 `HTTP 404` + `application/json` + `{"error":"not found"}`；现有所有 API 正常路由不受影响。

---

### 🟡 [Bug-R2-06] call-chain 模式无匹配符号时静默回退到第一个生产方法，无任何提示

* **严重级别**：P3-体验优化
* **问题类别**：交互反馈
* **复现环境**：curl 对隔离实例 48732 / petclinic

#### 🐾 严格复现步骤 (Step-by-Step Reproduction)
1. `curl "http://127.0.0.1:48732/api/repos/repo-...petclinic/query?question=zzzz不存在符号&mode=call-chain"`。

#### ⚖️ 现象比对 (Expected vs. Actual)
* **实际现象 (Actual)**：对完全无意义的文本，回答仍然一本正经地展示 `1. addInterceptors @ WebConfiguration.java:56  2. addInterceptor @ WebConfiguration.java:57 ...`——`findStartSymbol` 兜底到第一个生产 method，**无任何"未找到相关符号"提示**，用户会被误导以为这就是答案。
* **预期行为 (Expected)**：无符号可匹配时回答以"未找到相关符号，以下为仓库默认入口供参考"开头，或直接建议换一种问法。

#### 🔍 疑似根因与线索 (Suspected Cause & Code Context)
* **疑似文件/位置**：`services/control-plane/src/repoqa-worker.ts:533-589` `findStartSymbol`：words 匹配→fuzzy→typeKinds→**fallback 第一个生产 method**，fallback 分支未带说明标记。

#### 🤖 编码 Agent 专用修复 Prompt (Coder Agent Instruction)
> 在 `findStartSymbol` 的 fallback 分支返回带标记的默认入口（如 `{ symbol, fallback: true }`），worker 生成回答时若 `fallback=true` 则在开头加"未找到相关符号，以下为仓库默认入口供参考"。
> 验收标准：a) 问 `zzzz不存在符号` 时回答首句含"未找到相关符号"；b) 问 `initCreationForm` 时仍正常解析到 OwnerController.java:73，不加提示；c) 现有回归（Bug-02/03）不破坏。

---

### 🟡 [Bug-R2-07] IGNORED_DIRS 不含 `.scratch`，导入包含演示/临时代码的仓库会污染 Top API

* **严重级别**：P3-体验优化
* **问题类别**：功能缺陷（索引策略）
* **复现环境**：隔离实例 48732 / 导入 CodeCompass 自身（含 `.scratch/issue22-demo`）

#### 🐾 严格复现步骤 (Step-by-Step Reproduction)
1. 导入 `D:/CodeCompass`（仓库含 `.scratch/issue22-demo` 演示 Java 代码）。
2. 等待索引完成，查看 dashboard Top API 列表。

#### ⚖️ 现象比对 (Expected vs. Actual)
* **实际现象 (Actual)**：Top API 第一名是 `createOrder | OrderController | depth 3 | createOrder → submitOrder → insert`——来自 `.scratch/issue22-demo` 的演示代码，而非 CodeCompass 真实业务入口（截图 `ui-shots/r2-ccself-dashboard.png`）。`IGNORED_DIRS`（`services/control-plane/src/repoqa-scan.ts:13-29`）包含 `.git/.gradle/node_modules/target/...`，但**没有 `.scratch`**。
* **预期行为 (Expected)**：`.scratch` 这类开发临时目录不应被索引（或在导入前提示包含的目录清单）。

#### 🔍 疑似根因与线索 (Suspected Cause & Code Context)
* **疑似文件/位置**：`services/control-plane/src/repoqa-scan.ts:13-29` `IGNORED_DIRS`。

#### 🤖 编码 Agent 专用修复 Prompt (Coder Agent Instruction)
> 在 `repoqa-scan.ts` 的 `IGNORED_DIRS` 增加 `.scratch`（可同时评估 `.tmp`、`.penguin` 等）。
> 验收标准：重新导入 CodeCompass 自身后，Top API 不再出现 OrderController/createOrder；`.scratch` 内文件不计入 files/symbols 统计。

---

### 🟡 [Bug-R2-08] Mermaid code:// 链接点击产生 `net::ERR_ABORTED` 浏览器请求残留（功能正常）

* **严重级别**：P3-体验优化
* **问题类别**：性能与控制台
* **复现环境**：Chrome (Playwright chromium) / 1440×900 / 隔离实例 48732

#### 🐾 严格复现步骤 (Step-by-Step Reproduction)
1. 打开 petclinic dashboard，点击 Top API 第一项，等待 mermaid 图渲染（`[data-testid="mermaid-svg"]`）。
2. 点击图中节点（如 `initCreationForm`）。
3. 查看网络日志。

#### ⚖️ 现象比对 (Expected vs. Actual)
* **实际现象 (Actual)**：Inspector 正确打开（`PetController.java`），功能正常；但浏览器同时尝试导航到 `code://src/main/java/.../PetController.java`，产生 `net::ERR_ABORTED` 请求失败记录（截图见 t11 复验输出；console 无报错）。
* **预期行为 (Expected)**：点击节点仅触发应用内跳转，不产生失败导航请求；可对链接 click `preventDefault()`。

#### 🔍 疑似根因与线索 (Suspected Cause & Code Context)
* **疑似文件/位置**：mermaid 节点链接使用 `code://` 协议，前端 DOM 监听处理跳转但未阻止浏览器默认导航。

#### 🤖 编码 Agent 专用修复 Prompt (Coder Agent Instruction)
> 在 mermaid 节点点击处理处 `event.preventDefault()`（或对 `a[href^="code://"]` 统一拦截），再执行现有 Inspector 跳转逻辑。
> 验收标准：点击 mermaid 节点后 `requestfailed` 中不再出现 `code://...` 的 ERR_ABORTED；Inspector 跳转、glow 行为保持不变。

---

## 3. 体验优化与 Vibe 建议 (UX Polish & Enhancements)

* **[核心交互]**：自由提问是产品灵魂。建议把 architecture/call-chain 模式选择做成显式 Tab（当前默认 architecture 隐藏了 call-chain 的能力，而 call-chain 才是能回答问题内容的那条路径），避免用户在不自知的情况下拿到"固定答案"。
* **[交互微调]**：mermaid 图节点点击跳 Inspector 已可用，建议加 200ms 过渡与目标行闪烁动画，提升"我从图进入了代码"的确认感。
* **[文案调优]**：导入进度建议区分"扫描文件"与"解析 AST"两个阶段并显示实时计数；离线断线重连提示已友好，可在重连成功后加 toast "已恢复连接"。
* **[一致性]**：0 步 tour（error-handling）目前前端过滤、API 仍返回 3 条，建议后端按 `steps>0` 过滤，保持数据口径一致（关联 Bug-07 回归项）。
* **[状态]**：跨仓库切换会清空 chat（合理），但建议清空前给一次性确认或把历史问答保留在会话记录中，减少核心玩家误清后的挫败感。
* **[索引策略]**：自托管仓库（dogfood）场景下，建议导入前展示"将索引 N 个文件、跳过 M 个目录"，让用户对 `.scratch` 等目录有知情权（关联 Bug-R2-07）。
* **[Vibe 亮点]**：中文 fuzzy 匹配体验好（"宠物列表的完整调用链"能正确路由）；call-chain 自动排除 test 路径很聪明；导出 ONBOARDING.md 的脱敏处理（password key 标 sensitive 无值）值得保持；375px 移动端 drawer 方案清爽无溢出。

---

## 4. 全量功能覆盖清单 (Coverage Matrix)

> 状态：✅ 已体验（含结论）｜⚠️ 已体验（有保留/未彻底）｜❌ 未体验（原因）

| 功能域 | 状态 | 覆盖明细与结论 |
| :-- | :-- | :-- |
| 仪表盘/概览 | ✅ | repo 选择、scale 指标（routes/services/repositories/methods/files/configKeys/advices/interfaces）、highlight badge、tech stack 分组、config 拓扑（脱敏徽标）、Top API 列表；cc-self 大仓库加载 5s 内 |
| 符号树/侧边栏 | ✅ | routes（真实 URL + tooltip `路径:行号`）、services/repositories 分组、Symbols 按文件分组（47 files）、符号文件点击→Inspector |
| Inspector | ✅ | 文件打开、行号定位、glow 高亮（冷启动首次丢失见 Bug-R2-03）、mermaid 节点跳转 |
| 自由提问聊天 | ✅ | 默认 architecture 模式（**固定答案 Bug-R2-01**）、call-chain 模式（解析正确、自动排除 test）、空输入禁用、超长 500 字、中文/日语/emoji 输入、离线提示+重试成功 |
| Top API 点击链路 | ✅ | 点击→chat 携带 call-chain + start→mermaid 渲染→节点点击→Inspector；无占位符 |
| Tour 系统 | ✅ | main-flow 3 步播放（next/prev/back/done）、error-handling 0 步前端过滤、More 切换 |
| 仓库导入（本地路径） | ✅ | 双 Tab、ESC 关闭、自定义 Name 透传、幂等重导改名、无效路径具体报错、进度三阶段（**解析阶段缺失 Bug-R2-04**）、畸形 JSON 400 |
| 仓库导入（Git clone） | ❌ 未体验（环境不可用） | 目标网络无法连接 github.com:443（`Failed to connect to github.com port 443`），属环境限制；UI 对失败的提示本身友好 |
| 导出 ONBOARDING.md | ✅ | 10KB 完整：技术栈/脱敏配置/Top API mermaid/tours；password key 标 sensitive 无值 |
| 深链/路由 | ✅ | 无效深链优雅降级；F5 刷新保持 repo 选择；**浏览器 back 退出到 about:blank（Bug-R2-02）** |
| 响应式 | ✅ | 375px 无文档级溢出、drawer 开合、open-chat 可点；1440px 桌面正常 |
| 离线/降级 | ✅ | 断网提问→"连接中断，自动重连失败，请手动重试"→恢复后重试成功 |
| 跨仓库联动 | ✅ | 切换仓库清空 chat、指标/符号树刷新、数据一致性 |
| 控制台/网络 | ✅ | 正常路径无 console error/4xx；**未知 API 路由 HTML 404（Bug-R2-05）**；mermaid `code://` ERR_ABORTED 残留（Bug-R2-08） |
| 真实 LLM 问答链路 | ❌ 未体验（环境未配置） | 实例未配置 LLM，全部走确定性静态分析路径；离线/降级路径已覆盖 |
| 权限/多用户 | ❌ 未体验（产品无此能力） | 无账号体系，前端过滤 ≠ 后端校验场景不适用 |
| 移动端真机 | ❌ 未体验（用 375px 视口模拟替代） | 真机触摸/滚动细节未验证 |
