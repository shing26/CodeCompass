# v0.30 去极客化战役 spec（销 V27-11 + V27-2/3/4/10/14）

> 2026-09-16 grill 定案（D1-D8 全表见下）。来源：2026-09-12 用户反馈「太工程化/极客」→ v0.27-UI U5 裁决独立战役 → v027 台账 V27-11。
> 版本预claim：**v0.30**（D2：先切 v0.29.0 已发布 8a74d4f/tag v0.29.0/双绿，本战役骑干净 master）。
> 侦察基线：2026-09-16 双路探查（111 处任意值字号、~55 英文短语、~40 黑话命中、9 徽章家族、styles.css 85 行 4 段、228 处文本断言、copy-guard/实名哨位点全清单——行号以本 spec 四表所列 file:line 为准，动工时若有漂移以词面为锚）。

## Grill 定案

| # | 决策 | 定案 |
|---|------|------|
| D1 | 射程 | 主战役包：V27-11 五件套 + V27-14 空态 + V27-2/3 命名族 + V27-10 封条升级 + V27-4 ScenarioGuide。**暂缓**：V27-5、V27-6、V27-15、V27-16、V27-17、V29-1（各留原账，去极客化不混入行为手术） |
| D2 | 节奏 | 先切 v0.29.0（已执行），本战役收口另切 v0.30.0 |
| D3 | 混排边界 | **工程通用语保留**：HTTP 动词、语言专名、API、Git/URL/IDE、Token、LLM、MCP、SQL、Mapper、Local-First、品牌 CodeCompass。其余 chrome 全中文化 |
| D4 | 枚举值 | **契约不动、展示层映射**（未答按推荐记为授权假设）：payload 枚举/SSE/MCP 输出/e2e 断言的机器值一律不动，新增前端映射表出中文徽章。[cite: N] 机器格式与后端 rewrite 不动，只改引导语 |
| D5 | 字号 | 两档语义化：11px→text-xs(12px)、9/10px→新增 text-micro(10px)；任意值归零，Monaco `fontSize:13` 豁免（编辑器配置非文案） |
| D6 | 徽章 | 组件化双件：`Badge`（状态/风险/语言/动词/阶段变体）+ `CountPill`；mermaid 伪元素角标与品牌角标保留（SVG 域无 React）；**全部 testid 原样保留**，测试只改断言文本 |
| D7 | styles.css | 全迁清零：4 段→Tailwind 语义类，`.chat-starter` 死段 grep 确认后删，styles.css 整文件销号；index.css 主题 token 层保留 |
| D8 | 哨 | 双哨同表+全局扫描升级（V27-10 吃进）：①退役中文词→copyBlacklist 全文扫（含注释，无标识符冲突）；②退役英文词→**JSX 文本节点/字符串字面量级**扫描（防 EvolutionView 等标识符误伤）；③服务端文案哨新设（worker label ∪ agent 提示词 ∪ export 模板标题 ∈ 对照表）；④改文案与改哨断言同 commit |

## 铁律

1. **零行为变更**：契约值、枚举字面量、SSE 字段、stage **id**（intent_parse/target_resolve/convention_scan/pipeline/diagram——closeout_gate:1544 钉死）、MCP 输出、端点行为一律不动；动的是 className、label 值、人话文案。
2. **testid 全保**：masked-badge/gate-risk-badge/slice-chip/tech-chip/highlight-badge/privacy-pill/status-step-* 等定位符零改名。
3. 每票独立 commit、全门禁护航（tsc 四包 / cp 644+ / web 356+ / bridge 26 / e2e 62 / UI 冒烟）；G5 动 server 文案面加跑 docker（与 e2e 串行防 VirtualAlloc）；golden eval 在 G5、G8 各重跑一次。
4. copy-guard 全文扫描含注释与测试——各文案票把改红注释顺手清完，不留悬红。

## 表 A：chrome 中英对照表（D3；~55 短语，file:line 为侦察锚点）

