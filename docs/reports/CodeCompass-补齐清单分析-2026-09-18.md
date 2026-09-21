# CodeCompass — 补齐清单分析

> 分析日期：2026-09-18
> 被分析对象：`D:\WorkBuddyData\项目补齐清单\01-CodeCompass-补齐清单.md`（6 份独立清单中的 CodeCompass 那份）
> 核实基线：本机工作区 `D:\CodeCompass`，HEAD = `5700bbd`（`v0.31.0` 版本已推进、**未打 tag**）
> 清单自身口径：`2026-09-17-17-26-22\_audit\CodeCompass` 浅克隆（`--depth 1`）
> 结论一句话：**清单的事实依据全部复现通过，但它列的 5 项里有 4 项已经不是"缺口"而是"已立项未执行"或"卡在用户侧"；真正的增量在清单之外——README 的 IDE 配置会让人装成别人的包，以及 MCP 契约面上三处声明与实现不一致。**

---

## 1. 核实方法

清单是 09-17 的浅克隆快照，本工作区在它之后还有 3 个提交（`80186e7` Go receiver、`cb15585` 文档一致性批、`5700bbd` M2 归零 + 版本推进）。因此逐条不是"读一遍清单"，而是：

1. 对清单每一条的**实测证据**在本工作区重跑（npm registry 查询、`gh release list`、README 行号与计数、CI 步骤枚举）；
2. 对照项目**自己的**票池（`.scratch/v031-precision/spec.md` + `issues/01–07`）判断该条是否已在飞、是否已被裁决、是否卡在用户侧；
3. 对照 `docs/reports/scan-precision-baseline-2026-09-16.md` 复算 C2 引用的每一个数字。

---

## 2. 逐条核实结果

### C1 · README 分发路径对齐（清单判 P0）

**清单的实测证据——全部复现通过：**

| 清单断言 | 本工作区实测 | 结论 |
| --- | --- | --- |
| `npm view @codecompass/cli` → E404 | 2026-09-18 复现，404 | ✅ 成立 |
| `release.yml` 有意缺席 npm publish | 注释在 `release.yml:86-88`，写明 2026-09-04 切 B 内测 | ✅ 成立 |
| README 写「当前版本 v0.26.0」 | `README.md:244` 确为 `v0.26.0` | ✅ 成立 |
| README 工具表 15 行、真实 17 | 表 15 行；`MCP_TOOLS` 实测 **17**（`repoqa-mcp.ts` 计数） | ✅ 成立 |
| `get_conventions` 在 README 零出现 | `grep -c` = 0 | ✅ 成立 |

**但清单有两处表述在 09-17 之后已经过期：**

1. **「README 说 15 个工具」已不成立**。`README.md:163` 正文现已写「当前提供 **17 个**确定性工具」——这是 `cb15585`（票 03(b)）改的。**改的是正文数字，漏的是可枚举清单**：表仍只有 15 行，`plan_evolution` 只在 `module_evolution` 那行的弃用说明里被提一句。所以 C1 第 4 条（补 2 行）仍然精确成立，但它的理由要改写为**「README 内部自相矛盾」**（正文 17 / 表格 15），而不是"README 说漏了 2 个工具"。
2. **「陌生人第一步 100% 失败」严重度被高估**。README 的「快速上手」第一段是**方式一：源码构建**（`README.md:81-94`：`npm run install:all` → `npm run build` → `codecompass <path>`），这条路径可用。会 404 的是其后的「安装（npm）」段（`:147-157`）。即：陌生人按文档从上往下走**是能跑通的**，只有选了 npm 那条捷径才会失败。这不是"仓库完全不可接触"，是"其中一条被推荐得最显眼的路径不通"——严重度从"100% 失败"降为"首选捷径失败"。

3. **C1 已被项目自己立项，且在两张票里**：票 03(b) 已改正文数字并打 ✅（虚高，见下）；未跟踪的 `issues/07-mcp-contract-closeout.md` 的 (d) 项已把"表格补 2 行 + 给 `module_evolution` 加机器可读弃用标注 + 新增 `readme-tool-table-parity` 门禁断言"写成完整草案，状态是**待用户裁决**。

