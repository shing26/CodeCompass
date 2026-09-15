# 03：G3 — chrome 中文化（销 V27-11② + V27-14）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（表 A 全量；D3 工程通用语保留）。*

Status: closed
标签：文案 / 大票 / 来源：v027 台账 V27-11②、V27-14。

## 现状

~55 唯一英文短语散落内联（无 i18n 层，侦察表 A 逐位点列账）；V27-14 Sidebar 空态噪音（`0 files — expand to browse`/`ROUTES (0)`/中英混排）同性质同文件并入。

## Agent Brief

**Summary:** 按表 A 全量替换；KIND_FILTER_OPTIONS 只译 label 不动 value；HTTP 动词/语言名/品牌/API/Git/URL/Token 按 D3 保留。**同 commit 联动**：App/TopBar/Canvas 票15 实名哨/TourPlayer/ImportRepoModal/ArchitectureDeltaView/CiGateView 等英文钉句断言同票改；表 D 第二层英文退役词随本票入 contracts 共表。V27-14 空态降噪：计数零不印、英文噪音行人话化。
**Acceptance:** ①表 A 位点 grep 零残留（保留名单除外）；②web 全量绿、testid 全保；③两视口实拍（集中随 G8 兑现，票面登记）；④ui_smoke 全链路绿（testid 驱动零改动）。

## Comments（2026-09-16 实施收口）

- **表 A 全量落地**（TopBar/Sidebar/App/DashboardView/Inspector/SubgraphPanel/Canvas/ImportRepoModal/StatusStepper/SourceTraceDrawer/QuickTours/TourPlayer/ArchitectureDeltaView/CiGateView/index.html）：Watcher→文件监视、Import repo→导入仓库、13-Rules Masked→13 条规则已脱敏、Clean/Cyber→清爽/赛博、Loading…族→…加载中、No file open→未打开文件、Click a diagram node…→点击图上节点或源码卡片、Source trace→源码溯源、Quick/More/Hide Tours→导览族、Base/Head ref→基线/待审（引用）、Added/Removed Routes→新增/移除接口、Broken Edges→断裂边、Impacted APIs→受影响 API、Tech Stack/Architecture Scale/Config Topology→技术栈/结构规模/配置拓扑、depth/sensitive→深度/敏感、Top Core API 入口→Top 核心 API 入口、KIND 过滤器 13 label 中文化（value 不动）、符号树 kind 直出改中文标签（复用过滤器 label）、页脚 files/symbols→个文件/个符号、Caller/Callee/Target→调用方/被调方/目标（Canvas ROLE_COPY 映射、SubgraphPanel 图例、Inspector 切片 role 值内嵌中文化）、Workbench views→工作台视图、ImportModal 全按钮组中文化（Git URL→Git 地址；placeholder 示例保留）、浏览器标题→CodeCompass 工作台。
- **D3 保留面核实**：HTTP 动词/语言名/API/Git/URL/Token/MCP/LLM/SQL/Mapper/Local-First/品牌/commit/Agent/ONBOARDING.md 全部原位；`Token 预算`、`{n} / {m} Tokens`、Top APIs、commit hash 等属机器/通用语，零改动。
- **V27-14 空态降噪**：未选库导览句改人话；`Routes (0)`→接口（零数不印计数）；`N files — expand to browse`→`N 个文件，点「展开」浏览`；kind 过滤器不再直出小写英文。
- **测试联动 23 处**（TopBar.test×5、App.test×5、Canvas.test×6、Inspector.test×3、QuickTours.test×3+错误句、DashboardView.test×2、TourPlayer.test×3、SubgraphPanel.test×2、Sidebar.test×2、CiGateView.test×1）全绿；**testid 零改动**（diff 复核无 data-testid 行变更）；Canvas 票15 实名哨升级为「导入仓库」+`not.toContain('Import repo')` 双向钉（旧英文复活即红）。
- **英文退役表首批填词 38 项**入 contracts（表 D 第二层）；哨裁决记录：「Quick Tours/More Tours/Cancel」三词在 grep 粗扫误报，实为注释与标识符（onCancel），区域收集器免疫实证通过——机制判定优于词面 grep。
- **提前吃进票 05 范围一项**：导出模板节标题（技术栈/结构规模/脱敏配置去英文括注+SCALE_LABELS 中文化）系 cp 英文区域扫的拦路虎，随本票销——同时把挂账 `架构指标` 从 cp PENDING 摘除（销词同 commit 纪律首次实战）；export.test/repoqa-http.test 钉句 8 处同步。票 05 范围相应缩减（剩余=前端黑话+worker label+双端同步项）。
- 门禁：tsc 四包 0 错 | web 360 | cp 650 | e2e 62/62（LLM 环境变量清空对照组）| UI 冒烟 PASS | docker v030g3 重建+/health 绿（version/深检齐）。
- **留票 03 未做，移交登记**：`Step`/`Workbench` 未入英文表（Step 在 ScenarioGuide 域属票 07；Workbench views 已译但单字 Workbench 系产品名场景）；CiGateView `{run.status}`/`dirty`、Canvas `BROKEN`、EvidenceCard、CommandPalette anchor.type、PlanCardView intent 直出——全部属表 C 枚举映射，归票 04。