| 现文 | 定为 | 位点 |
|---|---|---|
| `Watcher: Ready/Indexing/Offline/Standby` | `文件监视：就绪/索引中/离线/待机` | TopBar.tsx:66-74,206（App.test:285,296、TopBar.test:221 同票改钉） |
| `Import repo` / 窄屏 `+` | `导入仓库` / `+` | TopBar.tsx:212,218-220；Canvas.test:55 实名哨断言同步改 |
| `13-Rules Masked` | `13 条规则已脱敏`（计数动态则 `{n} 条规则已脱敏`） | TopBar.tsx:300、TopBar.test:222 |
| `Clean`/`Cyber`、aria `Switch to … theme` | `清爽`/`赛博`、`切换清爽主题/切换赛博主题` | TopBar.tsx:307,314、TopBar.test:287-295 |
| aria `Close/Open sidebar`、`Workbench views` | `收起侧栏/展开侧栏`、`工作台视图` | TopBar.tsx:171,343 |
| `Loading repos…`、`Select a repo` | `仓库加载中…`、`选择仓库` | TopBar.tsx:193 |
| 页脚 `N files`/`N symbols`；`Local-First` 保留 | `N 文件`/`N 符号` | App.tsx:346-348 |
| `Tour · {title}` | `导览 · {title}` | App.tsx:223；TourPlayer `Step i / n`→`步骤 i / n`（App.test:573 同票） |
| `Quick Tours`、`Choose a repo to see recommended tours.`、`Loading tours…`、`No tours available.`、`More Tours (n)`、`Hide More Tours` | `快速导览`、`选择仓库后可见推荐导览`、`导览加载中…`、`暂无导览`、`更多导览 (n)`、`收起更多导览` | Sidebar.tsx:219,232；QuickTours.tsx:23,43,73 |
| `Routes (n)`、`Loading…`×2、`Symbols`、`Collapse`/`Expand`、`+n more`、`{n} files — expand to browse` | `接口 (n)`、`加载中…`、`符号`、`收起`/`展开`、`+n 更多`、`{n} 个文件，展开浏览` | Sidebar.tsx:254,256,288,309,281,313,315（V27-14 空态噪音并入：`0 files — expand to browse` 同句中文，空仓时整块降噪由票 03 顺裁决） |
| KIND_FILTER_OPTIONS 小写英文 | 全部类型/HTTP 接口/类/接口定义/方法/服务/仓储/Mapper/切面/字段/SQL/配置/依赖（`value` 枚举不动，只译 `label`） | Sidebar.tsx:28-42 |
| 语言/HTTP 动词徽章 | 保留（Java/TS/…、GET/POST/…）；`CODE` 兜底→`代码` | Sidebar.tsx:54-85；Canvas.tsx:301-320 |
| `Loading dashboard…`、`Tech Stack`、`Architecture Scale`、`Config Topology` | `仪表盘加载中…`、`技术栈`、`结构规模`、`配置拓扑` | DashboardView.tsx:49,118,157,177（V27-3 对齐：导出模板标题同步票 07） |
| SCALE_ORDER 九名 | 接口/服务/仓储/切面/普通类/接口定义/方法/字段/配置键/文件 | DashboardView.tsx:17-28 |
| `Top Core API 入口`、`depth n`、`sensitive` | `Top 核心 API 入口`、`深度 n`、`敏感` | DashboardView.tsx:217,239,204 |
| Inspector `No file open`、`Loading file…`、`Click a diagram node or source card…`、aria `Back/Forward/Close inspector`、`Token 预算`、`{n} / {m} Tokens` | `未打开文件`、`文件加载中…`、`点击图上节点或源码卡片，在此打开文件`、`后退/前进/收起检视器`、保留、`{n} / {m} tokens` | Inspector.tsx:238,346,359,218-255,324,335（App.test:1094,1104 同票改钉） |
| `↑ Caller/↓ Callee/Target`、`Start n/Caller n/Callee n` | `↑ 调用方 / ↓ 被调方 / 目标`、`起点/调用方/被调方 + n 中文` | Inspector.tsx:397；Canvas.tsx:357；SubgraphPanel.tsx:11-12,127-135 |
| Canvas `← Prev`/`Next →`/`Step i/n`/`BROKEN`/`↑ API n`/`↓ SQL n` | `← 上一跳`/`下一跳 →`/`步骤 i/n`、BROKEN→表 C、API/SQL 计数丸保留 | Canvas.tsx:230,236,241,160-168 |
| ImportRepoModal 全按钮组：`Import or clone repo`/`Import source`/`Cancel`/`Import`/`Importing…`/`Git URL`/`Branch（可选）`/`Clone & import`/`Cloning…`/`Indexing…` | `导入或克隆仓库`/`导入源`/`取消`/`导入`/`导入中…`/`Git 地址`/`分支（可选）`/`克隆并导入`/`克隆中…`/`建立索引…`；placeholder 示例保留 | ImportRepoModal.tsx:225-518（ImportRepoModal.test 18 断言同票） |
| StatusStepper aria `Indexing progress` | `索引进度` | StatusStepper.tsx:61 |
| `Source trace` | `源码溯源` | SourceTraceDrawer.tsx:18 |
| ArchitectureDeltaView `Base ref`/`Head ref`/`Added Routes`/`Removed Routes`/`Broken Edges`/`Impacted APIs`/`dirty` | `基线引用`/`待审引用`/`新增接口`/`移除接口`/`断裂边`/`受影响 API`/`未提交改动` | ArchitectureDeltaView.tsx:157-270（8 断言同票） |
| CiGateView `Base`/`Head`/`Routes`/`Top APIs`/`Files` | `基线`/`待审`/`接口`/`Top APIs`/`文件` | CiGateView.tsx:345-475 |
| 浏览器标题 `CodeCompass Workbench` | `CodeCompass 工作台` | index.html:7 |
| 「已复制」「LLM 未配置/LLM 解析」等已中文件 | 保留；「LLM 解析」→「LLM 整理」入表 B 判定 | ChatView.tsx:161、EvolutionView.tsx:248 |

