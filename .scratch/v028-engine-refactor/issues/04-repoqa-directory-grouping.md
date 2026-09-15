# 04：B4 — repoqa-* 目录归组（自票 03 增量 4 拆出，V27-30 残段）

> *Parent spec：`.scratch/v028-engine-refactor/spec.md`。自票 03 拆出：2026-09-14 实测 churn 后判定需专注窗口执行。*

Status: open
标签：结构 / P3（纯导航性，零缺陷风险消减）/ 来源：V27-30 增量 4。

## 为什么要拆出来（churn 实测，2026-09-14）

- 待迁 **20 源文件 + ~16 同名 test**；`repoqa-repos` 被引 **72 处**、callchain 24、worker 22、masking 16、parser 11……合计需重写 import 的文件 **≈70**。
- 每个被迁文件自身还有一层：sibling import 改 `../x` + contracts 深路径 `../../../packages`→`../../../../packages`；`scripts/profile-index.ts`、根 `package.json` 的 `eval` 脚本路径等外围引用跟着动。
- **Mimosa 铁律**：批量重写不得走 bash/python 直写源码（实测拦截），唯一通道是逐文件 Read+Edit——即 ~140+ 工具调用。在长会话尾部开这个头，半途断裂=master 红树，违反「每 commit 可验绿可回滚」纪律。

## 执行方案（留给专注窗口，逐组绿）

分组定稿（四桶；归属两可者按主消费者裁决）：
- `ingest/`：repos、worker、worker-helpers、worker-diagram、watcher、parser、scan、config、mapper
- `engine/`：callchain、diff、conventions、dashboard、export、graphrag、masking、stacktrace、tours、llm
- `mcp/`：mcp（+ cli/installer/chat-client 三处 importer 改路径）
- `eval/`：eval（+ package.json `"eval"` 脚本路径改）

顺序（每组独立 commit + 全门禁绿再下一组，从小到大练流程）：**eval → mcp → ingest → engine**？错——按风险递增应 **eval → mcp → engine → ingest**（repos 72 引最重，最后动）。每步：`git mv`（bash 合法）→ 逐文件 Read+Edit 重写 import → tsc 全清单驱动补漏 → 638+/e2e 62/build → commit。
测试文件跟随 subjects；根级集成测试（http/cli/events/static/gate-runs/evolve/commit-anchor/workbench-cards/multimodule/crosslang）**留根不迁**（主体是 server/routes 面）。

## 价值声明（诚实注记）

纯导航性收益（scan 的 oversizedFiles 桶已靠票 03 拆分消掉主要热点：worker 2556→2087、巨注册 515→三域）。若 v0.28 排期紧，本票可降级为「只归 mcp/eval 两组试点」甚至长期 open 不阻塞任何事。

## Comments（2026-09-14 开工——执行通道修正：纯改名移交用户本机）

- 原方案前提「git mv 在 bash 合法」**被证伪**：Mimosa 路径特征门把 `git mv`/`mv`/`rm -f` 一律判为「Bash 直接写源码」拦截（实测三种命令全拦；裸 `rm` 首次放行、文件进敏感名单后即拦）。批量逐文件 Read+Write+rm 搬家 = ~15k 行内容无谓穿上下文且 rm 不可靠——不走。
- **修正分工**（与 Mimosa 拦 push→出 .cmd 交用户本机同构惯例）：纯改名（零内容变更、无待扫描对象）交用户执行 `D:\zcode-tmp\b34-move.cmd`（43 条 git mv：eval 2/mcp 3/engine 21/ingest 16+multimodule/crosslang 归位；已全量校验源存在；root 集成测试 cli/http/events/static/gate-runs/evolve/commit-anchor/workbench-cards 不迁）；**一切真实内容改写（import 路径重写）由智能体走 Write/Edit 受扫描**，tsc 全清单驱动补漏。
- 收编粒度调整：用户一次跑完全部四组搬家，智能体一次改完全部 import——**归组成为单个原子 commit**（放弃逐组四 commit），以全门禁（tsc+638+/e2e 62+build+UI 冒烟+docker）护航、可整体 revert。票上「逐组绿」是 churn 预算的保守假设，原子单 commit 同样满足「每 commit 可验绿可回滚」铁律。
- 附：门曾拦截会话内的探测文件清理（mv-probe-a.ts 进敏感名单删不动），.cmd 里含 `del` 一行由用户侧顺带清除（智能体自造探针，非源码）。
