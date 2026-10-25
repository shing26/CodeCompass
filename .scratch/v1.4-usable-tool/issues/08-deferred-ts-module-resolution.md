# 票 08 — 登记 deferred：TS 模块路径解析（import + tsconfig paths）

Status: deferred

## 背景
用户批判①括注："一旦遇到 Monorepo 或 tsconfig.json 里配了 @/ 路径别名，解析器可能直接静默报错或断链，用户毫无获得感。"

实测（2026-10-19）：TS 适配器**不解析 import 声明**——跨文件关系按「符号名 + caller 自身文件优先 + 最早声明」确定性绑定（`repoqa-callchain.ts:705-724` 的 Issue 15 规则）。`@/` 别名不会触发任何报错，不匹配的边落入 BREAK/EXTERNAL/DYNAMIC 语义而非静默丢失；monorepo 同名符号存在错绑可能。

## 为什么 deferred
真实修复 = 引擎级重构：解析 import/export 声明 → 建模块解析表（含 tsconfig `baseUrl`/`paths`、package workspaces）→ 用模块图约束跨文件消解。直接威胁三仓精度棘轮的逐字节约束（self/lazygit/petclinic），且不属于「可用性手术」命题。v1.4 只做诚实披露（票 06）。

## 触发线
满足任一即立项：
1. 真实使用中出现别名/模块路径导致的错绑或断链案例（用户可复现，非推测）；
2. 票 06 的 Known Limitations 披露后，仍有用户/评审因该边界产生错误结论；
3. 需要按包边界做影响面分析的任务出现（workspaces 感知成为硬需求）。

## 立项时必须先做的事
1. 先量：三仓（self/lazygit/petclinic）按 import 声明可消解而未消解的边数（新探针，先有度量再有战役）；
2. 棘轮保护方案：改消解规则前先冻结三仓孤儿数/假边数基线，逐字节差异必须有解释；
3. ADR：模块路径消解与「不猜」原则的关系（specifier 不存在时标 EXTERNAL/UNRESOLVED 的语义细化）。

## Comments
（登记于 2026-10-19，v1.4 spec §2.3 放弃清单对应项）

v1.4 已落地的**披露侧**：README `Known Limitations` 第 2 条明确写出「不解析 import 声明、不读 tsconfig baseUrl/paths；按符号名绑定；同名可能错绑；别名不报错」。本票只登记真实修复，不在 v1.4 实现。

- **2026-10-25 前置条件 1（先量）已完成**：探针 `scripts/precision/import_resolution_probe.ts` 在 self 仓（commit 38deb70）实测：跨文件调用 4055 条，其中**同名多文件声明歧义 3274 条**；若解析 import 声明（仅相对导入——self 未用任何 `@/` 别名、无 tsconfig paths），**1301 条可被唯一钉死（40%）**。报表 `scripts/precision/out/import_probe_self.json`。数字跨过「先有度量」门槛：按本票「立项时必须先做的事」第 2、3 条（三仓棘轮基线冻结 + 消解语义 ADR）可开战役，建议批次 v1.6；lazygit（Go）/petclinic（Java）不受影响，战役前后应逐字节不变。