## 表 B：黑话替换表（V27-11③；前端 + 服务端双写位点必须同票改，D4/D8）

| 退役词 | 定为 | 位点（含服务端） |
|---|---|---|
| `AST 提取`/`解析 AST`/`AST 确定性分析` | `代码解析`（阶段名）；句子人话化「由确定性代码分析生成」 | StatusStepper.tsx:5、ImportRepoModal.tsx:417-419、Canvas.tsx:212；**worker.ts:497 label 同改** |
| `2-Hop 关联切片` | `上下游关联切片` | Inspector.tsx:389 |
| `零幻觉锚定`、`目标锚定`、`未锚定目标`、`物理锚点` | `证据逐字可查`、`目标定位`、`未定位到目标`、`精确定位（file:line + commit）` | EvidenceCard.tsx:44、EvolutionView.tsx:28,252,261、StackTraceInput.tsx:88；**worker.ts:668,697 label 同改**（前端 STAGE_LABEL 是自家映射，双保） |
| `孤岛` | `孤立代码` | ChatView.tsx:16 starter 标题 |
| `波及`（受波及树/被波及的接口/N 波及/受波及面/被波及的调用者） | `影响`（影响树/受影响的接口/N 受影响/影响面/受影响的调用方） | Canvas.tsx:154、ChatView.tsx:27、TopBar.tsx:59、ArchitectureDeltaView.tsx:157、CiGateView.tsx:501 |
| `工件卡`/`工件流`/`新卡片进入同一工件流` | `方案卡`/`方案流`（CONTEXT 词条 Intent→Artifact 保留域内名，用户文案降「方案」；导出 HTML「本工件」→`本文件`，export-artifact.ts:171） | EvolutionView.tsx:445,460,468 |
| `惯例嗅探` | `代码惯例扫描` | EvolutionView.tsx:29 STAGE_LABEL；**worker.ts:703,776 同改**；CONTEXT:75 词条中文名同步改（票 07） |
| `演进推演`/`推演中…`/`开始推演`/`追加推演`/`会话已切换，推演中断` | `方案生成`/`生成方案中…`/`开始生成方案`/`追加方案`/`会话已切换，方案生成中断`——**了结现役闸门冲突**（Canvas.test:82/Sidebar.test:273 禁此词，EvolutionView.tsx:30,479 与 worker.ts:707,780 却仍在用） | 双端 + useEvolutionSession.ts:273 |
| `落位`（表/点/靶点/这次落位/产出落位） | `方案`（清单/建议/靶点→改动目标）；tab title「产出落位建议」→「产出落地建议」 | TopBar.tsx:60、Canvas.tsx:282、EvolutionView.tsx:118,347,361,451,460,468 |
| `[cite: N]` 字样印在引导语（机器格式与 rewrite 不动，D4） | 「证据角标（点击溯源）」「上标数字可点开查证」 | TopBar.tsx:57、Canvas.tsx:288、ChatView.tsx:434 |
| `拓扑收敛`、`图谱投射`、`意图解析`、`跨语言桥接`（worker 中文 label，SSE 进 UI） | `结构收敛`、`图表生成`、`需求理解`、`跨语言关联` | worker.ts:523,541,577,657,786 |
| 系统提示词 `拆除计划`（V27-2） | `下线方案`；:19 触发条件改「明确要求演进或**下线**」并保留同义词（删除/清理/下线）保触发 robustness；chat/routes.ts:170、chat.test:426,479 mock 同票 | agent.ts:19,23 |
| README `模块演进推演`:181、`安全下线推演`:63、`扩展挂载推演`:64、`1-Hop/…Hop`:177、`架构指标`:37、`模块演进副驾`:62 | 与表 C/D 同步人话化（README 属产品门面，票 07 统一）；ADR-0014/15 正文「模式嗅探」**不改**（历史记录不改写惯例） | README.md；CONTEXT.md 票 07 |
| `架构指标（Architecture Scale）` 导出模板标题（V27-3） | `结构规模（Architecture Scale）` | engine/repoqa-export.ts:78 + repoqa-export.test.ts:175 + repoqa-http.test.ts:1654；**动工先核 golden eval 是否锁此标题**（eval-ts 面），锁则上账裁决再动 |
| ScenarioGuide 三段化（V27-4） | 复制命令旧动线改当前真实三段动线，用词全部 ∈ 表 A/B/C | CiGateView.tsx:288-291 附近 |

