# Issue 10 — 错误码单一源（contracts/error-codes.ts）（外部评审 C4）

> 依据：`docs/reports/CodeCompass-框架补强建议分析-2026-09-19.md`（C4 半对半错：CONTEXT.md 表**存在**，缺口是"表在 Markdown、编译期与 gate 都不执法"）
> 判据：与票 07「readme-tool-table-parity」同一哲学——单一源 + 执法，防前后端错误码漂移
> 波次：v0.31.0（tag 未打，搭车）｜ 依赖：无 ｜ 用户裁决：2026-09-19 批准（「先做两条候选票」）

## 目标

错误码事实从「Markdown 表 + 前端手写键 + 服务端散落字面量」收敛为
**`packages/contracts/src/error-codes.ts` 单一源**：前端漏 copy 编译红，服务端漏登记测试红，文档与代码双向对账有测试。

## 现状（2026-09-19 实测）

| 面 | 现状 | 缺口 |
|---|---|---|
| 权威表 | `CONTEXT.md:82-90`「Error Code Contract（v0.27-B R3）」**存在且完整**（评审文档"实查无此节"被证伪） | Markdown 执法 = 靠纪律 |
| 前端 | `ERROR_COPY: Record<string, string>`，30 键与 CONTEXT 表**逐项一致** | 键是裸 string，新增后端码漏 copy 无编译信号 |
| 服务端 | `code: '<字面量>'` 散布 38 处（routes/ + http.ts:97/131）；`http-error.ts:108` 三元发射 `request_error`/`internal_error` | 新码可以完全绕开 CONTEXT 表（前端静默降级为原样透出） |

## 内容

### (a) `packages/contracts/src/error-codes.ts`

`ERROR_CODES` 常量表（键=值恒等，运行时 wire 格式不变）+ `ErrorCode` 类型 + `ERROR_CODE_LIST` 运行时清单。
30 码 = CONTEXT 表全集（含客户端合成的 `network_timeout`）。

### (b) 前端：`ERROR_COPY` 改 `Record<ErrorCode, string>`

30 键已全，**零新文案、零 copy-guard 风险**。此后后端加码不加 contracts → 前端编译红。

### (c) 服务端执法：扫描哨（copy-guard 同形态），**不做 38 处逐点替换**

38 个发射点无单一收口；逐点替换成常量 import 的 diff 面与收益不成比例。取本仓既有执法形态
（`copy-guard.server.test.ts` 的字符串区域扫）：新增 cp 侧守卫测试，正则提取全 src 的
`code: '<literal>'`（排除 *.test.ts），断言 ∈ `ERROR_CODE_LIST`——**新码不进 contracts 即测试红**。
`http-error.ts:108` 的三元发射是唯一非字面量形态，单点改为常量（编译期执法）。

**取舍记录**：评审建议的编译期执法只覆盖前端方向（Record 类型）；服务端方向无论怎么做都要么逐点改 38 处、要么扫描哨。
扫描哨 + 单点常量化以 1/38 的 diff 面拿到等价执法强度。

### (d) 文档对账测试 + CONTEXT.md 注记

- `errorCodes.test.ts` 增断言：`ERROR_CODE_LIST` 每一项都出现在 CONTEXT.md「Error Code Contract」节（Markdown 表 ↔ 代码双向对账，防"改表不改码"）。
- CONTEXT.md 契约段补一句：单一源已落 `packages/contracts/src/error-codes.ts`（票 10），本表与代码双向对账受测试执法。

## 验收

- [x] 前端 `ERROR_COPY` 类型化；人为删除一个 copy 键（`clone_branch_invalid`）typecheck 红——
      `TS2741: Property 'clone_branch_invalid' is missing … but required in type 'Record<…>'`（实测记录）
- [x] 服务端守卫测试在位；临时探针 `code: 'made_up_code'` 被抓——报错含 `src\__probe-error-code.ts:2 'made_up_code'`
      与三步修复指引（探针即删）（实测记录）
- [x] `ERROR_CODE_LIST` ↔ CONTEXT.md 表双向对账测试在位（放 cp 侧：web 浏览器 tsconfig 无 node 类型）
- [x] 运行时 wire 格式零变化（码值恒等；e2e **68/68** 含错误契约相关断言全绿）；cp **680** / web **364** / 四包 typecheck 净
- [x] `packages/contracts` 纯新增导出（`error-codes.ts` + index 一行 re-export），无破坏

## 实施记录（2026-09-19）

- `packages/contracts/src/error-codes.ts`：`ERROR_CODES`（30 码，键=值恒等）+ `ErrorCode` + `ERROR_CODE_LIST`；
  前端 `ERROR_COPY: Record<ErrorCode, string>`——30 键本就与 CONTEXT 表逐项一致，**零新文案、零 copy-guard 风险**。
- `http-error.ts:108` 三元发射点改 `ERROR_CODES.request_error / internal_error`（唯一非字面量形态，编译期执法）；
  其余 ~37 个字面量发射点由 `error-code-guard.test.ts` 扫描哨执法（copy-guard 同形态：字符串区域扫，排除 *.test.ts）。
- 守卫正则只认 `code: '<literal>'` 形态（票面风险 2 已登记）；哨自身的形态识别测试修了一个
  `/g` 正则 `lastIndex` 跨 exec 残留导致的误探（改为每次新建正则）。
- 对账测试落位：cp 守卫内断言 `ERROR_CODE_LIST` 每码出现在 CONTEXT.md「Error Code Contract」节
  （表与代码双向，改表不改码在此红）；web `errorCodes.test.ts` 增运行时镜像断言（防类型被放宽回
  `Record<string, string>` 后静默漏键）。
- CONTEXT.md 契约段补「单一源」注记与**新码三处同动**流程。

## 风险

1. `Record<ErrorCode, string>` 使"加码必须三处同动"（contracts → 前端 copy → CONTEXT 表）成为编译/测试强制——这是特性；新码流程写进 CONTEXT.md 注记。
2. 扫描哨的正则只认 `code: '<literal>'` 形态；未来出现新的发射形态（非三元）会漏扫——票面登记该已知边界，形态变更时同步哨。
3. `network_timeout` 是客户端合成码（无 HTTP 响应载体），入 contracts 但服务端不发射——守卫测试对它不要求服务端发射点，注释写明。

## 文件面声明（并行协作）

| 文件 | 归属 | 说明 |
|---|---|---|
| `packages/contracts/src/error-codes.ts`、`index.ts` | **共享区（契约）** | **新增** + 一行 re-export；纯新增导出 |
| `apps/repoqa-web/src/client/errorCodes.ts`（+test） | 智能体工作台 | 类型化 + 文档对账断言（**工作台线共享文件，开工前对齐认领**） |
| `services/control-plane/src/error-code-guard.test.ts`、`http-error.ts` | MCP 工具面 | 扫描哨 + 单点常量化 |
| `CONTEXT.md` | 共享区 | 契约段注记一句（收口时与其他共享文档一次推） |
