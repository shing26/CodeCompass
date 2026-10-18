# 票 02 — 粘贴 TS 片段即出调用图

Status: agent-ready

## 背景
用户批判①第二半："允许直接粘贴一段包含几个函数调用的 TS 代码片段，立即在右侧看调用树，把使用成本降到零。"

现状：无任何片段入口；唯一粘贴流是 incident 堆栈（且 UI 触发位已不在）。

## 目标
不导入任何仓库：粘贴一段 TS/JS 源码 → 立即看到函数列表 + 调用关系图（mermaid）+ 未解析边缘的诚实标注。

## 实现要点（D2 裁决：后端内存解析，不落盘不进 DB）
1. **引擎（纯函数，可独测）**：`services/control-plane/src/engine/repoqa-snippet.ts`
   - 输入 `{ source, fileName? }`；`parseTypeScriptSource(source, fileName ?? 'snippet.ts', 'snippet-preview')`
   - `buildCallIndex(symbols)` + 逐边 `resolveCallEdge` 消解：仓内可解析 → 边；不可解析 → 计入 breaks（按 reason 分 EXTERNAL/UNRESOLVED/DYNAMIC 计数）
   - 输出 `{ nodes: [{id,name,kind,file,line,lineEnd,outDegree,inDegree}], edges: [{from,to,line}], breaks: {external,unresolved,dynamic,total}, mermaid }`
   - mermaid：`flowchart LR`，节点上限 200 + 聚合节点（复用前端同规则；引擎侧截断，避免大片段灌爆）
   - 出库文本一律过 `maskSensitiveText`（ADR-0003 不变式）
2. **路由**：`services/control-plane/src/routes/snippet.ts` — `POST /api/snippets/graph`
   - 校验：source 非空、长度上限 100KB（超限 400 `snippet_too_large`）、仅接受字符串
   - 失败 400 `snippet_parse_failed`（掩码后消息）
   - `http.ts` 注册（1 import + 1 行）
3. **Web**：`SnippetView.tsx`（新视图 `view='snippet'`，无仓库也可达）
   - 左侧 textarea（预填一段短示例代码，可一键清空）+「解析片段」按钮
   - 右侧 `MermaidDiagram` 渲染 mermaid + 函数列表（kind/行号）+ 未解析/仓外边计数如实展示
   - 空状态（无仓库）新增入口按钮「粘贴代码片段试试」→ 切到该视图
   - `RepoQAClient.analyzeSnippet(source)`

## 验收
1. 引擎单测：≥5 个用例——（a）三个函数互相调用出正确边；（b）调用仓外方法（`console.log`）计 EXTERNAL 不计假边；（c）未解析同名方法计 UNRESOLVED；（d）200 节点截断 + 聚合；（e）空输入报错。
2. 路由测试：正常 200 形状断言；超长 400；空 400。
3. Web 测试：粘贴 → 调用 → 图与列表渲染；错误态展示。
4. 事实边界：输出不含源码正文（只含符号名/行号）——防止"粘贴即出库"变成代码外泄通道；如需展示代码由前端用用户自己的输入渲染。
5. 文案过双哨（新组件在 `apps/repoqa-web/src` 全文扫范围内）。

## Comments
**2026-10-19 落地。** 证据：
- 引擎 `engine/repoqa-snippet.ts`（纯函数，`parseTypeScriptSource` + `resolveCallEdge`）：节点/边/三类边界计数/200 节点渲染截断；响应不回显源码正文。
- 路由 `routes/snippet.ts`（`POST /api/snippets/graph`）：空 400 `snippet_required`、>100KB 400 `snippet_too_large`、解析失败 400 `snippet_parse_failed`（码已三处同动入 contracts/ERROR_COPY/CONTEXT）。
- 测试：`routes/snippet.test.ts` 7 项（图正确性 / 外部与动态计数 / 截断保留全量节点 / 空与超限 / 不回显源码 / 路由形状）。
- Web：`SnippetView`（`?mode=snippet`，无仓库可达；空状态「粘贴一段代码看看」），`SnippetView.test.tsx` 3 项。