## 表 C：枚举展示映射（`client/statusLabel.ts` 新建；契约值不动，D4）

| 机器值 | 中文徽章 | 位点 |
|---|---|---|
| `VERIFIED`/`BREAK`/`SUSPECT` | 已验证/断链/存疑 | EvidenceCard.tsx:9-22 STATUS_BADGE（testid gate-risk-badge 等全保） |
| `PASS`/`FAIL` | 通过/未通过 | CiGateView.tsx:462-468 |
| `LOW`/`MEDIUM`/`HIGH` | 低/中/高风险 | CiGateView.tsx:534、riskBadgeClass:43-47 |
| `EXTEND`/`DEPRECATE` | 扩展挂载/安全下线 | PlanCardView.tsx:55 |
| `CONTROLLER`/`ENTITY` 等 anchor.type | 控制器/实体/方法/配置项…（按 CommandPalette.tsx:249-256 全集） | CommandPalette.tsx:249-256 |
| `BROKEN`（trace 断点角标、mermaid 伪元素保留 SVG 域） | `断链`（React 域走表 C；伪元素 index.css:259 改中文 content，G6 迁 styles 时顺） | Canvas.tsx:241 |
| `dirty`/`sensitive` | 未提交改动/敏感 | CiGateView.tsx:473、DashboardView.tsx:204 |
| closeout_gate:622 `VERIFIED\|BREAK\|SUSPECT` marker 与 :1001 `"VERIFIED"` | **不动**（SSE/MCP 机器面） | scripts/e2e/closeout_gate.py |

## 表 D：退役词黑名单扩容（D8 双层）

