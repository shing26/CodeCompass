# 票 04 — import/export 声明解析 + 相对路径模块表

Status: pending

## 范围

按 ADR-0022 决定 2/3，只做 **L1（相对路径 import）**，先不碰 tsconfig 别名与 workspaces。

1. 索引期 pass：对每个 TS/JS 文件解析 import/export 声明（`from '…'` / `require('…')` /
   `import('…')`），把相对 specifier 解析到仓内唯一文件（按 `RESOLVE_SUFFIXES` 的候选顺序，
   含 `/index.ts`）。
2. 产物：`file → { specifier → resolvedFile }` 表，随 snapshot 落库（与 symbols 同 commit）。
   表缺失即降级——查询期回退 v1.5 行为，并在诊断里说明「未启用模块消解」。
3. 解析器只认声明语句，**不做类型推断**：解析不到就记为解析不到，不猜目录。

## 验收

- 单测：相对 import 的唯一命中 / 同名文件（`a.ts` 与 `a/index.ts`）优先级 / 解析失败不报错只留空 /
  `import()` 动态导入与 `require` 都收。
- 探针复核：表构建后，L1 覆盖的边数应与探针的「相对路径可钉死」子集一致（票 01 的报表可扩一列）。
- 不改变任何既有查询结果（本票只产出表，不接线）。

## Comments

- 2026-10-26 立项。文件预占 `engine/repoqa-module-resolution.ts`（可与票 05 合并实现，但仍分开验收）。