**判定：不是新缺口。C1 = 裁决 issue 07 即可执行。**

### C2 · 桶语义四项裁决（清单判 P0）

**数字逐项复算，与清单完全一致**（源：`docs/reports/scan-precision-baseline-2026-09-16.md` §7.5）：

- lazygit 全桶孤儿 **2805**；类型声明 **623**（22%）、接口实现方法 **620**（22%）、接口方法声明 **375**（13%）；
- 三项合计 **1618**，占 **58%**——报告原文措辞是"需要**桶语义裁决**而不是代码修复"；
- 三项裁决落地后 lazygit 孤儿 = 2805 − 623 − 620 − 375 = **1187**；
- 三仓 top-10 假阳性 **100%（10/10）**，且报告明确写"接收器绑定类工作不可能推动它"。

**清单有两处偏差：**

1. **这不是"待发现的缺口"，而是项目自认的 P0 阻塞项。** `issues/02-residual-precision.md` 用一整节写「阻塞项（需用户裁决，不在本票文件面内）」，三个问题与清单表格逐字对应，连预期值 1187 都一样。清单的价值在于"建议以 ADR 形式固化"，不在于发现。
2. **「`scan-engine.ts`、`domain-radar-engine.ts` 均不在票 02 的文件面声明内」已过期。** `scan-engine.ts` 已在票 02 文件面补齐登记（第三增量 M2 归零就改在这个文件）；只有 `domain-radar-engine.ts` 确实未登记。

**判定：成立且是主轴唯一卡点，但属"已挂账，只差裁决"。**

### C3 · precision harness 接 CI 棘轮（清单判 P1）

**成立，且比清单说的更彻底**：`.github/workflows/ci.yml` 三个 job（单测矩阵 / E2E gate / Docker）**无任何 precision 步骤**；更关键的是 `scripts/precision/scan_precision.ts` **连 npm script 都没挂**（根 `package.json` 无 `precision` 条目），目前只能手敲路径跑。要接 CI，先得补 wiring。

**但清单漏了一个次序陷阱**：M1 现状是 **100% 假阳性**。此刻把"当前基线"接成门禁棘轮，等于把**一个已被报告判定为口径错误的结果冻成门禁底线**——以后精度真提升了，棘轮反而会因为"低于基线"报红。棘轮的阈值只有等 C2 裁决落地、复算过 1187 之后才有意义。

**判定：方向正确，但必须排在 C2 之后。**

### C4 · npm 同名包混淆防护（清单判 P1，10 分钟）

**成立**：npm 上确有他人包 `codecompass@1.0.0`（publisher `alvinveroy`，仓库 `github.com/alvinveroy/CodeCompass`——**连仓库名都同名**）；README 全文无"内测期不经 npm 分发"一类声明。

**但清单只找到了一半，而且漏掉的是更硬的那一半。**

README `:190-210` 手写的 Cursor / Claude Desktop 配置里，命令是：

```json
{ "command": "npx", "args": ["codecompass", "mcp", "/path/to/your/repo"] }
```

`npx codecompass` 解析的是 **npm 包名 `codecompass`**，不是 `@codecompass/cli` 的 bin（本项目 `package.json` 里 `bin` 名确实是 `codecompass`，但 npx 按**包名**查注册表）。陌生人照抄这段配置，在没有本地安装时**会下载并运行 alvinveroy 的那个包**。这比"读者可能装错包"严重一档：它是**被文档主动引导的故障**。

对照之下，安装器生成的配置是**正确的**——`installer.ts:191` 写的是 `{ command: <node 绝对路径>, args: [<cli.js 绝对路径>, 'mcp', <repo>] }`，自包含、不查注册表。即：`codecompass install --ide cursor` 这条路没问题，**错的只有 README 里的手抄示例**。

