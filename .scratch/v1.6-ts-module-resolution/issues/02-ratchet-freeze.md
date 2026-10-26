# 票 02 — 三仓棘轮基线冻结

Status: done

## 结论先说

基线已冻结：`scripts/precision/campaign-baselines/v1.6-module-resolution-before.json`
（三仓，确定性字段白名单，7.7 KB），配套对比器 `scripts/precision/campaign_baseline.ts`。
Phase 1/2 改绑前后只要跑一次 `compare --must-match lazygit,petclinic`，Go/Java 一旦漂移即非零退出。

## 与 `--freeze` 的关系（为什么没有复用它）

`scan_precision.ts --freeze` 冻的是**人工判定的 top-10 真值**（`scripts/precision/frozen/`，
给 e2e `check_precision_frozen` 做账实一致），它要求 `out/` dump + `verdicts/` 判定文件同时存在。
本战役要冻的是**孤儿桶读数**（孤儿总数、ratio、各桶 total、census、污染计数、抽样键），
两者语义不同，硬塞进 `frozen/` 会让「账实一致」这条既有门禁变味。故另立 campaign baseline，
并在脚本头部写清两者不要互相替代。

## 基线读数（`capture` 实测）

| 仓 | commit | 符号数 | orphanedPublic | ratio | 其他桶 |
|---|---|---|---|---|---|
| lazygit（Go） | `c07f4d3` | 10523 | 1828 | 0.173715 | hubs=5217 oversized=10 deepChains=0 oversizedFiles=10 |
| petclinic（Java） | `3858f9c` | 595 | 13 | 0.021849 | hubs=185 oversized=0 deepChains=8 oversizedFiles=0 |
| self（TS） | `d892a09` | 2271 | 173 | 0.076178 | hubs=1828 oversized=10 deepChains=33 oversizedFiles=10 |

ratio 口径与 `ratchet-baseline.json` 一致（orphanTotal / symbolCount）。

## 数据来源与可复现性

- 复用 v0.21 dogfooding 的本地克隆（`~/.mhw/clones/lazygit-1788629449744`、
  `spring-petclinic-microservices-1788629442931`）——**本机 github.com:443 不可达**
  （`git ls-remote` 21 秒超时；harness 注释里记过这个网络形态），本地克隆是唯一可行路径，
  也正好保证与 v0.21 基线可比。
- `petclinic` 的目录名与 harness 的 `findLocalClone` 前缀规则对不上（克隆叫
  `spring-petclinic-microservices-*`），用 junction 补：
  `mklink /J %TEMP%\cc-precision\petclinic <克隆路径>`，harness 走 `CLONE_DIR/{name}` 命中。
- 复现：`npm run precision -- lazygit petclinic self` 然后
  `... campaign_baseline.ts capture`。

## 验收

- `compare --must-match lazygit,petclinic` 在当前 dump 上三仓 **IDENTICAL**、退出码 0（已跑）。
- 基线只含确定性字段：无 `measuredAt`/`elapsedMs`/明细文案；抽样明细只留 `file:line:symbol` 键。

## Comments

- 2026-10-26 完成。`scripts/precision/out/` 是 gitignore 的（raw dump 可再生），
  基线 JSON 与对比器入库；`frozen/`、`verdicts/` 未动。
- 对比器用法（票 05/06 直接抄）：
  `node --max-old-space-size=4096 services/control-plane/node_modules/tsx/dist/cli.mjs scripts/precision/campaign_baseline.ts compare --must-match lazygit,petclinic`
  —— self 的漂移只打印、不判失败（Phase 1/2 本来会改它），Go/Java 漂移立刻 `EXIT=1`。
