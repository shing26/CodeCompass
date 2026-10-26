# 票 01 — 断链标记计数接回真实 wire 值

Status: done

## 现状（评审实证）

- v1.5 spec 决策（`spec.md:27-29`）要求按 BREAK/BROKEN/EXTERNAL/DYNAMIC/UNRESOLVED/SUSPECT
  逐值清点；完成定义把它当回执的核心读数。
- 实现用**裸枚举等值**匹配（`output-contract.ts:23-31,88`），但 trace 断口在线上是
  `break: true` 布尔 + 整句 `reason`（`packages/contracts/v1.ts:141-143`），发射方写的是
  `'[Static Analysis Break: Dynamic/RPC Dispatch]'` / `_target method not found` /
  `_outside this repository`（`packages/contracts/src/repoqa.ts:125-141`）。
- 后果：trace 类载荷（`trace_call_chain` 的 hops、diagnose 的 hop 侧）`breakMarkers` 恒为 `{}`，
  恰好是 spec 要描述的那类载荷。diagnose 的 `status` 裸枚举仍能命中，故属**部分命中**，
  不是全错。
- 另：`'STATIC_ANALYSIS_BREAK'` 键全仓无任何发射方（死键），属票面清单外的自造值。

## 修法

1. 计数两条判据：裸枚举值（diagnose `status`）照旧等值计数；对象带 `break === true` 时按
   `reason` 归类——含 DYNAMIC / EXTERNAL / UNRESOLVED 常量归对应键，其余归 `BREAK`。
2. 删死键 `'STATIC_ANALYSIS_BREAK'`。
3. 归类只引用 `packages/contracts` 的单一源常量，不另写字符串（避免第二把尺）。

## 验收

- fixture：`break: true` + 三种 reason → `{DYNAMIC:1, EXTERNAL:1, UNRESOLVED:1}`；
  无 reason 的 break hop → `{BREAK:1}`。
- 既有 `output-contract` 4 条测试全绿（diagnose status 裸值计数不得回退）。
- `tsc --noEmit` 零错。

## Comments

- 2026-10-26 立项：来源 `docs/reports/code-review-2026-10-26.md` —— Standards 轴 S-1 与 Spec 轴
  「断链标记在 trace 载荷上恒为空」两轴独立收敛的同一处硬伤。范围只修计数判据，不动 17 个
  输入签名、不动锚点校验（S-2/S-3 另行登记）。
- 2026-10-26 实现（红→绿）：先补 2 条 fixture 断言——`expected {} to deeply equal { DYNAMIC: 2, … }`
  红在旧实现上，正是评审描述的读数恒空；落地后 `output-contract` 8/8 绿、`src/mcp` 4 文件
  49/49 绿、控制面 `tsc --noEmit` 零错。
  归类用 `reason.includes` 对三个 contracts 常量（`repoqa-callchain.ts:616` 的 ` HTTP GET /x`
  后缀变体已在 fixture 内覆盖），无 reason 的断口归 `BREAK`。
- 2026-10-26 未做（有意）：CHANGELOG / 版本五处属收口件，按本仓「共享区只在收口动」的约定
  留到 1.5.1 收口；S-2（行号不校验）、S-3（500 条截断静默）与 Spec 轴其余 10 条另开票。