修法也随之明确：把那两段 JSON 换成 `npx -y @codecompass/cli mcp <path>`（发布后），或直接改写成"用 `codecompass install --ide <ide>` 自动写入"。另加清单建议的那行免责声明。

**判定：成立，且应升级——它是本清单里唯一"照做就会出错"的项。**

### C5 · 版本单源 + README 一致性校验（清单判 P2）

**成立，实测覆盖范围比清单以为的更窄**：`closeout_gate.py::check_versions` 断言的是 `package.json == version.ts == CHANGELOG`（`:415-433`），另有 `mcp-handshake-version`（`:446-453`）与 `/health payload version`（`:459-471`）。**README 完全不在断言范围内**（gate 全文无 README 引用）。

而且版本口径实际有**四处**，不是清单说的三处：README `v0.26.0` / `package.json` + `version.ts` = `0.31.0` / 最新 Release 与 tag = `v0.30.0`（v0.31.0 未打 tag）。README 落后 5 个 minor。

**判定：成立，成本 1 小时，与既有 gate 同表扩展即可。**

### 清单的「明确不做」六条——逐条核对，**全部认同**

| 清单否决项 | 项目内的落点 | 我的判断 |
| --- | --- | --- |
| 加第 18 个工具 / 第 7 个 Tab | `spec.md` §1.1 + HANDOFF §2.2 纪律（票 06） | 认同，且已有文字裁决 |
| 为 Web 做视觉/文案战役 | `spec.md` §1.1「前端只允许收敛与非破坏性修复」 | 认同 |
| 引入 embedding / 向量检索 | ADR-0002（结构化静态分析优先于语义检索） | 认同——这是差异化本身 |
| 重写 TS 适配器架构 | v0.31 已量化：本仓孤儿 −42%、petclinic −76%、lazygit −13.1% | 认同，换架构 = 把已量化收益清零 |
| 承诺 TTFP / Adoption 指标 | `spec.md` §6.4 明令不再写进对外文案；实测 README/CONTEXT 已无 | 认同（票 06 已验） |
| 把"发 npm"当作补齐项 | **这条已过期，见下** | 部分修正 |

**唯一需要修正的是最后一条。** 清单写"那不是缺口，是 2026-09-04 的主动裁决（切 B 内测）"。但项目已在 `spec.md` §3 把 **M4 = 「干净机器照 README 抄一行命令完成 MCP 握手」、目标值 1** 立为本批验收指标，票 03(a) 就是 npm 首发。也就是说：**决策已经翻过一次（B → 发布），且卡点从"要不要发"变成了"用户侧凭证"**（`spec.md` §6.3：npm org + `NPM_TOKEN` 需用户本机执行，agent 只能做发布前核验）。

因此清单文末「需要你拍板的一件事」A/B 二选一，**实际上 A 路已经不在桌面上**：选 A 等于亲手废掉票 03 的验收标准。真正的待办是"用户去建 npm org 并 publish"，不是"再拍一次板"。

---

## 3. 清单未覆盖的增量（我这一侧的发现）

### N1 · README 的 IDE 配置会让人装成别人的包（已在 C4 展开）

**这是清单漏掉的最硬一条。** 严重度不低于它列的 C1：C1 是"命令跑不通"（读者会去试方式一），N1 是"命令跑通了，跑的是别人的包"。

### N2 · MCP 契约面三处声明与实现不一致（`issues/07`，提案待裁决）

清单只看了文档面与 CI 面，没看 **MCP 契约面**——而按 `spec.md` §1 的定位，MCP 才是主面。票 07 已实测坐实三处：