- **全文扫层（中文词，无标识符冲突）**：AST 提取、2-Hop、锚定、孤岛、波及、工件卡、惯例嗅探、演进推演、落位、拓扑收敛、图谱投射、拆除计划、模式嗅探、架构指标、读侧、写侧（+现有 7 词）。
- **JSX 文本/字面量扫层（英文词，防 EvolutionView/EvolutionRisk 等标识符误伤）**：`Watcher`、`Import repo`、`No file open`、`Loading…`、`Quick Tours`、`Tech Stack`、`Base ref`、`VERIFIED/BREAK/SUSPECT/PASS/FAIL`、`[cite:`。
- **服务端哨（cp 测试新位点）**：worker.ts 中文 stage label 集合 ⊆ 表 B 新词全集；agent.ts 提示词零退役词；export 模板标题 ∈ 表 B。
- **V27-10 升级**：`copy-guard.test.ts` Evolution 英文封条由 2 testid 位点升为全组件 JSX 文本节点扫描（G1 落地，先机制后扩词——防无哨窗口期）。

## 票池（执行序 G1→G8；每票全门禁）

| 票 | 账 | 一句 | 主要红线 |
|---|---|---|---|
| 01 | V27-10 + D8① | 哨基建先行：JSX 文本节点级扫描升级 + 服务端哨位点（黑表暂只入现词） | 不动业务文案 |
| 02 | V27-11① | 字号两档语义化：tailwind `text-micro` + 111 处收编 | 纯 className，零文案 |
| 03 | V27-11②+V27-14 | 表 A chrome 中文化（含 V27-14 空态降噪）；App/TopBar/Canvas/ImportRepoModal/ArchitectureDeltaView 等英文钉句与实名哨断言同票改 | testid 全保；~120 断言联动 |
| 04 | V27-11④+D4/D6 | 表 C statusLabel + Badge/CountPill 双件收编 9 家族 | testid 全保；closeout marker 不碰 |
| 05 | V27-11③ | 表 B 黑话清扫（前端+worker 双侧；演进推演闸门冲突了结；架构指标先核 eval） | stage id 不动；SSE label 改值双端同步；docker+eval 加跑 |
| 06 | V27-11⑤+D7 | styles.css 全迁清零（含 mermaid 伪元素角标中文、`.chat-starter` 死段删除） | 实拍验收 |
| 07 | V27-2/3/4+D8③ | 命名族文档票：agent.ts 拆除计划、README 五处、CONTEXT 词条（含「用户文案规范」新词条+惯例嗅探改名）、ScenarioGuide 三段化、ADR 正文不动登记 | export 标题双测试+eval 联动 |
| 08 | 收口 | 黑名单扩容全表 + 注释扫尾 + 两视口实拍 + golden eval + e2e 62 + UI 冒烟 + docker + CHANGELOG 0.30.0 + 总账划销 V27-2/3/4/10/11/14 | 发布令随票面出 |

## 明确不做（本战役窗口）

首屏改 chat、六 tab 增删、主题重设计、V27-5 改名（第三次翻车风险）、V27-6 色族（独立票带）、V27-15 a11y、V27-16 选题、V27-17 tours 内容、V29-1 传输手术、ADR 正文改写、MCP 工具 description 全量中文化（MCP 消费者是 agent 不是人，维持英文）。

## 验收门（战役级）

- 视觉票（02/03/04/06）收口跑两视口实拍（a04-shots rig 先例）+ judge 视觉验收；G8 终版实拍全套。
- 每票：tsc 四包 / web 全量（356+ 基线，断言文本改动只多不少）/ cp（G5/G7 涉服务端）/ e2e 62 / UI 冒烟；G5/G8 加 docker 与 golden eval（与 e2e 串行）。
- 文案与哨同 commit；票面 Comments 记录断言改动计数与实拍结论。
- 双 agent 惯例：v0.30 本线预 claim；改动面 web 前端 + cp 文案位点 + 文档，与智能体线无对撞（parallel-collaboration.md 已核对：那边消费 MCP 工具面，不触 web 文案）。
