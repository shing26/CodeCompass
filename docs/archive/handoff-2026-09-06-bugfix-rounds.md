# 交接文档:产品体验修复两轮(Round2 已落库 / Round3 未落库)

> 写给:接手 CodeCompass 体验修复/回归验收的下一个 agent(fresh session)
> 交接时点:2026-09-06,基于 v0.21.0(`b4fae3b`)之后的工作区
> 工作区:`D:\CodeCompass`(Windows 11 / Git Bash / Node 24)
> 配套报告:`产品体验报告/产品体验报告.md`(Round2 输入)、`产品体验报告/产品体验报告-Round3.md`(Round3 输入,截图在 `产品体验报告/ui-shots/`)

---

## 1. 一句话状态

体验报告驱动了两轮修复:**Round2(BUG-09~13,五个 P3)已提交(`e48d769`,随 v0.21.0 发布)**;**Round3(R3-Bug-01~04,三个 P1 + 一个 P2)已全部落盘并隔离验收通过,但尚未提交**——工作区当前混着本线(Round3)与并行线(0.22.0 scan dogfooding)的未提交改动,提交前先读 §4。

## 2. 已落库:Round2(BUG-09 ~ 13,commit `e48d769`,2026-08-24)

均已在当时用临时实例 + Playwright 实测 13/13 PASS(48734 + cc-smoke 数据目录,实例已停):

- **BUG-09** Routes 显示 URL:parser 提取 Spring 映射注解 → `repo_symbols.display_path` 列(db.ts SCHEMA + PRAGMA 迁移),Sidebar 渲染 `displayPath ?? name`。
- **BUG-10** 导入 Name 被忽略:http 透传 body.name + `upsertByLocalPath` 同步更新 name。
- **BUG-11** ESC 关导入弹窗:TopBar window keydown Escape。
- **BUG-12** 长导入无进度:根因是前端 `RepoStatus` 缺 `'indexing'`、轮询从未触发;补类型 + POST 挂起期间 1200ms 轮询 + `import-progress` 卡。
- **BUG-13** 畸形 JSON 泄露 HTML:express 4 参错误中间件 → 400 `{error:'invalid JSON body'}`。
- 追加(code-review 双 Medium,同一 commit):Top API 点击把 `name+filePath` 作为显式起点透传(前端 `QueryStart` → 后端 `findStartSymbol`);`findStartSymbol` 启发式排除测试文件(`isTestPath`)。

## 3. 未落库:Round3(R3-Bug-01 ~ 04,全部修复 + 验收通过)

### R3-Bug-01(P1)演进 EXTEND 锚不到 route
- 根因:引擎类级白名单不含 route → 类级命中 route 后 attach 失败,报裸 `AttachPointNotFoundError` 无出路;EvolutionView 的 placeholder 写死「给订单模块加 Excel 导出」(示例类不存在时必错)。
- 修法:`module-evolution-engine.ts` 白名单扩为 `CLASS_LEVEL_ATTACH_KINDS`(class/interface/route/service/repository/mapper/advice/config);`AttachPointNotFoundError` 带 `alternatives`(新 `attachPointAlternatives()`);`repoqa-worker.ts` 未锚定时持久化 status:'error' 的 evolve 卡(带 intentEcho 供纠正重锚,hydrate 可回放)。前端 `EvolutionView.tsx` 加可选 `client?: Pick<RepoQAClient,'radar'>`,radar 取 hubNodes[0].symbol 生成动态 placeholder(`给${hub}加 Excel 导出`),**守卫 `typeof client.radar !== 'function'`**(App.test 的 mock 没有 radar,不加守卫测试会炸);App.tsx 传 `client={client}`。
- 验证:直连 `POST /api/repos/:id/evolve` SSE 全流程出 done 卡,`OrderController` 路由级锚定 100 分;无卡 repo 的 placeholder 实测为「给OrderRepository.findAll加 Excel 导出」。

