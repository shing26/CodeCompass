# CodeCompass Phase 2 Handoff

> 生成时间：2026-08-21
> 生成自：CodeCompass Phase 1 实现会话
> 目标：让 fresh agent 接手 Phase 2 前端 Workbench 开发

## 1. 项目身份

**名称**: CodeCompass (内部代号 RepoPulse)
**仓库**: `git@github.com:shing26/CodeCompass.git` (branch: master, commit: 5d7e031)
**用途**: 只读代码智能工作台，帮助新开发者理解 Java 项目架构
**位置**: `D:/CodeCompass`
**原始来源**: `D:/multi-harness-workbench`（已适配为本地副本，不修改原工作台）

## 2. Phase 1 已完成 — 当前状态

Phase 1 交付了一个可验证的本地 Java 静态 trace 闭环：

| 能力 | 状态 |
|------|------|
| 契约冻结（embedding 移除，SSE 固定为 token/mermaid/anchors/done） | ✅ |
| 本地 Repo 导入、幂等、重启恢复、3,000/500K 上限 | ✅ |
| Java AST 解析（@lezer/java）：class/interface/method/field/route/service/repository + calls[] | ✅ |
| 确定性 call-chain 跨层解析，未解析边标记 Static Analysis Break | ✅ |
| README/Javadoc chunk + config key 提取（YAML/properties/pom），不暴露值 | ✅ |
| Secret masking（password/token/api key/AK-SK/private key） | ✅ |
| 本地只读事件平面（repoqa_events 表） | ✅ |
| Golden dataset eval harness（50 题分桶，真实 git commit，RECALL_K=5） | ✅ |
| 真实 LLM adapter（streaming，首 token 1.5s 硬 gate，REPOQA_GATES_PASSED 门禁） | ✅ |
| 21 条集成测试 + typecheck + eval + build 全通过 | ✅ |

**验证命令**: `npm test --prefix services/control-plane` (21 passed), `npm run eval --prefix services/control-plane` (passed)

## 3. 架构全景

```
packages/
  contracts/          # 数据契约（index/query I/O）
  bridge-adapters/    # 桥接适配器（浏览器/Shell 等 runtime）
services/
  control-plane/      # Node.js 后端（Express + SQLite + WebSocket）
    src/
      db.ts           # SQLite schema（repos, repo_symbols, repo_chunks, repo_files, repoqa_events）
      http.ts         # Express 路由（/api/repos, /api/repos/:id/query SSE, /file/raw）
      index.ts        # 入口：HTTP server + WebSocket + EventBus 转发
      repoqa-worker.ts    # 核心 Worker：indexRepo / queryRepo / ReAct loop
      repoqa-repos.ts     # RepoQARepos DAO
      repoqa-parser.ts    # @lezer/java AST 提取
      repoqa-callchain.ts # 调用链解析（递归 CTE + 同文件/跨文件 fallback）
      repoqa-config.ts    # 配置 key 提取（YAML/properties/pom）
      repoqa-masking.ts   # 敏感信息掩码（正则替换）
      repoqa-llm.ts       # LLM adapter（streaming，OpenAI-compatible）
      repoqa-eval.ts      # Golden dataset eval harness
      repoqa-http.test.ts # 21 条集成测试
      repoqa-scan.ts      # 文件扫描（忽略 .git/node_modules/dist 等）
      ws.ts               # WebSocket 辅助（可挂载 eventBus，当前未使用）
```

**关键端口**: 控制平面在 `http://localhost:{port}` 启动，port 由 `config.ts` 决定。

## 4. Phase 2 工作范围

### 4.1 目标
构建一个三面板 Web 工作台，让开发者通过自然语言交互可视化地理解代码库。

### 4.2 技术栈（来自 `docs/repoqa-plan.md` §10.1）
- Vite + React 19 + TypeScript
- Tailwind CSS
- Monaco Editor (`@monaco-editor/react`)
- Mermaid.js (`mermaid`)

### 4.3 核心组件（来自 `docs/repoqa-plan.md` §10.3）
- **TopBar**: repo 选择器、step stepper、导出按钮
- **Sidebar**: Quick Tours 列表、route 列表、symbol 树
- **Canvas**: 聊天流 + Mermaid 渲染 + Source Trace 抽屉
- **Inspector**: Monaco 编辑器，支持 `code://` 深链跳转 + glow 高亮

