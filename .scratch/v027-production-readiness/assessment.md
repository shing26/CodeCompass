# 生产就绪度评估（2026-09-12）

> 触发：用户要求判断项目是玩具 Demo 还是接近可上线/企业级。方法：五面代码证据走查（只读，未改码）。
> 结论校准基准 = 产品身份定论（2026-09-03）：**Local-First MCP 引擎 + Web 演示厅、单机零鉴权**——不无脑对标企业 SRE 全家桶。

## 总判定

**不是玩具级，也未到企业级——「单机产品化成熟期」。**
引擎与子进程层已有超时/崩溃守卫/状态机降级/孤儿恢复（玩具与产品的分水岭全在）；缺的是服务运维面：日志 sink、指标、错误码契约、传输层韧性。高+中差距全部补完约 5-6 人日，单机产品可称「可上线」；转向多用户企业部署则需重做监控/告警两面，量级另算且与产品身份冲突。

## 分项证据

### 1. 容错机制 —— 部分具备（五面最强）
已有：
- 外部进程超时全覆盖：git clone 60s+maxBuffer（`git-importer.ts:145-177`）、git diff 超时（`repoqa-diff.ts:71-77`）、原生对话框超时（`dialog.ts:36-46`）、LLM `AbortSignal.timeout`（`chat/llm.ts:151`）。
- 崩溃守卫+优雅停机：`cli.ts:961-976`（uncaught/unhandled→fatal）、`cli.ts:1037-1038`（SIGINT/SIGTERM）。
- 索引失败降级：worker catch→repo `'error'`+message（`repoqa-worker.ts:825-827`）；**重启孤儿 `'indexing'`→`'idle'` 归一**（`repoqa-repos.ts:584`）。
- LLM 降级：tools API 缺失去 tools 重试（`repoqa-llm.ts:453-455`）；空答案单重试（`chat/agent.ts:196-211`）。
- 非 Windows 对话框契约降级（v0.25 批1）。
缺：
- 前端 fetch 零超时/AbortSignal（`RepoQAClient.ts` 全文无 signal）→ 后端挂起=页面永转圈。
- WS 无重连（`RepoContext.tsx:144-178` 无 onclose 处理）→ 后端重启后进度流静默死亡（「页面死状态」报障体感的真实来源之一）。
- clone/reindex 无网络瞬断重试。

### 2. 日志体系 —— 部分具备（chat 面优、服务端面近零）
已有：chat JSONL 结构化事件日志（`chat/log.ts`，落盘可回放）；事件持久化 SQLite（`GET /api/events`、tasks/:id/logs、gate-runs）；`doctor` 自检。
缺：服务端零运行日志（无级别/无 sink/无轮转，console.* 仅 cli/repl/stdio 合法输出面）；route 抛错无落点（联动缺口 5）；chat JSONL 无界增长；跨链无 traceId。

### 3. 配置管理 —— 部分具备（外部化到位、分级没有）
已有：`loadConfig` env 外部化+安全默认（`config.ts:13-27`）；LLM env 链（`chat/llm.ts:123-130`）；`/api/runtime` 掩码（maskHostname）；vite `.env.development`。
缺：启动期配置校验 fail-fast；`.env.example`；文件级环境区分（test 靠注入 env，可接受）。
红线（Mimosa 约束+既有实践）：凭据只走 env/密钥服务；日志/错误体永不带 apiKey 与请求头。

### 4. 监控与告警 —— 薄弱（按产品身份打折）
已有：`/health`（status/version/port/dataDir，`routes/workbench.ts:12-18`）；`/api/runtime`；面向用户的「监控」进了 UI（索引进度、watcher-status、gate 趋势）。
缺：性能指标零采集；`/health` 不探依赖（DB/磁盘）；无告警（单机场景=应用内 error 态+doctor 合理，多用户需重做）。

### 5. 错误处理 —— 部分具备（HTTP 语义好、契约未规范）
已有：`{error:string}` 统一；400/403/404/409/202/204 语义正确；坏 JSON→JSON 400 不泄堆栈（Bug-13）；/api 兜底 JSON 404；git ref 注入双层守卫。
缺：**无全局 error 中间件**（Express 4 async rejection→悬挂、sync throw→HTML 500 泄栈；`routes/deps.ts` try 数 0、500 出口全仓仅 `analysis.ts:143,349` 两处）；**无错误码契约**（机器判断靠英文 free-text，chat `unknown session` 即 V27-12 病根）；业务/系统错误同形。

## 差距清单（→ 票池裁决见 spec.md）

| # | 差距 | 优先级 | 工作量 | 台账映射 |
|---|---|---|---|---|
| 1 | 全局 error 中间件 + asyncHandler 包装（500 也 JSON、堆栈不出网、rejection 有日志落点） | 高 | 0.5d | 新增 |
| 2 | 传输层韧性：fetch timeout/AbortSignal + WS onclose 指数退避重连 | 高 | 1d | 新增 |
| 3 | 错误码契约 {error,code}（高频面先行）+ chat 错误人类化 | 高 | 1d | 并入 V27-12 |
| 4 | 控制面绑 127.0.0.1（逃生 env） | 高 | 0.5d | V27-1 |
| 5 | 服务端最小日志 sink（级别+JSONL 轮转+traceId，复用 SessionLogger 模式） | 中 | 1-2d | 新增 |
| 6 | /health 深检（SELECT 1+dataDir 可写）+ runtime 附 uptime/RSS/activeTasks | 中 | 0.5d | 新增 |
| 7 | UI 冒烟进 Release 管线（真实浏览器，选库→dock→门禁三链路） | 高（验证轨） | 1-2d | V27-13 |
| — | clone/reindex 瞬断重试（2 次退避） | 中 | 1d | V27-18（新登记） |
| — | 指标暴露 /metrics、外置告警、配置 fail-fast+.env.example | 低 | — | V27-19（新登记，产品身份裁决多数不做） |

## 实施顺序建议

1→2→3 打「错误与韧性面」批（http/web 层互验），7 紧随其后用真浏览器锁「后端重启/断网 UI 不死亡」；4 独立安全票；5→6 打「取证面」批。
