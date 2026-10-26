# 票 03 — ADR-0022 消解语义

Status: done

产出 `docs/adr/0022-ts-module-resolution-semantics.md`（accepted）：证据分级 L1 相对路径 /
L2 tsconfig 别名 / L3 bare specifier 不参与 / L0 无声明；模块表是索引期产物、旧索引降级；
Phase 1 钉死 → Phase 2 歧义显式化（SUSPECT）；只作用于 TS/JS，Go/Java 字节不变是硬断言。

## Comments

- 2026-10-26 完成。