### 4.4 交互流程
1. 用户导入 repo 或选择已导入的 repo
2. 点击 Quick Tour → 自动提交 prompt 到 `GET /api/repos/:id/query`
3. SSE `token` 事件 → 追加到 Markdown 渲染
4. SSE `mermaid` 事件 → 渲染 Mermaid 图
5. SSE `anchors` 事件 → 显示 Source Trace 抽屉（源码卡片列表）
6. 点击 diagram 节点或源码卡片 → `code://` 深链 → Inspector 打开 + 高亮行
7. Inspector 导航栈支持前进/后退

### 4.5 关键设计决策（来自于 `docs/repoqa-review.md`）
- 首屏只有 1 个 Recommended Flow，不展示三卡并列
- 自然语言按钮为主入口，slash command 只作为高级快捷方式
- 答案按"业务概览 → 图 → 源码卡片 → 下一步"分阶段揭晓
- 首次跳转后再触发 Monaco glow
- 完成后给可量化 micro-win 和显式 off-ramp，不得用成功 toast 掩盖 Static Analysis Break
- SSE 重连、Mermaid 降级、`code://` 深链与 Monaco 定位纳入 Phase 2 gate

### 4.6 状态模型（来自 `docs/repoqa-plan.md` §10.2）
- `RepoState`: repo 元数据 + symbols
- `ChatState`: 消息列表 + streaming 状态
- `InspectorState`: 当前文件 + 内容 + 导航栈

## 5. Phase 2 的 API 契约

所有后端 API 已就绪，Phase 2 只需消费：

| 端点 | 用途 |
|------|------|
| `GET /api/repos` | 列出已导入 repo |
| `POST /api/repos` | 导入本地 repo |
| `GET /api/repos/:id` | 获取单个 repo 状态 |
| `GET /api/repos/:id/symbols?kind=...` | 列出 symbols |
| `GET /api/repos/:id/chunks?q=...` | 搜索 chunks |
| `GET /api/repos/:id/query?question=&mode=` | SSE 查询（核心端点） |
| `GET /api/repos/:id/file/raw?path=` | 获取原始文件内容 |
| `POST /api/repos/:id/anchor-click` | 记录 anchor 点击事件 |
| `POST /api/repos/:id/feedback` | 记录反馈 |

SSE 事件流顺序：`token → mermaid → anchors → done`

## 6. 未解决的 Phase 2 问题

来自 `docs/repoqa-review.md` 的决策清单中，以下项处于 `needs-validation`：

- 单一 Recommended Flow 与文案（是否优于空白聊天需对照实验）
- Day 1/3/7/14 节奏（需要真实回访数据）
- `code://` 深链在 Monaco 中的定位精度（需要验证）

## 7. Phase 3 预览

`docs/repoqa-prd.md` §12 和 `docs/repoqa-plan.md` §13 有完整描述，核心：
- Onboarding Dashboard（技术栈/模块/环境依赖）
- Markdown/PNG 导出
- Commit-hash caching → instant re-open
- Golden dataset CI gate
- 5–10 人 pilot outcome 作为 gate

## 8. 建议的 Skills

下一个 agent 应依次调用：

1. **`/to-spec`** — 把 Phase 2 的 PRD/plan 转化为 actionable spec
2. **`/to-tickets`** — 拆分为 tracer-bullet tickets，声明 blocking edges
3. **`/implement`** — 逐 ticket 实现
4. **`/code-review`** — 双轴 review（Standards + Spec）后提交

## 9. 引用文档

- `docs/repoqa-prd.md` — 完整 PRD（用户故事、功能需求、路线图）
- `docs/repoqa-plan.md` — 技术架构、API 契约、前端计划
- `docs/repoqa-review.md` — 产品评审报告、决策清单、分歧裁决
- `docs/adr/` — 4 条架构建决策（本地优先、结构化检索、安全门禁、golden dataset 先于 prompt 调优）
- `CONTEXT.md` — 领域术语词汇表
- `.scratch/repoqa-phase1/issues/` — Phase 1 实现 ticket（参考验收标准）
- `HANDOFF.md` — 原始交接文档（Phase 1 起点）

## 10. 敏感信息

无。LLM 配置通过 `REPOQA_LLM_URL` / `REPOQA_LLM_MODEL` / `REPOQA_LLM_API_KEY` 环境变量传入，无硬编码 URL。GitHub token 已从上下文移除。