### R3-Bug-02(P1)delta/cigate 默认 ref 硬编码 origin/main
- 根因:master 仓库开箱即 400,且错误是原始 git stderr 多行直接怼给用户。
- 修法:后端 `repoqa-repos.ts` 加 `defaultBranch?` 字段 + `resolveDefaultBranchSync`(HEAD abbrev-ref → detached 时 origin/HEAD → fallback),http.ts `withDefaultBranch` 注入 GET /api/repos 与 /:id;`repoqa-diff.ts` 加 `summarizeGitError()`(中文单行,识别 ambiguous argument/bad revision/invalid object name/not a git repository),delta catch 返回 `{error: 单行, detail: 原始}`;前端 types/RepoQAClient 解析并把 `err.detail` 挂上 Error,错误单行展示 + `<details data-testid="delta-error-detail">` 看原始;ArchitectureDeltaView/CiGateView 按 `repo.defaultBranch` 设默认 base(placeholder「如 ${defaultBranch} 或 HEAD~3」)。
- 验证:master 仓库 `GET /api/repos` 返回 `defaultBranch:"master"`(旧持久化 'main' 是陈旧值,被正确纠正);base=origin/main → 400 单行 + detail;HEAD~1/HEAD → 200;UI base 输入框预填 master、无错误横幅。

### R3-Bug-03(P1)TopBar <128px 右簇溢出遮挡
- 修法:header `flex-wrap` 两行方案——nav `order-3 w-full flex-wrap xl:order-2 xl:w-auto`(选 flex-wrap 而非横向滚动,保证 375px 下每个 tab 中心可命中);watcher/masked-badge `xl:inline-flex`、brand-logo `max-sm:hidden`、import 按钮 sm 以下缩为「+」、主题按钮 emoji🌙/☀️、copy 按钮 <xl 显示「复制」;`PrivacyPill.tsx` 文本 `hidden xl:inline` 只留色点。more-menu 保持 `absolute right-0 top-full`(App 外层 overflow-x-hidden 是全屏容器,不裁剪)。
- 验证:Playwright 375/768/1024/1280 四档,24/24 PASS(见 §5)。

### R3-Bug-04(P2)more-menu 不支持 Esc
- 修法:TopBar `useEffect` + `moreActionsRef`,Escape 时 stopPropagation 关菜单并把焦点回传 ⋯ 按钮。验证:Esc 关闭 + `document.activeElement` 回到 more-actions。

### 测试与构建基线(当前工作区,含并行线改动,全绿)
- 后端 control-plane:vitest **42 文件 556/556**;web:vitest **34 文件 290/290**;两侧 `tsc --noEmit` ✓;`dist/` 已重建(esbuild 直调)、`vite build` ✓。
- 本轮新增测试:summarizeGitError×2、route-kind EXTEND 锚定(ORDER_CONTROLLER_ROUTE fixture)+ 未锚定 alternatives、http delta defaultBranch + 坏 ref 结构化错误、TopBar Esc、ArchitectureDeltaView(defaultBranch=master 预填 + 错误 details)、CiGateView defaultBranch、EvolutionView 动态 placeholder(SessionHost 需加 radarClient prop)。

## 4. 工作区现状与提交策略(接手者必读)

工作区**两条线的未提交改动并存**(并行协作约定见 `docs/agents/parallel-collaboration.md`):

| 归属 | 文件 |
|---|---|
| 本线(Round3 修复) | `module-evolution-engine(.test).ts`、`repoqa-repos.ts`、`repoqa-diff(.test).ts`、`repoqa-http.test.ts`、`http.ts`、`types.ts`、`RepoQAClient.ts`、`TopBar(.test).tsx`、`PrivacyPill.tsx`、`ArchitectureDeltaView(.test).tsx`、`CiGateView(.test).tsx`、`EvolutionView(.test).tsx`、`App.tsx` |
| 并行线(0.22.0 scan dogfooding) | `GoAdapter(.test).ts`、`repoqa-callchain.ts`、`diagnose-engine(.test).ts`、`repoqa-scan(.test).ts`、`scan-engine(.test).ts`、`repoqa-mcp(.test).ts`、`cli.ts`、四个 `package.json`(版本六处)、`CHANGELOG.md`、`README.md` |
| **两线交叉** | `repoqa-worker.ts`(并行线的 isTestPath 收拢 + 本线的 AttachPointNotFoundError echo,已在同一文件) |

