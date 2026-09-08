# 01: CHANGELOG 补全 + engines 对齐 doctor

Status: done

## 问题

- `CHANGELOG.md` 顶部只有 `[0.5.0]`，缺 0.5.1（polyglot 消费与跨语言桥接加固，commit e99c8da）与 0.6.0（resilience/doctor/分阶段索引/架构差异，commit ae411a9）条目。
- root `package.json` `engines.node: ">=20"` 与 `doctor.ts:37` 的 `NODE_MIN_MAJOR = 24` 硬检查矛盾：Node 20/22 用户 `npm start` 会因 better-sqlite3 ABI 失败，而声明却说可以。

## 任务

1. CHANGELOG 补 `[0.5.1] - 2026-08-27` 与 `[0.6.0] - 2026-08-27` 条目（内容从 commit diff 与代码注释还原）。
2. `engines.node` 改 `>=24`；README 安装节注明 better-sqlite3 原生模块 ABI 与 Node 版本必须匹配的原因。
3. 补一条版本一致性断言（纳入 issue 07 的 e2e 基线）：root package.json version = `cli.ts` VERSION = CHANGELOG 顶部版本。

## 验收

- CHANGELOG 三个版本条目齐全；`npm start` 在 Node 24 下可用、Node <24 时 doctor 给出明确报错。
- e2e 基线含版本一致性检查且通过。
