# 01：G1 — 哨基建先行（V27-10 机制清偿·G8 划账；立 D8 双哨）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（grill D8：双哨同表+全局扫描升级）。*

Status: closed
标签：文案哨 / 先行票 / 来源：v027 台账 V27-10 + D8。

## 现状

copy-guard 英文封条只锚 2 个 testid 位点（copy-guard.test.ts:49-60），位点外英文「Evolution」用户文案会漏网（台账 V27-10 前瞻项）；服务端文案（worker stage label、agent 提示词、export 模板标题）历史上无哨。侦察已逮到漂移活例：「演进推演」被前端哨禁、却被 EvolutionView STAGE_LABEL 与 worker label 使用。

## Agent Brief

**Summary:** ①`copy-guard.test.ts` 把 Evolution 封条从 testid 位点升为**全组件 JSX 文本节点扫描**（遍历 `components/**/*.tsx` 源文本，剥标识符语境后断言 `\bEvolution\b` 仅存于代码标识符——具体判据实施时定稿，防 EvolutionView/EvolutionRisk 误伤是硬约束）；②新增服务端哨 `services/control-plane/src/copy-guard.server.test.ts`：worker.ts 中文 stage label 集合、agent.ts SYSTEM_PROMPT、export 模板标题三面断言「零退役词」——本票黑名单暂只入现词（拆除计划等 7 词表 B 已定退役项），给 03/05/07 各票留同票扩词空间；③英文词 JSX 级扫描层机制建立但词表暂空（表 D 第二层随 03 票入词）。
**Acceptance:** ①新哨在当前文案下有**已知红例**（临时植词→红→回滚）证明灵敏度，非空转；②web/cp 全量绿（新哨自身除外零改测试）；③零业务文案改动（本票只立闸不改案）。

## Comments（2026-09-16 实施收口）

- **黑名单跨包升格**：词表权威移到 `packages/contracts/src/copy-blacklist.ts`（`USER_COPY_BLACKLIST`，contracts 首次携带运行时常量——裁决：词表即双面体共享契约，web/cp 两哨物理共表，杜绝 v0.27-B R3 同款「第二事实源」漂移）。web `client/copyBlacklist.ts` 降为桥接（errorCodes/copy-guard 消费者原名零改动）；整词只写在扫描根之外，自燃通道为零。
- **D8② 英文层**：copy-guard.test.ts 新增 `stripComments`（字符串感知剥离）+ `userTextRegions`（JSX 文本节点+字符串字面量）机制层；Evolution 封条升为全 src 非测试源码扫描（V27-10 销）；`ENGLISH_RETIRED` 词表 G1 留空、G3 随退役填入——灵敏度由 3 例注入/免疫测试证明（JSX/attr/label 三种载体命中；import/复合标识符/注释零误伤），非空转。已知限制（注释+票面登记）：正则字面量含引号可能误导剥离器奇偶，真触发误报再具名豁免。
- **D8③ 服务端哨**：`copy-guard.server.test.ts` 新建（扫描面=agent 提示词/chat routes/export 模板/worker 中文 label 四件，即「会进用户眼睛」面；routes/analysis 等工程结构注释不入本役射程）。burn-down 挂账 `PENDING_RETIREMENT={拆除计划, 架构指标}`（现文案活居，G5/G7 销词同 commit 摘挂账——meta 测试防僵尸豁免）。本包 CJS 构建，`import.meta` 违 tsc 红线，SRC 定位改 `process.cwd()/src`（包内跑测纪律，CI matrix 同路径）。
- **新发现立账（非本票修复）**：e2e chat/incident 检查在根 `.env` 在场时**实走远程 LLM**（`server spawn cwd=ROOT` 继承 dotenv），本轮三跑红位漂移（incident/chat SSE/persist，90s 超时）皆为外网慢——对照组清空 `REPOQA_LLM_*` 强制确定性 fallback 后 62/62。gate 非 hermetic 属既有缺陷，登记 V30-9（hermetic 化：gate spawn 显式清除/覆写 LLM env，stub 面归 UI 冒烟已验）不扩本票范围。
- 门禁：tsc 四包 0 错 | cp **649**（+4 新哨）| web **360**（+4 新层）| bridge 26 | e2e 62/62（对照组）| UI 冒烟 PASS | docker 构建+容器冒烟（票收口时随 commit 记录）。
- 零业务文案改动核实：本票 diff 只含 contracts 新词表+桥接+两哨测试文件，表 A/B/C 文案面零触碰（G3/G5 开工）。

## Reviewer-Security 处置（1×P1 + 6×P2，全部闭环于 fix commit）

- **P1（僵尸豁免从根凿穿）已修**：burn-down 活性判定改「字符串区域扫」——`拆除计划`/`架构指标` 在扫描文件里的注释栖身（agent.ts:169,336、routes.ts:170、export.ts:8）不再给挂账续命；G5/G7 销真文案后，若忘摘挂账，活性测试即红。中文主扫保持全文含注释（退役词入表后注释栖身也拦，与 web 同哲学，G8 扫尾纪律不变）。
- P2-2 种子断言：主测试前钉「Sidebar 收集器必须看见『规范演进』」——收集器坏则先红不空转。
- P2-3 剥器连坐面：' 与 " 不跨行闭合（JS 语义），未配对撇号（`Don't` 式 JSX 文本）不再吞后续注释；免疫测试补含撇号活例；残留面（未闭合反引号）已登记限制。
- P2-4 英文层跨包共表：`USER_COPY_ENGLISH_RETIRED` 入 contracts 与中文表并置（中文表头注加「英文词禁入本表」护栏——两判据不同物勿合并）；cp 哨对 4 文件加英文区域扫；web 局部表废除（否则英文层自犯它要治的双表病）。
- P2-5 cwd 守卫：SRC 定位失败给「须从包根执行」响亮指引。**载体棘轮缓做**（评审建议之目录启发式在 4 文件清单外易误报，G1→G8 七票窗口以 G8 终扫+人工 diff 兜底，登记不静默）。
- P2-6 跨行断裂：兜底扫只对字符串区域扁平化（全文扁平会把「…读\n侧…」散文拼成假命中）。
- P2-7 票面精度：标题「销 V27-10」改「机制清偿·G8 划账」（V27-11 战役总账在 G8 统一划销）；Summary 三面→四面以本处置记录为准。
- 复跑：tsc 四包 0 错 | cp **650** | web **360** | 双哨注入/免疫/活性/挂账全绿。