| 项 | 实测 | 为什么重要 |
| --- | --- | --- |
| server `instructions` 未设置（`repoqa-mcp.ts:979` 只传 `capabilities`） | SDK 1.30.0 支持该字段，本项目缺席 | 17 个工具跨 5 个使用阶段（索引→发现→定位→穿透→演进），**没有任何一处告诉 agent 编排顺序**；ADR-0016 的「`index_repo` 立即返回 → 必须轮询 `list_repos`」硬约束只写在单个工具的 description 里，agent 先调别的工具就无从得知 |
| `zodShapeFor` 类型护栏是空操作（`:961`） | `maxTokens` 实跑：`"500"` / `{}` / `true` / `[1,2]` **四种非数字输入全部通过** | 全库唯一非 string 参数形同无约束，靠 handler 内 `Number()` 事后兜底；客户端拿到的 schema 里该参数类型不可读 |
| MCP 出库无统一脱敏收口点 | 1102 行 / 17 工具，`maskSensitiveText` **仅 1 处**（只用于 `repo.error`） | **当前不是活泄露**（`diagnose-engine.ts:110`、`repoqa-graphrag.ts:359/457` 各自内部已脱敏），但 `textResult()` 作为唯一出口对 payload 无兜底；且与 `CONTEXT.md` 自陈的「出库掩码不变式」存在实现漂移（v0.29 立的红线） |

三条**都不改工具数量与签名**，不触 `spec.md` §1.2 冻结面（票 07 已就此提请补一句边界说明）。我判断 (a) 是清单之外**最高杠杆的单点改动**：成本约半天，直接决定"接进来之后会不会用"——这正是 M4「陌生人接入」的下一段。

### N3 · 归因入口未暴露，C2 的裁决将无法复算

票 02 第三增量末尾自留了一句「另需决定」：`runScan` 只发布前 10 条候选，全桶归因目前靠临时诊断。若 C2 裁决要"可复算地"验证 1187，就得先让桶内容可枚举。**这是 C2 的前置工具项**，清单没提。

### N4 · 次序陷阱：C3 不能早于 C2

见 C3 判定。

---

## 4. 优先级建议（对齐项目自己的 M1–M5）

排序依据不是"清单标的 P0/P1/P2"，而是**它服务哪个度量**、**卡在谁身上**。

| 序 | 动作 | 服务指标 | 成本 | 卡点 |
| --- | --- | --- | --- | --- |
| **1** | 把 README 的 npm 安装段与 IDE 配置改对（包名 + 内测声明 + 版本串 + 工具表 2 行），并加 `readme-tool-table-parity` 与 README 版本串两条门禁 | M4 | 1–1.5 小时 | **仅需裁决 issue 07** |
| **2** | 桶语义三项裁决，写成 ADR（只裁决不改码） | **M1（唯一路径）** | 裁决 0.5 天 | **仅需用户裁决** |
| **3** | 按 ADR 落地桶语义 + 暴露归因入口，复算 1187 | M1 | 1–1.5 天 | 依赖 2 |
| **4** | 裁决 issue 07 的 (a)(b)(c)，先做 `instructions` | M4 / A 主轴可用性 | 0.5–1 天 | 仅需裁决 |
| **5** | 精度棘轮入 CI（**先补 npm script，且在 3 之后**） | M1 不回退 | 2–3 小时 | **必须晚于 2/3** |
| **6** | npm 首发：用户建 `@codecompass` org → publish → 打 tag `v0.31.0` | M4=1 / M5 | 用户本机 | **凭证**（agent 不可完成） |

**为什么 1 排在 2 前面**：1 的成本是 2 的两个数量级之一，且它服务的 M4 是"陌生人能不能进来"——一个精度 100% 达标但 README 让人装错包的项目，M4 仍然是 0。两者不冲突，可以并行（1 动 README，2 只写 ADR）。

**为什么 4 值得插在 3 之前**：它不依赖精度数字，且是 MCP-first 定位下主面的契约正确性。第 6 项（发布）一旦发生，外部 agent 拿到的是"没有 instructions、类型护栏空转"的 17 工具——发布前修比发布后修便宜。

---

## 5. 明确不属于必要补足

以下项我判定**不应作为补齐工作推进**，其中前两条是对清单本身的修正：

