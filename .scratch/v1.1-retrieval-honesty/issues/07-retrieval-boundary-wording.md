# Issue 07 — 检索边界表述收口（工具描述 + README + Go 缺口）

> 依据：ADR-0002 原文撤销的是 embedding 与"**语义检索**"这一表述，并指定补偿手段为"精确检索、别名与配置 key 提取"
> 波次：波 1（拆半）→ **整票已落地（2026-09-28，后半随票 04 同 commit）** ｜ 依赖：无 ｜ 半批：A 主命题

## 1. 现状

`mcp/repoqa-mcp.ts:270-276` 的 `codecompass_domain_radar` 描述：

> "Domain panorama over the symbol graph (deterministic, zero-LLM): … and — with a **natural-language intent** — the top-3 **anchor symbols** blended from identifier fuzzy matching, **doc-chunk evidence** and graph rank. **No embeddings.**"

问题：该工具的 `query` 实际进入 `searchChunks`（chunk **子串/LIKE** 路径）。"natural-language intent" + "intent anchors" 的表述**容易被读成语义检索**——正是 ADR-0002 要撤销的说法。

## 2. 落地（三件）

1. **工具描述补边界**：匹配方式是**关键词 / 子串**，不是语义检索；中文意图经 chunk 文本桥接，覆盖程度受 chunk 语言范围限制。
2. **chunk 覆盖边界写全**（含 Go 缺口）：
   > 当前入库范围 = `.md` / `readme*`（票 05 后按 `##` 结构化）+ `*.java` Javadoc + TS/TSX/JS/PY 注释与 docstring（票 04）；**Go 未覆盖**（触发线见 spec §1.3）。
3. **禁用词**：全仓文档不得再用"语义检索"描述任何检索面（除非是在引用 ADR-0002 的撤销决定）。`README.md` 工具表由 `sync-mcp-tool-table` **双向校验**，改描述后须**同轮重生成**。

## 验收（机器可验证）

1. `grep -rn "语义检索" README.md services/control-plane/src/mcp/` → **0 命中**（可选：入文案哨作断言）。
2. 检索面文档含 **Go 未覆盖**字样（grep 断言）；语言清单与票 04 实际实现一致。
3. README 工具表双向校验测试绿。
4. **17 工具数量与签名零变化**（本票只改文本）。

## Comments

- 2026-09-27 立项；2026-09-28 补 Go 边界（外部评估 1a 建议：让"从未被问过"不在 Go 上原样复发）。
- 2026-09-28 裁决（spec §7.1 追加裁决，用户拍板）：**拆半落地**——第 1 件（工具描述补边界：匹配方式是关键词/子串、不是语义检索）+ 第 3 件（禁用词「语义检索」清零 + README 同轮重生成）**即刻落地**（今天即为真，ADR-0002 的核心合规点）；第 2 件（chunk 覆盖语言清单，含 Go 缺口）**随票 04 补**——其验收 2「语言清单与票 04 实际实现一致」在 04 落地前无判据，先写会变成对未实现覆盖的陈述。
- 2026-09-28 **整票落地**（与票 04+05 同 commit）：
  - 第 1+2 件：`codecompass_domain_radar` 描述改写——"natural-language intent"→"natural-language query"、补「Matching is keyword/substring over indexed chunks — no embeddings, no semantic retrieval (ADR-0002)」+ **chunk 语言清单**（`.md/readme*` 按 heading 结构化 / `*.java` Javadoc / TS/TSX/JS/PY 注释与 docstring / **Go is not covered**（v1.1 spec §1.3 触发线））。
  - 第 3 件：`grep "语义检索" README.md services/control-plane/src/mcp/` **0 命中**（全仓余档三处均为 ADR-0002 引用/归档语境，票面允许）；`sync-mcp-tool-table.py` 复跑报 **in sync (17 tools)**（README 表不含完整描述列，零 diff）。
  - 验收 4：17 工具数量与签名零变化（纯文本票，e2e mcp-handshake 与工具数断言全绿）。