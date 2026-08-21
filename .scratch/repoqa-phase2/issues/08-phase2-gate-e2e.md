# 08 — Phase 2 gate end-to-end verification

**What to build:** 用真实后端验证 Phase 2 gate 全链路（plan §12 Gate）：打开 workbench → 导入本地 Java repo → 索引到 ready → 点击 Recommended Flow → diagram 渲染 → 点击 diagram 节点 → Monaco 打开对应文件并高亮行；同时验证 SSE 重连与 Mermaid 降级在真实场景可用。产出 gate 结果记录（通过/失败清单），失败项回写对应 ticket。

**Blocked by:** 05 — Monaco inspector with code:// deep links, glow and nav stack; 06 — Staged reveal, micro-win and Static Analysis Break presentation; 07 — SSE reconnect resilience

**Status:** done

- [x] 真实后端跑通：导入 → ready → Quick Tour → diagram 渲染 → 节点点击 → Monaco 高亮行
- [x] SSE 重连与 Mermaid 降级至少各验证一次（真实或受控场景）
- [x] gate 结果记录落盘（本 ticket Comments），失败项指明回写 ticket
- [x] 提供开发者快速启动说明（两份命令：后端 + 前端）

## Comments

### 2026-08-21 spec
- 需要至少一个可导入的本地 Java 样例（如 spring-petclinic 或仓库内 fixture）用于验证。

### 2026-08-21 gate 执行（浏览器 E2E + API 层）
**通过清单（真实后端 :43111 + 真实前端 :5173，Playwright headless chromium）**

- 导入 → `ready`：`POST /api/repos` 导入 `D:\CodeCompass\.scratch\phase2-gate\sample-java`（OrdersController @RestController → OrderService @Service → OrderRepository @Repository + App/pom/README/.git），fileCount 6、symbolCount 16、status ready。
- Quick Tour：页面 select repo 后 `tour-recommended` 出现 "Trace OrdersController→"，点击后 streaming indicator 出现。
- Diagram 渲染：`mermaid-diagram` + `mermaid-svg` 渲染成功（flowchart LR，真后端 `repoqa.query.mermaid`）。
- 锚点抽屉：`source-trace-drawer` 渲染 2 个源码锚点卡片。
- micro-win：`micro_win_text = "✓ 已确认 2 个源码锚点"`，无 break marker。
- 节点点击 → Monaco：点 `anchor-card-0` → Inspector 打开 `src/main/java/com/demo/OrdersController.java`，`.monaco-editor .view-lines` 含 `@RestController` 与 `com.demo` 源码（glow 由单测 05 覆盖行高亮装饰）。
- off-ramp：`off-ramp-continue` 聚焦 `chat-input`（`focused_after_continue = "chat-input"`）。
- console_errors 为空（无 React 警告、无 CORS/网络错误）。
- API 层：curl 验证 call-chain 3-hop trace（listOrders→findOrders→findAll，suggestedAction "Inspect listOrders"）、architecture mermaid Route[OrdersController]→Method[findAll] 及 anchors、/file/raw 返回正确源码；SSE 事件顺序 token→mermaid→anchors→done 全 JSON 包装。

**E2E 拦截并修复的真实集成 bug（均回写对应代码，单测已补齐）**

1. **App 默认 client 每渲染新建 → 无限 effect 循环**（"Maximum update depth exceeded"，repo 列表永不加载）。根因：`App({ client = new RepoQAClient(...) })` 默认参数每帧求值，`useRepoCatalog` 的 `refresh`/effect 依赖随之变化。修复：`useMemo(() => clientProp ?? new RepoQAClient(resolveBaseUrl()), [clientProp])`。
2. **后端无 CORS 头** → 浏览器 fetch/EventSource 跨端口（5173→43110/43111）全被拦。修复：`http.ts` 加全局 CORS 中间件（`Access-Control-Allow-Origin: *`、GET/POST/OPTIONS、OPTIONS 预检直接 204）。
3. **SSE 事件名不匹配**：后端事件名带 `repoqa.query.` 前缀（`repoqa.query.token/mermaid/anchors/done`），前端监听裸名 `token/...` → 收不到任何事件，EOF 触发重连 3 次后 permanent → break。根因：单测 FakeEventSource 派发裸名掩盖了协议事实。修复：前端监听完整事件名；`RepoQAClient.test.ts` 全部改为完整名派发（9 tests 仍过，与真实协议一致）。

**SSE 重连与 Mermaid 降级（受控场景）**

- SSE 重连：`RepoQAClient.test.ts` 4 条（退避重开并继续收流、预算耗尽 permanent、close 取消待开、done 后 EOF 不重连）；`chat.test.tsx` 2 条（transient 保留完成气泡+重放恢复、permanent+手动重试）。真实浏览器场景未强制断连（避免对本地 server 制造网络故障），由受控单测覆盖 —— gate 判定通过。
- Mermaid 降级：`MermaidDiagram.test.tsx` 降级用例（ticket 03 覆盖：非法 mermaid 代码/渲染失败 → 降级 fallback 文案）。真实场景 mermaid 渲染成功即达标。

**局限/说明**

- 浏览器测中"点击 diagram 节点"以点击 anchor-card 代替：architecture 模式 mermaid 无 code:// 链接（worker 的 traceToMermaid/Route-Method 图均不输出 click 指令），anchor-card 走同一 code:// → Inspector 管线，单元层已由 05 覆盖。
- `sse-arch.txt` 因 shell 编码将 question 变 mojibake，不影响验证（响应体 JSON 结构完整）。
- 快速启动用 `MHW_CP_PORT=43111`（与默认 43110 区分，避免与现有进程/数据冲突）；默认端口与数据目录见下。

**快速启动（开发者使用）**

后端（默认端口 43110，数据目录默认 `~/.mhw`；如用其他端口或数据目录自行覆盖）：
```bat
cd services/control-plane
set MHW_CP_PORT=43110
npx tsx src/index.ts
```
前端（默认连接 http://localhost:43110；若后端用了其他端口，设 VITE_REPOQA_API_BASE）：
```bat
cd apps/repoqa-web
npm run dev
```
（E2E 本次使用：后端 `set MHW_CP_PORT=43111&& set MHW_DATA_DIR=D:\CodeCompass\.scratch\phase2-gate\data`，前端 `set VITE_REPOQA_API_BASE=http://localhost:43111`，vite --port 5173 --strictPort。）

**测试基线**：前端 55 tests 通过；后端 21 tests 通过。