| 项 | 否决类型 | 理由 |
| --- | --- | --- |
| **清单的 A 路：改文档承认"内测期不发 npm"** | **与已定目标冲突** | `spec.md` §3 已把 M4=1（照 README 抄一行命令接入）定为本批验收指标，票 03(a) 就是 npm 首发。选 A 等于废掉票 03 验收，并把"包名公开放弃"这个不可回退的决定提前做掉。**除非用户明确决定不发布** |
| **把清单的实测计数当验收基线** | **口径不可复现** | 清单基于浅克隆 + 自写 scanner：文件数 460（本工作区 `git ls-files` = 531）、TODO/FIXME 3+2（实测 0）、LOC 69,583（含 py/js）。条目**方向**可用，计数**不得**写进 ADR 或门禁 |
| 总览"补五个 LICENSE" | **不适用本项目** | 已有 MIT `LICENSE`，`package.json` `license: MIT`，且票 03 发布前核验确认 LICENSE 入包 |
| 补 TTFP / Adoption 类指标 | **不可测 + 自家明令** | Local-First 无遥测 ⇒ 永远拿不到数；`spec.md` §6.4 明令不再写进对外文案，票 06 已实测确认 README/CONTEXT 干净。**加回来是倒退** |
| 为 Web 做视觉/文案/响应式升级 | **自家裁决** | `spec.md` §1.1：前端只允许收敛与非破坏性修复；Web 定位为演示厅 |
| 引入 embedding / 向量检索 | **与定位冲突** | ADR-0002。零 LLM、确定性可复现是它区别于代码问答工具的全部理由 |
| 重写 TS 适配器架构 | **加栈无收益** | v0.31 已量化（本仓孤儿 −42%、petclinic −76%、lazygit −13.1%），"跨文件是主因"的旧判断还被实测推翻过（主因在同文件） |
| 加第 18 个工具 / 第 7 个 Tab | **自家裁决** | `spec.md` §1.1 + HANDOFF §2.2 纪律：新增须附"降误报或提精度"论证，无论证不开票 |
| Web 六 Tab 收敛为 3（票 05） | **条件票，不该当缺口推** | `spec.md` §1.3：D 目标下可整票裁剪。清单未列它，与此一致 |

---

## 6. 需要用户拍板的（收敛为两件 + 一件已定执行项）

1. **裁决 `issues/07-mcp-contract-closeout.md`（提案状态）**——它把"README 表补 2 行"（= 清单 C1 第 4 条）、"IDE 配置包名"（= 清单 C4 的升级版）、`instructions`、类型护栏、出库脱敏收口打包在一起，全部**不加工具、不加签名**，不触 §1.2 冻结面。裁决后第 1、4 项可立即开工。
2. **裁决桶语义三项**（类型声明 / 接口方法及实现 / 仅被测试调用）——M1 离开 100% 的唯一路径，现挂在票 02「阻塞项」上等裁决。建议就按清单说的写成 ADR，只裁决不改码。
3. **已定执行项（无需再拍板）**：`@codecompass` org 归属 → `npm publish` → `git tag v0.31.0 && git push origin v0.31.0`。清单问的 A/B 实际已选 B，缺的是凭证而不是决策。

---

## 附：本次核实用到的可复现命令

```bash
# C1 / C4 / C5
npm view @codecompass/cli version          # → 404
npm view codecompass version repository.url # → 1.0.0 / alvinveroy/CodeCompass
grep -m1 '"version"' package.json          # → 0.31.0
grep -n "当前版本" README.md                # → :244 v0.26.0
awk '/^\| `codecompass_/{n++} END{print n}' README.md   # → 15
grep -c get_conventions README.md          # → 0
gh release list -R shing26/CodeCompass -L 3 # → v0.30.0 最新
grep -n "npx \|npm install -g" README.md    # → :151 :154

# C3
grep -n "name:\|run:" .github/workflows/ci.yml     # 三个 job，无 precision
grep -n precision package.json                      # 无输出

# C5 断言覆盖范围
grep -n "version" scripts/e2e/closeout_gate.py | head -25
grep -n README scripts/e2e/closeout_gate.py         # 无输出

# 工具数
grep -c "name: 'codecompass_" services/control-plane/src/mcp/repoqa-mcp.ts   # → 17
```
