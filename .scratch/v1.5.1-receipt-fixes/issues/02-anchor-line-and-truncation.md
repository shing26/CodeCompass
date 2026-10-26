# 票 02 — 锚点行号校验 + 锚点上限可见

Status: done

## 现状（评审实证）

- **S-2**：`VERIFIED` 仅凭 `fs.stat(file)` 断言，载荷给出的 `line` 从不校验（甚至可为
  `null`）。`CONTEXT.md:39` 的 Anchor 定义是「指向真实 file:line、只有 raw file 校验
  通过才能展示」，`CONTEXT.md:66` 要求「每个 file:line 引用必须过 raw-file 物理校验」——
  回执此前为它没做过的校验背书。
- **S-3**：`MAX_ANCHORS_CHECKED = 500`，超出的锚点静默丢弃，verdict 仍可为 `VERIFIED`，
  无字段无诊断记录截断。违背模块自身「绝不静默交付」与 spec:13。
- 连带：票 02 的「无 root 时锚点校验记 skipped」此前也未落地——`anchorsChecked` 照加，
  没有 skip 记录；`ANCHOR_FIELD_INVALID` 声明后从不发射。

## 修法

1. 校验升级为 `validateAnchor`：文件必须存在，且（载荷给出行号时）行号必须在文件行数内。
   行数按 64KB 块读到目标行为止，不整读大文件（出库路径上最多 500 条锚点）。
2. 行号语义：`null` 或 `0` = 未知，只做文件级校验（`RepoQaTraceHop.callLine` 用 0 表示未知，
   不能当越界）；负数/非整数 → `ANCHOR_FIELD_INVALID`；超出文件行数 →
   `ANCHOR_LINE_OUT_OF_RANGE`（新码，同时把声明已久的 `ANCHOR_FIELD_INVALID` 接上发射）。
3. 截断可见：回执新增 `anchorsTotal`（提取总数）；超上限写 `ANCHORS_TRUNCATED` 诊断，
   verdict 退 `UNCHECKED`（`ANCHORS_MISSING` 优先）。
4. 无 root 时不再把未校验算成 checked：`anchorsChecked` 只计真正验过的，另发一条
   `ANCHORS_UNCHECKED` 回执级诊断（票 02 的 skipped 要求落实）。

## 验收

- 行号在范围内 → `VERIFIED`；越界 → `ANCHORS_MISSING` + `ANCHOR_LINE_OUT_OF_RANGE`；
  `line: -3` → `ANCHOR_FIELD_INVALID`；`line: 0` → `VERIFIED` 且无诊断（不造噪音）。
- 501 条锚点 → `anchorsTotal=501`、`anchorsChecked=500`、verdict `UNCHECKED`、
  含 `ANCHORS_TRUNCATED`。
- 无 root → `anchorsChecked=0`、verdict `UNCHECKED`、含 `ANCHORS_UNCHECKED`。
- `output-contract` 14/14、`src/mcp` 55/55 绿；控制面 `tsc --noEmit` 零错。

## Comments

- 2026-10-26 立项并实现（红→绿）：先补 5 条 fixture，旧实现红在「越界行仍 VERIFIED / 截断静默 /
  无 root 计入 checked」；落地后全绿。
- 未做端到端真仓取样（本机无已索引仓，索引 self 仓成本高于本票价值）：改为对 `packages/contracts`
  的载荷形态做静态核对——`RepoQaTraceHop`（`v1.ts:132`）、`RepoQaAnchor`、diagnose `filePath+line`、
  scan/reverse/subgraph/impact 的 `filePath+line` 全部是「定义起始行」，行号语义一致，未发现会
  被新校验误杀的形状。若后续真仓出现误报，按 fixture 复现再收窄。
- 行数口径宽松一位：文件末行带换行时，比真实行数大 1 的行号会被放过（宁可漏判一次越界，
  不误杀合法锚点），已在 `lineExistsInFile` 注释写明。
- 与票 01 同批：CHANGELOG / 版本五处仍留 1.5.1 收口。