建议:并行线的 0.22.0 已写好 CHANGELOG 条目、看起来接近收口——**等它先提交**,本线再按上表挑文件提交(commit message 建议 `fix(ux): R3-Bug-01~04 体验报告修复——演进锚定/默认分支/TopBar 布局/Esc`);worker.ts 到时自然只剩本线增量。若需本线先走,worker.ts 会带上对方 isTestPath 改动,须在 commit message 里注明。注意:agent 的 `git commit` 可能被 Mimosa git-gate 拦截(HANDOFF.md §2.3),届时走并行收编或用户本机 shell 手动提交。

## 5. 验收方法(可复现)

1. **隔离实例**(勿动 43110/5173/48731——最后一个是他人旧实例,PID 52452):
   `node services/control-plane/dist/cli.js <repo路径> --port 4632 --data-dir <临时目录> --no-browser`
2. fixture:`D:/CodeCompass/.scratch/verify-routes`(Spring 多 controller,实际分支 master;注册后服务端按 localPath 去重,同路径重注册返回旧 id)。
3. 直连 API:`GET /api/repos`(看 defaultBranch)、`POST /api/repos/:id/architecture-delta`(坏 ref 看 400 结构)、`POST /api/repos/:id/evolve` SSE(**consent 仅前端门控,直连会真调 LLM**)。
4. Playwright 布局验收脚本要点(本轮用的脚本在本 agent scratchpad `session-2026-09-06-03-15-53-08159442/ui_accept.py`、`ui_evolve_delta.py`):六 tab `tab-{topo,metrics,incident,gate,delta,evolve}` 中心 elementFromPoint 命中自身、`scrollWidth===clientWidth`、more-menu boundingBox 全在视口、Esc 后焦点回 more-actions、1280 单行(tabTops 一致 + headerH<60)。
   **坑:`sidebar-toggle` 有 `md:hidden`(原有桌面行为)——display:none 的元素 elementFromPoint 会返回父级 header,对它断言要先 `is_hidden()`,别拿 rect 判断。**
5. Playwright 必须显式 `executable_path=C:/Users/Shing/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`(默认版本不存在)。

## 6. 工程坑位(本轮新增,历史坑见根 HANDOFF.md §2.3)

1. **CRLF/LF 混合行尾**:`repoqa-diff.ts`、`ArchitectureDeltaView.tsx`、`CiGateView.tsx`、多数 `.test.tsx` 是 LF,其余 CRLF——Python patch 前必须探测行尾,**严禁 heredoc 写 python**。
2. **Python 字符串 `\n` 会被解析成真实换行写进文件**(曾把 `split('\n')` 写坏)——patch 里用 `chr(10)`。
3. console 中文 GBK 乱码:输出写文件或 `PYTHONIOENCODING=utf-8`。
4. **vitest 大套件慢**:用 `--pool=forks --poolOptions.forks.maxForks=4 --poolOptions.forks.minForks=1`(threads pool 极慢;单文件跑 forks 需同时给 min/max,否则 Tinypool 冲突)。
5. **Windows fs.rm EBUSY**:测试清理加 `maxRetries:10, retryDelay:200`。
6. 未锚定锚点测试的 target 选 `'CheckinModule'`——选 `'CheckIn'` 会被精确匹配命中而不抛错。
7. npm 包装命令(npm test/build)在本机 git-bash 触发 WSL relay 噪音 exit 1 → 直接调 `./node_modules/.bin/`(esbuild/vitest/tsc)或 `node node_modules/...`。

## 7. 遗留与下一步

- Round3 四项全部闭环,无已知回归;若产品侧再出新报告,流程同本轮(报告 → 分级 → 修复 → 隔离实例 + Playwright 双验收)。
- evolve 错误卡已带 alternatives,前端「纠正重锚(Correction Pill)」交互如需强化,数据已就绪。
- 交接后第一件事:`git log --oneline -5` + CHANGELOG 顶部,确认并行线 0.22.0 是否已收口(§4 提交策略依赖它)。
