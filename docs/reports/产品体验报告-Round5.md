# 产品体验报告 · Round5（v1.2.x 后，NVIDIA 满血态）

> 日期：2026-10-02 ｜ 方法：两条**互不依赖**的路径并行——① Persona-QA-Simulator 黑盒走查（真 Chromium headless，三画像 × 七动线，71 次工具调用，36 张截图于 `D:\zcode-tmp\shots\`）；② 维护者侧的 API 层确定性引擎审计（直接打各模块端点 + CLI diagnose，覆盖 17 个已索引仓，含 45423 符号的 lazygit 压测）
> 环境：LLM 已从 DeepSeek 换为 NVIDIA `nvidia/nemotron-3-super-120b-a12b`（`integrate.api.nvidia.com/v1`），**chat / 演进为满血态**，不再是 402 降级
> 结论先行：**19 条 Round4 缺陷已全闭；本轮新发现 7 条 P1 / 8 条 P2 / 2 条 P3，其中 3 条为走查 agent 误报（已纠正）、4 条仅有单方证据（标注待复核）。**

## 本轮最重要的发现：调用链在编造，且打了「已验证」徽章

两条独立路径互证——这是本报告唯一的 P0 级内容。

**路径 ②（API 审计）实测**：

```
$ diagnose "GET /api/repos"               → AnswerBody (VERIFIED) → useState (BROKEN)
$ diagnose "POST /api/repos"              → AnswerBody (VERIFIED) → useState (BROKEN)
$ diagnose "GET /api/chat/sessions"       → AnswerBody (VERIFIED) → useState (BROKEN)
$ diagnose "GET /api/precision/summary"   → AnswerBody (VERIFIED) → useState (BROKEN)
$ diagnose "POST /api/repos/:id/gate/run" → AnswerBody (VERIFIED) → useState (BROKEN)
```

**路径 ①（浏览器走查）独立复现**：R5-02「TOP 核心 API 入口五张卡片全部指向同一个无关组件」——五张卡片副标题逐字相同 `深度 1 / AnswerBody → useState`，实点三张不同后端 API 全部落到同一个前端 React 组件。

**机制（查至代码行）**：`repoqa-callchain.ts:426` 的 `return symbols.find(s => s.kind === 'method')`——入口无法静态起始时取「仓库里第一个方法符号」当链路起点。本仓 64 个 route 符号只有 6 个带 `calls`（Express 内联箭头函数体未归属到 route 符号），**58/64 = 91% 的路由入口**都会拿到这条伪造常量链。同文件 413-415 行的注释记录过同类坑（Issue 17 为 `module` 补了出口），但把任意兜底留在了末行。

**影响面**：MCP `codecompass_diagnose` / `codecompass_trace_call_chain`、仪表盘 Top API 的 hops、CLI diagnose，以及 v1.2 票 08 刚做的拓扑概览层（我把自己的 UI 建在了未验证的数据源上——这笔账记在我头上）。

违反 v0.21 scan 红线与 ADR-0018：只报确定性事实。**宁可报「无法静态解析」，不该编一个。**

## 缺陷清单

### P1（功能错误 / 误导）

| # | 缺陷 | 复现 | 实际 vs 预期 | 证据 | 核验 |
|---|---|---|---|---|---|
| R5-01 | 路由入口的调用链是**编造**的且标 VERIFIED（见上节） | `diagnose <任意路由>` / 点概览任一 API 卡片 | 5 个不同 API → 同一无关前端组件 | CLI 实测 ×5 | **两路互证** |
| R5-02 | 点静态枢纽弹出「远程模型隐私确认」并锁死整页 | topo → 点「枢纽符号 · resolveCall」 | 该区明写「不调模型、不联网」，点击后弹出 `fixed inset-0 z-50` 模态、拦截全部 pointer events、后续点击 30s 超时 | `r5-06b-modal-after-hubclick.png` | 代码确认 + **我引入的回归** |
| R5-03 | 引用角标退化成裸数字、把句子拦腰截断 | chat 提问 → 观察引用处渲染 | 「…（例如 GET /api/chat/status）\n\n2\n\n。鉴权逻辑因而…」 | `r5-28-citation.png` | 机制由我判定（agent 判「角标不存在」是误报） |
| R5-04 | 变更审计没有深链 | 停在门禁页 → 复制地址栏 | URL 是干净的 `?repo=`，分享出去别人落到拓扑；`?mode=gate` / `?mode=delta` 也无效 | `r5-gate.png` | 代码确认 |
| R5-05 | 纯中文意图问句无限静默 | chat 输入「索引是怎么建立起来的？」 | t+10s…120s 六次采样恒为字面量 `…`，无断点提示、无错误、无重试 | `r5-15-chat-ellipsis.png` | agent 单方（我实测 SSE 出词快，怀疑是 120B 慢而非假死；但**无进度/无中断**成立） |
| R5-06 | 体检「深调用链」桶恒为 0 | 三仓 `total` 均为 0 | 读起来像「这个仓库没有深调用链」——由过滤条件制造的假阴性断言 | scan API 实测 | **代码确认，且是我上一批埋的雷** |
| R5-07 | 精度态势跨仓显示同一串他仓基线 | 切 CodeCompass ↔ lazygit | 面板逐字相同「12.0%（236 / 1960）」，无「这是自仓基线」标注 | `r5-27-scan-search.png` | 代码确认 |

### P2（摩擦 / 晦涩 / 自相矛盾）

| # | 缺陷 | 证据 | 核验 |
|---|---|---|---|
| R5-08 | 模型热切换只有一个档（`llm-profiles.json` 不存在 → `profiles:["default"]`），UI 在而功能空 | `r5-24-model-open.png` | **端点实测确认**（agent「胶囊是空的」是误报，「只有一档」是真的） |
| R5-09 | 同意授权后不自动发送 + 主区回落空态引导，首问两次点击 + 一次模态打断 | `r5-11-chat-cn.png` | 单方 |
| R5-10 | 枢纽列表排序与标题不符：`被调` 为 3/22/22/21/34 非单调，工具函数被打上「服务」标签 | `r5-02-topo.png` | **成立，且文案是我的错**（radar 按 PageRank 排序，我写「调用密度」） |
| R5-11 | 焦点计数器不随焦点变化（`↑API 64 / ↓SQL 0` 恒定） | `r5-03-hub-resolveCall.png` | 单方 |
| R5-12 | 首屏「当前链路」冷启动即指向一个前端组件；同屏两个「文件数」（概览 233 / 页脚 1635）无解释 | `r5-01-cold.png` | 部分成立（R5-01 的表现；文件数双口径为真） |
| R5-13 | 大仓概览降级无说明：lazygit 上 Top API 只剩一个 `—`、`当前链路` 整段消失，无兜底文案 | `r5-25-lazygit-topo.png` | 单方 |
| R5-14 | 流式无中断手段（单轮实测 68.5s，全页无停止键、Esc 无效） | `r5-11-chat-cn.png` | 单方 |
| R5-15 | 窄屏 1024×720 无溢出、无遮挡 —— **通过项，登记以免回归** | — | 已验 |

### P3

- R5-16 长回答（1400+ 字）无「展开全文」折叠（R4-05 只给 ChatView 加了 2400 字阈值，本条未复现超阈样本）；12 连点导航 + 前进后退无脏态（**通过**）。
- R5-17 切视图后 URL 退化为 `?repo=`，`mode` 丢失，不可分享当前视图（与 R5-04 同源，已并入）。

## 走查 agent 的 3 条误报（纠正，勿入 backlog）

1. **「证据角标根本不存在，全页 `<sup>` 节点数 = 0」** —— 角标 UI 是存在的（`button.chat-cite` 圆形徽章 + 「在拓扑中查看 →」），agent 用 `<sup>` 选择器计数导致误报。但它观察到的**句子截断是真的**，根因是引用协议只认 `[cite:N]` 一种写法（见 R5-03）。
2. **「模型设置胶囊是空的」** —— `/api/chat/model` 实测返回 `{profiles:["default"], active:"default", configured:true}`，渲染结论存疑；但「只有一个档位」是真的（见 R5-08）。
3. **「枢纽排序乱」** —— 排序依据是 PageRank 不是度数，是**我的文案不准**而非排序错（已按 R5-10 修）。

## 亮点（防止只记负面）

- **lazygit 45423 符号零压力**：topo / chat / scan / gate / delta 五页首渲染 561–882ms，8–9 次 API 全 200，零 4xx/5xx、零慢请求（>8s = 0）、控制台零报错。
- **问答满血可用且不编造**：「这个仓库哪里最值得改？」给出 164 孤儿符号 / PageRank 0.0094 / 591 行超大方法等可核对数字；`resolveCall 的调用链是什么？` 精确复现 `resolveCall → resolveHttpRoute → normalizeRoutePath → trim`（Dynamic/RPC Dispatch 断点）并给出行号，与拓扑页完全自洽。
- 断点原因如实标为「Dynamic/RPC Dispatch」而非掩盖，符合防造假原则。
- 检索分区语义诚实：明写「关键词/子串匹配，不看语义相似度」「抽样 top-n，不外推为全仓率」。
- 枢纽符号点击确实展开确定性链路，并标注来源「来自这里的枢纽符号」。

## 动线数据

| 画像 | 任务 | 用时 | 点击数 | 死胡同 |
|---|---|---|---|---|
| ①新手 | 冷启动选库→看懂本仓 | 8s | 2 | 0 |
| ①新手 | 拓扑概览读懂「从哪看进去」 | 25s | 5 | 1（R5-01 五个入口全失效） |
| ②维护者 | 枢纽符号下钻链路 | 12s | 2 | 0（被 R5-02 打断 30s） |
| ②维护者 | 中文意图提问「哪里最值得改」 | 105s | 4 | 0 |
| ②维护者 | 符号名提问 `resolveCall` 链路 | 30s | 3 | 0 |
| ①新手 | 纯中文意图「索引怎么建立」 | 120s+ | 3 | 1（R5-05） |
| ②维护者 | 体检 + 检索分区 | 15s | 3 | 0 |
| ②维护者 | 门禁 → Diff 影响面 | — | 1 | 1（R5-03+R5-04 双失） |
| ③手滑 | 12 连点导航 + 前进后退 | 15s | 14 | 0 |
| ③手滑 | 流式中 Esc / 找停止键 | 30s | 2 | 1（R5-14） |
| ①新手 | lazygit 五页巡检 | 40s | 5 | 0 |

## 处置（2026-10-02 同日）

**批 A（红线）已落地**：

- **R5-01**：`effectiveStart` 末行任意兜底删除 → 无起点即无链路。`diagnose` 新增 `chainUntraceable` 分支：入口解析成功但无出边时如实报 SUSPECT +「静态图谱未记录它的出边……不做推测」；仪表盘 Top API 保留入口（路由存在是确定性事实）但 hops 为空、UI 写「无法静态解析」；deepChains 桶补 note 说明「空通常是数据边界，不是体检合格」。**修后实测：路由指向自己、真链路（`runScan` 4 跳 3 验证）不受影响、fixture 露出真实 3 跳 `get → ping → select`。**
- **R5-02**：概览层枢纽点击与仪表盘入口点击一并改走 `submit` 直调，绕开 consent 门。**可证等价**：`repoqa-worker.ts:978` 的 LLM 分支被 `input.mode !== 'call-chain'` 硬门挡住，call-chain 全程不调模型。
- **R5-03**：`normalizeCitationMarkers` 把 `【N】`/`[^N]`/`[N]`/`（cite: N）` 归一为唯一形态 `[cite:N]`，**归一在悬空角标校验之前**（顺序反了变体会绕过校验）；裸 `[N]` 加「前字符不是标识符/右括号」守卫以免改写 `a[0]` 数组下标；提示词同步收紧。
- **R5-04**：`viewFromMode` 补 `gate`、接受 `delta` 别名；URL 写入补 `mode=gate`。

**批 B（诚实性与引导）已落地**：R5-07 精度态势加「CodeCompass 自仓基线，非当前仓库」标注；R5-10 文案由「按调用密度」改为「按静态图谱影响力排序」。

**未修（登记）**：R5-05（无进度/无中断，值得单独立票）、R5-08（需先建 `llm-profiles.json` 才有第二个档位——属用户侧配置）、R5-09/11/13/14/16（体验打磨，量级小于上述）。

**回归锁**：`round5-redline.test.ts` 6 项（引擎侧，构造独立符号表，断言基准不依赖被测源）+ App 侧 4 项（consent 不弹 / gate 深链往返 / 别名）+ UI 冒烟新增 3 步（五张卡片互不相同 / 无共用 hops / 点枢纽不弹授权）。**每条锁都验证过「回退修复后会红」**。

门禁：控制面 **791**、web **394**、e2e **73/0**、UI 冒烟 PASS。
