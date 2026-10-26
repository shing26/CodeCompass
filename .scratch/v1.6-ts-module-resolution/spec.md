# v1.6 — TS/JS 模块路径消解（Module Resolution）

Status: done

## 定位（ADR-0021 通道 A 论证）

**降低哪类误报**：同名符号错绑——v1.4 票 06 披露的已知边界：跨文件调用不解析 import，
按「符号名 + caller 自身文件优先 + 最早声明」绑定，monorepo 里同名符号可能被绑到错误文件，
agent 拿到错误的 `file:line` 再据此下结论。

**提升哪类精度**：已有跨文件调用边的**目标绑定精度**——不新增边，只把边钉到代码自己声明的模块。

**不是产品面扩张**：17 个 `codecompass_*` 工具输入签名与返回体结构零变化（ADR-0020 / 0021）。

## 背景与度量

- 触发线诚实标注：票 08 的触发线 1（真实用户可复现的错绑案例）**尚未出现**——本批是机会驱动，
  不是事故驱动；立项依据是「先量」已经跨过门槛。
- 度量（可复现）：`scripts/precision/import_resolution_probe.ts`

  | commit | 跨文件调用 | 同名歧义 | import 可唯一钉死 |
  |---|---|---|---|
  | `38deb70`（2026-10-25） | 4055 | 3274 | **1301** |
  | `13b1a34`（2026-10-26 复核） | 4061 | 3280 | **1301** |

  报表：`scripts/precision/out/import_probe_self.json`。
- 探针本轮修正：`TS_EXT` 的点号未转义（`robots`/`charts` 这类以 ts/js 结尾的非 TS 文件会被收进来）、
  扩展名清单存在三份、`aliasCalls` 死变量。修正后头条数字不变（1301），说明此前读数未被这个 bug 带偏。

## 决策

1. **消解只认代码自己的声明**（ADR-0022）：L1 相对路径 import → L2 tsconfig `paths`/`baseUrl` 别名；
   L3 bare specifier 不参与（落 EXTERNAL/UNRESOLVED）。
2. **模块表是索引期产物**，随 snapshot 落库、与 symbols 同 commit 口径；旧索引缺表即降级到 v1.5 行为，
   并让诊断说明「本次未启用模块消解」。
3. **Phase 1 钉死 / Phase 2 歧义显式化（SUSPECT）**，两阶段分开归因；Phase 2 是零幻觉合约要求。
4. **只作用于 TS/JS**；Go/Java 读数逐字节不变是硬断言。
5. **Phase 2 需要一个 wire 标记**（2026-10-26 裁决，替代 ADR-0022 原先的「不加新值」）：
   名字在多文件声明、import 声明也无法唯一钉死的 TS/JS 边，标 `STATIC_ANALYSIS_BREAK_AMBIGUOUS`
   （`'[Static Analysis Break: ambiguous target]'`）。理由：trace 面只有 `break`+`reason`，
   没有 `SUSPECT`；不新增标记就只能继续静默绑最早声明，违反零幻觉合约。诊断面把它映射为
   `SUSPECT`（既有枚举），Web 走既有「存疑」文案——**工具输入签名与返回体结构不变**，
   只是 `reason` 多一个取值。

## 文件面（开线声明）

- `services/control-plane/src/engine/`：新增模块消解表构建与绑定接线（预占
  `engine/repoqa-module-resolution.ts`，票 04 定稿时确认）
- `services/control-plane/src/ingest/`：索引期构建 / 落库（若需 schema 变更，同一票内写明迁移策略）
- `scripts/precision/import_resolution_probe.ts` + 消解前后对比探针
- `docs/adr/0022-ts-module-resolution-semantics.md`
- 共享区（CHANGELOG / README Known Limitations / 版本五处）：只在收口票（06）动
- **契约面（本批唯一一处，2026-10-26 裁决）**：`packages/contracts/src/repoqa.ts` 增
  `STATIC_ANALYSIS_BREAK_AMBIGUOUS` 常量 + `isAmbiguousDispatchReason` 判定；镜像类型与
  17 个工具输入 schema 不动（`reason` 是既有字段，只是多一个取值）
- **不触碰**：17 个工具输入 schema、Go/Java adapter、e2e 断言数（只增不删）

## 票清单

- 01 探针修正与复核度量（done）
- 02 三仓棘轮基线冻结（self + lazygit/petclinic 不变性）
- 03 ADR-0022 消解语义（done）
- 04 import/export 声明解析 + 相对路径模块表（索引期产物 + 单测）
- 05 接进跨文件绑定：Phase 1 钉死 → Phase 2 歧义显式化
- 06 精度复核与收口（v1.6.0）

## 完成定义

- self 仓 1301 条可钉死边**实际被钉死**（消解前后逐条 diff 可复现）；
- Phase 2 后歧义边显式可见（`SUSPECT` 计数 + 逐条归因），golden eval 幻觉率仍 0%；
- lazygit / petclinic 读数逐字节不变；
- typecheck 零错；控制面 / web / bridge 单测全绿；e2e 断言 ≥73 全绿；
- README `Known Limitations` 第 2 条改写成「已解析相对 import / 别名的边界说明」；
- 版本五处 1.6.0 + CHANGELOG `[1.6.0]`。

## Comments

- 2026-10-26 立项：票 08 的「立项必须先做」——先量（2026-10-25 完成、本轮复核）、消解语义 ADR
  （`docs/adr/0022`，本批落地）、棘轮基线（票 02 负责）。版本预占 **v1.6.0**；固定点 = v1.5.1（`13b1a34`）。
- 批次边界：只开 TS/JS 模块消解。v1.5 票 05（Go chunk 检索覆盖）仍 deferred，触发线未到，不入本批。
- **2026-10-26 收口（票 06 完成）**：版本 1.6.0 五处、CHANGELOG `[1.6.0]`、README 的
  `Known Limitations` 第 2 条改写为「只解析相对 import（L1）；别名与包名互引仍是边界」。
  门禁：cp tsc 0 / 71 文件 899 测试、web tsc 0 / 41 文件 433 测试、bridge 26、build 四前缀 0、
  e2e **73 passed / 0 failed**；三仓棘轮 `lazygit`/`petclinic` **IDENTICAL**。
- **2026-10-26 复核结论（记在这里，避免以后误读）**：立项数字 1301 是候选歧义上界，
  实际 tiebreak 暴露面 246（230 标存疑 + 16 救回）。本批没有出现「真实用户可复现的错绑」
  （触发线 1 仍未满足），所以这是一次**机会驱动**的精度加固，不是事故修复。
